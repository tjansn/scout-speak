/**
 * Latency Metrics - Instrumentation for conversational latency
 *
 * Per T051 and PRD FR-2/FR-4/FR-6:
 * - Track STT latency (stt_start -> stt_done)
 * - Track TTS time-to-first-audio (tts_start -> first_audio_out)
 * - Track barge-in stop latency (barge_in_detected -> playback_stopped)
 *
 * Required Metrics:
 * - P50/P95 for STT latency on short utterances (<5s speech)
 * - P50/P95 for time-to-first-audio
 * - P50/P95 for barge-in stop latency
 *
 * Usage:
 *   const metrics = new LatencyMetrics();
 *   metrics.startStt();
 *   // ... STT processing ...
 *   metrics.endStt(audioDurationMs);
 *   console.log(metrics.getSummary());
 */

import { EventEmitter } from 'events';

/**
 * @typedef {Object} LatencyMeasurement
 * @property {number} startTime - Start timestamp (ms)
 * @property {number} endTime - End timestamp (ms)
 * @property {number} durationMs - Duration in milliseconds
 * @property {number} [audioDurationMs] - Audio duration for STT measurements
 */

/**
 * @typedef {Object} PercentileStats
 * @property {number} p50 - 50th percentile (median)
 * @property {number} p95 - 95th percentile
 * @property {number} min - Minimum value
 * @property {number} max - Maximum value
 * @property {number} avg - Average value
 * @property {number} count - Number of measurements
 */

/**
 * @typedef {Object} LatencySummary
 * @property {PercentileStats} stt - STT latency stats
 * @property {PercentileStats} tts - TTS time-to-first-audio stats
 * @property {PercentileStats} bargeIn - Barge-in stop latency stats
 * @property {number} totalMeasurements - Total measurements taken
 * @property {string} timestamp - Summary generation timestamp
 */

/**
 * @typedef {Object} LatencyMetricsConfig
 * @property {number} [maxHistorySize=1000] - Maximum measurements to retain
 * @property {boolean} [enabled=true] - Whether metrics collection is enabled
 */

/**
 * Default configuration
 */
export const DEFAULT_LATENCY_CONFIG = Object.freeze({
  maxHistorySize: 1000,
  enabled: true
});

/**
 * LatencyMetrics - Track and analyze conversational latency
 *
 * Events:
 * - 'stt_complete': STT measurement completed
 * - 'tts_first_audio': TTS first audio measurement completed
 * - 'barge_in_complete': Barge-in stop measurement completed
 * - 'threshold_exceeded': A latency exceeded its target threshold
 */
export class LatencyMetrics extends EventEmitter {
  /**
   * Create LatencyMetrics instance
   * @param {Partial<LatencyMetricsConfig>} [config={}] - Configuration
   */
  constructor(config = {}) {
    super();

    /** @type {LatencyMetricsConfig} */
    this.config = { ...DEFAULT_LATENCY_CONFIG, ...config };

    /** @type {number[]} - STT latencies */
    this._sttLatencies = [];

    /** @type {number[]} - TTS time-to-first-audio latencies */
    this._ttsLatencies = [];

    /** @type {number[]} - Barge-in stop latencies */
    this._bargeInLatencies = [];

    /** @type {number|null} - Current STT start time */
    this._sttStartTime = null;

    /** @type {number|null} - Current TTS start time */
    this._ttsStartTime = null;

    /** @type {number|null} - Current barge-in start time */
    this._bargeInStartTime = null;

    /** @type {boolean} - Whether TTS has produced first audio this session */
    this._ttsFirstAudioReceived = false;

    // Target thresholds per PRD
    /** @type {number} - FR-2: STT within 2 seconds for short utterance */
    this.STT_TARGET_MS = 2000;

    /** @type {number} - FR-4: Audio begins within 500ms */
    this.TTS_TARGET_MS = 500;

    /** @type {number} - FR-6: Barge-in stops within 200ms */
    this.BARGE_IN_TARGET_MS = 200;
  }

  /**
   * Check if metrics collection is enabled
   * @returns {boolean}
   */
  get enabled() {
    return this.config.enabled ?? true;
  }

  /**
   * Enable metrics collection
   */
  enable() {
    this.config.enabled = true;
  }

  /**
   * Disable metrics collection
   */
  disable() {
    this.config.enabled = false;
  }

  /**
   * Mark the start of STT processing
   */
  startStt() {
    if (!this.enabled) return;
    this._sttStartTime = Date.now();
  }

