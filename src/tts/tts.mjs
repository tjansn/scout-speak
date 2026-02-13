/**
 * TTS Module - Text-to-Speech via Piper TTS
 *
 * Per T023 and specs/tts_piper.md:
 * - Command: echo "text" | piper --model voice.onnx --output_raw
 * - Output: Raw PCM (s16le, mono, sample rate from model config)
 * - Supports streaming output for reduced latency
 * - Can be interrupted for barge-in functionality
 *
 * Performance considerations:
 * - Piper has significant cold start latency (4-14 seconds first inference)
 * - Sentence-level chunking enables streaming playback
 * - FR-4: Audio begins within 500ms of synthesis start (after warm-up)
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * @typedef {Object} TTSConfig
 * @property {string} modelPath - Path to Piper .onnx voice model
 * @property {number} sampleRate - Output sample rate (from model config)
 */

/**
 * Default configuration
 */
export const DEFAULT_TTS_CONFIG = Object.freeze({
  modelPath: '',
  sampleRate: 22050
});

/**
 * TTS - Text-to-Speech synthesis via Piper
 */
export class TTS extends EventEmitter {
  /**
   * Create TTS instance
   * @param {Partial<TTSConfig>} [config={}] - Configuration
   */
  constructor(config = {}) {
    super();

    /** @type {TTSConfig} */
    this.config = { ...DEFAULT_TTS_CONFIG, ...config };

    /** @type {import('child_process').ChildProcess|null} */
    this._process = null;

    /** @type {boolean} */
    this._synthesizing = false;

    /** @type {boolean} */
    this._cancelled = false;
  }

  /**
   * Check if synthesis is in progress
   * @returns {boolean}
   */
  get synthesizing() {
    return this._synthesizing;
  }

  /**
   * Get the configured sample rate
   * @returns {number}
   */
  get sampleRate() {
    return this.config.sampleRate;
  }

  /**
   * Synthesize text to audio (streaming)
   *
   * Returns an async iterable that yields audio chunks as they become available.
   * This enables streaming playback where audio starts before the full text is synthesized.
   *
   * @param {string} text - Text to synthesize
   * @yields {Buffer} Audio chunks (raw PCM, s16le, mono)
   * @throws {Error} If model path not configured or synthesis fails
   */
  async *synthesize(text) {
    if (!this.config.modelPath) {
      throw new Error('TTS model path not configured');
    }

    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }

    if (this._synthesizing) {
      throw new Error('Synthesis already in progress');
    }

    this._synthesizing = true;
    this._cancelled = false;
    this.emit('synthesis_started', { text });

    try {
      const args = [
        '--model', this.config.modelPath,
        '--output_raw'
      ];

      this._process = spawn('piper', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Set up chunk buffer for yielding
      /** @type {Buffer[]} */
      const chunks = [];
      let error = /** @type {Error|null} */ (null);
      let processExited = false;
      let resolveChunk = /** @type {((value: boolean) => void)|null} */ (null);

      // Handle stdout (audio data)
      this._process.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
        chunks.push(chunk);
        if (resolveChunk) {
          resolveChunk(true);
          resolveChunk = null;
        }
      });

      // Handle stderr (errors/warnings)
      this._process.stderr?.on('data', (/** @type {Buffer} */ data) => {
        const message = data.toString().trim();
        if (message) {
          // Piper outputs progress/info to stderr - only emit as warning
          this.emit('warning', message);
        }
      });

      // Handle process exit
      this._process.on('exit', (code, _signal) => {
        processExited = true;
        if (code !== 0 && code !== null && !this._cancelled) {
          error = new Error(`Piper exited with code ${code}`);
        }
        if (resolveChunk) {
          resolveChunk(false);
          resolveChunk = null;
        }
      });

      // Handle process error
      this._process.on('error', (err) => {
        processExited = true;
        error = err;
        if (resolveChunk) {
          resolveChunk(false);
          resolveChunk = null;
        }
      });

      // Send text to piper stdin
      this._process.stdin?.write(text);
      this._process.stdin?.end();

      // Yield chunks as they become available
      while (!processExited || chunks.length > 0) {
        if (this._cancelled) {
          break;
        }

        if (chunks.length > 0) {
          yield chunks.shift();
        } else if (!processExited) {
          // Wait for more data or process exit
          await new Promise((resolve) => {
            resolveChunk = resolve;
          });
        }
      }

      if (error && !this._cancelled) {
        throw error;
      }

      this.emit('synthesis_complete', { text });

    } finally {
      this._synthesizing = false;
      this._process = null;
    }
  }

  /**
   * Synthesize text to a single buffer (batch mode)
   *
   * Waits for complete synthesis and returns all audio at once.
   * Use synthesize() for streaming.
   *
   * @param {string} text - Text to synthesize
   * @returns {Promise<Buffer>} Complete audio buffer
   */
  async synthesizeToBuffer(text) {
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of this.synthesize(text)) {
      if (chunk) {
        chunks.push(chunk);
      }
    }
    return Buffer.concat(chunks);
  }

  /**
   * Stop synthesis immediately
   *
   * Used for barge-in - cancels any pending synthesis.
   */
  stop() {
    if (!this._synthesizing || !this._process) {
      return;
    }

    this._cancelled = true;
    this._process.kill('SIGTERM');
    this._synthesizing = false;
    this.emit('synthesis_cancelled');
  }

  /**
   * Calculate duration of audio buffer in milliseconds
   * @param {Buffer} buffer - Audio buffer
   * @returns {number} Duration in milliseconds
   */
  calculateDurationMs(buffer) {
    const samples = buffer.length / 2; // 16-bit = 2 bytes per sample
    return (samples / this.config.sampleRate) * 1000;
  }
}

/**
 * Create a TTS instance
 * @param {Partial<TTSConfig>} [config={}] - Configuration
 * @returns {TTS}
 */
export function createTTS(config = {}) {
  return new TTS(config);
}
