/**
 * First-Run Detection
 *
 * Per T035 and PRD FR-7:
 * - Detect fresh installation (config file missing)
 * - Trigger setup wizard on first run
 * - Skip wizard if valid config exists
 *
 * This module determines whether Scout is being run for the first time
 * and coordinates the first-run experience.
 */

import { access, stat } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { loadConfig, validateConfig } from './config.mjs';
import { EventEmitter } from 'events';

/**
 * @typedef {Object} FirstRunStatus
 * @property {boolean} isFirstRun - Whether this is a first run (config missing)
 * @property {boolean} configExists - Whether config file exists
 * @property {boolean} configValid - Whether existing config is valid
 * @property {string[]} validationErrors - Validation error messages (if any)
 * @property {string|null} configPath - Path to config file
 */

/**
 * @typedef {Object} FirstRunCheckResult
 * @property {boolean} needsSetup - Whether setup wizard should be triggered
 * @property {'missing' | 'invalid' | 'valid'} reason - Why setup is or isn't needed
 * @property {string[]} errors - Error messages if any
 */

/**
 * Default config file path
 */
export const DEFAULT_CONFIG_PATH = process.env.HOME
  ? `${process.env.HOME}/.openclaw/workspace/scout/config.json`
  : './config.json';

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a file is readable
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>}
 */
async function isFileReadable(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * FirstRunDetector - Detects whether Scout needs first-run setup
 *
 * @extends EventEmitter
 */
export class FirstRunDetector extends EventEmitter {
  /**
   * Create a FirstRunDetector
   * @param {string} [configPath] - Path to config file (defaults to ~/.openclaw/workspace/scout/config.json)
   */
  constructor(configPath = DEFAULT_CONFIG_PATH) {
    super();

    /** @type {string} */
    this._configPath = configPath;

    /** @type {FirstRunStatus|null} */
    this._status = null;
  }

  /**
   * Get the config file path
   * @returns {string}
   */
  get configPath() {
    return this._configPath;
  }

  /**
   * Get the last check status
   * @returns {FirstRunStatus|null}
   */
  get status() {
    return this._status;
  }

  /**
   * Check if this is a first run (config needs to be created)
   *
   * Returns true if:
   * - Config file doesn't exist
   * - Config file exists but is empty or invalid JSON
   * - Config file exists but fails validation
   *
   * @returns {Promise<FirstRunCheckResult>}
   */
  async check() {
    const exists = await fileExists(this._configPath);

    if (!exists) {
      this._status = {
        isFirstRun: true,
        configExists: false,
        configValid: false,
        validationErrors: [],
        configPath: this._configPath
      };

      this.emit('first_run_detected', {
        reason: 'missing',
        configPath: this._configPath
      });

      return {
        needsSetup: true,
        reason: 'missing',
        errors: ['Config file not found']
      };
    }

    // Config exists, check if it's readable
    const readable = await isFileReadable(this._configPath);
    if (!readable) {
      this._status = {
        isFirstRun: true,
        configExists: true,
        configValid: false,
        validationErrors: ['Config file is not readable'],
        configPath: this._configPath
      };

      this.emit('first_run_detected', {
        reason: 'invalid',
        configPath: this._configPath
      });

      return {
        needsSetup: true,
        reason: 'invalid',
        errors: ['Config file is not readable']
      };
    }

    // Config exists and is readable, try to load and validate
    try {
      const config = await loadConfig(this._configPath);

      // Config loaded successfully, perform additional validation
      const errors = await validateConfig(config);

      if (errors.length > 0) {
        const errorMessages = errors.map(e => `${e.field}: ${e.message}`);

        this._status = {
          isFirstRun: false,
          configExists: true,
          configValid: false,
          validationErrors: errorMessages,
          configPath: this._configPath
        };

        this.emit('config_invalid', {
          errors: errorMessages,
          configPath: this._configPath
        });

        return {
          needsSetup: true,
          reason: 'invalid',
          errors: errorMessages
        };
      }

      // Config is valid
      this._status = {
        isFirstRun: false,
        configExists: true,
        configValid: true,
        validationErrors: [],
        configPath: this._configPath
      };

      this.emit('config_valid', {
        configPath: this._configPath
      });

      return {
        needsSetup: false,
        reason: 'valid',
        errors: []
      };

    } catch (/** @type {any} */ err) {
      const errorMessage = err.message || 'Unknown error loading config';

      this._status = {
        isFirstRun: true,
        configExists: true,
        configValid: false,
        validationErrors: [errorMessage],
        configPath: this._configPath
      };

      this.emit('first_run_detected', {
        reason: 'invalid',
        configPath: this._configPath,
        error: errorMessage
      });

      return {
        needsSetup: true,
        reason: 'invalid',
        errors: [errorMessage]
      };
    }
  }

  /**
   * Convenience method to check if setup wizard should be triggered
   * @returns {Promise<boolean>}
   */
  async needsSetupWizard() {
    const result = await this.check();
    return result.needsSetup;
  }

  /**
   * Get detailed status information
   * @returns {Promise<FirstRunStatus>}
   */
  async getStatus() {
    if (!this._status) {
      await this.check();
    }
    return /** @type {FirstRunStatus} */ (this._status);
  }
}

/**
 * Create a FirstRunDetector instance
 * @param {string} [configPath] - Path to config file
 * @returns {FirstRunDetector}
 */
export function createFirstRunDetector(configPath) {
  return new FirstRunDetector(configPath);
}

/**
 * Quick check if setup is needed (for CLI usage)
 * @param {string} [configPath] - Path to config file
 * @returns {Promise<boolean>} True if setup wizard should run
 */
export async function isFirstRun(configPath = DEFAULT_CONFIG_PATH) {
  const detector = new FirstRunDetector(configPath);
  return detector.needsSetupWizard();
}

/**
 * Quick check returning full status (for CLI usage)
 * @param {string} [configPath] - Path to config file
 * @returns {Promise<FirstRunCheckResult>}
 */
export async function checkFirstRun(configPath = DEFAULT_CONFIG_PATH) {
  const detector = new FirstRunDetector(configPath);
  return detector.check();
}

export default FirstRunDetector;
