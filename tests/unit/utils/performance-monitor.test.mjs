/**
 * Unit tests for Performance Monitor
 *
 * Tests per T051 acceptance criteria:
 * - Detect sustained slowdowns
 * - Degrade gracefully by selecting lighter model/profile
 * - Surface status in logs/UI (never silently degrade)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import {
  PerformanceMonitor,
  createPerformanceMonitor,
  getGlobalPerformanceMonitor,
  resetGlobalPerformanceMonitor,
  DEFAULT_PERFORMANCE_CONFIG
} from '../../../src/utils/performance-monitor.mjs';

describe('PerformanceMonitor', () => {
  /** @type {PerformanceMonitor} */
  let monitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
    resetGlobalPerformanceMonitor();
  });

  afterEach(() => {
    monitor.dispose();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const m = new PerformanceMonitor();
      assert.strictEqual(m.config.windowSizeMs, DEFAULT_PERFORMANCE_CONFIG.windowSizeMs);
      assert.strictEqual(m.config.degradedThresholdFactor, DEFAULT_PERFORMANCE_CONFIG.degradedThresholdFactor);
    });

    it('should merge custom config', () => {
      const m = new PerformanceMonitor({
        windowSizeMs: 5000,
        degradedThresholdFactor: 2.0
      });
      assert.strictEqual(m.config.windowSizeMs, 5000);
      assert.strictEqual(m.config.degradedThresholdFactor, 2.0);
    });

    it('should be an EventEmitter', () => {
      assert.ok(monitor instanceof EventEmitter);
    });

    it('should start in normal level', () => {
      assert.strictEqual(monitor.level, 'normal');
    });

    it('should not have baseline initially', () => {
      assert.strictEqual(monitor.baseline, null);
      assert.strictEqual(monitor.isBaselineEstablished, false);
    });
  });

  describe('baseline establishment', () => {
    it('should establish baseline after minimum samples', () => {
      const minSamples = monitor.config.minSamplesForBaseline ?? 5;

      for (let i = 0; i < minSamples; i++) {
        monitor.recordLatency(100);
      }

      assert.strictEqual(monitor.isBaselineEstablished, true);
      assert.ok(monitor.baseline !== null);
    });

    it('should not establish baseline with too few samples', () => {
      monitor.recordLatency(100);
      monitor.recordLatency(100);

      assert.strictEqual(monitor.isBaselineEstablished, false);
    });

    it('should emit baseline_established event', () => {
      let emitted = false;
      monitor.on('baseline_established', (data) => {
        emitted = true;
        assert.ok('baselineMs' in data);
      });

      for (let i = 0; i < 5; i++) {
        monitor.recordLatency(100);
      }

      assert.strictEqual(emitted, true);
    });

    it('should use median for baseline', () => {
      // Record odd number of samples for clear median
      monitor.recordLatency(100);
      monitor.recordLatency(200);
      monitor.recordLatency(300);
      monitor.recordLatency(400);
      monitor.recordLatency(500);

      // Median of [100,200,300,400,500] = 300
      assert.strictEqual(monitor.baseline, 300);
    });
  });

  describe('performance level detection', () => {
    beforeEach(() => {
      // Establish baseline at 100ms
      for (let i = 0; i < 5; i++) {
        monitor.recordLatency(100);
      }
    });

    it('should stay normal when within baseline', () => {
      monitor.start();
      monitor.recordLatency(100);
      // @ts-expect-error - Testing private method
      monitor._checkPerformanceLevel();

      assert.strictEqual(monitor.level, 'normal');
      monitor.stop();
    });

    it('should detect degraded performance', () => {
      monitor.start();

      // Clear samples and add degraded ones (1.6x baseline = 160ms, between 1.5x and 2.0x)
      // @ts-expect-error - Testing private property
      monitor._samples = [];
      for (let i = 0; i < 10; i++) {
        monitor.recordLatency(160); // 1.6x baseline (degraded threshold is 1.5x, critical is 2.0x)
      }

      // @ts-expect-error - Testing private method
      monitor._checkPerformanceLevel();
      assert.strictEqual(monitor.level, 'degraded');
      monitor.stop();
    });

    it('should detect critical performance', () => {
      monitor.start();

      // Add critical latencies (>2x baseline)
      // @ts-expect-error - Testing private property
      monitor._samples = [];
      for (let i = 0; i < 10; i++) {
        monitor.recordLatency(250); // 2.5x baseline
      }

      // @ts-expect-error - Testing private method
      monitor._checkPerformanceLevel();
      assert.strictEqual(monitor.level, 'critical');
      monitor.stop();
    });

    it('should emit level_changed event', () => {
      let levelChanged = false;
      monitor.on('level_changed', (data) => {
        levelChanged = true;
        assert.ok('from' in data);
        assert.ok('to' in data);
        assert.ok('factor' in data);
      });

      monitor.start();
      // @ts-expect-error - Testing private property
      monitor._samples = [];
      for (let i = 0; i < 10; i++) {
        monitor.recordLatency(200);
      }
      // @ts-expect-error - Testing private method
      monitor._checkPerformanceLevel();

      assert.strictEqual(levelChanged, true);
      monitor.stop();
    });

    it('should emit recommendation on level change', () => {
      /** @type {{level: string, recommendations: string[]}|null} */
      let recommendation = null;
      monitor.on('recommendation', (data) => {
        recommendation = data;
      });

      monitor.start();
      // @ts-expect-error - Testing private property
      monitor._samples = [];
      for (let i = 0; i < 10; i++) {
        monitor.recordLatency(200);
      }
      // @ts-expect-error - Testing private method
      monitor._checkPerformanceLevel();

      assert.ok(recommendation !== null);
      assert.ok('level' in recommendation);
      assert.ok('recommendations' in recommendation);
      // @ts-expect-error - TS doesn't narrow type after !== null check
      assert.ok(Array.isArray(recommendation.recommendations));
      monitor.stop();
    });
  });

  describe('sliding window', () => {
    it('should prune old samples outside window', async () => {
      const m = new PerformanceMonitor({ windowSizeMs: 100 });

      m.recordLatency(100);
      m.recordLatency(100);

      // Wait for samples to age out
      await sleep(150);

      m.recordLatency(100);

      // Old samples should be pruned
      // @ts-expect-error - Testing private property
      assert.ok(m._samples.length <= 2);
    });
  });

  describe('getStats', () => {
    it('should return complete stats', () => {
      for (let i = 0; i < 5; i++) {
        monitor.recordLatency(100);
      }

      const stats = monitor.getStats();

      assert.ok('level' in stats);
      assert.ok('baselineMs' in stats);
      assert.ok('currentAvgMs' in stats);
      assert.ok('degradationFactor' in stats);
      assert.ok('sampleCount' in stats);
      assert.ok('isEstablished' in stats);
    });

    it('should calculate degradation factor correctly', () => {
      for (let i = 0; i < 5; i++) {
        monitor.recordLatency(100);
      }

      // Add some elevated latencies
      monitor.recordLatency(200);
      monitor.recordLatency(200);

      const stats = monitor.getStats();
      assert.ok(stats.degradationFactor > 1.0);
    });
  });

  describe('formatStatus', () => {
    it('should return formatted string', () => {
      for (let i = 0; i < 5; i++) {
        monitor.recordLatency(100);
      }

      const status = monitor.formatStatus();

      assert.ok(status.includes('Performance'));
      assert.ok(status.includes('Baseline'));
      assert.ok(status.includes('Factor'));
    });

    it('should include level indicator', () => {
      const status = monitor.formatStatus();
      assert.ok(status.includes('✓') || status.includes('⚠') || status.includes('✗'));
    });
  });

  describe('start/stop', () => {
    it('should start monitoring', () => {
      monitor.start();
      assert.strictEqual(monitor._started, true);
      assert.ok(monitor._checkInterval !== null);
      monitor.stop();
    });

    it('should stop monitoring', () => {
      monitor.start();
      monitor.stop();
      assert.strictEqual(monitor._started, false);
      assert.strictEqual(monitor._checkInterval, null);
    });

    it('should not start when disabled', () => {
      const m = new PerformanceMonitor({ enabled: false });
      m.start();
      assert.strictEqual(m._started, false);
    });

    it('should not double-start', () => {
      monitor.start();
      const interval = monitor._checkInterval;
      monitor.start();
      assert.strictEqual(monitor._checkInterval, interval);
      monitor.stop();
    });
  });

  describe('resetBaseline', () => {
    it('should clear baseline', () => {
      for (let i = 0; i < 5; i++) {
        monitor.recordLatency(100);
      }
      assert.strictEqual(monitor.isBaselineEstablished, true);

      monitor.resetBaseline();

      assert.strictEqual(monitor.isBaselineEstablished, false);
      assert.strictEqual(monitor.baseline, null);
      // @ts-expect-error - Testing private property
      assert.strictEqual(monitor._samples.length, 0);
    });

    it('should reset level to normal', () => {
      monitor._currentLevel = 'critical';
      monitor.resetBaseline();
      assert.strictEqual(monitor.level, 'normal');
    });
  });

  describe('reset', () => {
    it('should stop and reset all state', () => {
      monitor.start();
      for (let i = 0; i < 5; i++) {
        monitor.recordLatency(100);
      }

      monitor.reset();

      assert.strictEqual(monitor._started, false);
      assert.strictEqual(monitor.isBaselineEstablished, false);
      // @ts-expect-error - Testing private property
      assert.strictEqual(monitor._samples.length, 0);
    });
  });

  describe('dispose', () => {
    it('should stop and remove listeners', () => {
      monitor.on('level_changed', () => {});
      monitor.start();

      monitor.dispose();

      assert.strictEqual(monitor._started, false);
      assert.strictEqual(monitor.listenerCount('level_changed'), 0);
    });
  });

  describe('enabled property', () => {
    it('should return config enabled state', () => {
      const m1 = new PerformanceMonitor({ enabled: true });
      const m2 = new PerformanceMonitor({ enabled: false });

      assert.strictEqual(m1.enabled, true);
      assert.strictEqual(m2.enabled, false);
    });

    it('should not record when disabled', () => {
      const m = new PerformanceMonitor({ enabled: false });
      m.recordLatency(100);
      // @ts-expect-error - Testing private property
      assert.strictEqual(m._samples.length, 0);
    });
  });
});

