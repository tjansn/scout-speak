/**
 * Jitter Buffer - Smooth audio playback by buffering TTS output
 *
 * Per T025 and specs/algorithm_and_data_structures.md:
 * - Ring buffer with watermarks that accumulates audio before playback
 * - Starts playback after low_watermark is reached
 * - Handles irregular chunk arrival times
 * - Pads with silence on underrun (no clicks)
 * - Clears immediately on barge-in
 *
 * Configuration (from spec):
 * - buffer_size_ms: 500ms total capacity
 * - low_watermark_ms: 100ms (start playback threshold)
 * - frame_duration_ms: 20ms
 *
 * FR-5: Continuous audio with no cuts/glitches
 */

import { EventEmitter } from 'events';
import { AudioBuffer, msToSamples } from '../audio/audio-buffer.mjs';

/**
 * @typedef {Object} JitterBufferConfig
 * @property {number} bufferSizeMs - Total buffer capacity in ms
 * @property {number} lowWatermarkMs - Start playback threshold in ms
 * @property {number} frameDurationMs - Playback frame size in ms
 * @property {number} sampleRate - Sample rate for calculations
 */

/**
 * @typedef {Object} JitterBufferStats
 * @property {number} bufferedSamples - Current samples in buffer
 * @property {number} bufferedMs - Current buffer level in ms
 * @property {number} fillPercentage - Buffer fill level (0-100)
 * @property {boolean} playbackActive - Whether playback is active
 * @property {number} underruns - Count of buffer underruns
 * @property {number} totalSamplesWritten - Total samples written
 * @property {number} totalSamplesRead - Total samples read
 */

/**
 * Default configuration
 */
export const DEFAULT_JITTER_CONFIG = Object.freeze({
  bufferSizeMs: 500,
  lowWatermarkMs: 100,
  frameDurationMs: 20,
  sampleRate: 22050
});

/**
 * JitterBuffer - Smooth audio playback buffering
 */
export class JitterBuffer extends EventEmitter {
  /**
   * Create JitterBuffer instance
   * @param {Partial<JitterBufferConfig>} [config={}] - Configuration
   */
  constructor(config = {}) {
    super();

    /** @type {JitterBufferConfig} */
    this.config = { ...DEFAULT_JITTER_CONFIG, ...config };

    // Calculate sample counts from milliseconds
    const bufferSamples = msToSamples(this.config.bufferSizeMs, this.config.sampleRate);
    this._lowWatermarkSamples = msToSamples(this.config.lowWatermarkMs, this.config.sampleRate);
    this._frameSamples = msToSamples(this.config.frameDurationMs, this.config.sampleRate);

    /** @type {AudioBuffer} */
    this._buffer = new AudioBuffer(bufferSamples);

    /** @type {boolean} */
    this._playbackActive = false;

    /** @type {boolean} */
    this._endOfStream = false;

    /** @type {number} */
    this._underruns = 0;

    /** @type {number} */
    this._totalWritten = 0;

    /** @type {number} */
    this._totalRead = 0;
  }

  /**
   * Check if playback is active
   * @returns {boolean}
   */
  get playbackActive() {
    return this._playbackActive;
  }

  /**
   * Get current buffer level in samples
   * @returns {number}
   */
  get bufferedSamples() {
    return this._buffer.available();
  }

  /**
   * Get current buffer level in milliseconds
   * @returns {number}
   */
  get bufferedMs() {
    return (this._buffer.available() / this.config.sampleRate) * 1000;
  }

  /**
   * Check if buffer is ready to start playback
   * @returns {boolean}
   */
  get isReady() {
    return this._buffer.available() >= this._lowWatermarkSamples;
  }

