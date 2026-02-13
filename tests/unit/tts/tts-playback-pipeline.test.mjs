/**
 * Unit tests for TTS Playback Pipeline
 *
 * Per T027 acceptance criteria:
 * - Complete text-to-audio pipeline works
 * - Streaming reduces latency
 * - Smooth playback achieved
 * - FR-4: Audio begins within 500ms of synthesis start
 * - FR-5: Continuous audio with no cuts/glitches
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import {
  TtsPlaybackPipeline,
  createTtsPlaybackPipeline,
  DEFAULT_TTS_PLAYBACK_CONFIG
} from '../../../src/tts/tts-playback-pipeline.mjs';

describe('TtsPlaybackPipeline', () => {
  /** @type {TtsPlaybackPipeline|null} */
  let pipeline = null;

  afterEach(() => {
    if (pipeline) {
      pipeline.dispose();
      pipeline = null;
    }
  });

  describe('constructor', () => {
    it('should use default config', () => {
      pipeline = new TtsPlaybackPipeline();
      assert.strictEqual(pipeline.config.sampleRate, DEFAULT_TTS_PLAYBACK_CONFIG.sampleRate);
      assert.strictEqual(pipeline.config.bufferSizeMs, DEFAULT_TTS_PLAYBACK_CONFIG.bufferSizeMs);
      assert.strictEqual(pipeline.config.lowWatermarkMs, DEFAULT_TTS_PLAYBACK_CONFIG.lowWatermarkMs);
    });

    it('should merge custom config', () => {
      pipeline = new TtsPlaybackPipeline({
        modelPath: '/path/to/model.onnx',
        sampleRate: 16000
      });
      assert.strictEqual(pipeline.config.modelPath, '/path/to/model.onnx');
      assert.strictEqual(pipeline.config.sampleRate, 16000);
    });

    it('should start not speaking', () => {
      pipeline = new TtsPlaybackPipeline();
      assert.strictEqual(pipeline.speaking, false);
    });

    it('should be an EventEmitter', () => {
      pipeline = new TtsPlaybackPipeline();
      assert.ok(pipeline instanceof EventEmitter);
    });

    it('should create StreamingTTS with correct config', () => {
      pipeline = new TtsPlaybackPipeline({
        modelPath: '/test/model.onnx',
        sampleRate: 44100
      });
      assert.strictEqual(pipeline.streamingTts.config.modelPath, '/test/model.onnx');
      assert.strictEqual(pipeline.streamingTts.config.sampleRate, 44100);
    });

    it('should create AudioPlayback with correct config', () => {
      pipeline = new TtsPlaybackPipeline({
        sampleRate: 48000
      });
      assert.strictEqual(pipeline.audioPlayback.config.sampleRate, 48000);
    });
  });

  describe('sampleRate getter', () => {
    it('should return configured sample rate', () => {
      pipeline = new TtsPlaybackPipeline({ sampleRate: 44100 });
      assert.strictEqual(pipeline.sampleRate, 44100);
    });
  });

  describe('streamingTts getter', () => {
    it('should return the StreamingTTS instance', () => {
      pipeline = new TtsPlaybackPipeline();
      const stts = pipeline.streamingTts;
      assert.ok(stts);
      assert.strictEqual(typeof stts.speak, 'function');
      assert.strictEqual(typeof stts.stop, 'function');
    });
  });

  describe('audioPlayback getter', () => {
    it('should return the AudioPlayback instance', () => {
      pipeline = new TtsPlaybackPipeline();
      const ap = pipeline.audioPlayback;
      assert.ok(ap);
      assert.strictEqual(typeof ap.start, 'function');
      assert.strictEqual(typeof ap.write, 'function');
      assert.strictEqual(typeof ap.stop, 'function');
    });
  });

  describe('speak validation', () => {
    it('should throw when already speaking', async () => {
      pipeline = new TtsPlaybackPipeline({ modelPath: '/path/to/model.onnx' });

      // Manually set speaking flag
      pipeline._speaking = true;

      await assert.rejects(
        async () => pipeline?.speak('test'),
        /Already speaking/
      );
    });

    it('should throw for empty text', async () => {
      pipeline = new TtsPlaybackPipeline({ modelPath: '/path/to/model.onnx' });

      await assert.rejects(
        async () => pipeline?.speak(''),
        /non-empty string/
      );
    });

    it('should throw for non-string text', async () => {
      pipeline = new TtsPlaybackPipeline({ modelPath: '/path/to/model.onnx' });

      await assert.rejects(
        // @ts-ignore - testing invalid input type
        async () => pipeline?.speak(123),
        /non-empty string/
      );
    });

    it('should throw when disposed', async () => {
      pipeline = new TtsPlaybackPipeline({ modelPath: '/path/to/model.onnx' });
      pipeline.dispose();

      await assert.rejects(
        async () => pipeline?.speak('test'),
        /disposed/
      );
    });
  });

  describe('stop', () => {
    it('should handle stop when not speaking', () => {
      pipeline = new TtsPlaybackPipeline({ modelPath: '/path/to/model.onnx' });
      // Should not throw
      pipeline.stop();
      assert.strictEqual(pipeline.speaking, false);
    });

    it('should emit speaking_stopped event', () => {
      pipeline = new TtsPlaybackPipeline({ modelPath: '/path/to/model.onnx' });
      pipeline._speaking = true;

      let stopped = false;
      pipeline.on('speaking_stopped', () => { stopped = true; });

      pipeline.stop();

      assert.strictEqual(stopped, true);
      assert.strictEqual(pipeline.speaking, false);
    });

    it('should stop StreamingTTS', () => {
      pipeline = new TtsPlaybackPipeline({ modelPath: '/path/to/model.onnx' });
      pipeline._speaking = true;

      // Write some data to jitter buffer to simulate active state
      pipeline.streamingTts.jitterBuffer.write(new Int16Array(100));

      let ttsStopped = false;
      pipeline.streamingTts.on('speak_stopped', () => { ttsStopped = true; });

      // Manually set streaming TTS speaking state
      pipeline.streamingTts._speaking = true;

      pipeline.stop();

      assert.strictEqual(ttsStopped, true);
    });

    it('should clear playback interval', () => {
      pipeline = new TtsPlaybackPipeline({ modelPath: '/path/to/model.onnx' });
      pipeline._speaking = true;
      pipeline._playbackStarted = true;
      pipeline._playbackInterval = setInterval(() => {}, 1000);

      pipeline.stop();

      assert.strictEqual(pipeline._playbackInterval, null);
    });
  });

  describe('getStats', () => {
    it('should return combined statistics', () => {
      pipeline = new TtsPlaybackPipeline();

      const stats = pipeline.getStats();

      assert.strictEqual(stats.speaking, false);
      assert.strictEqual(stats.playbackStarted, false);
      assert.ok(stats.synthesis);
      assert.strictEqual(typeof stats.synthesis.speaking, 'boolean');
      assert.ok(stats.playback);
      assert.strictEqual(typeof stats.playback.running, 'boolean');
    });
  });

  describe('event forwarding', () => {
    it('should forward ready event', () => {
      pipeline = new TtsPlaybackPipeline({
        lowWatermarkMs: 10,
        sampleRate: 1000
      });

      // Mock _startPlayback to prevent actual audio process spawning
      let playbackStartCalled = false;
      // @ts-ignore - testing private method override
      pipeline._startPlayback = () => {
        playbackStartCalled = true;
        if (pipeline) {
          pipeline._playbackStarted = true;
          pipeline.emit('ready');
        }
      };

      pipeline._speaking = true;

      let ready = false;
      pipeline.on('ready', () => { ready = true; });

      // Manually trigger ready on jitter buffer
      pipeline.streamingTts.jitterBuffer.write(new Int16Array(20));

      // Verify playback start was triggered and ready event emitted
      assert.strictEqual(playbackStartCalled, true);
      assert.strictEqual(ready, true);
    });

    it('should forward underrun event', () => {
      pipeline = new TtsPlaybackPipeline();

      let underrun = null;
      pipeline.on('underrun', (data) => { underrun = data; });

      // Trigger underrun on jitter buffer via streamingTTS
      pipeline.streamingTts.emit('underrun', { requested: 100, available: 0 });

      assert.ok(underrun);
      // @ts-ignore - accessing event data
      assert.strictEqual(underrun.requested, 100);
    });

    it('should forward synthesis_started event', () => {
      pipeline = new TtsPlaybackPipeline();

      let started = null;
      pipeline.on('synthesis_started', (data) => { started = data; });

      pipeline.streamingTts.emit('speak_started', { text: 'Hello' });

      assert.ok(started);
      // @ts-ignore - accessing event data
      assert.strictEqual(started.text, 'Hello');
    });

    it('should forward sentence_started event', () => {
      pipeline = new TtsPlaybackPipeline();

      let sentence = null;
      pipeline.on('sentence_started', (data) => { sentence = data; });

      pipeline.streamingTts.emit('sentence_started', { index: 0, sentence: 'Hello.', total: 2 });

      assert.ok(sentence);
      // @ts-ignore - accessing event data
      assert.strictEqual(sentence.index, 0);
    });

    it('should forward sentence_complete event', () => {
      pipeline = new TtsPlaybackPipeline();

      let sentence = null;
      pipeline.on('sentence_complete', (data) => { sentence = data; });

      pipeline.streamingTts.emit('sentence_complete', { index: 0, sentence: 'Hello.', total: 2 });

      assert.ok(sentence);
      // @ts-ignore - accessing event data
      assert.strictEqual(sentence.index, 0);
    });

    it('should forward synthesis_complete event', () => {
      pipeline = new TtsPlaybackPipeline();

      let complete = false;
      pipeline.on('synthesis_complete', () => { complete = true; });

      pipeline.streamingTts.emit('speak_complete');

      assert.strictEqual(complete, true);
    });

    it('should emit speaking_complete when jitter buffer is drained', () => {
      pipeline = new TtsPlaybackPipeline();
      pipeline._speaking = true;
      pipeline._playbackStarted = true;

      let complete = false;
      pipeline.on('speaking_complete', () => { complete = true; });

      // Manually trigger drained event on jitter buffer
      pipeline.streamingTts.jitterBuffer.emit('drained');

      assert.strictEqual(complete, true);
      assert.strictEqual(pipeline.speaking, false);
    });
  });

  describe('error handling', () => {
    it('should forward errors from StreamingTTS', () => {
      pipeline = new TtsPlaybackPipeline();

      let error = null;
      pipeline.on('error', (err) => { error = err; });

      const testError = new Error('TTS error');
      pipeline.streamingTts.emit('error', testError);

      assert.strictEqual(error, testError);
      assert.strictEqual(pipeline.speaking, false);
    });

    it('should forward errors from AudioPlayback', () => {
      pipeline = new TtsPlaybackPipeline();

      let error = null;
      pipeline.on('error', (err) => { error = err; });

      const testError = new Error('Playback error');
      pipeline.audioPlayback.emit('error', testError);

      assert.strictEqual(error, testError);
      assert.strictEqual(pipeline.speaking, false);
    });
  });

  describe('dispose', () => {
    it('should stop speaking', () => {
      pipeline = new TtsPlaybackPipeline();
      pipeline._speaking = true;

      pipeline.dispose();

      assert.strictEqual(pipeline.speaking, false);
    });

    it('should mark as disposed', () => {
      pipeline = new TtsPlaybackPipeline();

      pipeline.dispose();

      assert.strictEqual(pipeline._disposed, true);
    });

    it('should remove all listeners', () => {
      pipeline = new TtsPlaybackPipeline();

      pipeline.on('speaking_started', () => {});
      pipeline.on('error', () => {});

      assert.ok(pipeline.listenerCount('speaking_started') > 0);

      pipeline.dispose();

      assert.strictEqual(pipeline.listenerCount('speaking_started'), 0);
      assert.strictEqual(pipeline.listenerCount('error'), 0);
    });
  });

  describe('playback loop behavior', () => {
    it('should not start playback if not speaking', () => {
      pipeline = new TtsPlaybackPipeline({
        lowWatermarkMs: 10,
        sampleRate: 1000
      });

      // Mock _startPlayback to track calls without side effects
      let startCalled = false;
      // @ts-ignore - testing private method override
      pipeline._startPlayback = () => {
        startCalled = true;
        if (pipeline) pipeline._playbackStarted = true;
      };

      // Trigger ready without speaking
      pipeline._speaking = false;
      pipeline.streamingTts.jitterBuffer.write(new Int16Array(20));

      assert.strictEqual(startCalled, false);
      assert.strictEqual(pipeline._playbackStarted, false);
    });

    it('should start playback when ready and speaking', () => {
      pipeline = new TtsPlaybackPipeline({
        lowWatermarkMs: 10,
        sampleRate: 1000
      });

      // Mock _startPlayback to track calls without spawning processes
      let startCalled = false;
      // @ts-ignore - testing private method override
      pipeline._startPlayback = () => {
        startCalled = true;
        if (pipeline) pipeline._playbackStarted = true;
      };

      pipeline._speaking = true;

      // Trigger ready
      pipeline.streamingTts.jitterBuffer.write(new Int16Array(20));

      assert.strictEqual(startCalled, true);
      assert.strictEqual(pipeline._playbackStarted, true);
    });

    it('should not start playback twice', () => {
      pipeline = new TtsPlaybackPipeline({
        lowWatermarkMs: 10,
        sampleRate: 1000
      });

      // Track call count without spawning processes
      let startCallCount = 0;
      // @ts-ignore - testing private method override
      pipeline._startPlayback = () => {
        if (pipeline?._playbackStarted) return;
        startCallCount++;
        if (pipeline) pipeline._playbackStarted = true;
      };

      pipeline._speaking = true;

      // Trigger ready twice
      pipeline.streamingTts.jitterBuffer.write(new Int16Array(20));
      pipeline.streamingTts.jitterBuffer.write(new Int16Array(20));

      // Should only be called once
      assert.strictEqual(startCallCount, 1);
    });
  });
});

