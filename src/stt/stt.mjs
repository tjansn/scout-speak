/**
 * STT - Speech-to-Text module using whisper.cpp
 *
 * Per specs/stt_whisper.md:
 * - Uses whisper.cpp CLI for local transcription
 * - Writes audio to temp WAV file, runs inference, parses output
 * - Supports tiny.en, base.en, small.en models
 *
 * Target performance (FR-2):
 * - Transcription within 2 seconds for short utterance (<5s speech)
 */

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

/**
 * @typedef {Object} STTConfig
 * @property {string} whisperPath - Path to whisper.cpp main executable
 * @property {string} modelPath - Path to GGML model file
 * @property {number} [threads=4] - Number of threads for inference
 * @property {number} [sampleRate=16000] - Audio sample rate (must be 16000)
 * @property {number} [timeoutMs=30000] - Maximum inference time (ms)
 */

/**
 * @typedef {Object} TranscriptionResult
 * @property {string} text - Transcribed text (empty if error/garbage)
 * @property {string|null} error - Error code if transcription failed
 * @property {number} durationMs - Inference duration in milliseconds
 */

/**
 * Default STT configuration
 */
export const DEFAULT_STT_CONFIG = Object.freeze({
  threads: 4,
  sampleRate: 16000,
  timeoutMs: 30000
});

/**
 * Common whisper.cpp output artifacts to filter
 */
const GARBAGE_PATTERNS = [
  /^\[BLANK_AUDIO\]$/i,
  /^\(silence\)$/i,
  /^\[inaudible\]$/i,
  /^[\s.,!?]*$/,  // Only whitespace/punctuation
  /^\[music\]$/i,
  /^\[applause\]$/i
];

/**
 * STT - Speech-to-Text transcription using whisper.cpp
 */
export class STT {
  /**
   * Create a new STT instance
   * @param {STTConfig} config - Configuration with whisperPath and modelPath required
   */
  constructor(config) {
    if (!config.whisperPath) {
      throw new Error('whisperPath is required');
    }
    if (!config.modelPath) {
      throw new Error('modelPath is required');
    }

    /** @type {STTConfig} */
    this.config = { ...DEFAULT_STT_CONFIG, ...config };

    /** @type {boolean} */
    this._disposed = false;

    /** @type {number} */
    this._transcriptionCount = 0;

    /** @type {number} */
    this._totalInferenceTimeMs = 0;
  }

  /**
   * Check if whisper.cpp executable exists
   * @returns {boolean}
   */
  isWhisperAvailable() {
    return existsSync(this.config.whisperPath);
  }

  /**
   * Check if model file exists
   * @returns {boolean}
   */
  isModelAvailable() {
    return existsSync(this.config.modelPath);
  }

  /**
   * Verify STT is ready to use
   * @returns {{ready: boolean, errors: string[]}}
   */
  verify() {
    const errors = [];

    if (!this.isWhisperAvailable()) {
      errors.push(`whisper.cpp not found at: ${this.config.whisperPath}`);
    }

    if (!this.isModelAvailable()) {
      errors.push(`Model not found at: ${this.config.modelPath}`);
    }

    return {
      ready: errors.length === 0,
      errors
    };
  }

  /**
   * Transcribe audio to text
   *
   * @param {Int16Array|Buffer} audio - PCM audio samples (16kHz, mono, s16le)
   * @returns {Promise<TranscriptionResult>} Transcription result
   */
  async transcribe(audio) {
    if (this._disposed) {
      return { text: '', error: 'STT_DISPOSED', durationMs: 0 };
    }

    // Handle empty input
    if (!audio || audio.length === 0) {
      return { text: '', error: 'EMPTY_AUDIO', durationMs: 0 };
    }

    // Convert Buffer to Int16Array if needed
    let int16Audio;
    if (Buffer.isBuffer(audio)) {
      int16Audio = new Int16Array(
        audio.buffer,
        audio.byteOffset,
        audio.length / 2
      );
    } else if (audio instanceof Int16Array) {
      int16Audio = audio;
    } else {
      return { text: '', error: 'INVALID_AUDIO_FORMAT', durationMs: 0 };
    }

    const startTime = Date.now();
    const wavPath = this._createTempPath();

    try {
      // Write audio to temp WAV file
      const wavBuffer = this._pcmToWav(int16Audio);
      writeFileSync(wavPath, wavBuffer);

      // Run whisper.cpp inference
      const rawText = await this._runInference(wavPath);

      // Parse and clean output
      const text = this._parseOutput(rawText);

      // Check for garbage output
      if (this._isGarbageOutput(text)) {
        return {
          text: '',
          error: 'EMPTY_TRANSCRIPT',
          durationMs: Date.now() - startTime
        };
      }

      const durationMs = Date.now() - startTime;
      this._transcriptionCount++;
      this._totalInferenceTimeMs += durationMs;

      return { text, error: null, durationMs };

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startTime;

      // Map error to specific error code
      let errorCode = 'STT_ERROR';
      if (message.includes('failed to open') || message.includes('not found')) {
        errorCode = 'MODEL_NOT_FOUND';
      } else if (message.includes('invalid WAV') || message.includes('invalid format')) {
        errorCode = 'INVALID_AUDIO';
      } else if (message.includes('timeout') || message.includes('TIMEOUT')) {
        errorCode = 'TIMEOUT';
      }

      return { text: '', error: errorCode, durationMs };

    } finally {
      this._cleanup(wavPath);
    }
  }

