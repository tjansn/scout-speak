/**
 * Unit tests for Jitter Buffer
 *
 * Tests per T025 acceptance criteria:
 * - FR-5: Continuous audio with no cuts/glitches
 * - Handles irregular chunk arrival
 * - Pads with silence on underrun (no clicks)
 * - Clears immediately on barge-in
 * - Watermark behavior
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import {
  JitterBuffer,
  createJitterBuffer,
  DEFAULT_JITTER_CONFIG
} from '../../../src/tts/jitter-buffer.mjs';

describe('JitterBuffer', () => {
  describe('constructor', () => {
    it('should use default config', () => {
      const jb = new JitterBuffer();
      assert.strictEqual(jb.config.bufferSizeMs, DEFAULT_JITTER_CONFIG.bufferSizeMs);
      assert.strictEqual(jb.config.lowWatermarkMs, DEFAULT_JITTER_CONFIG.lowWatermarkMs);
      assert.strictEqual(jb.config.sampleRate, DEFAULT_JITTER_CONFIG.sampleRate);
    });

    it('should merge custom config', () => {
      const jb = new JitterBuffer({ bufferSizeMs: 1000, sampleRate: 16000 });
      assert.strictEqual(jb.config.bufferSizeMs, 1000);
      assert.strictEqual(jb.config.sampleRate, 16000);
    });

    it('should start not playing', () => {
      const jb = new JitterBuffer();
      assert.strictEqual(jb.playbackActive, false);
    });

    it('should be an EventEmitter', () => {
      const jb = new JitterBuffer();
      assert.ok(jb instanceof EventEmitter);
    });
  });

  describe('write', () => {
    it('should write Int16Array samples', () => {
      const jb = new JitterBuffer();
      const samples = new Int16Array([1, 2, 3, 4, 5]);
      const written = jb.write(samples);
      assert.strictEqual(written, 5);
      assert.strictEqual(jb.bufferedSamples, 5);
    });

    it('should write Buffer samples', () => {
      const jb = new JitterBuffer();
      const buffer = Buffer.alloc(10); // 5 samples at 16-bit
      const written = jb.write(buffer);
      assert.strictEqual(written, 5);
      assert.strictEqual(jb.bufferedSamples, 5);
    });

    it('should throw for invalid input', () => {
      const jb = new JitterBuffer();
      assert.throws(() => {
        // @ts-ignore - testing invalid input
        jb.write('invalid');
      }, /must be Int16Array or Buffer/);
    });

    it('should not write after end()', () => {
      const jb = new JitterBuffer();
      jb.end();
      const written = jb.write(new Int16Array([1, 2, 3]));
      assert.strictEqual(written, 0);
    });
  });

  describe('watermark behavior', () => {
    it('should emit ready when low watermark reached', () => {
      // 100ms at 22050Hz = 2205 samples
      const jb = new JitterBuffer({
        bufferSizeMs: 500,
        lowWatermarkMs: 100,
        sampleRate: 22050
      });

      let readyEmitted = false;
      jb.on('ready', () => { readyEmitted = true; });

      // Write less than watermark
      jb.write(new Int16Array(1000));
      assert.strictEqual(readyEmitted, false);
      assert.strictEqual(jb.playbackActive, false);

      // Write more to reach watermark (need ~2205 total)
      jb.write(new Int16Array(1500));
      assert.strictEqual(readyEmitted, true);
      assert.strictEqual(jb.playbackActive, true);
    });

    it('should not emit ready multiple times', () => {
      const jb = new JitterBuffer({ lowWatermarkMs: 10, sampleRate: 1000 });
      let readyCount = 0;
      jb.on('ready', () => { readyCount++; });

      // Write enough for watermark
      jb.write(new Int16Array(20));
      jb.write(new Int16Array(20));

      assert.strictEqual(readyCount, 1);
    });
  });

  describe('read', () => {
    it('should read frame-sized chunks', () => {
      const jb = new JitterBuffer({
        frameDurationMs: 20,
        sampleRate: 1000 // 20 samples per frame
      });

      jb.write(new Int16Array(100));
      const frame = jb.read();

      assert.strictEqual(frame.length, 20);
    });

    it('should pad with silence on underrun', () => {
      const jb = new JitterBuffer({
        frameDurationMs: 20,
        sampleRate: 1000
      });

      // Write only 10 samples
      jb.write(new Int16Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

      const frame = jb.read();
      assert.strictEqual(frame.length, 20);

      // First 10 should be data
      assert.strictEqual(frame[0], 1);
      assert.strictEqual(frame[9], 10);

      // Rest should be silence (0)
      assert.strictEqual(frame[10], 0);
      assert.strictEqual(frame[19], 0);
    });

    it('should emit underrun event', () => {
      const jb = new JitterBuffer({
        frameDurationMs: 20,
        sampleRate: 1000
      });

      /** @type {{requested: number, available: number}|null} */
      let underrunData = null;
      jb.on('underrun', (/** @type {{requested: number, available: number}} */ data) => { underrunData = data; });

      // Write partial frame
      jb.write(new Int16Array([1, 2, 3]));
      jb.read();

      assert.ok(underrunData !== null);
      // @ts-ignore - TypeScript doesn't narrow type after assert.ok
      assert.strictEqual(underrunData.requested, 20);
      // @ts-ignore - TypeScript doesn't narrow type after assert.ok
      assert.strictEqual(underrunData.available, 3);
    });

    it('should return all zeros when empty', () => {
      const jb = new JitterBuffer({
        frameDurationMs: 10,
        sampleRate: 1000
      });

      const frame = jb.read();
      assert.strictEqual(frame.length, 10);
      assert.ok(frame.every(s => s === 0));
    });
  });

  describe('readAvailable', () => {
    it('should read only available samples', () => {
      const jb = new JitterBuffer();
      jb.write(new Int16Array([1, 2, 3, 4, 5]));

      const data = jb.readAvailable(10);
      assert.strictEqual(data.length, 5);
    });

    it('should respect maxSamples', () => {
      const jb = new JitterBuffer();
      jb.write(new Int16Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

      const data = jb.readAvailable(3);
      assert.strictEqual(data.length, 3);
    });
  });

  describe('end', () => {
    it('should emit drained when buffer empties', () => {
      const jb = new JitterBuffer({
        frameDurationMs: 10,
        sampleRate: 1000
      });

      let drained = false;
      jb.on('drained', () => { drained = true; });

      jb.write(new Int16Array(10));
      jb.end();

      // Read until empty
      jb.read();

      assert.strictEqual(drained, true);
    });

    it('should emit drained immediately if already empty', () => {
      const jb = new JitterBuffer();

      let drained = false;
      jb.on('drained', () => { drained = true; });

      jb.end();

      assert.strictEqual(drained, true);
    });
  });

  describe('clear', () => {
    it('should empty the buffer immediately', () => {
      const jb = new JitterBuffer();
      jb.write(new Int16Array(1000));

      assert.ok(jb.bufferedSamples > 0);

      jb.clear();

      assert.strictEqual(jb.bufferedSamples, 0);
      assert.strictEqual(jb.playbackActive, false);
    });

    it('should emit cleared event', () => {
      const jb = new JitterBuffer();
      let cleared = false;
      jb.on('cleared', () => { cleared = true; });

      jb.write(new Int16Array(100));
      jb.clear();

      assert.strictEqual(cleared, true);
    });

    it('should allow writes after clear', () => {
      const jb = new JitterBuffer();
      jb.write(new Int16Array(100));
      jb.end(); // This would normally prevent writes

      jb.clear(); // Should reset end-of-stream flag

      const written = jb.write(new Int16Array(50));
      assert.strictEqual(written, 50);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      const jb = new JitterBuffer();
      jb.write(new Int16Array(1000));
      jb.read();

      jb.reset();

      const stats = jb.getStats();
      assert.strictEqual(stats.bufferedSamples, 0);
      assert.strictEqual(stats.underruns, 0);
      assert.strictEqual(stats.totalSamplesWritten, 0);
      assert.strictEqual(stats.totalSamplesRead, 0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const jb = new JitterBuffer({ sampleRate: 1000 });

      jb.write(new Int16Array(100));

      const stats = jb.getStats();
      assert.strictEqual(stats.bufferedSamples, 100);
      assert.strictEqual(stats.bufferedMs, 100);
      assert.strictEqual(stats.totalSamplesWritten, 100);
    });

    it('should track underruns', () => {
      const jb = new JitterBuffer({
        frameDurationMs: 10,
        sampleRate: 1000
      });

      // Cause underruns by reading from empty buffer
      jb.read();
      jb.read();

      const stats = jb.getStats();
      assert.strictEqual(stats.underruns, 2);
    });
  });

  describe('isReady', () => {
    it('should return true when above low watermark', () => {
      const jb = new JitterBuffer({
        lowWatermarkMs: 10,
        sampleRate: 1000
      });

      jb.write(new Int16Array(20));
      assert.strictEqual(jb.isReady, true);
    });

    it('should return false when below low watermark', () => {
      const jb = new JitterBuffer({
        lowWatermarkMs: 100,
        sampleRate: 1000
      });

      jb.write(new Int16Array(50));
      assert.strictEqual(jb.isReady, false);
    });
  });
});

describe('createJitterBuffer', () => {
  it('should create JitterBuffer instance', () => {
    const jb = createJitterBuffer();
    assert.ok(jb instanceof JitterBuffer);
  });

  it('should pass config to constructor', () => {
    const jb = createJitterBuffer({ bufferSizeMs: 1000 });
    assert.strictEqual(jb.config.bufferSizeMs, 1000);
  });
});

describe('DEFAULT_JITTER_CONFIG', () => {
  it('should have expected defaults per spec', () => {
    assert.strictEqual(DEFAULT_JITTER_CONFIG.bufferSizeMs, 500);
    assert.strictEqual(DEFAULT_JITTER_CONFIG.lowWatermarkMs, 100);
    assert.strictEqual(DEFAULT_JITTER_CONFIG.frameDurationMs, 20);
    assert.strictEqual(DEFAULT_JITTER_CONFIG.sampleRate, 22050);
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_JITTER_CONFIG));
  });
});
