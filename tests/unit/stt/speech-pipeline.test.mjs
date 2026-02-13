// @ts-nocheck - Tests intentionally use invalid inputs and mock internal properties
/**
 * Unit tests for SpeechPipeline - Complete audio capture to transcription pipeline
 *
 * Tests cover:
 * - Pipeline creation and configuration
 * - Initialization
 * - Start/stop lifecycle
 * - Event propagation
 * - Playback mode for barge-in
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  SpeechPipeline,
  createSpeechPipeline,
  DEFAULT_PIPELINE_CONFIG
} from '../../../src/stt/speech-pipeline.mjs';
import {
  assertThrows,
  assertThrowsAsync
} from '../../test-utils.mjs';

describe('SpeechPipeline', () => {
  describe('constructor', () => {
    it('should require vadModelPath', () => {
      assertThrows(() => {
        new SpeechPipeline({
          whisperPath: '/test/whisper',
          sttModelPath: '/test/model.bin'
        });
      }, 'vadModelPath is required');
    });

    it('should require whisperPath', () => {
      assertThrows(() => {
        new SpeechPipeline({
          vadModelPath: '/test/vad.onnx',
          sttModelPath: '/test/model.bin'
        });
      }, 'whisperPath is required');
    });

    it('should require sttModelPath', () => {
      assertThrows(() => {
        new SpeechPipeline({
          vadModelPath: '/test/vad.onnx',
          whisperPath: '/test/whisper'
        });
      }, 'sttModelPath is required');
    });

    it('should create instance with required config', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      assert.strictEqual(pipeline.isInitialized, false);
      assert.strictEqual(pipeline.isRunning, false);
      assert.strictEqual(pipeline.isTranscribing, false);
    });

    it('should use default config values', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      assert.strictEqual(pipeline.config.sampleRate, DEFAULT_PIPELINE_CONFIG.sampleRate);
      assert.strictEqual(pipeline.config.vadThreshold, DEFAULT_PIPELINE_CONFIG.vadThreshold);
      assert.strictEqual(pipeline.config.silenceDurationMs, DEFAULT_PIPELINE_CONFIG.silenceDurationMs);
    });

    it('should allow custom config values', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin',
        vadThreshold: 0.6,
        silenceDurationMs: 1500
      });

      assert.strictEqual(pipeline.config.vadThreshold, 0.6);
      assert.strictEqual(pipeline.config.silenceDurationMs, 1500);
    });
  });

  describe('init', () => {
    it('should return true when already initialized', async () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      // Mock initialized state
      pipeline._initialized = true;

      const result = await pipeline.init();

      assert.strictEqual(result, true);
    });

    it('should throw error when VAD model not found', async () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/nonexistent/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      await assertThrowsAsync(
        () => pipeline.init(),
        /VAD model not found/
      );
    });

    it('should emit error on initialization failure', async () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/nonexistent/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      let errorEmitted = false;
      pipeline.on('error', (data) => {
        errorEmitted = true;
        assert.strictEqual(data.type, 'init');
      });

      try {
        await pipeline.init();
      } catch {
        // Expected
      }

      assert.strictEqual(errorEmitted, true);
    });
  });

  describe('start', () => {
    it('should throw when not initialized', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      assertThrows(() => {
        pipeline.start();
      }, 'Pipeline not initialized. Call init() first.');
    });

    it('should return true when already running', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      pipeline._initialized = true;
      pipeline._running = true;

      // Mock capture to prevent actual start
      pipeline._capture.start = mock.fn();

      const result = pipeline.start();

      assert.strictEqual(result, true);
      assert.strictEqual(pipeline._capture.start.mock.callCount(), 0);
    });

    it('should start audio capture when initialized', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      pipeline._initialized = true;

      // Mock capture
      pipeline._capture.start = mock.fn();
      pipeline._capture.onChunk = mock.fn();

      const result = pipeline.start();

      assert.strictEqual(result, true);
      assert.strictEqual(pipeline.isRunning, true);
      assert.strictEqual(pipeline._capture.start.mock.callCount(), 1);
    });
  });

  describe('stop', () => {
    it('should do nothing when not running', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      // Mock capture
      pipeline._capture.stop = mock.fn();

      pipeline.stop();

      assert.strictEqual(pipeline._capture.stop.mock.callCount(), 0);
    });

    it('should stop capture and emit stopped event', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      pipeline._initialized = true;
      pipeline._running = true;

      // Mock components
      pipeline._capture.stop = mock.fn();
      pipeline._vad.forceEndSpeech = mock.fn();
      pipeline._vad.reset = mock.fn();

      let stoppedEmitted = false;
      pipeline.on('stopped', () => {
        stoppedEmitted = true;
      });

      pipeline.stop();

      assert.strictEqual(pipeline.isRunning, false);
      assert.strictEqual(stoppedEmitted, true);
      assert.strictEqual(pipeline._capture.stop.mock.callCount(), 1);
      assert.strictEqual(pipeline._vad.forceEndSpeech.mock.callCount(), 1);
    });
  });

  describe('setPlaybackActive', () => {
    it('should delegate to VAD processor', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      pipeline._vad.setPlaybackActive = mock.fn();

      pipeline.setPlaybackActive(true);

      assert.strictEqual(pipeline._vad.setPlaybackActive.mock.callCount(), 1);
      assert.deepStrictEqual(
        pipeline._vad.setPlaybackActive.mock.calls[0].arguments,
        [true]
      );
    });
  });

  describe('VAD event propagation', () => {
    it('should emit speech_started when VAD detects speech', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      let speechStarted = false;
      pipeline.on('speech_started', () => {
        speechStarted = true;
      });

      // Trigger VAD event
      pipeline._vad.emit('speech_started');

      assert.strictEqual(speechStarted, true);
    });

    it('should emit speech_ended when VAD ends speech', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      // Mock STT to prevent actual transcription
      pipeline._stt.transcribe = mock.fn(() =>
        Promise.resolve({ text: 'Hello', error: null, durationMs: 100 })
      );

      let speechEnded = false;
      let endedDuration = 0;
      pipeline.on('speech_ended', (data) => {
        speechEnded = true;
        endedDuration = data.durationMs;
      });

      // Trigger VAD event
      pipeline._vad.emit('speech_ended', {
        audio: new Int16Array(1000),
        durationMs: 500
      });

      assert.strictEqual(speechEnded, true);
      assert.strictEqual(endedDuration, 500);
    });

    it('should emit barge_in when VAD detects interrupt', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      let bargeIn = false;
      pipeline.on('barge_in', () => {
        bargeIn = true;
      });

      // Trigger VAD event
      pipeline._vad.emit('barge_in', { probability: 0.9 });

      assert.strictEqual(bargeIn, true);
    });
  });

  describe('transcription', () => {
    it('should emit transcript when STT succeeds', async () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      // Mock STT
      pipeline._stt.transcribe = mock.fn(() =>
        Promise.resolve({ text: 'Hello world', error: null, durationMs: 150 })
      );

      let transcript = null;
      pipeline.on('transcript', (data) => {
        transcript = data;
      });

      // Trigger VAD speech_ended
      pipeline._vad.emit('speech_ended', {
        audio: new Int16Array(1000),
        durationMs: 600
      });

      // Wait for async transcription
      await new Promise(resolve => setTimeout(resolve, 10));

      assert.notStrictEqual(transcript, null);
      assert.strictEqual(transcript.text, 'Hello world');
      assert.strictEqual(transcript.audioDurationMs, 600);
      assert.strictEqual(transcript.sttDurationMs, 150);
    });

    it('should emit empty_transcript when STT returns garbage', async () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      // Mock STT to return empty
      pipeline._stt.transcribe = mock.fn(() =>
        Promise.resolve({ text: '', error: 'EMPTY_TRANSCRIPT', durationMs: 100 })
      );

      let emptyTranscript = null;
      pipeline.on('empty_transcript', (data) => {
        emptyTranscript = data;
      });

      // Trigger VAD speech_ended
      pipeline._vad.emit('speech_ended', {
        audio: new Int16Array(1000),
        durationMs: 600
      });

      // Wait for async transcription
      await new Promise(resolve => setTimeout(resolve, 10));

      assert.notStrictEqual(emptyTranscript, null);
      assert.strictEqual(emptyTranscript.error, 'EMPTY_TRANSCRIPT');
    });

    it('should track transcription counts', async () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      // Mock STT
      let callCount = 0;
      pipeline._stt.transcribe = mock.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ text: 'Hello', error: null, durationMs: 100 });
        }
        return Promise.resolve({ text: '', error: 'EMPTY_TRANSCRIPT', durationMs: 50 });
      });

      // First transcription - success
      pipeline._vad.emit('speech_ended', { audio: new Int16Array(100), durationMs: 500 });
      await new Promise(resolve => setTimeout(resolve, 10));

      // Second transcription - empty
      pipeline._vad.emit('speech_ended', { audio: new Int16Array(100), durationMs: 500 });
      await new Promise(resolve => setTimeout(resolve, 10));

      const stats = pipeline.getStats();
      assert.strictEqual(stats.transcriptCount, 1);
      assert.strictEqual(stats.emptyTranscriptCount, 1);
    });
  });

  describe('getStats', () => {
    it('should return pipeline statistics', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      const stats = pipeline.getStats();

      assert.strictEqual(stats.initialized, false);
      assert.strictEqual(stats.running, false);
      assert.strictEqual(stats.transcribing, false);
      assert.strictEqual(stats.transcriptCount, 0);
      assert.strictEqual(stats.emptyTranscriptCount, 0);
      assert.ok(typeof stats.capture === 'object');
      assert.ok(typeof stats.vad === 'object');
      assert.ok(typeof stats.stt === 'object');
    });
  });

  describe('getSnapshot', () => {
    it('should return current state snapshot', () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      const snapshot = pipeline.getSnapshot();

      assert.strictEqual(snapshot.initialized, false);
      assert.strictEqual(snapshot.running, false);
      assert.strictEqual(snapshot.transcribing, false);
      assert.ok(typeof snapshot.vad === 'object');
    });
  });

  describe('dispose', () => {
    it('should release all resources', async () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      pipeline._initialized = true;
      pipeline._running = true;

      // Mock components
      pipeline._capture.stop = mock.fn();
      pipeline._vad.forceEndSpeech = mock.fn();
      pipeline._vad.reset = mock.fn();
      pipeline._vad.dispose = mock.fn(() => Promise.resolve());
      pipeline._stt.dispose = mock.fn();

      await pipeline.dispose();

      assert.strictEqual(pipeline.isInitialized, false);
      assert.strictEqual(pipeline._vad.dispose.mock.callCount(), 1);
      assert.strictEqual(pipeline._stt.dispose.mock.callCount(), 1);
    });

    it('should remove all listeners', async () => {
      const pipeline = new SpeechPipeline({
        vadModelPath: '/test/vad.onnx',
        whisperPath: '/test/whisper',
        sttModelPath: '/test/model.bin'
      });

      pipeline.on('transcript', () => {});
      pipeline.on('error', () => {});

      // Mock dispose methods
      pipeline._capture.stop = mock.fn();
      pipeline._vad.forceEndSpeech = mock.fn();
      pipeline._vad.reset = mock.fn();
      pipeline._vad.dispose = mock.fn(() => Promise.resolve());
      pipeline._stt.dispose = mock.fn();

      await pipeline.dispose();

      assert.strictEqual(pipeline.listenerCount('transcript'), 0);
      assert.strictEqual(pipeline.listenerCount('error'), 0);
    });
  });
});

describe('createSpeechPipeline', () => {
  it('should create SpeechPipeline instance', () => {
    const pipeline = createSpeechPipeline({
      vadModelPath: '/test/vad.onnx',
      whisperPath: '/test/whisper',
      sttModelPath: '/test/model.bin'
    });

    assert.ok(pipeline instanceof SpeechPipeline);
  });

  it('should pass config to constructor', () => {
    const pipeline = createSpeechPipeline({
      vadModelPath: '/test/vad.onnx',
      whisperPath: '/test/whisper',
      sttModelPath: '/test/model.bin',
      vadThreshold: 0.7
    });

    assert.strictEqual(pipeline.config.vadThreshold, 0.7);
  });
});

describe('DEFAULT_PIPELINE_CONFIG', () => {
  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_PIPELINE_CONFIG));
  });

  it('should have expected defaults', () => {
    assert.strictEqual(DEFAULT_PIPELINE_CONFIG.sampleRate, 16000);
    assert.strictEqual(DEFAULT_PIPELINE_CONFIG.vadThreshold, 0.5);
    assert.strictEqual(DEFAULT_PIPELINE_CONFIG.bargeInThreshold, 0.7);
    assert.strictEqual(DEFAULT_PIPELINE_CONFIG.silenceDurationMs, 1200);
    assert.strictEqual(DEFAULT_PIPELINE_CONFIG.minSpeechMs, 500);
    assert.strictEqual(DEFAULT_PIPELINE_CONFIG.sttThreads, 4);
  });
});
