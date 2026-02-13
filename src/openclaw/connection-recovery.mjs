/**
 * Connection Recovery - Handle network disconnections gracefully
 *
 * Per T039 and PRD NFR Reliability:
 * - Brief disconnections (<5s) should not crash session
 * - Show "Connection lost" message
 * - Attempt reconnection with bounded exponential backoff
 * - Resume if possible
 * - Fail gracefully if not
 *
 * Retry Policy (deterministic):
 * - Initial delay: 1000ms
 * - Multiplier: 2x
 * - Max delay: 5000ms
 * - Max attempts: 10 (total ~30s of retrying)
 */

import { EventEmitter } from 'events';

/**
 * @typedef {Object} RecoveryConfig
 * @property {number} [initialDelayMs=1000] - Initial retry delay
 * @property {number} [maxDelayMs=5000] - Maximum retry delay
 * @property {number} [backoffMultiplier=2] - Delay multiplier for each retry
 * @property {number} [maxAttempts=10] - Maximum reconnection attempts
 * @property {number} [jitterMs=0] - Random jitter to add (0 = no jitter)
 */

/**
 * @typedef {Object} RecoveryState
 * @property {boolean} recovering - Whether recovery is in progress
 * @property {number} attemptCount - Number of reconnection attempts
 * @property {number} nextDelayMs - Next retry delay
 * @property {number|null} lastAttemptTimestamp - Timestamp of last attempt
 */

/**
 * @typedef {Object} RecoveryResult
 * @property {boolean} success - Whether recovery succeeded
 * @property {number} attempts - Number of attempts made
 * @property {number} totalTimeMs - Total time spent recovering
 * @property {string|null} error - Error message if failed
 */

/**
 * Default configuration
 */
export const DEFAULT_RECOVERY_CONFIG = Object.freeze({
  initialDelayMs: 1000,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  maxAttempts: 10,
  jitterMs: 0
});

/**
 * Calculate the next delay using exponential backoff
 * @param {number} attempt - Current attempt number (0-based)
 * @param {RecoveryConfig} config - Recovery configuration
 * @returns {number} - Delay in milliseconds
 */
export function calculateBackoffDelay(attempt, config) {
  const { initialDelayMs = 1000, maxDelayMs = 5000, backoffMultiplier = 2, jitterMs = 0 } = config;

  // Calculate base delay with exponential backoff
  const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(baseDelay, maxDelayMs);

  // Add optional jitter
  if (jitterMs > 0) {
    const jitter = Math.random() * jitterMs;
    return Math.min(cappedDelay + jitter, maxDelayMs);
  }

  return cappedDelay;
}

/**
 * ConnectionRecovery - Handles automatic reconnection with exponential backoff
 *
 * Events:
 * - 'recovery_started': Recovery process has begun
 * - 'attempt': Reconnection attempt made {attempt: number, delayMs: number}
 * - 'attempt_failed': Reconnection attempt failed {attempt: number, error: string}
 * - 'recovered': Connection restored {attempts: number, totalTimeMs: number}
 * - 'recovery_failed': All attempts exhausted {attempts: number, totalTimeMs: number}
 * - 'recovery_cancelled': Recovery was cancelled
 *
 * @extends EventEmitter
 */
export class ConnectionRecovery extends EventEmitter {
  /**
   * Create a ConnectionRecovery instance
   * @param {function(): Promise<boolean>} checkConnection - Function to check connection
   * @param {Partial<RecoveryConfig>} [config={}] - Recovery configuration
   */
  constructor(checkConnection, config = {}) {
    super();

    if (typeof checkConnection !== 'function') {
      throw new Error('checkConnection must be a function');
    }

    /** @type {function(): Promise<boolean>} */
    this._checkConnection = checkConnection;

    /** @type {Required<RecoveryConfig>} */
    this._config = { ...DEFAULT_RECOVERY_CONFIG, ...config };

    /** @type {boolean} */
    this._recovering = false;

    /** @type {boolean} */
    this._cancelled = false;

    /** @type {number} */
    this._attemptCount = 0;

    /** @type {number} */
    this._startTimestamp = 0;

    /** @type {number|null} */
    this._lastAttemptTimestamp = null;

    /** @type {ReturnType<typeof setTimeout>|null} */
    this._timeoutId = null;
  }

  /**
   * Check if recovery is in progress
   * @returns {boolean}
   */
  get isRecovering() {
    return this._recovering;
  }

  /**
   * Get the current recovery state
   * @returns {RecoveryState}
   */
  getState() {
    return {
      recovering: this._recovering,
      attemptCount: this._attemptCount,
      nextDelayMs: this._recovering
        ? calculateBackoffDelay(this._attemptCount, this._config)
        : 0,
      lastAttemptTimestamp: this._lastAttemptTimestamp
    };
  }

