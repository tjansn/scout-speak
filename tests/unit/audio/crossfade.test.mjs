/**
 * Unit tests for Audio Crossfade
 *
 * Tests per T026 acceptance criteria:
 * - No audible clicks at chunk boundaries
 * - Minimal processing overhead
 * - Linear crossfade between chunks
 * - Proper handling of edge cases
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  AudioCrossfader,
  createCrossfader,
  applyCrossfadeBetween,
  DEFAULT_CROSSFADE_CONFIG
} from '../../../src/audio/crossfade.mjs';

describe('AudioCrossfader', () => {
  describe('constructor', () => {
    it('should use default config', () => {
      const cf = new AudioCrossfader();
      assert.strictEqual(cf.config.fadeDurationMs, DEFAULT_CROSSFADE_CONFIG.fadeDurationMs);
      assert.strictEqual(cf.config.sampleRate, DEFAULT_CROSSFADE_CONFIG.sampleRate);
    });

    it('should merge custom config', () => {
      const cf = new AudioCrossfader({ fadeDurationMs: 10, sampleRate: 16000 });
      assert.strictEqual(cf.config.fadeDurationMs, 10);
      assert.strictEqual(cf.config.sampleRate, 16000);
    });

    it('should calculate fade samples correctly', () => {
      // 5ms at 22050Hz = 110.25 samples, ceil to 111
      const cf = new AudioCrossfader({ fadeDurationMs: 5, sampleRate: 22050 });
      assert.strictEqual(cf.fadeSamples, 111);
    });

    it('should start with no previous tail', () => {
      const cf = new AudioCrossfader();
      assert.strictEqual(cf.hasPreviousTail(), false);
      assert.strictEqual(cf.chunksProcessed, 0);
    });
  });

  describe('process', () => {
    it('should return first chunk unchanged', () => {
      const cf = new AudioCrossfader({ fadeDurationMs: 10, sampleRate: 1000 });
      const chunk = new Int16Array([
        100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
        1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000
      ]);
      const result = cf.process(chunk);

      // First chunk should be unchanged
      assert.deepStrictEqual(Array.from(result), Array.from(chunk));
      assert.strictEqual(cf.chunksProcessed, 1);
    });

    it('should apply crossfade on second chunk', () => {
      const cf = new AudioCrossfader({ fadeDurationMs: 10, sampleRate: 1000 }); // 10 sample fade

      // First chunk: ends with high values
      const chunk1 = new Int16Array(20).fill(10000);
      cf.process(chunk1);

      // Second chunk: starts with low values
      const chunk2 = new Int16Array(20).fill(0);
      const result = cf.process(chunk2);

      // The beginning should be crossfaded from 10000 to 0
      // At sample 0: t=0, so value = 10000 * (1-0) + 0 * 0 = 10000
      // At sample 9: t=0.9, so value = 10000 * 0.1 + 0 * 0.9 = 1000
      // Values should decrease from high to low
      assert.ok(result[0] > result[9], 'Crossfade should transition from previous to current');
      assert.strictEqual(cf.chunksProcessed, 2);
    });

    it('should throw for non-Int16Array input', () => {
      const cf = new AudioCrossfader();
      assert.throws(() => {
        // @ts-ignore - testing invalid input
        cf.process([1, 2, 3]);
      }, /must be Int16Array/);
    });

    it('should handle empty chunks', () => {
      const cf = new AudioCrossfader();
      const empty = new Int16Array(0);
      const result = cf.process(empty);
      assert.strictEqual(result.length, 0);
    });

    it('should skip crossfade for chunks smaller than fade duration', () => {
      const cf = new AudioCrossfader({ fadeDurationMs: 10, sampleRate: 1000 }); // 10 sample fade

      // First chunk: larger than fade
      const chunk1 = new Int16Array(20).fill(10000);
      cf.process(chunk1);

      // Second chunk: smaller than fade (only 5 samples)
      const chunk2 = new Int16Array([0, 0, 0, 0, 0]);
      const result = cf.process(chunk2);

      // Should return unchanged since chunk is smaller than fade
      assert.deepStrictEqual(Array.from(result), [0, 0, 0, 0, 0]);
    });
  });

  describe('crossfade algorithm', () => {
    it('should produce smooth linear transition', () => {
      const cf = new AudioCrossfader({ fadeDurationMs: 10, sampleRate: 1000 }); // 10 sample fade

      // First chunk: constant 10000
      const chunk1 = new Int16Array(20).fill(10000);
      cf.process(chunk1);

      // Second chunk: constant 0
      const chunk2 = new Int16Array(20).fill(0);
      const result = cf.process(chunk2);

      // Verify linear crossfade in first 10 samples
      // t = i/10 for i in [0,9]
      // value = 10000 * (1-t) + 0 * t = 10000 * (1 - i/10)
      for (let i = 0; i < 10; i++) {
        const t = i / 10;
        const expected = Math.round(10000 * (1 - t));
        // Allow small rounding difference
        assert.ok(Math.abs(result[i] - expected) <= 1,
          `Sample ${i}: expected ~${expected}, got ${result[i]}`);
      }

      // Samples after fade region should be unchanged (0)
      for (let i = 10; i < 20; i++) {
        assert.strictEqual(result[i], 0);
      }
    });

    it('should clamp values to Int16 range', () => {
      const cf = new AudioCrossfader({ fadeDurationMs: 10, sampleRate: 1000 });

      // First chunk near max value
      const chunk1 = new Int16Array(20).fill(32000);
      cf.process(chunk1);

      // Second chunk also high
      const chunk2 = new Int16Array(20).fill(32000);
      const result = cf.process(chunk2);

      // All values should be within Int16 range
      for (const sample of result) {
        assert.ok(sample >= -32768 && sample <= 32767);
      }
    });
  });

  describe('reset', () => {
    it('should clear previous tail', () => {
      const cf = new AudioCrossfader({ fadeDurationMs: 10, sampleRate: 1000 });

      cf.process(new Int16Array(20).fill(1000));
      assert.strictEqual(cf.hasPreviousTail(), true);

      cf.reset();
      assert.strictEqual(cf.hasPreviousTail(), false);
      assert.strictEqual(cf.chunksProcessed, 0);
    });

    it('should prevent crossfade with stale audio', () => {
      const cf = new AudioCrossfader({ fadeDurationMs: 10, sampleRate: 1000 });

      // Process first chunk
      cf.process(new Int16Array(20).fill(10000));

      // Reset (simulating barge-in)
      cf.reset();

      // Process new chunk - should NOT crossfade with old audio
      const newChunk = new Int16Array(20).fill(0);
      const result = cf.process(newChunk);

      // Should be unchanged since no previous tail after reset
      assert.deepStrictEqual(Array.from(result), Array.from(newChunk));
    });
  });

  describe('hasPreviousTail', () => {
    it('should return false initially', () => {
      const cf = new AudioCrossfader();
      assert.strictEqual(cf.hasPreviousTail(), false);
    });

    it('should return true after processing', () => {
      const cf = new AudioCrossfader();
      cf.process(new Int16Array(100));
      assert.strictEqual(cf.hasPreviousTail(), true);
    });
  });
});

describe('createCrossfader', () => {
  it('should create AudioCrossfader instance', () => {
    const cf = createCrossfader();
    assert.ok(cf instanceof AudioCrossfader);
  });

  it('should pass config to constructor', () => {
    const cf = createCrossfader({ fadeDurationMs: 15 });
    assert.strictEqual(cf.config.fadeDurationMs, 15);
  });
});

describe('applyCrossfadeBetween', () => {
  it('should apply fade out to first buffer', () => {
    const buf1 = new Int16Array([1000, 1000, 1000, 1000, 1000]);
    const buf2 = new Int16Array([0, 0, 0, 0, 0]);

    const { faded1 } = applyCrossfadeBetween(buf1, buf2, 5);

    // Buffer 1 should fade out at the end
    // At index 0: t=0, value = 1000 * 1 = 1000
    // At index 4: t=0.8, value = 1000 * 0.2 = 200
    assert.strictEqual(faded1[0], 1000);
    assert.ok(faded1[4] < faded1[0], 'Should fade out');
  });

  it('should apply fade in to second buffer', () => {
    const buf1 = new Int16Array([0, 0, 0, 0, 0]);
    const buf2 = new Int16Array([1000, 1000, 1000, 1000, 1000]);

    const { faded2 } = applyCrossfadeBetween(buf1, buf2, 5);

    // Buffer 2 should fade in at the start
    // At index 0: t=0, value = 1000 * 0 = 0
    // At index 4: t=0.8, value = 1000 * 0.8 = 800
    assert.strictEqual(faded2[0], 0);
    assert.ok(faded2[4] > faded2[0], 'Should fade in');
  });

  it('should handle empty buffers', () => {
    const buf1 = new Int16Array(0);
    const buf2 = new Int16Array([1, 2, 3]);

    const { faded1, faded2 } = applyCrossfadeBetween(buf1, buf2, 5);
    assert.strictEqual(faded1.length, 0);
    assert.deepStrictEqual(Array.from(faded2), [1, 2, 3]);
  });

  it('should handle zero fade samples', () => {
    const buf1 = new Int16Array([1, 2, 3]);
    const buf2 = new Int16Array([4, 5, 6]);

    const { faded1, faded2 } = applyCrossfadeBetween(buf1, buf2, 0);
    assert.deepStrictEqual(Array.from(faded1), [1, 2, 3]);
    assert.deepStrictEqual(Array.from(faded2), [4, 5, 6]);
  });

  it('should throw for invalid input', () => {
    assert.throws(() => {
      // @ts-ignore - testing invalid input
      applyCrossfadeBetween([1, 2], new Int16Array(3), 5);
    }, /must be Int16Array/);
  });

  it('should respect smaller buffer length', () => {
    const buf1 = new Int16Array([100, 100, 100]); // only 3 samples
    const buf2 = new Int16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // 10 samples

    const { faded1, faded2 } = applyCrossfadeBetween(buf1, buf2, 5);

    // Only first 3 samples of each should be affected
    assert.strictEqual(faded1.length, 3);
    assert.strictEqual(faded2.length, 10);
  });
});

describe('DEFAULT_CROSSFADE_CONFIG', () => {
  it('should have expected defaults per spec', () => {
    // Per T026: Short (5-10ms) linear fade
    assert.strictEqual(DEFAULT_CROSSFADE_CONFIG.fadeDurationMs, 5);
    assert.strictEqual(DEFAULT_CROSSFADE_CONFIG.sampleRate, 22050);
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_CROSSFADE_CONFIG));
  });
});
