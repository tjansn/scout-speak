/**
 * Setup Wizard - Gateway Configuration
 *
 * Per T036 and PRD FR-7:
 * - Guide user through gateway setup
 * - Prompt for gateway URL (default: localhost:18789)
 * - Prompt for gateway token
 * - Test authenticated connection
 * - Show success/failure feedback
 *
 * This module provides an interactive CLI wizard for first-run configuration.
 */

import { createInterface } from 'readline';
import { EventEmitter } from 'events';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { OpenClawClient } from '../openclaw/openclaw-client.mjs';
import { isLocalhostUrl, validateConfig, createConfig } from '../config/config.mjs';

/**
 * @typedef {Object} WizardConfig
 * @property {string} gateway_url - Gateway URL
 * @property {string} gateway_token - Gateway authentication token
 */

/**
 * @typedef {Object} WizardResult
 * @property {boolean} success - Whether setup completed successfully
 * @property {WizardConfig|null} config - The configured values (if successful)
 * @property {string|null} error - Error message (if failed)
 */

/**
 * @typedef {Object} ConnectionTestResult
 * @property {boolean} success - Whether connection test passed
 * @property {string|null} error - Error message if failed
 * @property {number} latencyMs - Connection latency in milliseconds
 */

/**
 * Default gateway URL
 */
export const DEFAULT_GATEWAY_URL = 'http://localhost:18789';

/**
 * SetupWizard - Interactive CLI wizard for first-run configuration
 *
 * @extends EventEmitter
 */
export class SetupWizard extends EventEmitter {
  /**
   * Create a SetupWizard instance
   * @param {Object} [options] - Wizard options
   * @param {NodeJS.ReadableStream} [options.input] - Input stream (default: process.stdin)
   * @param {NodeJS.WritableStream} [options.output] - Output stream (default: process.stdout)
   * @param {boolean} [options.skipConnectionTest] - Skip connection test (for testing)
   */
  constructor(options = {}) {
    super();

    /** @type {NodeJS.ReadableStream} */
    this._input = options.input || process.stdin;

    /** @type {NodeJS.WritableStream} */
    this._output = options.output || process.stdout;

    /** @type {boolean} */
    this._skipConnectionTest = options.skipConnectionTest || false;

    /** @type {import('readline').Interface|null} */
    this._rl = null;

    /** @type {boolean} */
    this._running = false;

    /** @type {WizardConfig} */
    this._config = {
      gateway_url: DEFAULT_GATEWAY_URL,
      gateway_token: ''
    };
  }

  /**
   * Check if wizard is running
   * @returns {boolean}
   */
  get isRunning() {
    return this._running;
  }

  /**
   * Get the current wizard configuration
   * @returns {WizardConfig}
   */
  get config() {
    return { ...this._config };
  }

  /**
   * Run the setup wizard
   * @returns {Promise<WizardResult>}
   */
  async run() {
    if (this._running) {
      return {
        success: false,
        config: null,
        error: 'Wizard is already running'
      };
    }

    this._running = true;
    this._rl = createInterface({
      input: this._input,
      output: this._output
    });

    try {
      this.emit('started');
      this._writeLine('\n=== Scout First-Run Setup ===\n');

      // Step 1: Gateway URL
      this._writeLine('Step 1: Gateway Configuration\n');
      const gatewayUrl = await this._promptGatewayUrl();
      this._config.gateway_url = gatewayUrl;
      this.emit('step_complete', { step: 'gateway_url', value: gatewayUrl });

      // Step 2: Gateway Token
      const gatewayToken = await this._promptGatewayToken();
      this._config.gateway_token = gatewayToken;
      this.emit('step_complete', { step: 'gateway_token', value: '***' }); // Don't emit actual token

      // Step 3: Test Connection
      this._writeLine('\nStep 2: Testing Connection...\n');
      const testResult = await this._testConnection();

      if (!testResult.success) {
        this._writeLine(`\n[ERROR] Connection test failed: ${testResult.error}\n`);
        this.emit('connection_failed', { error: testResult.error });

        // Ask if user wants to continue anyway
        const continueAnyway = await this._promptYesNo(
          'Connection test failed. Continue with setup anyway? (y/n)',
          false
        );

        if (!continueAnyway) {
          this.emit('cancelled', { reason: 'connection_failed' });
          return {
            success: false,
            config: null,
            error: `Connection test failed: ${testResult.error}`
          };
        }
      } else {
        this._writeLine(`[SUCCESS] Connected to gateway (${testResult.latencyMs}ms)\n`);
        this.emit('connection_success', { latencyMs: testResult.latencyMs });
      }

      // Validate the configuration
      const errors = await validateConfig(this._config);
      if (errors.length > 0) {
        const errorMsg = errors.map(e => `${e.field}: ${e.message}`).join(', ');
        this._writeLine(`\n[ERROR] Configuration validation failed: ${errorMsg}\n`);
        return {
          success: false,
          config: null,
          error: `Validation failed: ${errorMsg}`
        };
      }

      this._writeLine('\n=== Setup Complete ===\n');
      this._writeLine('Gateway URL: ' + this._config.gateway_url + '\n');
      this._writeLine('Gateway Token: ' + (this._config.gateway_token ? '(configured)' : '(not set)') + '\n');

      this.emit('completed', { config: this._config });

      return {
        success: true,
        config: { ...this._config },
        error: null
      };

    } catch (/** @type {any} */ err) {
      const errorMsg = err.message || 'Unknown error';
      this.emit('error', { error: errorMsg });
      return {
        success: false,
        config: null,
        error: errorMsg
      };
    } finally {
      this._cleanup();
    }
  }

