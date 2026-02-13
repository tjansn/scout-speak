/**
 * Performance Monitor - Detect and respond to thermal/load degradation
 *
 * Per T051 Thermal/Load Strategy:
 * - Detect sustained slowdowns
 * - Degrade gracefully by selecting lighter model/profile where configured
 * - Never degrade into glitching/clicking output silently; surface status in logs/UI
 *
 * This module monitors latency trends and detects when the system is under
 * sustained load or thermal throttling, enabling graceful degradation.
 */

import { EventEmitter } from 'events';

/**
 * @typedef {'normal' | 'degraded' | 'critical'} PerformanceLevel
 */

/**
 * @typedef {Object} PerformanceMonitorConfig
 * @property {number} [windowSizeMs=10000] - Sliding window for averaging (10s)
 * @property {number} [degradedThresholdFactor=1.5] - Factor above baseline for degraded state
 * @property {number} [criticalThresholdFactor=2.0] - Factor above baseline for critical state
 * @property {number} [minSamplesForBaseline=5] - Minimum samples before establishing baseline
 * @property {number} [checkIntervalMs=1000] - How often to check performance level
 * @property {boolean} [enabled=true] - Whether monitoring is enabled
 */

/**
 * @typedef {Object} PerformanceStats
 * @property {PerformanceLevel} level - Current performance level
 * @property {number} baselineMs - Established baseline latency
 * @property {number} currentAvgMs - Current average latency
 * @property {number} degradationFactor - How much above baseline (1.0 = at baseline)
 * @property {number} sampleCount - Number of samples in current window
 * @property {boolean} isEstablished - Whether baseline is established
 */

/**
 * Default configuration
 */
export const DEFAULT_PERFORMANCE_CONFIG = Object.freeze({
  windowSizeMs: 10000,
  degradedThresholdFactor: 1.5,
  criticalThresholdFactor: 2.0,
  minSamplesForBaseline: 5,
  checkIntervalMs: 1000,
  enabled: true
});

/**
 * PerformanceMonitor - Track and respond to system performance degradation
 *
 * Events:
 * - 'level_changed': Performance level changed (normal/degraded/critical)
 * - 'baseline_established': Initial baseline has been established
 * - 'recommendation': Degradation recommendation for session manager
 */
export class PerformanceMonitor extends EventEmitter {
  /**
   * Create PerformanceMonitor instance
   * @param {Partial<PerformanceMonitorConfig>} [config={}] - Configuration
   */
  constructor(config = {}) {
    super();

    /** @type {PerformanceMonitorConfig} */
    this.config = { ...DEFAULT_PERFORMANCE_CONFIG, ...config };

    /**
     * @type {Array<{timestamp: number, latencyMs: number}>}
     * @private
     */
    this._samples = [];

    /** @type {number|null} - Established baseline latency */
    this._baselineMs = null;

    /** @type {PerformanceLevel} */
    this._currentLevel = 'normal';

    /** @type {NodeJS.Timeout|null} */
    this._checkInterval = null;

    /** @type {boolean} */
    this._started = false;
  }

  /**
   * Check if monitoring is enabled
   * @returns {boolean}
   */
  get enabled() {
    return this.config.enabled ?? true;
  }

  /**
   * Get current performance level
   * @returns {PerformanceLevel}
   */
  get level() {
    return this._currentLevel;
  }

  /**
   * Get established baseline (or null if not established)
   * @returns {number|null}
   */
  get baseline() {
    return this._baselineMs;
  }

  /**
   * Check if baseline is established
   * @returns {boolean}
   */
  get isBaselineEstablished() {
    return this._baselineMs !== null;
  }

  /**
   * Start monitoring
   */
  start() {
    if (this._started || !this.enabled) return;

    this._started = true;
    this._checkInterval = setInterval(() => {
      this._checkPerformanceLevel();
    }, this.config.checkIntervalMs ?? DEFAULT_PERFORMANCE_CONFIG.checkIntervalMs);
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (!this._started) return;

    this._started = false;
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
  }

  /**
   * Record a latency measurement
   *
   * @param {number} latencyMs - Measured latency
   * @param {string} [_type='general'] - Type of measurement (stt/tts/etc)
   */
  recordLatency(latencyMs, _type = 'general') {
    if (!this.enabled) return;

    const now = Date.now();
    this._samples.push({ timestamp: now, latencyMs });

    // Prune old samples outside window
    const windowMs = this.config.windowSizeMs ?? DEFAULT_PERFORMANCE_CONFIG.windowSizeMs;
    const cutoff = now - windowMs;
    this._samples = this._samples.filter(s => s.timestamp > cutoff);

    // Establish baseline if we have enough samples and haven't yet
    const minSamples = this.config.minSamplesForBaseline ?? DEFAULT_PERFORMANCE_CONFIG.minSamplesForBaseline;
    if (this._baselineMs === null && this._samples.length >= minSamples) {
      this._establishBaseline();
    }
  }

