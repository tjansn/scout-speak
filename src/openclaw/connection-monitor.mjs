/**
 * ConnectionMonitor - Continuous monitoring of OpenClaw gateway connection
 *
 * Per T020 requirements:
 * - Check health every 5 seconds
 * - Update ConversationState.openclaw_connected
 * - FR-8: Show "disconnected" indicator within 5s of failure
 *
 * Per prd.md FR-8:
 * - The app must show whether it's connected to OpenClaw
 * - When OpenClaw becomes unreachable, the user sees a clear "disconnected" indicator within 5 seconds
 */

import { EventEmitter } from 'events';

/**
 * @typedef {import('./openclaw-client.mjs').OpenClawClient} OpenClawClient
 * @typedef {import('../session/conversation-state.mjs').ConversationState} ConversationState
 */

/**
 * @typedef {Object} ConnectionMonitorConfig
 * @property {number} [pollIntervalMs=5000] - Interval between health checks (FR-8 requires 5s max)
 * @property {number} [initialDelayMs=0] - Delay before first health check
 */

/**
 * Default configuration
 * @type {Readonly<Required<ConnectionMonitorConfig>>}
 */
export const DEFAULT_MONITOR_CONFIG = Object.freeze({
  pollIntervalMs: 5000, // FR-8: 5 second detection requirement
  initialDelayMs: 0
});

/**
 * ConnectionMonitor - Monitors OpenClaw gateway connection status
 *
 * Events:
 * - 'connected': Emitted when connection is established/restored
 * - 'disconnected': Emitted when connection is lost
 * - 'checkComplete': Emitted after each health check with {connected: boolean}
 * - 'error': Emitted on monitoring errors
 */
export class ConnectionMonitor extends EventEmitter {
  /**
   * @param {OpenClawClient} client - OpenClaw client for health checks
   * @param {ConversationState|null} [conversationState=null] - Optional state to update
   * @param {ConnectionMonitorConfig} [config={}] - Monitor configuration
   */
  constructor(client, conversationState = null, config = {}) {
    super();

    if (!client || typeof client.healthCheck !== 'function') {
      throw new Error('Valid OpenClawClient with healthCheck method is required');
    }

    /** @type {OpenClawClient} */
    this._client = client;

    /** @type {ConversationState|null} */
    this._conversationState = conversationState;

    /** @type {Required<ConnectionMonitorConfig>} */
    this._config = { ...DEFAULT_MONITOR_CONFIG, ...config };

    /** @type {ReturnType<typeof setInterval>|null} */
    this._intervalId = null;

    /** @type {ReturnType<typeof setTimeout>|null} */
    this._initialDelayId = null;

    /** @type {boolean} */
    this._running = false;

    /** @type {boolean} */
    this._lastKnownStatus = false;

    /** @type {number} */
    this._checkCount = 0;

    /** @type {number} */
    this._consecutiveFailures = 0;
  }

  /**
   * Get whether the monitor is currently running
   * @returns {boolean}
   */
  get isRunning() {
    return this._running;
  }

  /**
   * Get the last known connection status
   * @returns {boolean}
   */
  get isConnected() {
    return this._lastKnownStatus;
  }

  /**
   * Get monitoring statistics
   * @returns {{checkCount: number, consecutiveFailures: number, isRunning: boolean, isConnected: boolean}}
   */
  getStats() {
    return {
      checkCount: this._checkCount,
      consecutiveFailures: this._consecutiveFailures,
      isRunning: this._running,
      isConnected: this._lastKnownStatus
    };
  }

  /**
   * Start monitoring connection status
   *
   * @returns {boolean} True if started, false if already running
   */
  start() {
    if (this._running) {
      return false;
    }

    this._running = true;

    // Schedule initial check
    if (this._config.initialDelayMs > 0) {
      this._initialDelayId = setTimeout(() => {
        this._initialDelayId = null;
        this._performCheck();
        this._startPolling();
      }, this._config.initialDelayMs);
    } else {
      // Perform immediate check then start polling
      this._performCheck();
      this._startPolling();
    }

    return true;
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }

    if (this._initialDelayId) {
      clearTimeout(this._initialDelayId);
      this._initialDelayId = null;
    }

    this._running = false;
  }

  /**
   * Perform a single health check (useful for manual checks)
   * @returns {Promise<boolean>}
   */
  async check() {
    return this._performCheck();
  }

  /**
   * Start the polling interval
   * @private
   */
  _startPolling() {
    if (this._intervalId) {
      return;
    }

    this._intervalId = setInterval(() => {
      this._performCheck();
    }, this._config.pollIntervalMs);
  }

  /**
   * Perform a health check and update state
   * @returns {Promise<boolean>}
   * @private
   */
  async _performCheck() {
    this._checkCount++;

    try {
      const connected = await this._client.healthCheck();
      this._updateStatus(connected);
      return connected;
    } catch (err) {
      // healthCheck() shouldn't throw (it catches internally), but handle just in case
      this.emit('error', err);
      this._updateStatus(false);
      return false;
    }
  }

  /**
   * Update connection status and emit events
   * @param {boolean} connected
   * @private
   */
  _updateStatus(connected) {
    const wasConnected = this._lastKnownStatus;
    this._lastKnownStatus = connected;

    // Update consecutive failure counter
    if (connected) {
      this._consecutiveFailures = 0;
    } else {
      this._consecutiveFailures++;
    }

    // Update ConversationState if provided
    if (this._conversationState) {
      this._conversationState.setOpenclawConnected(connected);
    }

    // Emit status change events
    if (wasConnected !== connected) {
      if (connected) {
        this.emit('connected');
      } else {
        this.emit('disconnected');
      }
    }

    // Always emit checkComplete for monitoring
    this.emit('checkComplete', { connected });
  }

  /**
   * Dispose of resources
   */
  dispose() {
    this.stop();
    this.removeAllListeners();
  }
}

/**
 * Create a ConnectionMonitor instance
 * @param {OpenClawClient} client - OpenClaw client
 * @param {ConversationState} [conversationState] - Optional state to update
 * @param {ConnectionMonitorConfig} [config] - Monitor configuration
 * @returns {ConnectionMonitor}
 */
export function createConnectionMonitor(client, conversationState, config) {
  return new ConnectionMonitor(client, conversationState, config);
}

export default ConnectionMonitor;
