/**
 * VADState - Voice Activity Detection state machine
 *
 * Per algorithm_and_data_structures.md:
 * - Tracks speech/silence state correctly
 * - Buffers audio during speech
 * - Emits events at state transitions
 * - Configurable thresholds
 *
 * VAD Algorithm:
 * For each 30ms audio frame:
 *   1. Run VAD inference -> speech probability
 *   2. If probability > threshold:
 *      - If not in speech -> emit "speech_started"
 *      - Mark as in speech, reset silence counter
 *   3. If probability <= threshold:
 *      - Increment silence counter
 *      - If silence > min_silence_frames:
 *        - Emit "speech_ended" with buffered audio
 *        - Reset state
 */

import { AudioBuffer, msToSamples } from '../audio/audio-buffer.mjs';

/**
 * @typedef {Object} VADConfig
 * @property {number} threshold - Speech probability threshold (0.0-1.0)
 * @property {number} silenceDurationMs - Silence duration to end utterance (ms)
 * @property {number} minSpeechMs - Minimum speech duration to accept (ms)
 * @property {number} sampleRate - Audio sample rate (Hz)
 * @property {number} frameDurationMs - Frame duration for VAD (ms)
 * @property {number} [bargeInThreshold] - Higher threshold during playback
 */

/**
 * @typedef {{type: 'speech_started'}} SpeechStartedEvent
 */

/**
 * @typedef {{type: 'speech_ended', audio: Int16Array, durationMs: number}} SpeechEndedEvent
 */

/**
 * @typedef {SpeechStartedEvent | SpeechEndedEvent} VADEvent
 */

/**
 * Default VAD configuration
 */
export const DEFAULT_VAD_CONFIG = Object.freeze({
  threshold: 0.5,
  silenceDurationMs: 1200,
  minSpeechMs: 500,
  sampleRate: 16000,
  frameDurationMs: 30,
  bargeInThreshold: 0.7
});

/**
 * VADState - Manages voice activity detection state
 */
export class VADState {
  /**
   * Create a new VADState
   * @param {Partial<VADConfig>} [config={}] - Configuration options
   */
  constructor(config = {}) {
    /** @type {VADConfig} */
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };

    // Calculate frame and buffer sizes
    /** @type {number} */
    this.samplesPerFrame = msToSamples(this.config.frameDurationMs, this.config.sampleRate);

    /** @type {number} */
    this.silenceFramesThreshold = Math.ceil(
      this.config.silenceDurationMs / this.config.frameDurationMs
    );

    /** @type {number} */
    this.minSpeechFrames = Math.ceil(
      this.config.minSpeechMs / this.config.frameDurationMs
    );

    // State
    /** @type {boolean} */
    this._inSpeech = false;

    /** @type {number} */
    this._silenceFrames = 0;

    /** @type {number} */
    this._speechFrames = 0;

    /** @type {number} */
    this._lastProbability = 0;

    /** @type {boolean} */
    this._bargeInMode = false;

