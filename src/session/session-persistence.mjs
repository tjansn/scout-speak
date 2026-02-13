/**
 * Session Persistence - Manages session ID storage for reconnect/resume
 *
 * Per T050 Session Strategy & Identity Continuity:
 * - Capture `sessionId` from OpenClaw responses when provided
 * - Reuse session ID for subsequent requests in active session
 * - Persist last successful session ID for reconnect/resume behavior
 * - Reset session ID when user intentionally starts a new session
 *
 * This module handles the persistence layer for session IDs, allowing
 * conversations to maintain identity/memory continuity across restarts.
 */

import { loadConfig, saveConfig } from '../config/config.mjs';

/**
 * @typedef {Object} SessionPersistenceOptions
 * @property {string} configPath - Path to the config file
 * @property {boolean} [autoSave=true] - Auto-save session ID changes
 */

/**
 * Session persistence manager for maintaining conversation continuity
 */
export class SessionPersistence {
  /**
   * Create a SessionPersistence instance
   * @param {SessionPersistenceOptions} options
   */
  constructor(options) {
    if (!options?.configPath) {
      throw new Error('configPath is required');
    }

    /** @type {string} */
    this._configPath = options.configPath;

    /** @type {boolean} */
    this._autoSave = options.autoSave ?? true;

    /** @type {string|null} */
    this._sessionId = null;

    /** @type {boolean} */
    this._initialized = false;
  }

  /**
   * Get the current session ID
   * @returns {string|null}
   */
  get sessionId() {
    return this._sessionId;
  }

  /**
   * Check if persistence is initialized
   * @returns {boolean}
   */
  get isInitialized() {
    return this._initialized;
  }

  /**
   * Initialize and load persisted session ID from config
   * @returns {Promise<string|null>} The loaded session ID or null
   */
  async init() {
    try {
      const config = await loadConfig(this._configPath);
      this._sessionId = config.last_session_id || null;
      this._initialized = true;
      return this._sessionId;
    } catch {
      // Config file may not exist yet - that's OK
      this._sessionId = null;
      this._initialized = true;
      return null;
    }
  }

  /**
   * Update the session ID (and optionally persist it)
   * @param {string|null} sessionId - New session ID to store
   * @returns {Promise<void>}
   */
  async setSessionId(sessionId) {
    this._sessionId = sessionId;

    if (this._autoSave) {
      await this.save();
    }
  }

  /**
   * Save the current session ID to config
   * @returns {Promise<void>}
   */
  async save() {
    try {
      const config = await loadConfig(this._configPath);
      config.last_session_id = this._sessionId || '';
      await saveConfig(this._configPath, config);
    } catch (err) {
      // If config doesn't exist, we can't persist
      // This is non-fatal - session will still work in-memory
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[SessionPersistence] Failed to save session ID: ${message}`);
    }
  }

  /**
   * Reset the session (clear persisted session ID)
   * This is called when user intentionally starts a new session.
   * @returns {Promise<void>}
   */
  async reset() {
    await this.setSessionId(null);
  }

  /**
   * Load session ID without initializing (for checking if a session exists)
   * @param {string} configPath - Path to config file
   * @returns {Promise<string|null>} The session ID or null
   */
  static async loadSessionId(configPath) {
    try {
      const config = await loadConfig(configPath);
      return config.last_session_id || null;
    } catch {
      return null;
    }
  }
}

/**
 * Create a SessionPersistence instance
 * @param {SessionPersistenceOptions} options
 * @returns {SessionPersistence}
 */
export function createSessionPersistence(options) {
  return new SessionPersistence(options);
}

export default SessionPersistence;
