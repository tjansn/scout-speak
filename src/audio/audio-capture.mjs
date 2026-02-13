/**
 * AudioCapture - Audio capture via PulseAudio parecord
 *
 * Per T010 and audio_io.md:
 * - Command: parecord --raw --format=s16le --rate=16000 --channels=1
 * - Output: PCM chunks (16kHz, mono, 16-bit signed little-endian)
 * - Interface: start(), stop(), onChunk(callback)
 *
 * FR-1: Captures voice ready for transcription
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * @typedef {Object} AudioCaptureConfig
 * @property {number} [sampleRate=16000] - Sample rate in Hz
 * @property {number} [channels=1] - Number of channels (mono)
 * @property {string} [format='s16le'] - PCM format
 * @property {number} [chunkSize=480] - Samples per chunk (30ms at 16kHz)
 */

/**
 * Default configuration
 */
export const DEFAULT_CAPTURE_CONFIG = Object.freeze({
  sampleRate: 16000,
  channels: 1,
  format: 's16le',
  chunkSize: 480 // 30ms frame at 16kHz
});

/**
 * AudioCapture - Captures audio from microphone via PulseAudio
 */
export class AudioCapture extends EventEmitter {
  /**
   * Create AudioCapture instance
   * @param {Partial<AudioCaptureConfig>} [config={}] - Configuration
   */
  constructor(config = {}) {
    super();

    /** @type {AudioCaptureConfig} */
    this.config = { ...DEFAULT_CAPTURE_CONFIG, ...config };

    /** @type {import('child_process').ChildProcess|null} */
    this._process = null;

    /** @type {boolean} */
    this._running = false;

    /** @type {Buffer} */
    this._pendingBuffer = Buffer.alloc(0);

    /** @type {number} */
    this._bytesPerSample = 2; // 16-bit = 2 bytes

    /** @type {number} */
    this._chunkSizeBytes = (this.config.chunkSize || 480) * this._bytesPerSample;
  }

  /**
   * Check if capture is running
   * @returns {boolean}
   */
  get running() {
    return this._running;
  }

  /**
   * Start audio capture
   * @throws {Error} If already running or parecord fails
   */
  start() {
    if (this._running) {
      throw new Error('AudioCapture is already running');
    }

    const args = [
      '--raw',
      `--format=${this.config.format}`,
      `--rate=${this.config.sampleRate}`,
      `--channels=${this.config.channels}`
    ];

    this._process = spawn('parecord', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this._running = true;
    this._pendingBuffer = Buffer.alloc(0);

    // Handle stdout data (audio)
    this._process.stdout?.on('data', (/** @type {Buffer} */ data) => {
      this._handleData(data);
    });

    // Handle stderr (errors/warnings)
    this._process.stderr?.on('data', (/** @type {Buffer} */ data) => {
      const message = data.toString().trim();
      if (message) {
        this.emit('warning', message);
      }
    });

    // Handle process exit
    this._process.on('exit', (code, signal) => {
      this._running = false;
      this._process = null;

      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`parecord exited with code ${code}`));
      } else if (signal) {
        this.emit('stopped', signal);
      } else {
        this.emit('stopped', 'exit');
      }
    });

    // Handle process error (e.g., command not found)
    this._process.on('error', (err) => {
      this._running = false;
      this._process = null;
      this.emit('error', err);
    });

    this.emit('started');
  }

  /**
   * Handle incoming audio data
   * @param {Buffer} data - Raw audio data
   * @private
   */
  _handleData(data) {
    // Append to pending buffer
    this._pendingBuffer = Buffer.concat([this._pendingBuffer, data]);

    // Emit complete chunks
    while (this._pendingBuffer.length >= this._chunkSizeBytes) {
      const chunkBuffer = this._pendingBuffer.subarray(0, this._chunkSizeBytes);
      this._pendingBuffer = this._pendingBuffer.subarray(this._chunkSizeBytes);

      // Convert Buffer to Int16Array
      const chunk = new Int16Array(
        chunkBuffer.buffer,
        chunkBuffer.byteOffset,
        this.config.chunkSize
      );

      this.emit('chunk', chunk);
    }
  }

  /**
   * Stop audio capture
   */
  stop() {
    if (!this._running || !this._process) {
      return;
    }

    this._process.kill('SIGTERM');
    this._running = false;
    this._pendingBuffer = Buffer.alloc(0);
  }

  /**
   * Register chunk callback
   * @param {function(Int16Array): void} callback - Called for each audio chunk
   */
  onChunk(callback) {
    this.on('chunk', callback);
  }

  /**
   * Get statistics
   * @returns {{running: boolean, pendingBytes: number}}
   */
  getStats() {
    return {
      running: this._running,
      pendingBytes: this._pendingBuffer.length
    };
  }
}

/**
 * Create an AudioCapture instance
 * @param {Partial<AudioCaptureConfig>} [config={}] - Configuration
 * @returns {AudioCapture}
 */
export function createAudioCapture(config = {}) {
  return new AudioCapture(config);
}
