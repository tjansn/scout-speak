/**
 * Tests for AudioBuffer (Ring Buffer)
 *
 * Verifies O(1) operations, wrap-around behavior, overflow/underflow handling,
 * and watermark support per algorithm_and_data_structures.md.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  AudioBuffer,
  createAudioBufferForDuration,
  msToSamples,
  samplesToMs
} from '../../../src/audio/audio-buffer.mjs';

describe('AudioBuffer', () => {
  /** @type {AudioBuffer} */
  let buffer;

  beforeEach(() => {
    buffer = new AudioBuffer(100);
  });

  describe('constructor', () => {
    it('should create buffer with specified capacity', () => {
      const buf = new AudioBuffer(50);
      assert.strictEqual(buf.capacity(), 50);
      assert.strictEqual(buf.available(), 0);
    });

    it('should throw for non-positive capacity', () => {
      assert.throws(() => new AudioBuffer(0), /positive integer/);
      assert.throws(() => new AudioBuffer(-10), /positive integer/);
      assert.throws(() => new AudioBuffer(1.5), /positive integer/);
    });

    it('should start empty', () => {
      assert.strictEqual(buffer.isEmpty(), true);
      assert.strictEqual(buffer.isFull(), false);
      assert.strictEqual(buffer.available(), 0);
    });
  });

  describe('write', () => {
    it('should write samples and update available count', () => {
      const samples = new Int16Array([1, 2, 3, 4, 5]);
      const written = buffer.write(samples);

      assert.strictEqual(written, 5);
      assert.strictEqual(buffer.available(), 5);
    });

    it('should throw for non-Int16Array input', () => {
      // @ts-expect-error - Testing invalid input
      assert.throws(() => buffer.write([1, 2, 3]), /Int16Array/);
    });

    it('should return 0 for empty array', () => {
      const written = buffer.write(new Int16Array(0));
      assert.strictEqual(written, 0);
      assert.strictEqual(buffer.available(), 0);
    });

    it('should handle writing exactly to capacity', () => {
      const samples = new Int16Array(100);
      for (let i = 0; i < 100; i++) samples[i] = i;

      buffer.write(samples);
      assert.strictEqual(buffer.available(), 100);
      assert.strictEqual(buffer.isFull(), true);
    });

    it('should drop oldest samples on overflow', () => {
      // Fill buffer completely
      const first = new Int16Array(100);
      for (let i = 0; i < 100; i++) first[i] = i;
      buffer.write(first);

      // Write 10 more samples
      const second = new Int16Array([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009]);
      buffer.write(second);

      // Should still be at capacity
      assert.strictEqual(buffer.available(), 100);

      // First 10 samples should be the oldest that weren't dropped (10-99)
      // Then the new samples (1000-1009)
      const readBack = buffer.read(100);

      // Check first sample is 10 (oldest 0-9 were dropped)
      assert.strictEqual(readBack[0], 10);

      // Check last 10 are the new samples
      assert.strictEqual(readBack[90], 1000);
      assert.strictEqual(readBack[99], 1009);
    });
  });

  describe('read', () => {
    it('should read samples in FIFO order', () => {
      buffer.write(new Int16Array([1, 2, 3, 4, 5]));
      const read = buffer.read(3);

      assert.deepStrictEqual(Array.from(read), [1, 2, 3]);
      assert.strictEqual(buffer.available(), 2);
    });

    it('should return empty array for zero count', () => {
      buffer.write(new Int16Array([1, 2, 3]));
      const read = buffer.read(0);

      assert.strictEqual(read.length, 0);
      assert.strictEqual(buffer.available(), 3);
    });

    it('should return partial result on underflow', () => {
      buffer.write(new Int16Array([1, 2, 3]));
      const read = buffer.read(10);

      assert.strictEqual(read.length, 3);
      assert.deepStrictEqual(Array.from(read), [1, 2, 3]);
      assert.strictEqual(buffer.available(), 0);
    });

    it('should return empty array when buffer is empty', () => {
      const read = buffer.read(10);
      assert.strictEqual(read.length, 0);
    });

    it('should throw for invalid count', () => {
      assert.throws(() => buffer.read(-1), /non-negative integer/);
      assert.throws(() => buffer.read(1.5), /non-negative integer/);
    });
  });

  describe('wrap-around behavior', () => {
    it('should handle wrap-around correctly', () => {
      // Write 80 samples
      const first = new Int16Array(80);
      for (let i = 0; i < 80; i++) first[i] = i;
      buffer.write(first);

      // Read 60 samples (advances read pointer)
      buffer.read(60);
      assert.strictEqual(buffer.available(), 20);

      // Write 50 more samples (will wrap around)
      const second = new Int16Array(50);
      for (let i = 0; i < 50; i++) second[i] = 100 + i;
      buffer.write(second);

      assert.strictEqual(buffer.available(), 70);

      // Read all and verify data integrity
      const all = buffer.read(70);
      assert.strictEqual(all.length, 70);

      // First 20 should be 60-79
      for (let i = 0; i < 20; i++) {
        assert.strictEqual(all[i], 60 + i, `Position ${i} should be ${60 + i}`);
      }

      // Next 50 should be 100-149
      for (let i = 0; i < 50; i++) {
        assert.strictEqual(all[20 + i], 100 + i, `Position ${20 + i} should be ${100 + i}`);
      }
    });

    it('should handle multiple wrap-arounds', () => {
      // Simulate continuous audio streaming
      for (let cycle = 0; cycle < 5; cycle++) {
        const samples = new Int16Array(30);
        for (let i = 0; i < 30; i++) samples[i] = cycle * 30 + i;
        buffer.write(samples);

        const read = buffer.read(30);
        assert.strictEqual(read.length, 30);

        // Verify data
        for (let i = 0; i < 30; i++) {
          assert.strictEqual(read[i], cycle * 30 + i);
        }
      }
    });
  });

  describe('peek', () => {
    it('should return samples without removing them', () => {
      buffer.write(new Int16Array([1, 2, 3, 4, 5]));

      const peeked = buffer.peek(3);
      assert.deepStrictEqual(Array.from(peeked), [1, 2, 3]);
      assert.strictEqual(buffer.available(), 5); // Unchanged

      const read = buffer.read(3);
      assert.deepStrictEqual(Array.from(read), [1, 2, 3]);
      assert.strictEqual(buffer.available(), 2);
    });
  });

  describe('skip', () => {
    it('should discard samples without returning them', () => {
      buffer.write(new Int16Array([1, 2, 3, 4, 5]));

      const skipped = buffer.skip(2);
      assert.strictEqual(skipped, 2);
      assert.strictEqual(buffer.available(), 3);

      const read = buffer.read(3);
      assert.deepStrictEqual(Array.from(read), [3, 4, 5]);
    });

    it('should return actual skipped count on underflow', () => {
      buffer.write(new Int16Array([1, 2, 3]));

      const skipped = buffer.skip(10);
      assert.strictEqual(skipped, 3);
      assert.strictEqual(buffer.available(), 0);
    });
  });

  describe('clear', () => {
    it('should empty the buffer', () => {
      buffer.write(new Int16Array([1, 2, 3, 4, 5]));
      buffer.clear();

      assert.strictEqual(buffer.available(), 0);
      assert.strictEqual(buffer.isEmpty(), true);
    });

    it('should allow immediate reuse after clear', () => {
      buffer.write(new Int16Array([1, 2, 3]));
      buffer.clear();
      buffer.write(new Int16Array([10, 20, 30]));

      const read = buffer.read(3);
      assert.deepStrictEqual(Array.from(read), [10, 20, 30]);
    });
  });

  describe('watermarks', () => {
    it('should check above watermark correctly', () => {
      buffer.write(new Int16Array([1, 2, 3, 4, 5]));

      assert.strictEqual(buffer.isAboveWatermark(5), true);
      assert.strictEqual(buffer.isAboveWatermark(4), true);
      assert.strictEqual(buffer.isAboveWatermark(6), false);
    });

    it('should check below watermark correctly', () => {
      buffer.write(new Int16Array([1, 2, 3, 4, 5]));

      assert.strictEqual(buffer.isBelowWatermark(5), true);
      assert.strictEqual(buffer.isBelowWatermark(6), true);
      assert.strictEqual(buffer.isBelowWatermark(4), false);
    });
  });

  describe('fillPercentage', () => {
    it('should return correct fill percentage', () => {
      assert.strictEqual(buffer.fillPercentage(), 0);

      buffer.write(new Int16Array(50));
      assert.strictEqual(buffer.fillPercentage(), 50);

      buffer.write(new Int16Array(50));
      assert.strictEqual(buffer.fillPercentage(), 100);
    });
  });
});

