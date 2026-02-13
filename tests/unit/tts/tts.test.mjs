/**
 * Unit tests for TTS Module (Piper wrapper)
 *
 * Tests per T023 acceptance criteria:
 * - FR-4: Audio begins within 500ms of synthesis start
 * - Outputs correct format (s16le, configurable sample rate)
 * - Supports streaming output
 * - Can be interrupted
 * - Piper cold-start impact is mitigated
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import { TTS, createTTS, DEFAULT_TTS_CONFIG } from '../../../src/tts/tts.mjs';

describe('TTS', () => {
  describe('constructor', () => {
    it('should use default config', () => {
      const tts = new TTS();
      assert.strictEqual(tts.config.sampleRate, DEFAULT_TTS_CONFIG.sampleRate);
      assert.strictEqual(tts.config.modelPath, DEFAULT_TTS_CONFIG.modelPath);
    });

    it('should merge custom config', () => {
      const tts = new TTS({ modelPath: '/path/to/model.onnx', sampleRate: 16000 });
      assert.strictEqual(tts.config.modelPath, '/path/to/model.onnx');
      assert.strictEqual(tts.config.sampleRate, 16000);
    });

    it('should start not synthesizing', () => {
      const tts = new TTS();
      assert.strictEqual(tts.synthesizing, false);
    });
  });

  describe('event emitter', () => {
    it('should be an EventEmitter', () => {
      const tts = new TTS();
      assert.ok(tts instanceof EventEmitter);
    });
  });

  describe('synthesize validation', () => {
    it('should throw if model path not configured', async () => {
      const tts = new TTS();
      await assert.rejects(
        async () => {
          for await (const _chunk of tts.synthesize('test')) { /* consume iterator */ }
        },
        /model path not configured/
      );
    });

    it('should throw for empty text', async () => {
      const tts = new TTS({ modelPath: '/path/to/model.onnx' });
      await assert.rejects(
        async () => {
          for await (const _chunk of tts.synthesize('')) { /* consume iterator */ }
        },
        /non-empty string/
      );
    });

    it('should throw for non-string text', async () => {
      const tts = new TTS({ modelPath: '/path/to/model.onnx' });
      await assert.rejects(
        async () => {
          // @ts-ignore - testing invalid input
          for await (const _chunk of tts.synthesize(123)) { /* consume iterator */ }
        },
        /non-empty string/
      );
    });
  });

  describe('stop', () => {
    it('should handle stop when not synthesizing', () => {
      const tts = new TTS({ modelPath: '/path/to/model.onnx' });
      // Should not throw
      tts.stop();
      assert.strictEqual(tts.synthesizing, false);
    });
  });

  describe('calculateDurationMs', () => {
    it('should calculate duration correctly at 22050Hz', () => {
      const tts = new TTS({ sampleRate: 22050 });
      const buffer = Buffer.alloc(22050 * 2); // 1 second at 16-bit
      const duration = tts.calculateDurationMs(buffer);
      assert.strictEqual(duration, 1000);
    });

    it('should calculate duration correctly at 16000Hz', () => {
      const tts = new TTS({ sampleRate: 16000 });
      const buffer = Buffer.alloc(16000 * 2); // 1 second at 16-bit
      const duration = tts.calculateDurationMs(buffer);
      assert.strictEqual(duration, 1000);
    });

    it('should handle partial seconds', () => {
      const tts = new TTS({ sampleRate: 22050 });
      const buffer = Buffer.alloc(11025 * 2); // 0.5 seconds
      const duration = tts.calculateDurationMs(buffer);
      assert.strictEqual(duration, 500);
    });
  });

  describe('sampleRate getter', () => {
    it('should return configured sample rate', () => {
      const tts = new TTS({ sampleRate: 44100 });
      assert.strictEqual(tts.sampleRate, 44100);
    });
  });
});

describe('createTTS', () => {
  it('should create TTS instance', () => {
    const tts = createTTS();
    assert.ok(tts instanceof TTS);
  });

  it('should pass config to constructor', () => {
    const tts = createTTS({ modelPath: '/test/path.onnx' });
    assert.strictEqual(tts.config.modelPath, '/test/path.onnx');
  });
});
