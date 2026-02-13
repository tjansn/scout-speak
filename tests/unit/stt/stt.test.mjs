// @ts-nocheck - Tests intentionally use invalid inputs and test private methods
/**
 * Unit tests for STT - Speech-to-Text module using whisper.cpp
 *
 * Tests cover:
 * - Configuration validation
 * - WAV file generation
 * - Output parsing and cleanup
 * - Garbage detection
 * - Error handling
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STT,
  createSTT,
  isGarbageTranscript,
  DEFAULT_STT_CONFIG
} from '../../../src/stt/stt.mjs';
import {
  createMockSpeechAudio,
  assertThrows
} from '../../test-utils.mjs';

describe('STT', () => {
  describe('constructor', () => {
    it('should require whisperPath', () => {
      assertThrows(() => {
        new STT({ modelPath: '/test/model.bin' });
      }, 'whisperPath is required');
    });

    it('should require modelPath', () => {
      assertThrows(() => {
        new STT({ whisperPath: '/test/whisper' });
      }, 'modelPath is required');
    });

    it('should create instance with required config', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      assert.strictEqual(stt.config.whisperPath, '/test/whisper');
      assert.strictEqual(stt.config.modelPath, '/test/model.bin');
    });

    it('should use default config values', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      assert.strictEqual(stt.config.threads, DEFAULT_STT_CONFIG.threads);
      assert.strictEqual(stt.config.sampleRate, DEFAULT_STT_CONFIG.sampleRate);
      assert.strictEqual(stt.config.timeoutMs, DEFAULT_STT_CONFIG.timeoutMs);
    });

    it('should allow custom config values', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin',
        threads: 8,
        timeoutMs: 60000
      });

      assert.strictEqual(stt.config.threads, 8);
      assert.strictEqual(stt.config.timeoutMs, 60000);
    });
  });

  describe('verify', () => {
    it('should report errors for missing files', () => {
      const stt = new STT({
        whisperPath: '/nonexistent/whisper',
        modelPath: '/nonexistent/model.bin'
      });

      const result = stt.verify();

      assert.strictEqual(result.ready, false);
      assert.strictEqual(result.errors.length, 2);
      assert.ok(result.errors[0].includes('whisper.cpp not found'));
      assert.ok(result.errors[1].includes('Model not found'));
    });
  });

  describe('isWhisperAvailable', () => {
    it('should return false for nonexistent path', () => {
      const stt = new STT({
        whisperPath: '/nonexistent/whisper',
        modelPath: '/test/model.bin'
      });

      assert.strictEqual(stt.isWhisperAvailable(), false);
    });

    it('should return true for existing file', () => {
      // Use a file that definitely exists
      const stt = new STT({
        whisperPath: '/bin/sh',
        modelPath: '/test/model.bin'
      });

      assert.strictEqual(stt.isWhisperAvailable(), true);
    });
  });

  describe('transcribe', () => {
    it('should return error for empty audio', async () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const result = await stt.transcribe(new Int16Array(0));

      assert.strictEqual(result.text, '');
      assert.strictEqual(result.error, 'EMPTY_AUDIO');
    });

    it('should return error for null audio', async () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const result = await stt.transcribe(null);

      assert.strictEqual(result.text, '');
      assert.strictEqual(result.error, 'EMPTY_AUDIO');
    });

    it('should return error for invalid audio format', async () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const result = await stt.transcribe('invalid');

      assert.strictEqual(result.text, '');
      assert.strictEqual(result.error, 'INVALID_AUDIO_FORMAT');
    });

    it('should return error after dispose', async () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      stt.dispose();

      const audio = createMockSpeechAudio(1000); // 1 second
      const result = await stt.transcribe(audio);

      assert.strictEqual(result.text, '');
      assert.strictEqual(result.error, 'STT_DISPOSED');
    });

    it('should accept Buffer input', async () => {
      const stt = new STT({
        whisperPath: '/nonexistent/whisper',
        modelPath: '/nonexistent/model.bin'
      });

      // Create a Buffer from Int16Array
      const int16 = createMockSpeechAudio(100); // 100ms
      const buffer = Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength);

      const result = await stt.transcribe(buffer);

      // Will fail because whisper doesn't exist, but should not reject on format
      assert.ok(['STT_ERROR', 'MODEL_NOT_FOUND'].includes(result.error));
    });
  });

  describe('_pcmToWav', () => {
    it('should generate valid WAV header', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const pcm = new Int16Array([0, 100, -100, 32767, -32768]);
      const wav = stt._pcmToWav(pcm);

      // Check RIFF header
      assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
      assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE');
      assert.strictEqual(wav.toString('ascii', 12, 16), 'fmt ');
      assert.strictEqual(wav.toString('ascii', 36, 40), 'data');

      // Check format values
      assert.strictEqual(wav.readUInt16LE(20), 1); // PCM format
      assert.strictEqual(wav.readUInt16LE(22), 1); // Mono
      assert.strictEqual(wav.readUInt32LE(24), 16000); // Sample rate
      assert.strictEqual(wav.readUInt16LE(34), 16); // Bits per sample
    });

    it('should include correct audio data', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const pcm = new Int16Array([100, -100, 32767, -32768]);
      const wav = stt._pcmToWav(pcm);

      // Check data values after header (offset 44)
      assert.strictEqual(wav.readInt16LE(44), 100);
      assert.strictEqual(wav.readInt16LE(46), -100);
      assert.strictEqual(wav.readInt16LE(48), 32767);
      assert.strictEqual(wav.readInt16LE(50), -32768);
    });

    it('should set correct file size', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const pcm = new Int16Array(100);
      const wav = stt._pcmToWav(pcm);

      // RIFF chunk size = file size - 8
      const riffSize = wav.readUInt32LE(4);
      assert.strictEqual(riffSize, wav.length - 8);

      // Data chunk size = data bytes
      const dataSize = wav.readUInt32LE(40);
      assert.strictEqual(dataSize, 100 * 2); // 100 samples * 2 bytes
    });
  });

  describe('_parseOutput', () => {
    it('should trim whitespace', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const result = stt._parseOutput('  Hello world  \n');

      assert.strictEqual(result, 'Hello world');
    });

    it('should remove [BLANK_AUDIO]', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const result = stt._parseOutput('[BLANK_AUDIO] Hello [BLANK_AUDIO]');

      assert.strictEqual(result, 'Hello');
    });

    it('should remove (silence)', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const result = stt._parseOutput('Hello (silence) world');

      assert.strictEqual(result, 'Hello world');
    });

    it('should remove timestamp markers', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const result = stt._parseOutput('[00:00:00.000 --> 00:00:02.500] Hello world');

      assert.strictEqual(result, 'Hello world');
    });

    it('should normalize multiple spaces', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const result = stt._parseOutput('Hello    world   test');

      assert.strictEqual(result, 'Hello world test');
    });
  });

  describe('_isGarbageOutput', () => {
    it('should detect empty string', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      assert.strictEqual(stt._isGarbageOutput(''), true);
    });

    it('should detect very short output', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      assert.strictEqual(stt._isGarbageOutput('a'), true);
    });

    it('should detect [BLANK_AUDIO]', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      assert.strictEqual(stt._isGarbageOutput('[BLANK_AUDIO]'), true);
    });

    it('should detect punctuation only', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      assert.strictEqual(stt._isGarbageOutput('...'), true);
      assert.strictEqual(stt._isGarbageOutput('!?'), true);
    });

    it('should accept valid text', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      assert.strictEqual(stt._isGarbageOutput('Hello world'), false);
      assert.strictEqual(stt._isGarbageOutput('Hi'), false);
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      const stats = stt.getStats();

      assert.strictEqual(stats.transcriptionCount, 0);
      assert.strictEqual(stats.avgInferenceTimeMs, 0);
      assert.strictEqual(stats.totalInferenceTimeMs, 0);
    });
  });

  describe('dispose', () => {
    it('should mark as disposed', () => {
      const stt = new STT({
        whisperPath: '/test/whisper',
        modelPath: '/test/model.bin'
      });

      stt.dispose();

      assert.strictEqual(stt._disposed, true);
    });
  });
});

describe('isGarbageTranscript', () => {
  it('should detect empty string', () => {
    assert.strictEqual(isGarbageTranscript(''), true);
    assert.strictEqual(isGarbageTranscript(null), true);
    assert.strictEqual(isGarbageTranscript(undefined), true);
  });

  it('should detect short output', () => {
    assert.strictEqual(isGarbageTranscript('a'), true);
  });

  it('should detect known artifacts', () => {
    assert.strictEqual(isGarbageTranscript('[BLANK_AUDIO]'), true);
    assert.strictEqual(isGarbageTranscript('(silence)'), true);
    assert.strictEqual(isGarbageTranscript('[inaudible]'), true);
    assert.strictEqual(isGarbageTranscript('[music]'), true);
  });

  it('should accept valid text', () => {
    assert.strictEqual(isGarbageTranscript('Hello'), false);
    assert.strictEqual(isGarbageTranscript('Hello world'), false);
  });
});

describe('createSTT', () => {
  it('should create STT instance', () => {
    const stt = createSTT({
      whisperPath: '/test/whisper',
      modelPath: '/test/model.bin'
    });

    assert.ok(stt instanceof STT);
  });

  it('should pass config to constructor', () => {
    const stt = createSTT({
      whisperPath: '/test/whisper',
      modelPath: '/test/model.bin',
      threads: 8
    });

    assert.strictEqual(stt.config.threads, 8);
  });
});

describe('DEFAULT_STT_CONFIG', () => {
  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_STT_CONFIG));
  });

  it('should have expected defaults', () => {
    assert.strictEqual(DEFAULT_STT_CONFIG.threads, 4);
    assert.strictEqual(DEFAULT_STT_CONFIG.sampleRate, 16000);
    assert.strictEqual(DEFAULT_STT_CONFIG.timeoutMs, 30000);
  });
});
