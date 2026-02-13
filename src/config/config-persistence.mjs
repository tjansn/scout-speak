/**
 * Config Persistence - Reliable configuration storage
 *
 * Per T040 and PRD FR-10:
 * - Gateway URL preserved after restart
 * - Gateway token preserved securely after restart
 * - All settings preserved
 * - Corruption detection
 *
 * This module provides atomic config writes, backup management,
 * and corruption recovery for reliable configuration persistence.
 */

import { EventEmitter } from 'events';
import { readFile, writeFile, rename, unlink, access, copyFile, mkdir, stat } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { dirname } from 'path';
import { createHash } from 'crypto';
import { loadConfig, validateConfig, DEFAULT_CONFIG } from './config.mjs';

/**
 * @typedef {import('./config.mjs').Config} Config
 */

/**
 * @typedef {Object} PersistenceConfig
 * @property {string} configPath - Path to main config file
 * @property {string} [backupPath] - Path to backup file (default: configPath + '.bak')
 * @property {boolean} [enableBackup=true] - Create backups before writes
 * @property {boolean} [enableChecksum=true] - Use checksums for corruption detection
 * @property {boolean} [atomicWrite=true] - Use atomic write (write to temp, then rename)
 */

/**
 * @typedef {Object} PersistenceStats
 * @property {number} loadCount - Number of successful loads
 * @property {number} saveCount - Number of successful saves
 * @property {number} backupRestoreCount - Number of backup restores
 * @property {number} corruptionDetectedCount - Number of corruptions detected
 * @property {number|null} lastLoadTimestamp - Last load timestamp
 * @property {number|null} lastSaveTimestamp - Last save timestamp
 */

/**
 * @typedef {Object} ConfigCheckResult
 * @property {boolean} valid - Whether config is valid
 * @property {boolean} exists - Whether config file exists
 * @property {boolean} checksumValid - Whether checksum matches (if enabled)
 * @property {string|null} error - Error message if invalid
 */

/**
 * Calculate checksum for config content
 * @param {string} content - Config file content
 * @returns {string} - SHA-256 checksum
 */