  /**
   * Mark the end of STT processing
   * @param {number} [audioDurationMs] - Duration of audio being transcribed
   * @returns {number|null} - Duration in ms, or null if not started
   */
  endStt(audioDurationMs) {
    if (!this.enabled || this._sttStartTime === null) return null;

    const endTime = Date.now();
    const durationMs = endTime - this._sttStartTime;
    this._sttStartTime = null;

    this._addMeasurement(this._sttLatencies, durationMs);

    // Check threshold
    if (durationMs > this.STT_TARGET_MS) {
      this.emit('threshold_exceeded', {
        type: 'stt',
        actual: durationMs,
        target: this.STT_TARGET_MS,
        audioDurationMs
      });
    }

    this.emit('stt_complete', { durationMs, audioDurationMs });
    return durationMs;
  }

  /**
   * Mark the start of TTS synthesis
   */
  startTts() {
    if (!this.enabled) return;
    this._ttsStartTime = Date.now();
    this._ttsFirstAudioReceived = false;
  }

  /**
   * Mark when first TTS audio chunk is received
   * @returns {number|null} - Duration in ms, or null if not started
   */
  firstTtsAudio() {
    if (!this.enabled || this._ttsStartTime === null || this._ttsFirstAudioReceived) {
      return null;
    }

    const endTime = Date.now();
    const durationMs = endTime - this._ttsStartTime;
    this._ttsFirstAudioReceived = true;

    this._addMeasurement(this._ttsLatencies, durationMs);

    // Check threshold
    if (durationMs > this.TTS_TARGET_MS) {
      this.emit('threshold_exceeded', {
        type: 'tts',
        actual: durationMs,
        target: this.TTS_TARGET_MS
      });
    }

    this.emit('tts_first_audio', { durationMs });
    return durationMs;
  }

  /**
   * Mark TTS synthesis complete (resets first audio tracking)
   */
  endTts() {
    this._ttsStartTime = null;
    this._ttsFirstAudioReceived = false;
  }

  /**
   * Mark the start of barge-in detection
   */
  startBargeIn() {
    if (!this.enabled) return;
    this._bargeInStartTime = Date.now();
  }

  /**
   * Mark when playback has stopped after barge-in
   * @returns {number|null} - Duration in ms, or null if not started
   */
  endBargeIn() {
    if (!this.enabled || this._bargeInStartTime === null) return null;

    const endTime = Date.now();
    const durationMs = endTime - this._bargeInStartTime;
    this._bargeInStartTime = null;

    this._addMeasurement(this._bargeInLatencies, durationMs);

    // Check threshold
    if (durationMs > this.BARGE_IN_TARGET_MS) {
      this.emit('threshold_exceeded', {
        type: 'barge_in',
        actual: durationMs,
        target: this.BARGE_IN_TARGET_MS
      });
    }

    this.emit('barge_in_complete', { durationMs });
    return durationMs;
  }

  /**
   * Add a measurement to an array, respecting max size
   * @param {number[]} array - Array to add to
   * @param {number} value - Value to add
   * @private
   */
  _addMeasurement(array, value) {
    array.push(value);

    // Trim to max size by removing oldest entries
    const maxSize = this.config.maxHistorySize ?? DEFAULT_LATENCY_CONFIG.maxHistorySize;
    while (array.length > maxSize) {
      array.shift();
    }
  }

  /**
   * Calculate percentile statistics for an array of values
   * @param {number[]} values - Array of measurements
   * @returns {PercentileStats}
   * @private
   */
  _calculatePercentiles(values) {
    if (values.length === 0) {
      return {
        p50: 0,
        p95: 0,
        min: 0,
        max: 0,
        avg: 0,
        count: 0
      };
    }

    // Sort for percentile calculation
    const sorted = [...values].sort((a, b) => a - b);

    const count = sorted.length;
    const p50Index = Math.floor(count * 0.5);
    const p95Index = Math.floor(count * 0.95);

    return {
      p50: sorted[p50Index] ?? sorted[sorted.length - 1],
      p95: sorted[p95Index] ?? sorted[sorted.length - 1],
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: values.reduce((sum, v) => sum + v, 0) / count,
      count
    };
  }

