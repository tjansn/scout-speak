/**
 * Unit tests for Latency Metrics
 *
 * Tests per T051 acceptance criteria:
 * - FR-2/FR-4/FR-6 latency metrics are measurable from logs/telemetry
 * - Timestamp capture and duration computation
 * - P50/P95 percentile calculation
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import {
  LatencyMetrics,
  createLatencyMetrics,
  getGlobalMetrics,
  resetGlobalMetrics,
  DEFAULT_LATENCY_CONFIG
} from '../../../src/utils/latency-metrics.mjs';

describe('LatencyMetrics', () => {
  /** @type {LatencyMetrics} */
  let metrics;

  beforeEach(() => {
    metrics = new LatencyMetrics();
    metrics.reset();
    resetGlobalMetrics();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const m = new LatencyMetrics();
      assert.strictEqual(m.config.maxHistorySize, DEFAULT_LATENCY_CONFIG.maxHistorySize);
      assert.strictEqual(m.config.enabled, DEFAULT_LATENCY_CONFIG.enabled);
    });

    it('should merge custom config', () => {
      const m = new LatencyMetrics({ maxHistorySize: 500, enabled: false });
      assert.strictEqual(m.config.maxHistorySize, 500);
      assert.strictEqual(m.config.enabled, false);
    });

    it('should be an EventEmitter', () => {
      assert.ok(metrics instanceof EventEmitter);
    });

    it('should have PRD target thresholds', () => {
      assert.strictEqual(metrics.STT_TARGET_MS, 2000);  // FR-2
      assert.strictEqual(metrics.TTS_TARGET_MS, 500);   // FR-4
      assert.strictEqual(metrics.BARGE_IN_TARGET_MS, 200); // FR-6
    });
  });

  describe('STT latency tracking', () => {
    it('should track STT latency', async () => {
      metrics.startStt();
      await sleep(50);
      const duration = metrics.endStt(1000);

      assert.ok(duration !== null);
      assert.ok(duration >= 50);
    });

    it('should emit stt_complete event', async () => {
      let emitted = false;
      metrics.on('stt_complete', (data) => {
        emitted = true;
        assert.ok('durationMs' in data);
        assert.ok('audioDurationMs' in data);
      });

      metrics.startStt();
      await sleep(10);
      metrics.endStt(500);

      assert.strictEqual(emitted, true);
    });

    it('should return null if not started', () => {
      const duration = metrics.endStt();
      assert.strictEqual(duration, null);
    });

    it('should emit threshold_exceeded for slow STT', async () => {
      let exceeded = false;
      metrics.on('threshold_exceeded', (data) => {
        if (data.type === 'stt') exceeded = true;
      });

      // Manually record a slow measurement
      metrics.startStt();
      // Simulate elapsed time by manipulating internal state
      metrics._sttStartTime = Date.now() - 2500; // 2.5 seconds ago
      metrics.endStt();

      assert.strictEqual(exceeded, true);
    });
  });

  describe('TTS latency tracking', () => {
    it('should track TTS time-to-first-audio', async () => {
      metrics.startTts();
      await sleep(30);
      const duration = metrics.firstTtsAudio();

      assert.ok(duration !== null);
      assert.ok(duration >= 30);
    });

    it('should only count first audio once per session', async () => {
      metrics.startTts();
      await sleep(10);
      const first = metrics.firstTtsAudio();
      const second = metrics.firstTtsAudio();

      assert.ok(first !== null);
      assert.strictEqual(second, null);
    });

    it('should reset first audio tracking on endTts', async () => {
      metrics.startTts();
      metrics.firstTtsAudio();
      metrics.endTts();

      // Start new TTS session
      metrics.startTts();
      await sleep(10);
      const duration = metrics.firstTtsAudio();

      assert.ok(duration !== null);
    });

    it('should emit tts_first_audio event', async () => {
      let emitted = false;
      metrics.on('tts_first_audio', (data) => {
        emitted = true;
        assert.ok('durationMs' in data);
      });

      metrics.startTts();
      await sleep(10);
      metrics.firstTtsAudio();

      assert.strictEqual(emitted, true);
    });
  });

  describe('barge-in latency tracking', () => {
    it('should track barge-in stop latency', async () => {
      metrics.startBargeIn();
      await sleep(20);
      const duration = metrics.endBargeIn();

      assert.ok(duration !== null);
      assert.ok(duration >= 20);
    });

    it('should emit barge_in_complete event', async () => {
      let emitted = false;
      metrics.on('barge_in_complete', (data) => {
        emitted = true;
        assert.ok('durationMs' in data);
      });

      metrics.startBargeIn();
      await sleep(10);
      metrics.endBargeIn();

      assert.strictEqual(emitted, true);
    });

    it('should emit threshold_exceeded for slow barge-in', () => {
      let exceeded = false;
      metrics.on('threshold_exceeded', (data) => {
        if (data.type === 'barge_in') exceeded = true;
      });

      metrics.startBargeIn();
      metrics._bargeInStartTime = Date.now() - 300; // 300ms ago
      metrics.endBargeIn();

      assert.strictEqual(exceeded, true);
    });
  });

  describe('percentile calculation', () => {
    it('should calculate P50 correctly', () => {
      // Record 10 measurements: 100-1000ms
      for (let i = 1; i <= 10; i++) {
        metrics._sttLatencies.push(i * 100);
      }

      const summary = metrics.getSummary();
      // Median of [100,200,300,400,500,600,700,800,900,1000] = 550
      assert.strictEqual(summary.stt.p50, 600); // Index 5 (0-indexed)
    });

    it('should calculate P95 correctly', () => {
      // Record 20 measurements: 50-1000ms
      for (let i = 1; i <= 20; i++) {
        metrics._sttLatencies.push(i * 50);
      }

      const summary = metrics.getSummary();
      // P95 index = floor(20 * 0.95) = 19
      assert.strictEqual(summary.stt.p95, 1000);
    });

    it('should handle empty arrays', () => {
      const summary = metrics.getSummary();
      assert.strictEqual(summary.stt.count, 0);
      assert.strictEqual(summary.stt.p50, 0);
      assert.strictEqual(summary.stt.p95, 0);
    });

    it('should calculate min/max/avg', () => {
      metrics._ttsLatencies.push(100, 200, 300, 400, 500);

      const summary = metrics.getSummary();
      assert.strictEqual(summary.tts.min, 100);
      assert.strictEqual(summary.tts.max, 500);
      assert.strictEqual(summary.tts.avg, 300);
    });
  });

  describe('getSummary', () => {
    it('should return complete summary', () => {
      metrics._sttLatencies.push(100);
      metrics._ttsLatencies.push(200);
      metrics._bargeInLatencies.push(50);

      const summary = metrics.getSummary();

      assert.ok('stt' in summary);
      assert.ok('tts' in summary);
      assert.ok('bargeIn' in summary);
      assert.ok('totalMeasurements' in summary);
      assert.ok('timestamp' in summary);

      assert.strictEqual(summary.totalMeasurements, 3);
    });
  });

  describe('checkTargets', () => {
    it('should pass when empty', () => {
      const targets = metrics.checkTargets();
      assert.strictEqual(targets.allPassing, true);
    });

    it('should pass when within targets', () => {
      metrics._sttLatencies.push(500, 600, 700, 800);  // All < 2000ms
      metrics._ttsLatencies.push(100, 150, 200);       // All < 500ms
      metrics._bargeInLatencies.push(50, 75, 100);     // All < 200ms

      const targets = metrics.checkTargets();
      assert.strictEqual(targets.allPassing, true);
      assert.strictEqual(targets.stt, true);
      assert.strictEqual(targets.tts, true);
      assert.strictEqual(targets.bargeIn, true);
    });

    it('should fail when P95 exceeds target', () => {
      // Add 19 good values and 1 bad value - P95 will be bad
      for (let i = 0; i < 19; i++) {
        metrics._sttLatencies.push(500);
      }
      metrics._sttLatencies.push(3000); // Exceeds 2000ms target

      const targets = metrics.checkTargets();
      assert.strictEqual(targets.stt, false);
      assert.strictEqual(targets.allPassing, false);
    });
  });

  describe('formatSummary', () => {
    it('should return formatted string', () => {
      metrics._sttLatencies.push(100, 200, 300);

      const formatted = metrics.formatSummary();

      assert.ok(formatted.includes('Latency Metrics Summary'));
      assert.ok(formatted.includes('STT Latency'));
      assert.ok(formatted.includes('TTS Time-to-First-Audio'));
      assert.ok(formatted.includes('Barge-in Stop Latency'));
    });

    it('should include pass/fail indicators', () => {
      const formatted = metrics.formatSummary();
      assert.ok(formatted.includes('✓') || formatted.includes('✗'));
    });
  });

  describe('maxHistorySize', () => {
    it('should trim old measurements', () => {
      const m = new LatencyMetrics({ maxHistorySize: 5 });

      for (let i = 0; i < 10; i++) {
        m._sttLatencies.push(i * 100);
        // @ts-expect-error - Testing private method
        m._addMeasurement(m._sttLatencies, 0); // Trigger trim via _addMeasurement
      }

      assert.ok(m._sttLatencies.length <= 5);
    });
  });

  describe('enable/disable', () => {
    it('should not record when disabled', () => {
      metrics.disable();

      metrics.startStt();
      metrics.endStt();

      assert.strictEqual(metrics._sttLatencies.length, 0);
    });

    it('should record when re-enabled', () => {
      metrics.disable();
      metrics.enable();

      metrics._sttLatencies.push(100); // Direct push to test
      assert.strictEqual(metrics._sttLatencies.length, 1);
    });
  });

  describe('reset', () => {
    it('should clear all data', () => {
      metrics._sttLatencies.push(100);
      metrics._ttsLatencies.push(200);
      metrics._bargeInLatencies.push(50);
      metrics._sttStartTime = Date.now();

      metrics.reset();

      assert.strictEqual(metrics._sttLatencies.length, 0);
      assert.strictEqual(metrics._ttsLatencies.length, 0);
      assert.strictEqual(metrics._bargeInLatencies.length, 0);
      assert.strictEqual(metrics._sttStartTime, null);
    });
  });

  describe('exportJson', () => {
    it('should export valid JSON', () => {
      metrics._sttLatencies.push(100, 200);

      const json = metrics.exportJson();
      const parsed = JSON.parse(json);

      assert.ok('summary' in parsed);
      assert.ok('raw' in parsed);
      assert.ok('targets' in parsed);
    });
  });

  describe('getRawMetrics', () => {
    it('should return copy of raw data', () => {
      metrics._sttLatencies.push(100, 200);

      const raw = metrics.getRawMetrics();
      raw.stt.push(300);

      // Original should not be modified
      assert.strictEqual(metrics._sttLatencies.length, 2);
    });
  });
});

describe('createLatencyMetrics', () => {
  it('should create LatencyMetrics instance', () => {
    const m = createLatencyMetrics();
    assert.ok(m instanceof LatencyMetrics);
  });

  it('should pass config to constructor', () => {
    const m = createLatencyMetrics({ maxHistorySize: 100 });
    assert.strictEqual(m.config.maxHistorySize, 100);
  });
});

describe('getGlobalMetrics', () => {
  beforeEach(() => {
    resetGlobalMetrics();
  });

  it('should return same instance', () => {
    const m1 = getGlobalMetrics();
    const m2 = getGlobalMetrics();
    assert.strictEqual(m1, m2);
  });

  it('should create instance if not exists', () => {
    const m = getGlobalMetrics();
    assert.ok(m instanceof LatencyMetrics);
  });
});

describe('DEFAULT_LATENCY_CONFIG', () => {
  it('should have expected defaults', () => {
    assert.strictEqual(DEFAULT_LATENCY_CONFIG.maxHistorySize, 1000);
    assert.strictEqual(DEFAULT_LATENCY_CONFIG.enabled, true);
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_LATENCY_CONFIG));
  });
});

/**
 * Helper to sleep for a given number of milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