    // Audio buffer for speech (max ~30 seconds of audio)
    const maxBufferMs = 30000;
    const bufferCapacity = msToSamples(maxBufferMs, this.config.sampleRate);
    /** @type {AudioBuffer} */
    this._speechBuffer = new AudioBuffer(bufferCapacity);
  }

  /**
   * Get whether currently in speech
   * @returns {boolean}
   */
  get inSpeech() {
    return this._inSpeech;
  }

  /**
   * Get number of silence frames since last speech
   * @returns {number}
   */
  get silenceFrames() {
    return this._silenceFrames;
  }

  /**
   * Get number of speech frames in current utterance
   * @returns {number}
   */
  get speechFrames() {
    return this._speechFrames;
  }

  /**
   * Get last speech probability
   * @returns {number}
   */
  get lastProbability() {
    return this._lastProbability;
  }

  /**
   * Get current threshold (may be elevated in barge-in mode)
   * @returns {number}
   */
  get currentThreshold() {
    return this._bargeInMode
      ? (this.config.bargeInThreshold || this.config.threshold)
      : this.config.threshold;
  }

  /**
   * Set barge-in mode (higher threshold during playback)
   * @param {boolean} enabled
   */
  setBargeInMode(enabled) {
    this._bargeInMode = enabled;
  }

  /**
   * Update VAD state with a new audio frame and probability
   *
   * @param {number} probability - Speech probability (0.0-1.0)
   * @param {Int16Array} audioFrame - Audio samples for this frame
   * @returns {VADEvent|null} Event if state changed, null otherwise
   */
  update(probability, audioFrame) {
    this._lastProbability = probability;

    const threshold = this.currentThreshold;

    if (probability > threshold) {
      // Speech detected
      this._silenceFrames = 0;
      this._speechFrames++;

      if (!this._inSpeech) {
        // Speech just started
        this._inSpeech = true;
        this._speechBuffer.clear();
      }

      // Buffer the audio
      this._speechBuffer.write(audioFrame);

      // Check if this is the first frame (speech just started)
      if (this._speechFrames === 1) {
        return { type: 'speech_started' };
      }

      return null;
    } else {
      // Silence detected
      if (this._inSpeech) {
        this._silenceFrames++;

        // Still buffer audio during silence (might resume speech)
        this._speechBuffer.write(audioFrame);

        // Check if silence duration exceeded
        if (this._silenceFrames >= this.silenceFramesThreshold) {
          // Speech ended - check if it was long enough
          if (this._speechFrames >= this.minSpeechFrames) {
            const audio = this._speechBuffer.read(this._speechBuffer.available());
            const durationMs = (this._speechFrames * this.config.frameDurationMs);

            this.reset();

            return {
              type: 'speech_ended',
              audio,
              durationMs
            };
          } else {
            // Too short, discard
            this.reset();
          }
        }
      }

      return null;
    }
  }

  /**
   * Process a batch of audio samples
   * Splits into frames and processes each, returning any events
   *
   * @param {number[]} probabilities - Speech probabilities for each frame
   * @param {Int16Array} audio - Complete audio buffer
   * @returns {VADEvent[]} Events from processing
   */
  processBatch(probabilities, audio) {
    /** @type {VADEvent[]} */
    const events = [];

    for (let i = 0; i < probabilities.length; i++) {
      const frameStart = i * this.samplesPerFrame;
      const frameEnd = Math.min(frameStart + this.samplesPerFrame, audio.length);
      const frame = audio.slice(frameStart, frameEnd);

      const event = this.update(probabilities[i], frame);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  /**
   * Force end of speech (e.g., on timeout or session end)
   * @returns {SpeechEndedEvent|null} Event if speech was active
   */
  forceEnd() {
    if (this._inSpeech && this._speechFrames >= this.minSpeechFrames) {
      const audio = this._speechBuffer.read(this._speechBuffer.available());
      const durationMs = (this._speechFrames * this.config.frameDurationMs);

      this.reset();

      return {
        type: 'speech_ended',
        audio,
        durationMs
      };
    }

    this.reset();
    return null;
  }

  /**
   * Reset state for new utterance detection
   */
  reset() {
    this._inSpeech = false;
    this._silenceFrames = 0;
    this._speechFrames = 0;
    this._speechBuffer.clear();
    // Note: Don't reset bargeInMode or lastProbability
  }

  /**
   * Get buffered audio duration in milliseconds
   * @returns {number}
   */
  getBufferedDurationMs() {
    const samples = this._speechBuffer.available();
    return (samples / this.config.sampleRate) * 1000;
  }

  /**
   * Get state snapshot for debugging
   * @returns {{inSpeech: boolean, silenceFrames: number, speechFrames: number, lastProbability: number, bufferedMs: number, bargeInMode: boolean}}
   */
  getSnapshot() {
    return {
      inSpeech: this._inSpeech,
      silenceFrames: this._silenceFrames,
      speechFrames: this._speechFrames,
      lastProbability: this._lastProbability,
      bufferedMs: this.getBufferedDurationMs(),
      bargeInMode: this._bargeInMode
    };
  }
}

/**
 * Create a new VADState with configuration
 * @param {Partial<VADConfig>} [config={}] - Configuration options
 * @returns {VADState}
 */
export function createVADState(config = {}) {
  return new VADState(config);
}