  /**
   * Get latency summary with P50/P95 statistics
   * @returns {LatencySummary}
   */
  getSummary() {
    return {
      stt: this._calculatePercentiles(this._sttLatencies),
      tts: this._calculatePercentiles(this._ttsLatencies),
      bargeIn: this._calculatePercentiles(this._bargeInLatencies),
      totalMeasurements: this._sttLatencies.length +
                         this._ttsLatencies.length +
                         this._bargeInLatencies.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get raw latency arrays for detailed analysis
   * @returns {{stt: number[], tts: number[], bargeIn: number[]}}
   */
  getRawMetrics() {
    return {
      stt: [...this._sttLatencies],
      tts: [...this._ttsLatencies],
      bargeIn: [...this._bargeInLatencies]
    };
  }

  /**
   * Check if all metrics are meeting their targets
   * @returns {{allPassing: boolean, stt: boolean, tts: boolean, bargeIn: boolean}}
   */
  checkTargets() {
    const summary = this.getSummary();

    const sttPassing = summary.stt.count === 0 || summary.stt.p95 <= this.STT_TARGET_MS;
    const ttsPassing = summary.tts.count === 0 || summary.tts.p95 <= this.TTS_TARGET_MS;
    const bargeInPassing = summary.bargeIn.count === 0 || summary.bargeIn.p95 <= this.BARGE_IN_TARGET_MS;

    return {
      allPassing: sttPassing && ttsPassing && bargeInPassing,
      stt: sttPassing,
      tts: ttsPassing,
      bargeIn: bargeInPassing
    };
  }

  /**
   * Format summary for logging/display
   * @returns {string}
   */
  formatSummary() {
    const summary = this.getSummary();
    const targets = this.checkTargets();

    const lines = [
      '=== Latency Metrics Summary ===',
      `Generated: ${summary.timestamp}`,
      '',
      `STT Latency (target: <${this.STT_TARGET_MS}ms) ${targets.stt ? '✓' : '✗'}`,
      `  Count: ${summary.stt.count}`,
      `  P50: ${summary.stt.p50.toFixed(0)}ms`,
      `  P95: ${summary.stt.p95.toFixed(0)}ms`,
      `  Min/Max: ${summary.stt.min.toFixed(0)}ms / ${summary.stt.max.toFixed(0)}ms`,
      '',
      `TTS Time-to-First-Audio (target: <${this.TTS_TARGET_MS}ms) ${targets.tts ? '✓' : '✗'}`,
      `  Count: ${summary.tts.count}`,
      `  P50: ${summary.tts.p50.toFixed(0)}ms`,
      `  P95: ${summary.tts.p95.toFixed(0)}ms`,
      `  Min/Max: ${summary.tts.min.toFixed(0)}ms / ${summary.tts.max.toFixed(0)}ms`,
      '',
      `Barge-in Stop Latency (target: <${this.BARGE_IN_TARGET_MS}ms) ${targets.bargeIn ? '✓' : '✗'}`,
      `  Count: ${summary.bargeIn.count}`,
      `  P50: ${summary.bargeIn.p50.toFixed(0)}ms`,
      `  P95: ${summary.bargeIn.p95.toFixed(0)}ms`,
      `  Min/Max: ${summary.bargeIn.min.toFixed(0)}ms / ${summary.bargeIn.max.toFixed(0)}ms`,
      '',
      `Total Measurements: ${summary.totalMeasurements}`,
      `All Targets Passing: ${targets.allPassing ? 'YES' : 'NO'}`
    ];

    return lines.join('\n');
  }

  /**
   * Reset all metrics
   */
  reset() {
    this._sttLatencies = [];
    this._ttsLatencies = [];
    this._bargeInLatencies = [];
    this._sttStartTime = null;
    this._ttsStartTime = null;
    this._bargeInStartTime = null;
    this._ttsFirstAudioReceived = false;
  }

  /**
   * Export metrics to JSON for persistence or analysis
   * @returns {string}
   */
  exportJson() {
    return JSON.stringify({
      summary: this.getSummary(),
      raw: this.getRawMetrics(),
      targets: this.checkTargets()
    }, null, 2);
  }
}

/**
 * Create a LatencyMetrics instance
 * @param {Partial<LatencyMetricsConfig>} [config={}] - Configuration
 * @returns {LatencyMetrics}
 */
export function createLatencyMetrics(config = {}) {
  return new LatencyMetrics(config);
}

// Global singleton for convenience
/** @type {LatencyMetrics|null} */
let _globalMetrics = null;

/**
 * Get or create the global LatencyMetrics instance
 * @returns {LatencyMetrics}
 */
export function getGlobalMetrics() {
  if (!_globalMetrics) {
    _globalMetrics = new LatencyMetrics();
  }
  return _globalMetrics;
}

/**
 * Reset the global metrics instance
 */
export function resetGlobalMetrics() {
  if (_globalMetrics) {
    _globalMetrics.reset();
  }
  _globalMetrics = null;
}
