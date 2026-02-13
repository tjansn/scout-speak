#!/usr/bin/env node
/**
 * Scout - Local-first voice interface for OpenClaw AI agents
 *
 * Entry point for the Scout voice pipeline application.
 * Coordinates first-run setup, configuration loading, and conversation session.
 *
 * Per PRD User Stories:
 * - #2: First-run wizard for gateway configuration
 * - #5: Start voice conversation by opening the app
 * - #14: See logs of what's happening
 */

import { EventEmitter } from 'events';
import { parseArgs } from 'util';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

// Core components
import { FirstRunDetector, DEFAULT_CONFIG_PATH } from './config/first-run.mjs';
import { SetupWizard, saveWizardConfig } from './setup/setup-wizard.mjs';
import { ConfigPersistence } from './config/config-persistence.mjs';
import { SessionManager } from './session/session-manager.mjs';
import { ConsoleUI } from './ui/console-ui.mjs';
import { Logger, createLoggerFromConfig } from './utils/logger.mjs';
import { DEFAULT_CONFIG } from './config/config.mjs';

/**
 * @typedef {import('./config/config.mjs').Config} Config
 */

/**
 * CLI options parsed from command line
 * @typedef {Object} CliOptions
 * @property {string} configPath - Path to configuration file
 * @property {boolean} help - Show help message
 * @property {boolean} version - Show version
 * @property {boolean} setup - Force run setup wizard
 * @property {string} logLevel - Override log level
 * @property {boolean} debug - Enable debug logging
 */

/**
 * Parse command line arguments
 * @returns {CliOptions}
 */
function parseCliArgs() {
  const options = {
    config: { type: /** @type {'string'} */ ('string'), short: 'c' },
    help: { type: /** @type {'boolean'} */ ('boolean'), short: 'h' },
    version: { type: /** @type {'boolean'} */ ('boolean'), short: 'v' },
    setup: { type: /** @type {'boolean'} */ ('boolean'), short: 's' },
    'log-level': { type: /** @type {'string'} */ ('string'), short: 'l' },
    debug: { type: /** @type {'boolean'} */ ('boolean'), short: 'd' }
  };

  try {
    const { values } = parseArgs({ options, allowPositionals: false });
    return {
      configPath: /** @type {string} */ (values.config) || DEFAULT_CONFIG_PATH,
      help: /** @type {boolean} */ (values.help) || false,
      version: /** @type {boolean} */ (values.version) || false,
      setup: /** @type {boolean} */ (values.setup) || false,
      logLevel: /** @type {string} */ (values['log-level']) || '',
      debug: /** @type {boolean} */ (values.debug) || false
    };
  } catch {
    return {
      configPath: DEFAULT_CONFIG_PATH,
      help: false,
      version: false,
      setup: false,
      logLevel: '',
      debug: false
    };
  }
}

/**
 * Get the package version from package.json
 * @returns {Promise<string>}
 */
