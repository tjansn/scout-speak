/**
 * Unit tests for Streaming TTS
 *
 * Tests per T024 and T027 acceptance criteria:
 * - Complete text-to-audio pipeline works
 * - Streaming reduces latency
 * - Smooth playback achieved
 * - Barge-in support
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import {
  StreamingTTS,
  createStreamingTTS,
  DEFAULT_STREAMING_TTS_CONFIG
} from '../../../src/tts/streaming-tts.mjs';

describe('StreamingTTS', () => {
  describe('constructor', () => {
    it('should use default config', () => {
      const stts = new StreamingTTS();
      assert.strictEqual(stts.config.sampleRate, DEFAULT_STREAMING_TTS_CONFIG.sampleRate);
      assert.strictEqual(stts.config.bufferSizeMs, DEFAULT_STREAMING_TTS_CONFIG.bufferSizeMs);
    });

    it('should merge custom config', () => {
      const stts = new StreamingTTS({
        modelPath: '/path/to/model.onnx',
        sampleRate: 16000
      });
      assert.strictEqual(stts.config.modelPath, '/path/to/model.onnx');
      assert.strictEqual(stts.config.sampleRate, 16000);
    });

    it('should start not speaking', () => {
      const stts = new StreamingTTS();
      assert.strictEqual(stts.speaking, false);
    });

    it('should be an EventEmitter', () => {
      const stts = new StreamingTTS();
      assert.ok(stts instanceof EventEmitter);
    });
  });

  describe('jitterBuffer getter', () => {
    it('should return the jitter buffer', () => {
      const stts = new StreamingTTS();
      const jb = stts.jitterBuffer;
      assert.ok(jb);
      assert.strictEqual(typeof jb.write, 'function');
      assert.strictEqual(typeof jb.read, 'function');
    });
  });

  describe('sampleRate getter', () => {
    it('should return configured sample rate', () => {
      const stts = new StreamingTTS({ sampleRate: 44100 });
      assert.strictEqual(stts.sampleRate, 44100);
    });
  });

  describe('speak validation', () => {
    it('should throw when already speaking', async () => {
      const stts = new StreamingTTS({ modelPath: '/path/to/model.onnx' });

      // Manually set speaking flag
      stts._speaking = true;

      await assert.rejects(
        async () => stts.speak('test'),
        /Already speaking/
      );
    });

    it('should throw for empty text', async () => {
      const stts = new StreamingTTS({ modelPath: '/path/to/model.onnx' });

      await assert.rejects(
        async () => stts.speak(''),
        /non-empty string/
      );
    });

    it('should throw for non-string text', async () => {
      const stts = new StreamingTTS({ modelPath: '/path/to/model.onnx' });

      await assert.rejects(
        // @ts-ignore - testing invalid input
        async () => stts.speak(123),
        /non-empty string/
      );
    });
  });

  describe('stop', () => {
    it('should handle stop when not speaking', () => {
      const stts = new StreamingTTS({ modelPath: '/path/to/model.onnx' });
      // Should not throw
      stts.stop();
      assert.strictEqual(stts.speaking, false);
    });

    it('should emit speak_stopped event', () => {
      const stts = new StreamingTTS({ modelPath: '/path/to/model.onnx' });
      stts._speaking = true; // Simulate speaking state

      let stopped = false;
      stts.on('speak_stopped', () => { stopped = true; });

      stts.stop();

      assert.strictEqual(stopped, true);
      assert.strictEqual(stts.speaking, false);
    });

    it('should clear jitter buffer', () => {
      const stts = new StreamingTTS({ modelPath: '/path/to/model.onnx' });
      stts._speaking = true;

      // Write some data to buffer
      stts.jitterBuffer.write(new Int16Array(100));
      assert.ok(stts.jitterBuffer.bufferedSamples > 0);

      stts.stop();

      assert.strictEqual(stts.jitterBuffer.bufferedSamples, 0);
    });
  });

  describe('readFrame', () => {
    it('should delegate to jitter buffer', () => {
      const stts = new StreamingTTS({
        frameDurationMs: 10,
        sampleRate: 1000
      });

      // Write some data
      stts.jitterBuffer.write(new Int16Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

      const frame = stts.readFrame();
      assert.strictEqual(frame.length, 10);
    });
  });

  describe('isBufferReady', () => {
    it('should delegate to jitter buffer', () => {
      const stts = new StreamingTTS({
        lowWatermarkMs: 10,
        sampleRate: 1000
      });

      assert.strictEqual(stts.isBufferReady(), false);

      stts.jitterBuffer.write(new Int16Array(20));

      assert.strictEqual(stts.isBufferReady(), true);
    });
  });

  describe('getStats', () => {
    it('should return combined statistics', () => {
      const stts = new StreamingTTS();

      const stats = stts.getStats();

      assert.strictEqual(stats.speaking, false);
      assert.strictEqual(stats.currentSentence, 0);
      assert.strictEqual(stats.totalSentences, 0);
      assert.ok(stats.buffer);
      assert.strictEqual(typeof stats.buffer.bufferedSamples, 'number');
    });
  });

  describe('event forwarding', () => {
    it('should forward ready event from jitter buffer', () => {
      const stts = new StreamingTTS({
        lowWatermarkMs: 10,
        sampleRate: 1000
      });

      let ready = false;
      stts.on('ready', () => { ready = true; });

      stts.jitterBuffer.write(new Int16Array(20));

      assert.strictEqual(ready, true);
    });

    it('should forward underrun event from jitter buffer', () => {
      const stts = new StreamingTTS({
        frameDurationMs: 10,
        sampleRate: 1000
      });

      let underrun = null;
      stts.on('underrun', (data) => { underrun = data; });

      stts.readFrame(); // Reading from empty buffer causes underrun

      assert.ok(underrun);
    });
  });
});

describe('createStreamingTTS', () => {
  it('should create StreamingTTS instance', () => {
    const stts = createStreamingTTS();
    assert.ok(stts instanceof StreamingTTS);
  });

  it('should pass config to constructor', () => {
    const stts = createStreamingTTS({ modelPath: '/test/model.onnx' });
    assert.strictEqual(stts.config.modelPath, '/test/model.onnx');
  });
});

describe('DEFAULT_STREAMING_TTS_CONFIG', () => {
  it('should have expected defaults', () => {
    assert.strictEqual(DEFAULT_STREAMING_TTS_CONFIG.sampleRate, 22050);
    assert.strictEqual(DEFAULT_STREAMING_TTS_CONFIG.bufferSizeMs, 500);
    assert.strictEqual(DEFAULT_STREAMING_TTS_CONFIG.lowWatermarkMs, 100);
    assert.strictEqual(DEFAULT_STREAMING_TTS_CONFIG.frameDurationMs, 20);
    assert.strictEqual(DEFAULT_STREAMING_TTS_CONFIG.minChunkChars, 20);
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_STREAMING_TTS_CONFIG));
  });
});