  /**
   * Prompt for gateway URL
   * @returns {Promise<string>}
   * @private
   */
  async _promptGatewayUrl() {
    let url = await this._prompt(
      `Enter OpenClaw gateway URL [${DEFAULT_GATEWAY_URL}]: `
    );

    // Use default if empty
    if (!url.trim()) {
      url = DEFAULT_GATEWAY_URL;
    }

    // Validate URL
    if (!this._isValidUrl(url)) {
      this._writeLine('[ERROR] Invalid URL format. Using default.\n');
      return DEFAULT_GATEWAY_URL;
    }

    if (!isLocalhostUrl(url)) {
      this._writeLine('[WARNING] URL is not localhost. Scout requires localhost-only connections.\n');
      const useAnyway = await this._promptYesNo('Use this URL anyway? (not recommended)', false);
      if (!useAnyway) {
        return DEFAULT_GATEWAY_URL;
      }
    }

    return url;
  }

  /**
   * Prompt for gateway token
   * @returns {Promise<string>}
   * @private
   */
  async _promptGatewayToken() {
    this._writeLine('\nGateway authentication token (leave empty if not required):\n');
    const token = await this._prompt('Enter gateway token: ');
    return token.trim();
  }

  /**
   * Test the gateway connection
   * @returns {Promise<ConnectionTestResult>}
   * @private
   */
  async _testConnection() {
    if (this._skipConnectionTest) {
      return {
        success: true,
        error: null,
        latencyMs: 0
      };
    }

    const client = new OpenClawClient(/** @type {import('../config/config.mjs').Config} */ ({
      gateway_url: this._config.gateway_url,
      gateway_token: this._config.gateway_token
    }));

    const startTime = Date.now();

    try {
      const healthy = await client.healthCheck();
      const latencyMs = Date.now() - startTime;

      if (healthy) {
        return {
          success: true,
          error: null,
          latencyMs
        };
      } else {
        return {
          success: false,
          error: 'Gateway health check failed',
          latencyMs
        };
      }
    } catch (/** @type {any} */ err) {
      return {
        success: false,
        error: err.message || 'Connection error',
        latencyMs: Date.now() - startTime
      };
    }
  }

  /**
   * Check if a string is a valid URL
   * @param {string} urlString
   * @returns {boolean}
   * @private
   */
  _isValidUrl(urlString) {
    try {
      new URL(urlString);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prompt for input
   * @param {string} question
   * @returns {Promise<string>}
   * @private
   */
  _prompt(question) {
    return new Promise((resolve) => {
      if (!this._rl) {
        resolve('');
        return;
      }
      this._rl.question(question, (answer) => {
        resolve(answer || '');
      });
    });
  }

  /**
   * Prompt for yes/no input
   * @param {string} question
   * @param {boolean} defaultValue
   * @returns {Promise<boolean>}
   * @private
   */
  async _promptYesNo(question, defaultValue) {
    const answer = await this._prompt(question + ' ');
    const trimmed = answer.trim().toLowerCase();

    if (!trimmed) {
      return defaultValue;
    }

    return trimmed === 'y' || trimmed === 'yes';
  }

  /**
   * Write a line to output
   * @param {string} text
   * @private
   */
  _writeLine(text) {
    this._output.write(text);
  }

  /**
   * Clean up resources
   * @private
   */
  _cleanup() {
    if (this._rl) {
      this._rl.close();
      this._rl = null;
    }
    this._running = false;
  }

  /**
   * Cancel the wizard
   */
  cancel() {
    this.emit('cancelled', { reason: 'user_cancelled' });
    this._cleanup();
  }
}

/**
 * Save wizard configuration to file
 * @param {string} configPath - Path to config file
 * @param {WizardConfig} wizardConfig - Configuration from wizard
 * @param {Partial<import('../config/config.mjs').Config>} [additionalConfig] - Additional config fields
 * @returns {Promise<void>}
 */
export async function saveWizardConfig(configPath, wizardConfig, additionalConfig = {}) {
  // Create full config with defaults
  const fullConfig = createConfig({
    ...additionalConfig,
    gateway_url: wizardConfig.gateway_url,
    gateway_token: wizardConfig.gateway_token
  });

  // Validate before saving
  const errors = await validateConfig(fullConfig);
  if (errors.length > 0) {
    const errorMsg = errors.map(e => `${e.field}: ${e.message}`).join(', ');
    throw new Error(`Configuration validation failed: ${errorMsg}`);
  }

  // Ensure directory exists
  const dir = dirname(configPath);
  await mkdir(dir, { recursive: true });

  // Write config
  const content = JSON.stringify(fullConfig, null, 2) + '\n';
  await writeFile(configPath, content, 'utf-8');
}

/**
 * Create a SetupWizard instance
 * @param {Object} [options] - Wizard options
 * @returns {SetupWizard}
 */
export function createSetupWizard(options) {
  return new SetupWizard(options);
}

/**
 * Run the setup wizard and save configuration
 * @param {string} configPath - Path to save config file
 * @param {Object} [options] - Wizard options
 * @returns {Promise<WizardResult>}
 */
export async function runSetupWizard(configPath, options = {}) {
  const wizard = new SetupWizard(options);

  try {
    const result = await wizard.run();

    if (result.success && result.config) {
      await saveWizardConfig(configPath, result.config);
    }

    return result;
  } catch (/** @type {any} */ err) {
    return {
      success: false,
      config: null,
      error: err.message || 'Setup failed'
    };
  }
}

export default SetupWizard;