describe('createPerformanceMonitor', () => {
  it('should create PerformanceMonitor instance', () => {
    const m = createPerformanceMonitor();
    assert.ok(m instanceof PerformanceMonitor);
    m.dispose();
  });

  it('should pass config to constructor', () => {
    const m = createPerformanceMonitor({ windowSizeMs: 5000 });
    assert.strictEqual(m.config.windowSizeMs, 5000);
    m.dispose();
  });
});

describe('getGlobalPerformanceMonitor', () => {
  beforeEach(() => {
    resetGlobalPerformanceMonitor();
  });

  it('should return same instance', () => {
    const m1 = getGlobalPerformanceMonitor();
    const m2 = getGlobalPerformanceMonitor();
    assert.strictEqual(m1, m2);
    m1.dispose();
  });

  it('should create instance if not exists', () => {
    const m = getGlobalPerformanceMonitor();
    assert.ok(m instanceof PerformanceMonitor);
    m.dispose();
  });
});

describe('DEFAULT_PERFORMANCE_CONFIG', () => {
  it('should have expected defaults', () => {
    assert.strictEqual(DEFAULT_PERFORMANCE_CONFIG.windowSizeMs, 10000);
    assert.strictEqual(DEFAULT_PERFORMANCE_CONFIG.degradedThresholdFactor, 1.5);
    assert.strictEqual(DEFAULT_PERFORMANCE_CONFIG.criticalThresholdFactor, 2.0);
    assert.strictEqual(DEFAULT_PERFORMANCE_CONFIG.minSamplesForBaseline, 5);
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_PERFORMANCE_CONFIG));
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
