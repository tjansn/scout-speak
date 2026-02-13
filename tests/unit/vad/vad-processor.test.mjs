// @ts-nocheck - Tests intentionally use invalid inputs and mock internal properties
/**
 * Unit tests for VADProcessor - Complete VAD processing pipeline
 *
 * Tests cover:
 * - Processor creation and configuration
 * - Model loading
 * - Frame processing with events
 * - Barge-in detection during playback
 * - State management and reset
 * - Statistics tracking
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  VADProcessor,
  createVADProcessor,
  DEFAULT_PROCESSOR_CONFIG
} from '../../../src/vad/vad-processor.mjs';
import {
  createMockAudioBuffer,
  assertThrows,
  assertThrowsAsync
} from '../../test-utils.mjs';

describe('VADProcessor', () => {
  describe('constructor', () => {
    it('should require modelPath', () => {
      assertThrows(() => {
        new VADProcessor({});
      }, 'modelPath is required');
    });

    it('should create instance with required config', () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });

      assert.strictEqual(processor.isLoaded, false);
      assert.strictEqual(processor.isPlaybackActive, false);
      assert.strictEqual(processor.config.modelPath, '/test/model.onnx');
    });

    it('should use default config values', () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });

      assert.strictEqual(processor.config.threshold, DEFAULT_PROCESSOR_CONFIG.threshold);
      assert.strictEqual(processor.config.silenceDurationMs, DEFAULT_PROCESSOR_CONFIG.silenceDurationMs);
      assert.strictEqual(processor.config.minSpeechMs, DEFAULT_PROCESSOR_CONFIG.minSpeechMs);
      assert.strictEqual(processor.config.bargeInConsecutiveFrames, 3);
    });

    it('should allow custom config values', () => {
      const processor = new VADProcessor({
        modelPath: '/test/model.onnx',
        threshold: 0.6,
        bargeInThreshold: 0.8,
        silenceDurationMs: 1500,
        bargeInConsecutiveFrames: 5
      });

      assert.strictEqual(processor.config.threshold, 0.6);
      assert.strictEqual(processor.config.bargeInThreshold, 0.8);
      assert.strictEqual(processor.config.silenceDurationMs, 1500);
      assert.strictEqual(processor.config.bargeInConsecutiveFrames, 5);
    });
  });

  describe('load', () => {
    it('should throw when model not found', async () => {
      const processor = new VADProcessor({ modelPath: '/nonexistent/model.onnx' });

      await assertThrowsAsync(
        () => processor.load(),
        /VAD model not found/
      );
    });

    it('should return true when already loaded', async () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });
      processor._loaded = true; // Mock loaded state

      const result = await processor.load();

      assert.strictEqual(result, true);
    });
  });

  describe('processFrame', () => {
    it('should throw when model not loaded', async () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });
      const frame = createMockAudioBuffer(480);

      await assertThrowsAsync(
        () => processor.processFrame(frame),
        'VAD model not loaded. Call load() first.'
      );
    });

    it('should process frame and return result', async () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });
      processor._loaded = true;

      // Mock the VAD inference
      processor._vad.infer = mock.fn(() => Promise.resolve(0.7));

      const frame = createMockAudioBuffer(480);
      const result = await processor.processFrame(frame);

      assert.strictEqual(result.probability, 0.7);
      assert.strictEqual(result.isSpeech, true);
      assert.ok(['idle', 'speech', 'silence'].includes(result.state));
    });

    it('should emit speech_started event', async () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });
      processor._loaded = true;

      // Mock the VAD inference to return high probability
      processor._vad.infer = mock.fn(() => Promise.resolve(0.8));

      let speechStarted = false;
      processor.on('speech_started', () => {
        speechStarted = true;
      });

      const frame = createMockAudioBuffer(480);
      await processor.processFrame(frame);

      assert.strictEqual(speechStarted, true);
    });

    it('should emit speech_ended event after silence', async () => {
      const processor = new VADProcessor({
        modelPath: '/test/model.onnx',
        threshold: 0.5,
        silenceDurationMs: 60, // 2 frames at 30ms
        minSpeechMs: 30 // 1 frame
      });
      processor._loaded = true;

      let speechEndedData = null;
      processor.on('speech_ended', (data) => {
        speechEndedData = data;
      });

      // Mock VAD inference
      let callCount = 0;
      processor._vad.infer = mock.fn(() => {
        callCount++;
        // First frames: speech, then silence
        if (callCount <= 2) return Promise.resolve(0.8); // Speech
        return Promise.resolve(0.2); // Silence
      });

      const frame = createMockAudioBuffer(480);

      // Process speech frames
      await processor.processFrame(frame);
      await processor.processFrame(frame);

      // Process silence frames
      await processor.processFrame(frame);
      await processor.processFrame(frame);
      await processor.processFrame(frame);

      assert.notStrictEqual(speechEndedData, null);
      assert.ok(speechEndedData.audio instanceof Int16Array);
      assert.ok(speechEndedData.durationMs > 0);
    });

    it('should track statistics', async () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });
      processor._loaded = true;
      processor._vad.infer = mock.fn(() => Promise.resolve(0.5));

      const frame = createMockAudioBuffer(480);
      await processor.processFrame(frame);
      await processor.processFrame(frame);
      await processor.processFrame(frame);

      const stats = processor.getStats();
      assert.strictEqual(stats.framesProcessed, 3);
      assert.ok(stats.avgInferenceTimeMs >= 0);
      assert.ok(stats.totalInferenceTimeMs >= 0);
    });
  });

  describe('barge-in detection', () => {
    it('should use higher threshold during playback', () => {
      const processor = new VADProcessor({
        modelPath: '/test/model.onnx',
        threshold: 0.5,
        bargeInThreshold: 0.7
      });

      assert.strictEqual(processor.currentThreshold, 0.5);

      processor.setPlaybackActive(true);
      assert.strictEqual(processor.currentThreshold, 0.7);

      processor.setPlaybackActive(false);
      assert.strictEqual(processor.currentThreshold, 0.5);
    });

    it('should emit barge_in after consecutive speech frames', async () => {
      const processor = new VADProcessor({
        modelPath: '/test/model.onnx',
        bargeInThreshold: 0.7,
        bargeInConsecutiveFrames: 3
      });
      processor._loaded = true;
      processor.setPlaybackActive(true);

      let bargeInData = null;
      processor.on('barge_in', (data) => {
        bargeInData = data;
      });

      // Mock VAD inference with high probability
      processor._vad.infer = mock.fn(() => Promise.resolve(0.9));

      const frame = createMockAudioBuffer(480);

      // Process 3 frames with high probability
      await processor.processFrame(frame);
      await processor.processFrame(frame);
      await processor.processFrame(frame);

      assert.notStrictEqual(bargeInData, null);
      assert.strictEqual(bargeInData.consecutiveFrames, 3);
      assert.ok(bargeInData.probability > 0.7);
    });

    it('should reset consecutive count on non-speech frame', async () => {
      const processor = new VADProcessor({
        modelPath: '/test/model.onnx',
        bargeInThreshold: 0.7,
        bargeInConsecutiveFrames: 3
      });
      processor._loaded = true;
      processor.setPlaybackActive(true);

      let bargeInEmitted = false;
      processor.on('barge_in', () => {
        bargeInEmitted = true;
      });

      // Mock VAD inference - speech, speech, silence, speech, speech, silence
      let callCount = 0;
      processor._vad.infer = mock.fn(() => {
        callCount++;
        if (callCount === 3 || callCount === 6) return Promise.resolve(0.3);
        return Promise.resolve(0.9);
      });

      const frame = createMockAudioBuffer(480);

      // Process 6 frames - should not trigger barge-in
      for (let i = 0; i < 6; i++) {
        await processor.processFrame(frame);
      }

      assert.strictEqual(bargeInEmitted, false);
    });

    it('should return playback state during playback', async () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });
      processor._loaded = true;
      processor.setPlaybackActive(true);

      processor._vad.infer = mock.fn(() => Promise.resolve(0.5));

      const frame = createMockAudioBuffer(480);
      const result = await processor.processFrame(frame);

      assert.strictEqual(result.state, 'playback');
    });
  });

  describe('forceEndSpeech', () => {
    it('should return null when no speech active', () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });

      const result = processor.forceEndSpeech();

      assert.strictEqual(result, null);
    });

    it('should emit speech_ended when speech active', async () => {
      const processor = new VADProcessor({
        modelPath: '/test/model.onnx',
        minSpeechMs: 30 // 1 frame
      });
      processor._loaded = true;

      // Mock VAD inference to start speech
      processor._vad.infer = mock.fn(() => Promise.resolve(0.8));

      let speechEndedEmitted = false;
      processor.on('speech_ended', () => {
        speechEndedEmitted = true;
      });

      const frame = createMockAudioBuffer(480);
      await processor.processFrame(frame);

      const result = processor.forceEndSpeech();

      assert.notStrictEqual(result, null);
      assert.strictEqual(speechEndedEmitted, true);
    });
  });

  describe('reset', () => {
    it('should reset VAD state and LSTM states', async () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });
      processor._loaded = true;
      processor._consecutiveSpeechFrames = 5;

      // Mock the reset methods
      let vadStateReset = false;
      let vadReset = false;

      processor._vadState.reset = mock.fn(() => {
        vadStateReset = true;
      });
      processor._vad.resetState = mock.fn(() => {
        vadReset = true;
      });

      processor.reset();

      assert.strictEqual(vadStateReset, true);
      assert.strictEqual(vadReset, true);
      assert.strictEqual(processor._consecutiveSpeechFrames, 0);
    });
  });

  describe('getSnapshot', () => {
    it('should return complete state snapshot', () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });

      const snapshot = processor.getSnapshot();

      assert.strictEqual(snapshot.loaded, false);
      assert.strictEqual(snapshot.playbackActive, false);
      assert.strictEqual(snapshot.consecutiveSpeechFrames, 0);
      assert.ok(typeof snapshot.currentThreshold === 'number');
      assert.ok(typeof snapshot.vadState === 'object');
      assert.ok(typeof snapshot.stats === 'object');
    });
  });

  describe('dispose', () => {
    it('should release resources', async () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });
      processor._loaded = true;

      let disposed = false;
      processor._vad.dispose = mock.fn(() => {
        disposed = true;
        return Promise.resolve();
      });

      await processor.dispose();

      assert.strictEqual(disposed, true);
      assert.strictEqual(processor.isLoaded, false);
    });

    it('should remove all listeners', async () => {
      const processor = new VADProcessor({ modelPath: '/test/model.onnx' });

      processor.on('speech_started', () => {});
      processor.on('speech_ended', () => {});
      processor.on('barge_in', () => {});

      processor._vad.dispose = mock.fn(() => Promise.resolve());

      await processor.dispose();

      assert.strictEqual(processor.listenerCount('speech_started'), 0);
      assert.strictEqual(processor.listenerCount('speech_ended'), 0);
      assert.strictEqual(processor.listenerCount('barge_in'), 0);
    });
  });
});

describe('createVADProcessor', () => {
  it('should create VADProcessor instance', () => {
    const processor = createVADProcessor({ modelPath: '/test/model.onnx' });

    assert.ok(processor instanceof VADProcessor);
  });

  it('should pass config to constructor', () => {
    const processor = createVADProcessor({
      modelPath: '/test/model.onnx',
      threshold: 0.6
    });

    assert.strictEqual(processor.config.threshold, 0.6);
  });
});

describe('DEFAULT_PROCESSOR_CONFIG', () => {
  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_PROCESSOR_CONFIG));
  });

  it('should have expected defaults', () => {
    assert.strictEqual(DEFAULT_PROCESSOR_CONFIG.threshold, 0.5);
    assert.strictEqual(DEFAULT_PROCESSOR_CONFIG.bargeInThreshold, 0.7);
    assert.strictEqual(DEFAULT_PROCESSOR_CONFIG.silenceDurationMs, 1200);
    assert.strictEqual(DEFAULT_PROCESSOR_CONFIG.minSpeechMs, 500);
    assert.strictEqual(DEFAULT_PROCESSOR_CONFIG.sampleRate, 16000);
    assert.strictEqual(DEFAULT_PROCESSOR_CONFIG.frameDurationMs, 30);
    assert.strictEqual(DEFAULT_PROCESSOR_CONFIG.bargeInConsecutiveFrames, 3);
  });
});
