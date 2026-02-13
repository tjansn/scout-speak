/**
 * SileroVAD - Silero VAD ONNX model loading and inference
 *
 * Per specs/vad_silero.md:
 * - Model: Silero VAD v4 ONNX (~2MB)
 * - Input: 30ms frames (480 samples at 16kHz)
 * - Output: Speech probability (0.0-1.0)
 * - Inference: ~2ms per frame
 *
 * The model uses LSTM states (h, c) that must persist between frames
 * for accurate speech detection continuity.
 */

import * as ort from 'onnxruntime-node';

/**
 * @typedef {Object} SileroVADConfig
 * @property {number} [sampleRate=16000] - Audio sample rate (must be 16000)
 * @property {number} [frameSize=480] - Samples per frame (30ms at 16kHz)
 */

/**
 * Default Silero VAD configuration
 */
export const DEFAULT_SILERO_CONFIG = Object.freeze({
  sampleRate: 16000,
  frameSize: 480 // 30ms at 16kHz
});

/**
 * SileroVAD - ONNX-based Voice Activity Detection
 *
 * Uses the Silero VAD v4 model for neural network-based speech detection.
 * Provides ~2ms inference per 30ms frame with high accuracy.
 */
export class SileroVAD {
  /**
   * Create a new SileroVAD instance
   * @param {Partial<SileroVADConfig>} [config={}] - Configuration options
   */
  constructor(config = {}) {
    /** @type {SileroVADConfig} */
    this.config = { ...DEFAULT_SILERO_CONFIG, ...config };

    if (this.config.sampleRate !== 16000) {
      throw new Error('SileroVAD requires 16kHz sample rate');
    }

    /** @type {ort.InferenceSession|null} */
    this._session = null;

    /** @type {ort.Tensor|null} */
    this._h = null;

    /** @type {ort.Tensor|null} */
    this._c = null;

    /** @type {boolean} */
    this._loaded = false;

    /** @type {string|null} */
    this._modelPath = null;
  }

  /**
   * Check if the model is loaded
   * @returns {boolean}
   */
  get isLoaded() {
    return this._loaded;
  }

  /**
   * Get the model path (if loaded)
   * @returns {string|null}
   */
  get modelPath() {
    return this._modelPath;
  }

  /**
   * Load the Silero VAD ONNX model
   *
   * @param {string} modelPath - Path to silero_vad.onnx file
   * @throws {Error} If model cannot be loaded
   */
  async load(modelPath) {
    if (this._loaded) {
      throw new Error('Model already loaded. Call reset() or create new instance.');
    }

    try {
      this._session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all'
      });