  /**
   * Get the recovery configuration
   * @returns {Required<RecoveryConfig>}
   */
  getConfig() {
    return { ...this._config };
  }

  /**
   * Start the recovery process
   * @returns {Promise<RecoveryResult>}
   */
  async startRecovery() {
    if (this._recovering) {
      return {
        success: false,
        attempts: this._attemptCount,
        totalTimeMs: 0,
        error: 'Recovery already in progress'
      };
    }

    this._recovering = true;
    this._cancelled = false;
    this._attemptCount = 0;
    this._startTimestamp = Date.now();
    this._lastAttemptTimestamp = null;

    this.emit('recovery_started');

    try {
      while (this._attemptCount < this._config.maxAttempts && !this._cancelled) {
        // Calculate delay for this attempt
        const delayMs = calculateBackoffDelay(this._attemptCount, this._config);

        // Wait before attempting (except for first attempt)
        if (this._attemptCount > 0) {
          await this._delay(delayMs);
        }

        if (this._cancelled) {
          break;
        }

        // Increment attempt counter
        this._attemptCount++;
        this._lastAttemptTimestamp = Date.now();

        this.emit('attempt', {
          attempt: this._attemptCount,
          delayMs: this._attemptCount === 1 ? 0 : delayMs
        });

        // Try to reconnect
        try {
          const connected = await this._checkConnection();

          if (connected) {
            const totalTimeMs = Date.now() - this._startTimestamp;
            this._recovering = false;

            this.emit('recovered', {
              attempts: this._attemptCount,
              totalTimeMs
            });

            return {
              success: true,
              attempts: this._attemptCount,
              totalTimeMs,
              error: null
            };
          } else {
            this.emit('attempt_failed', {
              attempt: this._attemptCount,
              error: 'Connection check returned false'
            });
          }
        } catch (/** @type {any} */ err) {
          this.emit('attempt_failed', {
            attempt: this._attemptCount,
            error: err.message || 'Connection check failed'
          });
        }
      }

      // All attempts exhausted or cancelled
      const totalTimeMs = Date.now() - this._startTimestamp;
      this._recovering = false;

      if (this._cancelled) {
        this.emit('recovery_cancelled');
        return {
          success: false,
          attempts: this._attemptCount,
          totalTimeMs,
          error: 'Recovery cancelled'
        };
      }

      this.emit('recovery_failed', {
        attempts: this._attemptCount,
        totalTimeMs
      });

      return {
        success: false,
        attempts: this._attemptCount,
        totalTimeMs,
        error: `Failed to reconnect after ${this._attemptCount} attempts`
      };

    } catch (/** @type {any} */ err) {
      const totalTimeMs = Date.now() - this._startTimestamp;
      this._recovering = false;

      return {
        success: false,
        attempts: this._attemptCount,
        totalTimeMs,
        error: err.message || 'Recovery error'
      };
    }
  }

  /**
   * Cancel the recovery process
   */
  cancel() {
    if (!this._recovering) {
      return;
    }

    this._cancelled = true;

    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  }

  /**
   * Reset the recovery state
   */
  reset() {
    this.cancel();
    this._recovering = false;
    this._cancelled = false;
    this._attemptCount = 0;
    this._startTimestamp = 0;
    this._lastAttemptTimestamp = null;
  }

  /**
   * Delay for a specified duration
   * @param {number} ms - Delay in milliseconds
   * @returns {Promise<void>}
   * @private
   */
  _delay(ms) {
    return new Promise((resolve) => {
      this._timeoutId = setTimeout(() => {
        this._timeoutId = null;
        resolve();
      }, ms);
    });
  }
}

/**
 * Create a ConnectionRecovery instance
 * @param {function(): Promise<boolean>} checkConnection - Connection check function
 * @param {Partial<RecoveryConfig>} [config={}] - Recovery configuration
 * @returns {ConnectionRecovery}
 */
export function createConnectionRecovery(checkConnection, config) {
  return new ConnectionRecovery(checkConnection, config);
}

/**
 * Calculate the total maximum recovery time based on config
 * @param {RecoveryConfig} [config={}] - Recovery configuration
 * @returns {number} - Maximum time in milliseconds
 */
export function calculateMaxRecoveryTime(config = {}) {
  const { maxAttempts = 10 } = config;
  let totalTime = 0;

  for (let i = 0; i < maxAttempts; i++) {
    totalTime += calculateBackoffDelay(i, config);
  }

  return totalTime;
}

/**
 * Get the backoff schedule as an array of delays
 * @param {RecoveryConfig} [config={}] - Recovery configuration
 * @returns {number[]} - Array of delay values in milliseconds
 */
export function getBackoffSchedule(config = {}) {
  const { maxAttempts = 10 } = config;
  const schedule = [];

  for (let i = 0; i < maxAttempts; i++) {
    schedule.push(calculateBackoffDelay(i, config));
  }

  return schedule;
}

export default ConnectionRecovery;
