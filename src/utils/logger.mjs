/**
 * Logger - Centralized logging system for Scout
 *
 * Per PRD.md user story #14:
 * "As a tinkerer, I want to see logs of what's happening so that I can debug issues."
 *
 * Per algorithm_and_data_structures.md configuration:
 * - log_level: "debug" | "info" | "warn" | "error"
 * - log_to_file: boolean
 *
 * Design decisions:
 * - Console logging always happens (SSH-friendly debugging)
 * - File logging is optional and append-only
 * - Format: [timestamp] [LEVEL] [component] message
 * - No external dependencies (keeps the stack simple for tinkerers)
 * - Global singleton pattern with per-component child loggers
 */

import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { LOG_LEVELS } from '../config/config.mjs';

/**
 * Log level priority map (higher = more severe)
 * @type {Record<string, number>}
 */
const LOG_LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * @typedef {Object} LoggerConfig
 * @property {string} [level='info'] - Minimum log level to output
 * @property {boolean} [toFile=false] - Enable file logging
 * @property {string} [filePath] - Path to log file (required if toFile is true)
 * @property {boolean} [includeTimestamp=true] - Include timestamp in log output
 * @property {boolean} [colorize=true] - Use ANSI colors in console output
 */

/**
 * ANSI color codes for console output
 * @type {Record<string, string>}
 */
const COLORS = {
  reset: '\x1b[0m',
  debug: '\x1b[36m',  // Cyan
  info: '\x1b[32m',   // Green
  warn: '\x1b[33m',   // Yellow
  error: '\x1b[31m',  // Red
  dim: '\x1b[2m',     // Dim (for timestamps)
  component: '\x1b[35m' // Magenta (for component names)
};

/**
 * Format a Date object as ISO-like timestamp
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Logger class - provides structured logging with level filtering and optional file output
 */
export class Logger {
  /** @type {string} */
  #level;

  /** @type {boolean} */
  #toFile;

  /** @type {string|null} */
  #filePath;

  /** @type {boolean} */
  #includeTimestamp;

  /** @type {boolean} */
  #colorize;

  /** @type {string|null} */
  #component;

  /** @type {boolean} */
  #fileDirectoryChecked;

  /** @type {Logger|null} */
  static #globalInstance = null;

  /**
   * Create a new Logger instance
   * @param {LoggerConfig & {component?: string}} [config={}]
   */
  constructor(config = {}) {
    this.#level = config.level || 'info';
    this.#toFile = config.toFile || false;
    this.#filePath = config.filePath || null;
    this.#includeTimestamp = config.includeTimestamp !== false;
    this.#colorize = config.colorize !== false;
    this.#component = config.component || null;
    this.#fileDirectoryChecked = false;

    // Validate log level
    if (!LOG_LEVELS.includes(this.#level)) {
      throw new Error(`Invalid log level: ${this.#level}. Must be one of: ${LOG_LEVELS.join(', ')}`);
    }

    // Validate file config
    if (this.#toFile && !this.#filePath) {
      throw new Error('filePath is required when toFile is enabled');
    }
  }

  /**
   * Get or create the global logger instance
   * @param {LoggerConfig} [config] - Configuration (only used on first call)
   * @returns {Logger}
   */
  static getGlobal(config) {
    if (!Logger.#globalInstance) {
      Logger.#globalInstance = new Logger(config);
    }
    return Logger.#globalInstance;
  }

  /**
   * Configure the global logger instance
   * @param {LoggerConfig} config
   */
  static configure(config) {
    Logger.#globalInstance = new Logger(config);
  }

  /**
   * Reset the global logger (primarily for testing)
   */
  static resetGlobal() {
    Logger.#globalInstance = null;
  }

  /**
   * Create a child logger for a specific component
   * @param {string} component - Component name (e.g., 'VAD', 'STT', 'TTS')
   * @returns {Logger}
   */
  child(component) {
    return new Logger({
      level: this.#level,
      toFile: this.#toFile,
      filePath: this.#filePath || undefined,
      includeTimestamp: this.#includeTimestamp,
      colorize: this.#colorize,
      component
    });
  }

  /**
   * Check if a log level should be output
   * @param {string} level
   * @returns {boolean}
   */
  #shouldLog(level) {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.#level];
  }

  /**
   * Format a log message for console output
   * @param {string} level
   * @param {string} message
   * @param {Object} [meta]
   * @returns {string}
   */
  #formatConsole(level, message, meta) {
    const parts = [];
    const upperLevel = level.toUpperCase().padEnd(5);

    if (this.#colorize) {
      if (this.#includeTimestamp) {
        parts.push(`${COLORS.dim}${formatTimestamp(new Date())}${COLORS.reset}`);
      }
      parts.push(`${COLORS[level]}${upperLevel}${COLORS.reset}`);
      if (this.#component) {
        parts.push(`${COLORS.component}[${this.#component}]${COLORS.reset}`);
      }
      parts.push(message);
    } else {
      if (this.#includeTimestamp) {
        parts.push(formatTimestamp(new Date()));
      }
      parts.push(upperLevel);
      if (this.#component) {
        parts.push(`[${this.#component}]`);
      }
      parts.push(message);
    }