describe('createAudioBufferForDuration', () => {
  it('should create buffer sized for duration at 16kHz', () => {
    const buf = createAudioBufferForDuration(100, 16000);
    // 100ms at 16kHz = 1600 samples
    assert.strictEqual(buf.capacity(), 1600);
  });

  it('should create buffer sized for duration at 22050Hz', () => {
    const buf = createAudioBufferForDuration(100, 22050);
    // 100ms at 22050Hz = 2205 samples
    assert.strictEqual(buf.capacity(), 2205);
  });

  it('should use 16kHz as default sample rate', () => {
    const buf = createAudioBufferForDuration(500);
    // 500ms at 16kHz = 8000 samples
    assert.strictEqual(buf.capacity(), 8000);
  });
});

describe('msToSamples', () => {
  it('should convert milliseconds to samples', () => {
    assert.strictEqual(msToSamples(1000, 16000), 16000);
    assert.strictEqual(msToSamples(100, 16000), 1600);
    assert.strictEqual(msToSamples(30, 16000), 480);
  });

  it('should ceil fractional samples', () => {
    // 25ms at 16kHz = 400 samples exactly
    assert.strictEqual(msToSamples(25, 16000), 400);
    // 33ms at 16kHz = 528 samples
    assert.strictEqual(msToSamples(33, 16000), 528);
  });
});

describe('samplesToMs', () => {
  it('should convert samples to milliseconds', () => {
    assert.strictEqual(samplesToMs(16000, 16000), 1000);
    assert.strictEqual(samplesToMs(1600, 16000), 100);
    assert.strictEqual(samplesToMs(480, 16000), 30);
  });
});
