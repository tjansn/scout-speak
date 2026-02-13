/**
 * AudioPlayback - Audio playback via PulseAudio pacat
 *
 * Per T011 and audio_io.md:
 * - Command: pacat --raw --format=s16le --rate=22050 --channels=1
 * - Input: PCM audio from TTS
 * - Interface: start(sampleRate), write(chunk), stop()
 *
 * Supports immediate stop for barge-in functionality.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * @typedef {Object} AudioPlaybackConfig
 * @property {number} [sampleRate=22050] - Sample rate in Hz
 * @property {number} [channels=1] - Number of channels (mono)
 * @property {string} [format='s16le'] - PCM format
 */

/**
 * Default configuration
 */
export const DEFAULT_PLAYBACK_CONFIG = Object.freeze({
  sampleRate: 22050,
  channels: 1,
  format: 's16le'
});

/**
 * AudioPlayback - Plays audio through speakers via PulseAudio
 */
export class AudioPlayback extends EventEmitter {
  /**
   * Create AudioPlayback instance
   * @param {Partial<AudioPlaybackConfig>} [config={}] - Configuration
   */
  constructor(config = {}) {
    super();

    /** @type {AudioPlaybackConfig} */
    this.config = { ...DEFAULT_PLAYBACK_CONFIG, ...config };

    /** @type {import('child_process').ChildProcess|null} */
    this._process = null;

    /** @type {boolean} */
    this._running = false;

    /** @type {number} */
    this._bytesWritten = 0;

    /** @type {boolean} */
    this._endOfStream = false;
  }

  /**
   * Check if playback is running
   * @returns {boolean}
   */
  get running() {
    return this._running;
  }

  /**
   * Start audio playback
   * @param {number} [sampleRate] - Override sample rate for this session
   * @throws {Error} If already running or pacat fails
   */
  start(sampleRate) {
    if (this._running) {
      throw new Error('AudioPlayback is already running');
    }

    const rate = sampleRate || this.config.sampleRate;

    const args = [
      '--raw',
      `--format=${this.config.format}`,
      `--rate=${rate}`,
      `--channels=${this.config.channels}`
    ];

    this._process = spawn('pacat', args, {
      stdio: ['pipe', 'ignore', 'pipe']
    });

    this._running = true;
    this._bytesWritten = 0;
    this._endOfStream = false;

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

      if (code !== 0 && code !== null && !this._endOfStream) {
        this.emit('error', new Error(`pacat exited with code ${code}`));
      } else if (signal) {
        this.emit('stopped', signal);
      } else {
        this.emit('complete');
      }
    });

    // Handle process error (e.g., command not found)
    this._process.on('error', (err) => {
      this._running = false;
      this._process = null;
      this.emit('error', err);
    });

    // Handle stdin drain (ready for more data)
    this._process.stdin?.on('drain', () => {
      this.emit('drain');
    });

    this.emit('started');
  }

  /**
   * Write audio data for playback
   * @param {Buffer|Int16Array} chunk - Audio data to play
   * @returns {boolean} False if backpressure (wait for 'drain' event)
   */
  write(chunk) {
    if (!this._running || !this._process?.stdin) {
      return false;
    }

    let buffer;
    if (chunk instanceof Int16Array) {
      buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    } else {
      buffer = chunk;
    }

    this._bytesWritten += buffer.length;
    return this._process.stdin.write(buffer);
  }

  /**
   * Signal end of audio stream
   * This allows pacat to play remaining buffered audio before exiting.
   */
  end() {
    if (!this._running || !this._process?.stdin) {
      return;
    }

    this._endOfStream = true;
    this._process.stdin.end();
  }

  /**
   * Stop audio playback immediately
   * Used for barge-in - stops playback without waiting for buffer to drain.
   */
  stop() {
    if (!this._running || !this._process) {
      return;
    }

    this._process.kill('SIGTERM');
    this._running = false;
    this._bytesWritten = 0;
  }

  /**
   * Register completion callback
   * @param {function(): void} callback - Called when playback completes
   */
  onComplete(callback) {
    this.on('complete', callback);
  }

  /**
   * Get statistics
   * @returns {{running: boolean, bytesWritten: number}}
   */
  getStats() {
    return {
      running: this._running,
      bytesWritten: this._bytesWritten
    };
  }

  /**
   * Calculate duration of written audio in milliseconds
   * @returns {number}
   */
  getDurationMs() {
    const samples = this._bytesWritten / 2; // 16-bit = 2 bytes per sample
    return (samples / (this.config.sampleRate || 22050)) * 1000;
  }
}

/**
 * Create an AudioPlayback instance
 * @param {Partial<AudioPlaybackConfig>} [config={}] - Configuration
 * @returns {AudioPlayback}
 */
export function createAudioPlayback(config = {}) {
  return new AudioPlayback(config);
}
