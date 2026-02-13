/**
 * AudioBuffer - Ring buffer for audio samples
 *
 * Provides O(1) read/write operations for efficient audio buffering.
 * Used by the jitter buffer and VAD for smooth audio handling.
 *
 * Per algorithm_and_data_structures.md:
 * - O(1) read/write operations
 * - Configurable capacity
 * - Watermark support (low/high)
 * - Methods: write(), read(), clear(), available()
 */

/**
 * Ring buffer for audio samples with O(1) operations
 */
export class AudioBuffer {
  /**
   * Create a new AudioBuffer
   * @param {number} capacitySamples - Maximum number of samples to hold
   */
  constructor(capacitySamples) {
    if (!Number.isInteger(capacitySamples) || capacitySamples <= 0) {
      throw new Error('Capacity must be a positive integer');
    }

    /** @type {Int16Array} */
    this.data = new Int16Array(capacitySamples);

    /** @type {number} */
    this.readPos = 0;

    /** @type {number} */
    this.writePos = 0;

    /** @type {number} */
    this._size = 0;

    /** @type {number} */
    this._capacity = capacitySamples;
  }

  /**
   * Get the current capacity of the buffer
   * @returns {number}
   */
  capacity() {
    return this._capacity;
  }

  /**
   * Get the number of samples currently in the buffer
   * @returns {number}
   */
  available() {
    return this._size;
  }

  /**
   * Check if the buffer is empty
   * @returns {boolean}
   */
  isEmpty() {
    return this._size === 0;
  }

  /**
   * Check if the buffer is full
   * @returns {boolean}
   */
  isFull() {
    return this._size === this._capacity;
  }

  /**
   * Get available space for writing
   * @returns {number}
   */
  availableForWrite() {
    return this._capacity - this._size;
  }

  /**
   * Write samples to the buffer
   *
   * If the buffer would overflow, oldest samples are dropped to make room.
   * Returns the number of samples actually written.
   *
   * @param {Int16Array} samples - Samples to write
   * @returns {number} Number of samples written
   */
  write(samples) {
    if (!(samples instanceof Int16Array)) {
      throw new Error('Samples must be Int16Array');
    }

    if (samples.length === 0) {
      return 0;
    }

    const samplesToWrite = Math.min(samples.length, this._capacity);
    let samplesWritten = 0;

    // If writing more than capacity, only keep the last 'capacity' samples
    const startOffset = samples.length > this._capacity
      ? samples.length - this._capacity
      : 0;

    // If we would overflow, drop oldest samples
    const overflow = (this._size + samplesToWrite - startOffset) - this._capacity;
    if (overflow > 0) {
      // Advance read pointer to drop oldest samples
      this.readPos = (this.readPos + overflow) % this._capacity;
      this._size -= overflow;
    }

    // Write samples
    for (let i = startOffset; i < samples.length; i++) {
      this.data[this.writePos] = samples[i];
      this.writePos = (this.writePos + 1) % this._capacity;
      this._size++;
      samplesWritten++;
    }

    return samplesWritten;
  }

  /**
   * Read samples from the buffer
   *
   * Returns up to 'count' samples. If fewer samples are available,
   * returns only the available samples (partial read).
   *
   * @param {number} count - Maximum number of samples to read
   * @returns {Int16Array} Samples read (may be shorter than count)
   */
  read(count) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('Count must be a non-negative integer');
    }

    const samplesToRead = Math.min(count, this._size);

    if (samplesToRead === 0) {
      return new Int16Array(0);
    }

    const result = new Int16Array(samplesToRead);

    for (let i = 0; i < samplesToRead; i++) {
      result[i] = this.data[this.readPos];
      this.readPos = (this.readPos + 1) % this._capacity;
    }

    this._size -= samplesToRead;

    return result;
  }

  /**
   * Peek at samples without removing them from the buffer
   *
   * @param {number} count - Maximum number of samples to peek
   * @returns {Int16Array} Samples (does not modify buffer)
   */
  peek(count) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('Count must be a non-negative integer');
    }

    const samplesToPeek = Math.min(count, this._size);

    if (samplesToPeek === 0) {
      return new Int16Array(0);
    }

    const result = new Int16Array(samplesToPeek);
    let readPos = this.readPos;

    for (let i = 0; i < samplesToPeek; i++) {
      result[i] = this.data[readPos];
      readPos = (readPos + 1) % this._capacity;
    }

    return result;
  }

  /**
   * Skip (discard) samples from the buffer
   *
   * @param {number} count - Number of samples to skip
   * @returns {number} Number of samples actually skipped
   */
  skip(count) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('Count must be a non-negative integer');
    }

    const samplesToSkip = Math.min(count, this._size);
    this.readPos = (this.readPos + samplesToSkip) % this._capacity;
    this._size -= samplesToSkip;

    return samplesToSkip;
  }

  /**
   * Clear all samples from the buffer
   */
  clear() {
    this.readPos = 0;
    this.writePos = 0;
    this._size = 0;
    // Note: We don't clear the underlying array for performance
    // The data will be overwritten on next write
  }

  /**
   * Check if buffer level is at or above a watermark
   *
   * @param {number} watermarkSamples - Watermark level in samples
   * @returns {boolean}
   */
  isAboveWatermark(watermarkSamples) {
    return this._size >= watermarkSamples;
  }

  /**
   * Check if buffer level is at or below a watermark
   *
   * @param {number} watermarkSamples - Watermark level in samples
   * @returns {boolean}
   */
  isBelowWatermark(watermarkSamples) {
    return this._size <= watermarkSamples;
  }

  /**
   * Get buffer fill level as a percentage (0-100)
   * @returns {number}
   */
  fillPercentage() {
    return (this._size / this._capacity) * 100;
  }
}

/**
 * Create an AudioBuffer sized for a duration in milliseconds
 *
 * @param {number} durationMs - Duration in milliseconds
 * @param {number} sampleRate - Sample rate in Hz (default 16000)
 * @returns {AudioBuffer}
 */
export function createAudioBufferForDuration(durationMs, sampleRate = 16000) {
  const samples = Math.ceil((durationMs / 1000) * sampleRate);
  return new AudioBuffer(samples);
}

/**
 * Convert milliseconds to samples
 *
 * @param {number} ms - Duration in milliseconds
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {number}
 */
export function msToSamples(ms, sampleRate) {
  return Math.ceil((ms / 1000) * sampleRate);
}

/**
 * Convert samples to milliseconds
 *
 * @param {number} samples - Number of samples
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {number}
 */
export function samplesToMs(samples, sampleRate) {
  return (samples / sampleRate) * 1000;
}