      this._modelPath = modelPath;
      this._initializeState();
      this._loaded = true;

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('ENOENT') || message.includes('no such file') ||
          message.includes("doesn't exist") || message.includes('does not exist')) {
        throw new Error(`VAD model not found: ${modelPath}`);
      }
      if (message.includes('protobuf') || message.includes('invalid')) {
        throw new Error(`Invalid VAD model format: ${modelPath}`);
      }

      throw new Error(`Failed to load VAD model: ${message}`);
    }
  }

  /**
   * Initialize LSTM hidden and cell states
   * @private
   */
  _initializeState() {
    // LSTM states: shape [2, 1, 64] (2 layers, batch size 1, 64 hidden units)
    const stateSize = 2 * 1 * 64;
    this._h = new ort.Tensor('float32', new Float32Array(stateSize), [2, 1, 64]);
    this._c = new ort.Tensor('float32', new Float32Array(stateSize), [2, 1, 64]);
  }

  /**
   * Reset LSTM states (call after speech_ended or to start fresh)
   */
  resetState() {
    if (!this._loaded) {
      return;
    }
    this._initializeState();
  }

  /**
   * Run inference on an audio frame
   *
   * @param {Buffer|Int16Array} audioFrame - Audio frame (480 samples, 16-bit PCM)
   * @returns {Promise<number>} Speech probability (0.0 to 1.0)
   * @throws {Error} If model not loaded or inference fails
   */
  async infer(audioFrame) {
    if (!this._loaded || !this._session) {
      throw new Error('VAD model not loaded. Call load() first.');
    }

    // Convert to Int16Array if Buffer
    let int16Samples;
    if (Buffer.isBuffer(audioFrame)) {
      int16Samples = new Int16Array(
        audioFrame.buffer,
        audioFrame.byteOffset,
        audioFrame.length / 2
      );
    } else if (audioFrame instanceof Int16Array) {
      int16Samples = audioFrame;
    } else {
      throw new Error('audioFrame must be Buffer or Int16Array');
    }

    // Validate frame size
    if (int16Samples.length !== this.config.frameSize) {
      throw new Error(
        `Invalid frame size: expected ${this.config.frameSize} samples, got ${int16Samples.length}`
      );
    }

    // Convert Int16 PCM to Float32 normalized [-1.0, 1.0]
    const float32Samples = new Float32Array(int16Samples.length);
    for (let i = 0; i < int16Samples.length; i++) {
      float32Samples[i] = int16Samples[i] / 32768.0;
    }

    // Create input tensor [1, frameSize]
    const inputTensor = new ort.Tensor('float32', float32Samples, [1, this.config.frameSize]);

    // Sample rate tensor [1]
    const sampleRate = this.config.sampleRate ?? 16000;
    const srTensor = new ort.Tensor(
      'int64',
      BigInt64Array.from([BigInt(sampleRate)]),
      [1]
    );

    // Ensure LSTM states are initialized
    if (!this._h || !this._c) {
      this._initializeState();
    }

    // Run inference
    const feeds = {
      input: inputTensor,
      sr: srTensor,
      h: /** @type {ort.Tensor} */ (this._h),
      c: /** @type {ort.Tensor} */ (this._c)
    };

    const results = await this._session.run(feeds);

    // Update LSTM states for next frame
    this._h = /** @type {ort.Tensor} */ (results.hn);
    this._c = /** @type {ort.Tensor} */ (results.cn);

    // Extract speech probability
    const probability = /** @type {number} */ (results.output.data[0]);

    return probability;
  }

  /**
   * Process multiple audio frames in sequence
   *
   * @param {Array<Buffer|Int16Array>} frames - Array of audio frames
   * @returns {Promise<number[]>} Array of speech probabilities
   */
  async inferBatch(frames) {
    const probabilities = [];

    for (const frame of frames) {
      const probability = await this.infer(frame);
      probabilities.push(probability);
    }

    return probabilities;
  }

  /**
   * Release model resources
   */
  async dispose() {
    if (this._session) {
      await this._session.release();
      this._session = null;
    }
    this._h = null;
    this._c = null;
    this._loaded = false;
    this._modelPath = null;
  }
}

/**
 * Convert raw PCM bytes to Int16Array
 *
 * @param {Buffer} buffer - Raw PCM buffer (s16le format)
 * @returns {Int16Array} Int16 samples
 */
export function pcmBufferToInt16(buffer) {
  return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
}

/**
 * Convert Int16 PCM samples to normalized Float32
 *
 * @param {Int16Array} int16Samples - 16-bit signed PCM samples
 * @returns {Float32Array} Normalized samples (-1.0 to 1.0)
 */
export function int16ToFloat32(int16Samples) {
  const float32 = new Float32Array(int16Samples.length);
  for (let i = 0; i < int16Samples.length; i++) {
    float32[i] = int16Samples[i] / 32768.0;
  }
  return float32;
}

/**
 * Create a SileroVAD instance
 *
 * @param {Partial<SileroVADConfig>} [config={}] - Configuration options
 * @returns {SileroVAD}
 */
export function createSileroVAD(config = {}) {
  return new SileroVAD(config);
}