  /**
   * Create temporary WAV file path
   * @returns {string}
   * @private
   */
  _createTempPath() {
    return join(tmpdir(), `scout-stt-${randomUUID()}.wav`);
  }

  /**
   * Convert PCM Int16 samples to WAV file buffer
   *
   * @param {Int16Array} pcmData - 16-bit signed PCM samples
   * @returns {Buffer} WAV file buffer
   * @private
   */
  _pcmToWav(pcmData) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const sampleRate = this.config.sampleRate ?? DEFAULT_STT_CONFIG.sampleRate;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.length * 2; // 16-bit = 2 bytes per sample

    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt subchunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);           // Subchunk size
    buffer.writeUInt16LE(1, 20);            // Audio format (PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data subchunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Copy PCM data
    for (let i = 0; i < pcmData.length; i++) {
      buffer.writeInt16LE(pcmData[i], 44 + i * 2);
    }

    return buffer;
  }

  /**
   * Run whisper.cpp inference
   *
   * @param {string} wavPath - Path to WAV file
   * @returns {Promise<string>} Raw transcription output
   * @private
   */
  _runInference(wavPath) {
    return new Promise((resolve, reject) => {
      /** @type {Buffer[]} */
      const stdout = [];
      /** @type {Buffer[]} */
      const stderr = [];

      const args = [
        '-m', this.config.modelPath,
        '-f', wavPath,
        '-nt',              // No timestamps
        '-np',              // No progress
        '-t', String(this.config.threads),
        '--no-fallback'     // Disable temperature fallback
      ];

      const proc = spawn(this.config.whisperPath, args);

      // Set timeout
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('TIMEOUT: Inference exceeded time limit'));
      }, this.config.timeoutMs);

      proc.stdout.on('data', (chunk) => {
        stdout.push(chunk);
      });

      proc.stderr.on('data', (chunk) => {
        stderr.push(chunk);
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);

        if (code === 0) {
          resolve(Buffer.concat(stdout).toString('utf-8'));
        } else {
          const errorMsg = Buffer.concat(stderr).toString('utf-8');
          reject(new Error(`whisper.cpp error (exit ${code}): ${errorMsg}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start whisper.cpp: ${err.message}`));
      });
    });
  }

  /**
   * Parse and clean whisper.cpp output
   *
   * @param {string} rawText - Raw output from whisper.cpp
   * @returns {string} Cleaned text
   * @private
   */
  _parseOutput(rawText) {
    let text = rawText.trim();

    // Remove common artifacts
    text = text.replace(/\[BLANK_AUDIO\]/gi, '');
    text = text.replace(/\(silence\)/gi, '');
    text = text.replace(/\[inaudible\]/gi, '');
    text = text.replace(/\[music\]/gi, '');
    text = text.replace(/\[applause\]/gi, '');

    // Remove timestamp markers if any slipped through
    text = text.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]/g, '');

    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  /**
   * Check if output is garbage (empty/noise)
   *
   * @param {string} text - Parsed text
   * @returns {boolean} True if garbage
   * @private
   */
  _isGarbageOutput(text) {
    if (!text || text.length === 0) return true;

    // Very short output is likely noise
    if (text.length < 2) return true;

    // Check against known garbage patterns
    for (const pattern of GARBAGE_PATTERNS) {
      if (pattern.test(text)) return true;
    }

    return false;
  }

  /**
   * Clean up temporary file
   *
   * @param {string} filePath - File to delete
   * @private
   */
  _cleanup(filePath) {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // Best-effort cleanup, don't throw
    }
  }

  /**
   * Get transcription statistics
   * @returns {{transcriptionCount: number, avgInferenceTimeMs: number, totalInferenceTimeMs: number}}
   */
  getStats() {
    return {
      transcriptionCount: this._transcriptionCount,
      avgInferenceTimeMs: this._transcriptionCount > 0
        ? this._totalInferenceTimeMs / this._transcriptionCount
        : 0,
      totalInferenceTimeMs: this._totalInferenceTimeMs
    };
  }

  /**
   * Mark as disposed (prevents further transcriptions)
   */
  dispose() {
    this._disposed = true;
  }
}

/**
 * Check if a string is garbage/noise output
 *
 * @param {string} text - Text to check
 * @returns {boolean} True if garbage
 */
export function isGarbageTranscript(text) {
  if (!text || text.length === 0) return true;
  if (text.length < 2) return true;

  for (const pattern of GARBAGE_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  return false;
}

/**
 * Create an STT instance
 *
 * @param {STTConfig} config - Configuration with whisperPath and modelPath required
 * @returns {STT}
 */
export function createSTT(config) {
  return new STT(config);
}