    let formatted = parts.join(' ');

    // Append metadata if present
    if (meta && Object.keys(meta).length > 0) {
      formatted += ' ' + JSON.stringify(meta);
    }

    return formatted;
  }

  /**
   * Format a log message for file output (no colors)
   * @param {string} level
   * @param {string} message
   * @param {Object} [meta]
   * @returns {string}
   */
  #formatFile(level, message, meta) {
    const parts = [];
    const upperLevel = level.toUpperCase().padEnd(5);

    parts.push(formatTimestamp(new Date()));
    parts.push(upperLevel);
    if (this.#component) {
      parts.push(`[${this.#component}]`);
    }
    parts.push(message);

    let formatted = parts.join(' ');

    if (meta && Object.keys(meta).length > 0) {
      formatted += ' ' + JSON.stringify(meta);
    }

    return formatted;
  }

  /**
   * Ensure the log file directory exists
   * @returns {Promise<void>}
   */
  async #ensureLogDirectory() {
    if (this.#fileDirectoryChecked || !this.#filePath) {
      return;
    }

    try {
      const dir = dirname(this.#filePath);
      await mkdir(dir, { recursive: true });
      this.#fileDirectoryChecked = true;
    } catch (/** @type {any} */ err) {
      // Directory might already exist, which is fine
      if (err.code !== 'EEXIST') {
        // Log to console only - don't recurse
        console.error(`[Logger] Failed to create log directory: ${err.message}`);
      }
      this.#fileDirectoryChecked = true;
    }
  }

  /**
   * Write a log entry
   * @param {string} level
   * @param {string} message
   * @param {Object} [meta]
   */
  async #write(level, message, meta) {
    if (!this.#shouldLog(level)) {
      return;
    }

    // Console output (always, synchronous)
    const consoleMessage = this.#formatConsole(level, message, meta);
    if (level === 'error') {
      console.error(consoleMessage);
    } else if (level === 'warn') {
      console.warn(consoleMessage);
    } else {
      console.log(consoleMessage);
    }

    // File output (optional, async)
    if (this.#toFile && this.#filePath) {
      await this.#ensureLogDirectory();
      const fileMessage = this.#formatFile(level, message, meta) + '\n';
      try {
        await appendFile(this.#filePath, fileMessage, 'utf-8');
      } catch (/** @type {any} */ err) {
        // Don't recurse - just log to console
        console.error(`[Logger] Failed to write to log file: ${err.message}`);
      }
    }
  }

  /**
   * Log a debug message
   * @param {string} message
   * @param {Object} [meta]
   */
  debug(message, meta) {
    // Fire and forget - don't await
    this.#write('debug', message, meta);
  }

  /**
   * Log an info message
   * @param {string} message
   * @param {Object} [meta]
   */
  info(message, meta) {
    this.#write('info', message, meta);
  }

  /**
   * Log a warning message
   * @param {string} message
   * @param {Object} [meta]
   */
  warn(message, meta) {
    this.#write('warn', message, meta);
  }

  /**
   * Log an error message
   * @param {string} message
   * @param {Object} [meta]
   */
  error(message, meta) {
    this.#write('error', message, meta);
  }

  /**
   * Get the current log level
   * @returns {string}
   */
  getLevel() {
    return this.#level;
  }

  /**
   * Set the log level dynamically
   * @param {string} level
   */
  setLevel(level) {
    if (!LOG_LEVELS.includes(level)) {
      throw new Error(`Invalid log level: ${level}. Must be one of: ${LOG_LEVELS.join(', ')}`);
    }
    this.#level = level;
  }

  /**
   * Check if file logging is enabled
   * @returns {boolean}
   */
  isFileLoggingEnabled() {
    return this.#toFile;
  }

  /**
   * Get the log file path
   * @returns {string|null}
   */
  getFilePath() {
    return this.#filePath;
  }

  /**
   * Get the component name
   * @returns {string|null}
   */
  getComponent() {
    return this.#component;
  }
}

/**
 * Create a logger from Scout config
 * @param {Object} config - Scout configuration object
 * @param {string} config.log_level - Log level
 * @param {boolean} config.log_to_file - Enable file logging
 * @param {string} [logFilePath] - Path to log file (defaults to ~/.scout/scout.log)
 * @returns {Logger}
 */
export function createLoggerFromConfig(config, logFilePath) {
  const defaultLogPath = logFilePath || `${process.env.HOME || '/tmp'}/.scout/scout.log`;

  return new Logger({
    level: config.log_level || 'info',
    toFile: config.log_to_file || false,
    filePath: config.log_to_file ? defaultLogPath : undefined,
    includeTimestamp: true,
    colorize: true
  });
}

/**
 * Convenience function to get a component logger from the global instance
 * @param {string} component - Component name
 * @returns {Logger}
 */
export function getLogger(component) {
  return Logger.getGlobal().child(component);
}

export default Logger;
