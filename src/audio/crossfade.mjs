/**
 * Audio Crossfade - Smooth transitions between audio chunks
 *
 * Per T026 and specs/system_architecture_and_data_flow.md:
 * - Short (5-10ms) linear fade between chunks at boundaries
 * - Prevents clicks/pops when chunks don't align smoothly
 * - Minimal processing overhead
 *
 * The crossfade works by:
 * 1. Storing the last N samples of the previous chunk
 * 2. When a new chunk arrives, blending the overlap region
 * 3. Using linear interpolation for smooth transition
 */

import { msToSamples } from './audio-buffer.mjs';

/**
 * @typedef {Object} CrossfadeConfig
 * @property {number} fadeDurationMs - Duration of crossfade in milliseconds (default: 5)
 * @property {number} sampleRate - Sample rate in Hz (default: 22050)
 */

/**
 * Default configuration
 */
export const DEFAULT_CROSSFADE_CONFIG = Object.freeze({
  fadeDurationMs: 5,
  sampleRate: 22050
});

/**
 * AudioCrossfader - Applies crossfades between audio chunks
 *
 * Usage:
 *   const crossfader = new AudioCrossfader({ fadeDurationMs: 5, sampleRate: 22050 });
 *   const smoothChunk1 = crossfader.process(chunk1);
 *   const smoothChunk2 = crossfader.process(chunk2); // crossfaded with chunk1
 */
export class AudioCrossfader {
  /**
   * Create AudioCrossfader instance
   * @param {Partial<CrossfadeConfig>} [config={}] - Configuration
   */
  constructor(config = {}) {
    /** @type {CrossfadeConfig} */
    this.config = { ...DEFAULT_CROSSFADE_CONFIG, ...config };

    /** @type {number} */
    this._fadeSamples = msToSamples(this.config.fadeDurationMs, this.config.sampleRate);

    /** @type {Int16Array|null} */
    this._previousTail = null;

    /** @type {number} */
    this._chunksProcessed = 0;
  }

  /**
   * Get the fade duration in samples
   * @returns {number}
   */
  get fadeSamples() {
    return this._fadeSamples;
  }

  /**
   * Get the number of chunks processed
   * @returns {number}
   */
  get chunksProcessed() {
    return this._chunksProcessed;
  }

  /**
   * Process an audio chunk, applying crossfade with previous chunk
   *
   * The first chunk is returned unchanged (no previous chunk to fade from).
   * Subsequent chunks are crossfaded at the beginning with the previous chunk's tail.
   *
   * @param {Int16Array} chunk - Audio samples to process
   * @returns {Int16Array} Processed audio (may be same reference if no crossfade needed)
   */
  process(chunk) {
    if (!(chunk instanceof Int16Array)) {
      throw new Error('Chunk must be Int16Array');
    }

    if (chunk.length === 0) {
      return chunk;
    }

    this._chunksProcessed++;

    // If chunk is smaller than fade duration, skip crossfade to avoid artifacts
    if (chunk.length < this._fadeSamples) {
      this._storeTail(chunk);
      return chunk;
    }

    let result = chunk;

    // Apply crossfade with previous chunk if we have a tail
    if (this._previousTail !== null && this._previousTail.length > 0) {
      result = this._applyCrossfade(chunk);
    }

    // Store the tail of this chunk for next crossfade
    this._storeTail(chunk);

    return result;
  }

  /**
   * Apply crossfade at the beginning of the chunk
   *
   * Uses linear interpolation to blend the previous chunk's tail
   * with the current chunk's head.
   *
   * @private
   * @param {Int16Array} chunk - Current chunk
   * @returns {Int16Array} Crossfaded chunk
   */
  _applyCrossfade(chunk) {
    // Create a copy to avoid modifying the original
    const result = new Int16Array(chunk.length);
    result.set(chunk);

    const fadeLen = Math.min(
      this._fadeSamples,
      this._previousTail?.length ?? 0,
      chunk.length
    );

    if (fadeLen === 0 || !this._previousTail) {
      return result;
    }

    // Apply linear crossfade
    // At the start: weight heavily toward previous tail
    // At the end: weight heavily toward current chunk
    for (let i = 0; i < fadeLen; i++) {
      // t goes from 0 to 1 over the fade duration
      const t = i / fadeLen;

      // Get the sample from the end of the previous chunk
      const prevIndex = this._previousTail.length - fadeLen + i;
      const prevSample = prevIndex >= 0 ? this._previousTail[prevIndex] : 0;

      // Get the sample from the start of the current chunk
      const currSample = chunk[i];

      // Linear crossfade: blend from prev to curr
      // At t=0: mostly prev, at t=1: mostly curr
      const blended = Math.round(prevSample * (1 - t) + currSample * t);

      // Clamp to Int16 range
      result[i] = Math.max(-32768, Math.min(32767, blended));
    }

    return result;
  }

  /**
   * Store the tail samples of a chunk for next crossfade
   *
   * @private
   * @param {Int16Array} chunk - Chunk to store tail from
   */
  _storeTail(chunk) {
    const tailLen = Math.min(this._fadeSamples, chunk.length);
    this._previousTail = new Int16Array(tailLen);
    this._previousTail.set(chunk.subarray(chunk.length - tailLen));
  }

  /**
   * Reset the crossfader state
   *
   * Call this when starting a new audio stream to prevent
   * crossfading with the previous stream.
   */
  reset() {
    this._previousTail = null;
    this._chunksProcessed = 0;
  }

  /**
   * Check if crossfader has stored tail samples
   * @returns {boolean}
   */
  hasPreviousTail() {
    return this._previousTail !== null && this._previousTail.length > 0;
  }
}

/**
 * Create an AudioCrossfader instance
 * @param {Partial<CrossfadeConfig>} [config={}] - Configuration
 * @returns {AudioCrossfader}
 */
export function createCrossfader(config = {}) {
  return new AudioCrossfader(config);
}

/**
 * Apply a one-shot crossfade between two audio buffers
 *
 * This is a stateless utility for applying a single crossfade
 * at the boundary between two buffers.
 *
 * @param {Int16Array} buffer1 - First buffer (tail will be faded out)
 * @param {Int16Array} buffer2 - Second buffer (head will be faded in)
 * @param {number} fadeSamples - Number of samples for the crossfade
 * @returns {{ faded1: Int16Array, faded2: Int16Array }} Crossfaded buffers
 */
export function applyCrossfadeBetween(buffer1, buffer2, fadeSamples) {
  if (!(buffer1 instanceof Int16Array) || !(buffer2 instanceof Int16Array)) {
    throw new Error('Buffers must be Int16Array');
  }

  if (fadeSamples <= 0 || buffer1.length === 0 || buffer2.length === 0) {
    return { faded1: buffer1, faded2: buffer2 };
  }

  const fadeLen = Math.min(fadeSamples, buffer1.length, buffer2.length);

  // Create copies
  const faded1 = new Int16Array(buffer1.length);
  const faded2 = new Int16Array(buffer2.length);
  faded1.set(buffer1);
  faded2.set(buffer2);

  // Apply fade out at the end of buffer1
  for (let i = 0; i < fadeLen; i++) {
    const t = i / fadeLen;
    const idx = buffer1.length - fadeLen + i;
    // Fade out: multiply by (1 - t)
    faded1[idx] = Math.round(buffer1[idx] * (1 - t));
  }

  // Apply fade in at the start of buffer2
  for (let i = 0; i < fadeLen; i++) {
    const t = i / fadeLen;
    // Fade in: multiply by t
    faded2[i] = Math.round(buffer2[i] * t);
  }

  return { faded1, faded2 };
}
