// @ts-nocheck - Tests intentionally use invalid inputs and mock ONNX types
/**
 * Unit tests for SileroVAD - ONNX model loading and inference
 *
 * Tests cover:
 * - Model loading success and failure
 * - Inference with valid/invalid inputs
 * - LSTM state management
 * - Frame size validation
 * - PCM conversion utilities
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  SileroVAD,
  createSileroVAD,
  pcmBufferToInt16,
  int16ToFloat32,
  DEFAULT_SILERO_CONFIG
} from '../../../src/vad/silero-vad.mjs';
import {
  createMockAudioBuffer,
  assertThrows,
  assertThrowsAsync
} from '../../test-utils.mjs';

describe('SileroVAD', () => {
  describe('constructor', () => {
    it('should create instance with default config', () => {
      const vad = new SileroVAD();

      assert.strictEqual(vad.config.sampleRate, 16000);
      assert.strictEqual(vad.config.frameSize, 480);
      assert.strictEqual(vad.isLoaded, false);
      assert.strictEqual(vad.modelPath, null);
    });

    it('should allow custom frame size', () => {
      const vad = new SileroVAD({ frameSize: 960 });

      assert.strictEqual(vad.config.frameSize, 960);
    });

    it('should reject non-16kHz sample rate', () => {
      assertThrows(() => {
        new SileroVAD({ sampleRate: 22050 });
      }, 'SileroVAD requires 16kHz sample rate');
    });
  });

  describe('load', () => {
    it('should throw error when model file not found', async () => {
      const vad = new SileroVAD();

      await assertThrowsAsync(
        () => vad.load('/nonexistent/path/silero_vad.onnx'),
        /VAD model not found/
      );
    });

    it('should throw error when loading invalid model file', async () => {
      const vad = new SileroVAD();

      // Try to load a non-ONNX file
      await assertThrowsAsync(
        () => vad.load('/dev/null'),
        /Failed to load VAD model/
      );
    });

    it('should throw error when loading twice without reset', async () => {
      const vad = new SileroVAD();

      // Mock successful first load
      vad._loaded = true;
      vad._modelPath = '/fake/path.onnx';

      await assertThrowsAsync(
        () => vad.load('/another/path.onnx'),
        'Model already loaded. Call reset() or create new instance.'
      );
    });
  });

  describe('infer', () => {
    it('should throw error when model not loaded', async () => {
      const vad = new SileroVAD();

      const frame = createMockAudioBuffer(480);

      await assertThrowsAsync(
        () => vad.infer(frame),
        'VAD model not loaded. Call load() first.'
      );
    });

    it('should throw error for invalid frame size', async () => {
      const vad = new SileroVAD();
      // Mock loaded state
      vad._loaded = true;
      vad._session = {}; // Mock session

      const frame = createMockAudioBuffer(240); // Wrong size

      await assertThrowsAsync(
        () => vad.infer(frame),
        /Invalid frame size: expected 480 samples, got 240/
      );
    });

    it('should throw error for invalid input type', async () => {
      const vad = new SileroVAD();
      // Mock loaded state
      vad._loaded = true;
      vad._session = {}; // Mock session

      await assertThrowsAsync(
        () => vad.infer('invalid input'),
        'audioFrame must be Buffer or Int16Array'
      );
    });

    it('should accept Buffer input', async () => {
      const vad = new SileroVAD();
      // Mock loaded state and session
      vad._loaded = true;

      const mockResult = {
        output: { data: [0.75] },
        hn: { data: new Float32Array(128) },
        cn: { data: new Float32Array(128) }
      };

      vad._session = {
        run: mock.fn(() => Promise.resolve(mockResult))
      };

      // Create mock h and c tensors
      vad._h = { data: new Float32Array(128) };
      vad._c = { data: new Float32Array(128) };

      // Create a Buffer with 480 samples (960 bytes)
      const buffer = Buffer.alloc(960);

      const probability = await vad.infer(buffer);

      assert.strictEqual(probability, 0.75);
    });

    it('should accept Int16Array input', async () => {
      const vad = new SileroVAD();
      // Mock loaded state and session
      vad._loaded = true;

      const mockResult = {
        output: { data: [0.5] },
        hn: { data: new Float32Array(128) },
        cn: { data: new Float32Array(128) }
      };

      vad._session = {
        run: mock.fn(() => Promise.resolve(mockResult))
      };

      vad._h = { data: new Float32Array(128) };
      vad._c = { data: new Float32Array(128) };

      const frame = createMockAudioBuffer(480);

      const probability = await vad.infer(frame);

      assert.strictEqual(probability, 0.5);
    });

    it('should update LSTM states after inference', async () => {
      const vad = new SileroVAD();
      vad._loaded = true;

      const newH = { data: new Float32Array(128).fill(1) };
      const newC = { data: new Float32Array(128).fill(2) };

      const mockResult = {
        output: { data: [0.6] },
        hn: newH,
        cn: newC
      };

      vad._session = {
        run: mock.fn(() => Promise.resolve(mockResult))
      };

      vad._h = { data: new Float32Array(128) };
      vad._c = { data: new Float32Array(128) };

      const frame = createMockAudioBuffer(480);
      await vad.infer(frame);

      // Verify states were updated
      assert.strictEqual(vad._h, newH);
      assert.strictEqual(vad._c, newC);
    });
  });

  describe('inferBatch', () => {
    it('should process multiple frames in sequence', async () => {
      const vad = new SileroVAD();
      vad._loaded = true;

      let callCount = 0;
      const probabilities = [0.3, 0.7, 0.9, 0.4];

      vad._session = {
        run: mock.fn(() => {
          const probability = probabilities[callCount++];
          return Promise.resolve({
            output: { data: [probability] },
            hn: { data: new Float32Array(128) },
            cn: { data: new Float32Array(128) }
          });
        })
      };

      vad._h = { data: new Float32Array(128) };
      vad._c = { data: new Float32Array(128) };

      const frames = [
        createMockAudioBuffer(480),
        createMockAudioBuffer(480),
        createMockAudioBuffer(480),
        createMockAudioBuffer(480)
      ];

      const results = await vad.inferBatch(frames);

      assert.deepStrictEqual(results, probabilities);
    });
  });

  describe('resetState', () => {
    it('should not throw when model not loaded', () => {
      const vad = new SileroVAD();
      vad.resetState(); // Should not throw
    });

    it('should reinitialize LSTM states', async () => {
      const vad = new SileroVAD();
      vad._loaded = true;

      // Set non-zero states
      vad._h = { data: new Float32Array(128).fill(1) };
      vad._c = { data: new Float32Array(128).fill(2) };

      vad.resetState();

      // Check that states were reset
      assert.notStrictEqual(vad._h.data[0], 1);
      assert.notStrictEqual(vad._c.data[0], 2);
    });
  });

  describe('dispose', () => {
    it('should release resources', async () => {
      const vad = new SileroVAD();
      vad._loaded = true;
      vad._modelPath = '/test/path.onnx';
      vad._h = { data: new Float32Array(128) };
      vad._c = { data: new Float32Array(128) };

      let released = false;
      vad._session = {
        release: mock.fn(() => {
          released = true;
          return Promise.resolve();
        })
      };

      await vad.dispose();

      assert.strictEqual(released, true);
      assert.strictEqual(vad.isLoaded, false);
      assert.strictEqual(vad.modelPath, null);
      assert.strictEqual(vad._session, null);
      assert.strictEqual(vad._h, null);
      assert.strictEqual(vad._c, null);
    });

    it('should handle dispose when not loaded', async () => {
      const vad = new SileroVAD();
      await vad.dispose(); // Should not throw
    });
  });
});

describe('pcmBufferToInt16', () => {
  it('should convert Buffer to Int16Array', () => {
    const buffer = Buffer.alloc(8);
    buffer.writeInt16LE(100, 0);
    buffer.writeInt16LE(-100, 2);
    buffer.writeInt16LE(32767, 4);
    buffer.writeInt16LE(-32768, 6);

    const int16 = pcmBufferToInt16(buffer);

    assert.strictEqual(int16.length, 4);
    assert.strictEqual(int16[0], 100);
    assert.strictEqual(int16[1], -100);
    assert.strictEqual(int16[2], 32767);
    assert.strictEqual(int16[3], -32768);
  });
});

describe('int16ToFloat32', () => {
  it('should normalize Int16 samples to [-1.0, 1.0]', () => {
    const int16 = new Int16Array([0, 16384, -16384, 32767, -32768]);

    const float32 = int16ToFloat32(int16);

    assert.strictEqual(float32.length, 5);
    assert.strictEqual(float32[0], 0);
    assert.ok(Math.abs(float32[1] - 0.5) < 0.001);
    assert.ok(Math.abs(float32[2] - (-0.5)) < 0.001);
    assert.ok(Math.abs(float32[3] - 0.99997) < 0.001);
    assert.strictEqual(float32[4], -1);
  });
});

describe('createSileroVAD', () => {
  it('should create a SileroVAD instance', () => {
    const vad = createSileroVAD();

    assert.ok(vad instanceof SileroVAD);
    assert.strictEqual(vad.isLoaded, false);
  });

  it('should accept custom config', () => {
    const vad = createSileroVAD({ frameSize: 256 });

    assert.strictEqual(vad.config.frameSize, 256);
  });
});

describe('DEFAULT_SILERO_CONFIG', () => {
  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_SILERO_CONFIG));
  });

  it('should have correct defaults', () => {
    assert.strictEqual(DEFAULT_SILERO_CONFIG.sampleRate, 16000);
    assert.strictEqual(DEFAULT_SILERO_CONFIG.frameSize, 480);
  });
});