async function getVersion() {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const packagePath = join(__dirname, '..', 'package.json');
    const packageJson = await readFile(packagePath, 'utf-8');
    const pkg = JSON.parse(packageJson);
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Scout - Local-first voice interface for OpenClaw AI agents

Usage: scout [options]

Options:
  -c, --config <path>     Path to configuration file
                          (default: ~/.openclaw/workspace/scout/config.json)
  -s, --setup            Run setup wizard (even if config exists)
  -l, --log-level <lvl>  Override log level (debug, info, warn, error)
  -d, --debug            Enable debug logging (shortcut for --log-level debug)
  -h, --help             Show this help message
  -v, --version          Show version number

Environment Variables:
  SCOUT_CONFIG           Path to configuration file (overridden by --config)
  OPENCLAW_GATEWAY_TOKEN Gateway authentication token

Examples:
  scout                     Start with default configuration
  scout --setup            Run setup wizard
  scout --config ./my.json Use custom config file
  scout --debug            Start with debug logging

For more information, see: https://github.com/tjansn/scout-speak
`);
}

/**
 * Scout application class - coordinates all voice pipeline components
 */
export class Scout extends EventEmitter {
  /**
   * Create a Scout instance
   * @param {CliOptions} options - CLI options
   */
  constructor(options) {
    super();

    /** @type {CliOptions} */
    this._options = options;

    /** @type {Config|null} */
    this._config = null;

    /** @type {Logger|null} */
    this._logger = null;

    /** @type {ConfigPersistence|null} */
    this._configPersistence = null;

    /** @type {SessionManager|null} */
    this._sessionManager = null;

    /** @type {ConsoleUI|null} */
    this._consoleUI = null;

    /** @type {boolean} */
    this._running = false;

    /** @type {boolean} */
    this._shuttingDown = false;
  }

  /**
   * Initialize Scout
   * @returns {Promise<boolean>} True if initialization succeeded
   */
  async init() {
    try {
      // Check for first-run or forced setup
      const firstRunDetector = new FirstRunDetector(this._options.configPath);
      const checkResult = await firstRunDetector.check();

      if (checkResult.needsSetup || this._options.setup) {
        const setupSuccess = await this._runSetupWizard();
        if (!setupSuccess) {
          return false;
        }
      }

      // Load configuration
      this._configPersistence = new ConfigPersistence({
        configPath: this._options.configPath
      });

      try {
        this._config = await this._configPersistence.load();
      } catch (err) {
        console.error(`Failed to load configuration: ${err instanceof Error ? err.message : err}`);
        console.error('Run \'scout --setup\' to create a new configuration.');
        return false;
      }

      // Apply CLI overrides
      if (this._options.debug) {
        this._config.log_level = 'debug';
      } else if (this._options.logLevel) {
        this._config.log_level = this._options.logLevel;
      }

      // Initialize logger
      this._logger = createLoggerFromConfig(this._config);
      Logger.configure({
        level: this._config.log_level,
        toFile: this._config.log_to_file,
        filePath: this._config.log_to_file ? `${process.env.HOME || '/tmp'}/.scout/scout.log` : undefined
      });

      this._logger.info('Scout initializing', { configPath: this._options.configPath });

      // Create session manager
      this._sessionManager = new SessionManager({
        vadModelPath: this._config.vad_model_path,
        whisperPath: this._config.whisper_path,
        sttModelPath: this._config.stt_model_path,
        ttsModelPath: this._config.tts_model_path,
        gateway_url: this._config.gateway_url,
        gateway_token: this._config.gateway_token,
        configPath: this._options.configPath,
        persistSession: true,
        sampleRate: this._config.sample_rate,
        ttsSampleRate: this._config.tts_sample_rate,
        silenceDurationMs: this._config.silence_duration_ms,
        bargeInEnabled: this._config.barge_in_enabled,
        bargeInCooldownMs: this._config.barge_in_cooldown_ms,
        wakeWordEnabled: this._config.wake_word_enabled,
        wakeWordPhrase: this._config.wake_word_phrase,
        displayMode: /** @type {import('./ui/display-formatter.mjs').DisplayMode} */ (this._config.display_mode)
      });

      // Create and attach console UI
      this._consoleUI = new ConsoleUI({
        displayMode: /** @type {import('./ui/display-formatter.mjs').DisplayMode} */ (this._config.display_mode),
        colorOutput: true
      });
      this._consoleUI.attach(this._sessionManager);

      // Set up session manager event logging
      this._setupEventLogging();

      // Initialize session manager (loads VAD model, etc.)
      await this._sessionManager.init();

      this._logger.info('Scout initialized successfully');
      return true;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Initialization failed: ${message}`);
      if (this._logger) {
        this._logger.error('Initialization failed', { error: message });
      }
      return false;
    }
  }

  /**
   * Run the setup wizard
   * @returns {Promise<boolean>} True if setup succeeded
   * @private
   */
  async _runSetupWizard() {
    console.log('\nWelcome to Scout - Voice Interface for OpenClaw\n');

    const wizard = new SetupWizard();
    const result = await wizard.run();

    if (!result.success || !result.config) {
      console.error(`\nSetup cancelled or failed: ${result.error || 'Unknown error'}`);
      return false;
    }

    // Save the configuration with defaults for model paths
    try {
      await saveWizardConfig(this._options.configPath, result.config, {
        // Set default model paths (user can customize later)
        vad_model_path: DEFAULT_CONFIG.vad_model_path,
        whisper_path: DEFAULT_CONFIG.whisper_path,
        stt_model_path: DEFAULT_CONFIG.stt_model_path,
        tts_model_path: DEFAULT_CONFIG.tts_model_path
      });
      console.log(`\nConfiguration saved to: ${this._options.configPath}\n`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to save configuration: ${message}`);
      return false;
    }
  }

  /**
   * Set up event logging for session manager
   * @private
   */
  _setupEventLogging() {
    if (!this._sessionManager || !this._logger) return;

    const logger = this._logger.child('Session');

    this._sessionManager.on('initialized', () => {
      logger.debug('Session manager initialized');
    });

    this._sessionManager.on('started', () => {
      logger.info('Session started');
    });

    this._sessionManager.on('stopped', () => {
      logger.info('Session stopped');
    });

    this._sessionManager.on('state_changed', (data) => {
      logger.debug('State changed', { from: data.from, to: data.to, reason: data.reason });
    });

    this._sessionManager.on('transcript', (data) => {
      logger.info('Transcript received', { text: data.text });
    });

    this._sessionManager.on('response', (data) => {
      logger.info('Response received', { text: data.text?.substring(0, 50) + '...' });
    });

    this._sessionManager.on('barge_in', () => {
      logger.debug('Barge-in detected');
    });

    this._sessionManager.on('error', (data) => {
      logger.error('Session error', { type: data.type, message: data.message });
    });

    this._sessionManager.on('connection_changed', (data) => {
      logger.info('Connection status', { connected: data.connected });
    });

    this._sessionManager.on('session_restored', (data) => {
      logger.info('Session restored', { sessionId: data.sessionId });
    });

    this._sessionManager.on('wake_word_detected', (data) => {
      logger.debug('Wake word detected', data);
    });
  }

  /**
   * Start the voice conversation session
   * @returns {Promise<void>}
   */
  async start() {
    if (!this._sessionManager) {
      throw new Error('Scout not initialized. Call init() first.');
    }

    if (this._running) {
      return;
    }

    this._running = true;

    // Set up signal handlers for graceful shutdown
    this._setupSignalHandlers();

    if (this._logger) {
      this._logger.info('Starting voice session');
    }

    // Print startup message
    console.log('\n--- Scout Voice Interface ---');
    console.log('Speak to interact with your OpenClaw agent.');
    console.log('Press Ctrl+C to exit.\n');

    try {
      await this._sessionManager.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to start session: ${message}`);
      if (this._logger) {
        this._logger.error('Failed to start session', { error: message });
      }
      await this.shutdown();
    }
  }

  /**
   * Set up signal handlers for graceful shutdown
   * @private
   */
  _setupSignalHandlers() {
    /** @param {string} signal */
    const handleSignal = async (signal) => {
      if (this._shuttingDown) {
        console.log('\nForcing exit...');
        process.exit(1);
      }

      console.log(`\nReceived ${signal}, shutting down...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));

    // Handle uncaught errors
    process.on('uncaughtException', async (err) => {
      console.error('Uncaught exception:', err.message);
      if (this._logger) {
        this._logger.error('Uncaught exception', { error: err.message, stack: err.stack });
      }
      await this.shutdown();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      console.error('Unhandled rejection:', message);
      if (this._logger) {
        this._logger.error('Unhandled rejection', { error: message });
      }
      await this.shutdown();
      process.exit(1);
    });
  }

  /**
   * Gracefully shut down Scout
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this._shuttingDown) {
      return;
    }

    this._shuttingDown = true;

    if (this._logger) {
      this._logger.info('Shutting down Scout');
    }

    // Detach console UI
    if (this._consoleUI) {
      this._consoleUI.detach();
      this._consoleUI.dispose();
      this._consoleUI = null;
    }

    // Dispose session manager
    if (this._sessionManager) {
      await this._sessionManager.dispose();
      this._sessionManager = null;
    }

    this._running = false;

    if (this._logger) {
      this._logger.info('Scout shut down complete');
    }

    console.log('\nGoodbye!');
  }

  /**
   * Get current state
   * @returns {object|null}
   */
  getState() {
    return this._sessionManager?.getState() ?? null;
  }

  /**
   * Get statistics
   * @returns {object|null}
   */
  getStats() {
    return this._sessionManager?.getStats() ?? null;
  }

  /**
   * Check if running
   * @returns {boolean}
   */
  get isRunning() {
    return this._running;
  }

  /**
   * Get the configuration
   * @returns {Config|null}
   */
  get config() {
    return this._config;
  }
}

/**
 * Main entry point
 */
async function main() {
  const options = parseCliArgs();

  // Handle --help
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Handle --version
  if (options.version) {
    const version = await getVersion();
    console.log(`Scout v${version}`);
    process.exit(0);
  }

  // Override config path from environment if not set via CLI
  if (options.configPath === DEFAULT_CONFIG_PATH && process.env.SCOUT_CONFIG) {
    options.configPath = process.env.SCOUT_CONFIG;
  }

  // Create and run Scout
  const scout = new Scout(options);

  const initialized = await scout.init();
  if (!initialized) {
    process.exit(1);
  }

  await scout.start();
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}

export default Scout;