  /**
   * Establish the performance baseline from current samples
   * @private
   */
  _establishBaseline() {
    if (this._samples.length === 0) return;

    // Use median as baseline (more robust than mean)
    const sorted = this._samples.map(s => s.latencyMs).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    this._baselineMs = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

    this.emit('baseline_established', { baselineMs: this._baselineMs });
  }

  /**
   * Calculate current average latency
   * @returns {number}
   * @private
   */
  _getCurrentAverage() {
    if (this._samples.length === 0) return 0;
    const sum = this._samples.reduce((acc, s) => acc + s.latencyMs, 0);
    return sum / this._samples.length;
  }

  /**
   * Check and update performance level
   * @private
   */
  _checkPerformanceLevel() {
    if (!this._baselineMs || this._samples.length === 0) return;

    const currentAvg = this._getCurrentAverage();
    const factor = currentAvg / this._baselineMs;

    const degradedThreshold = this.config.degradedThresholdFactor ?? DEFAULT_PERFORMANCE_CONFIG.degradedThresholdFactor;
    const criticalThreshold = this.config.criticalThresholdFactor ?? DEFAULT_PERFORMANCE_CONFIG.criticalThresholdFactor;

    let newLevel = /** @type {PerformanceLevel} */ ('normal');
    if (factor >= criticalThreshold) {
      newLevel = 'critical';
    } else if (factor >= degradedThreshold) {
      newLevel = 'degraded';
    }

    if (newLevel !== this._currentLevel) {
      const previousLevel = this._currentLevel;
      this._currentLevel = newLevel;

      this.emit('level_changed', {
        from: previousLevel,
        to: newLevel,
        factor,
        currentAvgMs: currentAvg,
        baselineMs: this._baselineMs
      });

      // Emit recommendations for degradation handling
      this._emitRecommendation(newLevel, factor);
    }
  }

  /**
   * Emit degradation recommendations
   * @param {PerformanceLevel} level - Current level
   * @param {number} factor - Degradation factor
   * @private
   */
  _emitRecommendation(level, factor) {
    /** @type {string[]} */
    const recommendations = [];

    if (level === 'degraded') {
      recommendations.push('Consider switching to lighter STT model (e.g., tiny.en)');
      recommendations.push('Monitor for continued degradation');
    } else if (level === 'critical') {
      recommendations.push('Switch to lightest available models');
      recommendations.push('Consider reducing audio quality settings');
      recommendations.push('Alert user about degraded performance');
    } else if (level === 'normal') {
      recommendations.push('Normal operation - no changes needed');
    }

    this.emit('recommendation', {
      level,
      factor: factor.toFixed(2),
      recommendations
    });
  }

  /**
   * Get current performance statistics
   * @returns {PerformanceStats}
   */
  getStats() {
    const currentAvg = this._getCurrentAverage();
    const factor = this._baselineMs ? currentAvg / this._baselineMs : 1.0;

    return {
      level: this._currentLevel,
      baselineMs: this._baselineMs ?? 0,
      currentAvgMs: currentAvg,
      degradationFactor: factor,
      sampleCount: this._samples.length,
      isEstablished: this._baselineMs !== null
    };
  }

  /**
   * Format status for logging
   * @returns {string}
   */
  formatStatus() {
    const stats = this.getStats();
    const levelIcon = {
      'normal': '✓',
      'degraded': '⚠',
      'critical': '✗'
    }[stats.level];

    const lines = [
      `Performance: ${levelIcon} ${stats.level.toUpperCase()}`,
      `  Baseline: ${stats.isEstablished ? `${stats.baselineMs.toFixed(0)}ms` : 'not established'}`,
      `  Current Avg: ${stats.currentAvgMs.toFixed(0)}ms`,
      `  Factor: ${stats.degradationFactor.toFixed(2)}x`,
      `  Samples: ${stats.sampleCount}`
    ];

    return lines.join('\n');
  }

  /**
   * Force re-establish baseline
   *
   * Use this after switching models or making other changes
   * that would invalidate the previous baseline.
   */
  resetBaseline() {
    this._baselineMs = null;
    this._samples = [];
    this._currentLevel = 'normal';
  }

  /**
   * Reset all state
   */
  reset() {
    this.stop();
    this.resetBaseline();
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
 * Create a PerformanceMonitor instance
 * @param {Partial<PerformanceMonitorConfig>} [config={}] - Configuration
 * @returns {PerformanceMonitor}
 */
export function createPerformanceMonitor(config = {}) {
  return new PerformanceMonitor(config);
}

// Global singleton for convenience
/** @type {PerformanceMonitor|null} */
let _globalMonitor = null;

/**
 * Get or create the global PerformanceMonitor instance
 * @returns {PerformanceMonitor}
 */
export function getGlobalPerformanceMonitor() {
  if (!_globalMonitor) {
    _globalMonitor = new PerformanceMonitor();
  }
  return _globalMonitor;
}

/**
 * Reset the global monitor instance
 */
export function resetGlobalPerformanceMonitor() {
  if (_globalMonitor) {
    _globalMonitor.dispose();
  }
  _globalMonitor = null;
}