  /**
   * Write audio samples to the buffer
   *
   * If the buffer reaches low watermark and playback wasn't active,
   * emits 'ready' event to signal playback can begin.
   *
   * @param {Int16Array|Buffer} samples - Audio samples to buffer
   * @returns {number} Number of samples written
   */
  write(samples) {
    if (this._endOfStream) {
      return 0;
    }

    let int16Samples;
    if (samples instanceof Buffer) {
      // Convert Buffer to Int16Array
      int16Samples = new Int16Array(
        samples.buffer,
        samples.byteOffset,
        samples.length / 2
      );
    } else if (samples instanceof Int16Array) {
      int16Samples = samples;
    } else {
      throw new Error('Samples must be Int16Array or Buffer');
    }

    const written = this._buffer.write(int16Samples);
    this._totalWritten += written;

    // Check if we should start playback
    if (!this._playbackActive && this._buffer.available() >= this._lowWatermarkSamples) {
      this._playbackActive = true;
      this.emit('ready');
    }

    return written;
  }

  /**
   * Read a frame of audio for playback
   *
   * Returns exactly frameDuration samples. If buffer underruns,
   * pads with silence to prevent clicks.
   *
   * @returns {Int16Array} Audio frame (always frameDuration samples)
   */
  read() {
    const frame = new Int16Array(this._frameSamples);
    const available = this._buffer.available();

    if (available >= this._frameSamples) {
      // Normal case: enough data
      const data = this._buffer.read(this._frameSamples);
      frame.set(data);
    } else if (available > 0) {
      // Underrun: partial data + silence padding
      const data = this._buffer.read(available);
      frame.set(data);
      // Remaining samples are already 0 (silence)
      this._underruns++;
      this.emit('underrun', { requested: this._frameSamples, available });
    } else {
      // Complete underrun: output silence
      // Array is already initialized to 0s
      this._underruns++;
      this.emit('underrun', { requested: this._frameSamples, available: 0 });
    }

    this._totalRead += this._frameSamples;

    // Check for end of stream with empty buffer
    if (this._endOfStream && this._buffer.available() === 0) {
      this._playbackActive = false;
      this.emit('drained');
    }

    return frame;
  }

  /**
   * Read available samples up to a maximum count
   *
   * Unlike read(), this doesn't pad with silence - it returns only
   * what's available. Useful for draining the buffer.
   *
   * @param {number} maxSamples - Maximum samples to read
   * @returns {Int16Array} Available samples (may be less than maxSamples)
   */
  readAvailable(maxSamples) {
    const toRead = Math.min(maxSamples, this._buffer.available());
    const data = this._buffer.read(toRead);
    this._totalRead += data.length;

    if (this._endOfStream && this._buffer.available() === 0) {
      this._playbackActive = false;
      this.emit('drained');
    }

    return data;
  }

  /**
   * Signal end of audio stream
   *
   * After this is called, no more writes are accepted.
   * Buffer will be drained during reads and 'drained' event emitted when empty.
   */
  end() {
    this._endOfStream = true;

    // If buffer is already empty, signal immediately
    if (this._buffer.available() === 0) {
      this._playbackActive = false;
      this.emit('drained');
    }
  }

  /**
   * Clear buffer immediately
   *
   * Used for barge-in - discards all buffered audio.
   */
  clear() {
    this._buffer.clear();
    this._playbackActive = false;
    this._endOfStream = false;
    this.emit('cleared');
  }

  /**
   * Reset buffer to initial state
   *
   * Clears buffer and resets all statistics.
   */
  reset() {
    this._buffer.clear();
    this._playbackActive = false;
    this._endOfStream = false;
    this._underruns = 0;
    this._totalWritten = 0;
    this._totalRead = 0;
  }

  /**
   * Get buffer statistics
   * @returns {JitterBufferStats}
   */
  getStats() {
    return {
      bufferedSamples: this._buffer.available(),
      bufferedMs: this.bufferedMs,
      fillPercentage: this._buffer.fillPercentage(),
      playbackActive: this._playbackActive,
      underruns: this._underruns,
      totalSamplesWritten: this._totalWritten,
      totalSamplesRead: this._totalRead
    };
  }
}

/**
 * Create a JitterBuffer instance
 * @param {Partial<JitterBufferConfig>} [config={}] - Configuration
 * @returns {JitterBuffer}
 */
export function createJitterBuffer(config = {}) {
  return new JitterBuffer(config);
}