describe('createTtsPlaybackPipeline', () => {
  it('should create TtsPlaybackPipeline instance', () => {
    const pipeline = createTtsPlaybackPipeline();
    assert.ok(pipeline instanceof TtsPlaybackPipeline);
    pipeline.dispose();
  });

  it('should pass config to constructor', () => {
    const pipeline = createTtsPlaybackPipeline({ modelPath: '/test/model.onnx' });
    assert.strictEqual(pipeline.config.modelPath, '/test/model.onnx');
    pipeline.dispose();
  });
});

describe('DEFAULT_TTS_PLAYBACK_CONFIG', () => {
  it('should have expected defaults', () => {
    assert.strictEqual(DEFAULT_TTS_PLAYBACK_CONFIG.sampleRate, 22050);
    assert.strictEqual(DEFAULT_TTS_PLAYBACK_CONFIG.bufferSizeMs, 500);
    assert.strictEqual(DEFAULT_TTS_PLAYBACK_CONFIG.lowWatermarkMs, 100);
    assert.strictEqual(DEFAULT_TTS_PLAYBACK_CONFIG.frameDurationMs, 20);
    assert.strictEqual(DEFAULT_TTS_PLAYBACK_CONFIG.minChunkChars, 20);
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_TTS_PLAYBACK_CONFIG));
  });
});