export function calculateChecksum(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

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
 * Ensure directory exists
 * @param {string} filePath - File path (directory will be extracted)
 * @returns {Promise<void>}
 */
async function ensureDirectory(filePath) {
  const dir = dirname(filePath);
  try {
    await mkdir(dir, { recursive: true });
  } catch (/** @type {any} */ err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

/**
 * ConfigPersistence - Reliable configuration storage with backup and corruption detection
 *
 * Events:
 * - 'loaded': Config loaded successfully {config: Config, fromBackup: boolean}
 * - 'saved': Config saved successfully
 * - 'backup_created': Backup created before save
 * - 'backup_restored': Config restored from backup
 * - 'corruption_detected': Corruption detected {error: string}
 * - 'error': Error occurred {error: string}
 *
 * @extends EventEmitter
 */
export class ConfigPersistence extends EventEmitter {
  /**
   * Create a ConfigPersistence instance
   * @param {PersistenceConfig} config - Persistence configuration
   */
  constructor(config) {
    super();

    if (!config.configPath) {
      throw new Error('configPath is required');
    }

    /** @type {string} */
    this._configPath = config.configPath;

    /** @type {string} */
    this._backupPath = config.backupPath || `${config.configPath}.bak`;

    /** @type {boolean} */
    this._enableBackup = config.enableBackup !== false;

    /** @type {boolean} */
    this._enableChecksum = config.enableChecksum !== false;

    /** @type {boolean} */
    this._atomicWrite = config.atomicWrite !== false;

    /** @type {string|null} */
    this._lastChecksum = null;

    /** @type {PersistenceStats} */
    this._stats = {
      loadCount: 0,
      saveCount: 0,
      backupRestoreCount: 0,
      corruptionDetectedCount: 0,
      lastLoadTimestamp: null,
      lastSaveTimestamp: null
    };
  }

  /**
   * Get the config file path
   * @returns {string}
   */
  get configPath() {
    return this._configPath;
  }

  /**
   * Get the backup file path
   * @returns {string}
   */
  get backupPath() {
    return this._backupPath;
  }

  /**
   * Get persistence statistics
   * @returns {PersistenceStats}
   */
  getStats() {
    return { ...this._stats };
  }

  /**
   * Check if config file exists and is valid
   * @returns {Promise<ConfigCheckResult>}
   */
  async checkConfig() {
    const exists = await fileExists(this._configPath);

    if (!exists) {
      return {
        valid: false,
        exists: false,
        checksumValid: false,
        error: 'Config file not found'
      };
    }

    try {
      const content = await readFile(this._configPath, 'utf-8');

      // Check if content is valid JSON
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        return {
          valid: false,
          exists: true,
          checksumValid: false,
          error: 'Config file contains invalid JSON'
        };
      }

      // Validate config structure
      const errors = await validateConfig(parsed);
      if (errors.length > 0) {
        return {
          valid: false,
          exists: true,
          checksumValid: false,
          error: `Validation failed: ${errors.map(e => e.message).join(', ')}`
        };
      }

      // Check checksum if enabled and we have a previous checksum
      let checksumValid = true;
      if (this._enableChecksum && this._lastChecksum) {
        const currentChecksum = calculateChecksum(content);
        checksumValid = currentChecksum === this._lastChecksum;
      }

      return {
        valid: true,
        exists: true,
        checksumValid,
        error: null
      };

    } catch (/** @type {any} */ err) {
      return {
        valid: false,
        exists: true,
        checksumValid: false,
        error: err.message || 'Failed to read config'
      };
    }
  }

  /**
   * Load configuration with corruption detection and backup fallback
   * @returns {Promise<Config>}
   */
  async load() {
    try {
      // Try to load main config
      const config = await loadConfig(this._configPath);
      const content = await readFile(this._configPath, 'utf-8');

      // Update checksum
      if (this._enableChecksum) {
        this._lastChecksum = calculateChecksum(content);
      }

      this._stats.loadCount++;
      this._stats.lastLoadTimestamp = Date.now();

      this.emit('loaded', { config, fromBackup: false });
      return config;

    } catch (/** @type {any} */ err) {
      // Main config failed, try backup
      this._stats.corruptionDetectedCount++;
      this.emit('corruption_detected', { error: err.message });

      if (this._enableBackup && await fileExists(this._backupPath)) {
        try {
          const config = await loadConfig(this._backupPath);
          const content = await readFile(this._backupPath, 'utf-8');

          // Restore backup to main config
          await copyFile(this._backupPath, this._configPath);

          if (this._enableChecksum) {
            this._lastChecksum = calculateChecksum(content);
          }

          this._stats.backupRestoreCount++;
          this._stats.loadCount++;
          this._stats.lastLoadTimestamp = Date.now();

          this.emit('backup_restored');
          this.emit('loaded', { config, fromBackup: true });
          return config;

        } catch {
          this.emit('error', { error: 'Both main config and backup are invalid' });
          throw new Error('Both main config and backup are invalid');
        }
      }

      this.emit('error', { error: err.message });
      throw err;
    }
  }

  /**
   * Load configuration or return defaults if not found
   * @returns {Promise<Config>}
   */
  async loadOrDefault() {
    try {
      return await this.load();
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  /**
   * Save configuration with optional backup
   * @param {Config} config - Configuration to save
   * @returns {Promise<void>}
   */
  async save(config) {
    // Validate before saving
    const errors = await validateConfig(config);
    if (errors.length > 0) {
      const errorMsg = errors.map(e => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Validation failed: ${errorMsg}`);
    }

    await ensureDirectory(this._configPath);

    // Create backup of current config if it exists
    if (this._enableBackup && await fileExists(this._configPath)) {
      try {
        await copyFile(this._configPath, this._backupPath);
        this.emit('backup_created');
      } catch (/** @type {any} */ err) {
        // Log warning but continue with save
        this.emit('error', { error: `Backup creation failed: ${err.message}` });
      }
    }

    // Prepare content
    const content = JSON.stringify(config, null, 2) + '\n';

    // Atomic write: write to temp file, then rename
    if (this._atomicWrite) {
      const tempPath = `${this._configPath}.tmp`;
      await writeFile(tempPath, content, 'utf-8');
      await rename(tempPath, this._configPath);
    } else {
      await writeFile(this._configPath, content, 'utf-8');
    }

    // Update checksum
    if (this._enableChecksum) {
      this._lastChecksum = calculateChecksum(content);
    }

    this._stats.saveCount++;
    this._stats.lastSaveTimestamp = Date.now();

    this.emit('saved');
  }

  /**
   * Update specific config fields
   * @param {Partial<Config>} updates - Fields to update
   * @returns {Promise<Config>}
   */
  async update(updates) {
    const currentConfig = await this.loadOrDefault();
    const newConfig = { ...currentConfig, ...updates };
    await this.save(newConfig);
    return newConfig;
  }

  /**
   * Delete config files (main and backup)
   * @returns {Promise<void>}
   */
  async delete() {
    if (await fileExists(this._configPath)) {
      await unlink(this._configPath);
    }

    if (await fileExists(this._backupPath)) {
      await unlink(this._backupPath);
    }

    this._lastChecksum = null;
  }

  /**
   * Check if config has been modified externally
   * @returns {Promise<boolean>}
   */
  async hasExternalChanges() {
    if (!this._enableChecksum || !this._lastChecksum) {
      return false;
    }

    try {
      const content = await readFile(this._configPath, 'utf-8');
      const currentChecksum = calculateChecksum(content);
      return currentChecksum !== this._lastChecksum;
    } catch {
      return true; // If we can't read, assume changes
    }
  }

  /**
   * Get file modification time
   * @returns {Promise<Date|null>}
   */
  async getLastModified() {
    try {
      const stats = await stat(this._configPath);
      return stats.mtime;
    } catch {
      return null;
    }
  }
}

/**
 * Create a ConfigPersistence instance
 * @param {PersistenceConfig} config - Persistence configuration
 * @returns {ConfigPersistence}
 */
export function createConfigPersistence(config) {
  return new ConfigPersistence(config);
}

export default ConfigPersistence;
