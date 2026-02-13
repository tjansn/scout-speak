/**
 * VADProcessor - Complete VAD processing pipeline
 *
 * Per specs/vad_silero.md and algorithm_and_data_structures.md:
 * - Combines Silero VAD model inference with VADState state machine
 * - Processes audio frames and emits speech events
 * - Supports barge-in mode for interrupting playback
 *
 * Data flow:
 *   AudioCapture.onChunk(chunk)
 *     -> VADProcessor.processFrame(chunk)
 *       -> SileroVAD.infer(chunk) -> probability
 *       -> VADState.update(probability, chunk) -> event
 *         -> emit 'speech_started' | 'speech_ended' | 'barge_in'
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { SileroVAD } from './silero-vad.mjs';
import { VADState, DEFAULT_VAD_CONFIG } from './vad-state.mjs';

/**
 * @typedef {Object} VADProcessorConfig
 * @property {string} modelPath - Path to Silero VAD ONNX model
 * @property {number} [threshold=0.5] - Speech probability threshold
 * @property {number} [bargeInThreshold=0.7] - Threshold during playback
 * @property {number} [silenceDurationMs=1200] - Silence to end utterance (ms)
 * @property {number} [minSpeechMs=500] - Minimum speech duration (ms)
 * @property {number} [sampleRate=16000] - Audio sample rate (Hz)
 * @property {number} [frameDurationMs=30] - Frame duration (ms)
 * @property {number} [bargeInConsecutiveFrames=3] - Frames required for barge-in
 */

/**
 * @typedef {Object} ProcessFrameResult
 * @property {number} probability - Speech probability from model
 * @property {boolean} isSpeech - Whether frame is speech
 * @property {'idle'|'speech'|'silence'|'playback'} state - Current state
 */

/**
 * Default processor configuration
 */
export const DEFAULT_PROCESSOR_CONFIG = Object.freeze({
  threshold: DEFAULT_VAD_CONFIG.threshold,
  bargeInThreshold: DEFAULT_VAD_CONFIG.bargeInThreshold,
  silenceDurationMs: DEFAULT_VAD_CONFIG.silenceDurationMs,
  minSpeechMs: DEFAULT_VAD_CONFIG.minSpeechMs,
  sampleRate: DEFAULT_VAD_CONFIG.sampleRate,
  frameDurationMs: DEFAULT_VAD_CONFIG.frameDurationMs,
  bargeInConsecutiveFrames: 3
});

/**
 * VADProcessor - Complete VAD processing pipeline with events
 *
 * Events:
 * - 'speech_started': User started speaking
 * - 'speech_ended': User stopped speaking (includes audio and duration)
 * - 'speech_discarded': Speech too short, discarded
 * - 'barge_in': User interrupted during playback
 * - 'error': Processing error occurred
 *
 * @extends EventEmitter
 */
export class VADProcessor extends EventEmitter {
  /**
   * Create a new VADProcessor
   * @param {VADProcessorConfig} config - Configuration with modelPath required
   */
  constructor(config) {
    super();

    if (!config.modelPath) {
      throw new Error('modelPath is required');
    }

    /** @type {VADProcessorConfig} */
    this.config = { ...DEFAULT_PROCESSOR_CONFIG, ...config };

    const sampleRate = this.config.sampleRate ?? DEFAULT_PROCESSOR_CONFIG.sampleRate;
    const frameDurationMs = this.config.frameDurationMs ?? DEFAULT_PROCESSOR_CONFIG.frameDurationMs;

    /** @type {SileroVAD} */
    this._vad = new SileroVAD({
      sampleRate,
      frameSize: Math.floor((frameDurationMs / 1000) * sampleRate)
    });

    /** @type {VADState} */
    this._vadState = new VADState({
      threshold: this.config.threshold,
      silenceDurationMs: this.config.silenceDurationMs,
      minSpeechMs: this.config.minSpeechMs,
      sampleRate: this.config.sampleRate,
      frameDurationMs: this.config.frameDurationMs,
      bargeInThreshold: this.config.bargeInThreshold
    });

    /** @type {boolean} */
    this._loaded = false;

    /** @type {boolean} */
    this._playbackActive = false;

    /** @type {number} */
    this._consecutiveSpeechFrames = 0;

    /** @type {number} */
    this._framesProcessed = 0;

    /** @type {number} */
    this._totalInferenceTimeMs = 0;
  }

  /**
   * Check if the VAD model is loaded
   * @returns {boolean}
   */
  get isLoaded() {
    return this._loaded;
  }

  /**
   * Check if playback mode is active (barge-in detection)
   * @returns {boolean}
   */
  get isPlaybackActive() {
    return this._playbackActive;
  }

  /**
   * Get current speech probability threshold
   * @returns {number}
   */
  get currentThreshold() {
    return this._playbackActive
      ? (this.config.bargeInThreshold ?? DEFAULT_PROCESSOR_CONFIG.bargeInThreshold)
      : (this.config.threshold ?? DEFAULT_PROCESSOR_CONFIG.threshold);
  }

  /**
   * Load the VAD model
   * @returns {Promise<boolean>}
   * @throws {Error} If model cannot be loaded
   */
  async load() {
    if (this._loaded) {
      return true;
    }

    await this._vad.load(this.config.modelPath);
    this._loaded = true;

    return true;
  }

  /**
   * Set playback mode (higher threshold for barge-in detection)
   *
   * During playback, VAD uses elevated threshold to filter speaker audio
   * picked up by microphone. Requires consecutive frames for barge-in.
   *
   * @param {boolean} active - Whether playback is active
   */
  setPlaybackActive(active) {
    this._playbackActive = active;
    this._vadState.setBargeInMode(active);
    this._consecutiveSpeechFrames = 0;
  }

  /**
   * Process a single audio frame
   *
   * @param {Buffer|Int16Array} audioFrame - Audio frame (30ms at 16kHz = 480 samples)
   * @returns {Promise<ProcessFrameResult>} Processing result
   * @throws {Error} If model not loaded
   */
  async processFrame(audioFrame) {
    if (!this._loaded) {
      throw new Error('VAD model not loaded. Call load() first.');
    }

    const startTime = performance.now();

    // Run inference
    const probability = await this._vad.infer(audioFrame);

    const inferenceTime = performance.now() - startTime;
    this._totalInferenceTimeMs += inferenceTime;
    this._framesProcessed++;

    const threshold = this.currentThreshold;
    const isSpeech = probability > threshold;

    // Handle barge-in during playback
    if (this._playbackActive) {
      if (isSpeech) {
        this._consecutiveSpeechFrames++;

        const bargeInFrames = this.config.bargeInConsecutiveFrames ?? DEFAULT_PROCESSOR_CONFIG.bargeInConsecutiveFrames;
        if (this._consecutiveSpeechFrames >= bargeInFrames) {
          this.emit('barge_in', {
            probability,
            consecutiveFrames: this._consecutiveSpeechFrames
          });
          this._consecutiveSpeechFrames = 0;
        }
      } else {
        this._consecutiveSpeechFrames = 0;
      }

      return {
        probability,
        isSpeech,
        state: 'playback'
      };
    }

    // Normal VAD processing - convert to Int16Array if needed
    let int16Frame;
    if (Buffer.isBuffer(audioFrame)) {
      int16Frame = new Int16Array(
        audioFrame.buffer,
        audioFrame.byteOffset,
        audioFrame.length / 2
      );
    } else {
      int16Frame = audioFrame;
    }

    // Update VAD state and check for events
    const event = this._vadState.update(probability, int16Frame);

    if (event) {
      if (event.type === 'speech_started') {
        this.emit('speech_started');
      } else if (event.type === 'speech_ended') {
        this.emit('speech_ended', {
          audio: event.audio,
          durationMs: event.durationMs
        });
      }
    }

    // Determine current state
    /** @type {'idle'|'speech'|'silence'|'playback'} */
    let state = 'idle';
    if (this._vadState.inSpeech) {
      state = isSpeech ? 'speech' : 'silence';
    }

    return {
      probability,
      isSpeech,
      state
    };
  }

  /**
   * Process multiple audio frames in sequence
   *
   * @param {Array<Buffer|Int16Array>} frames - Array of audio frames
   * @returns {Promise<ProcessFrameResult[]>} Array of results
   */
  async processFrames(frames) {
    const results = [];

    for (const frame of frames) {
      const result = await this.processFrame(frame);
      results.push(result);
    }

    return results;
  }

  /**
   * Force end of current speech (e.g., on timeout or session end)
   *
   * @returns {{audio: Int16Array, durationMs: number}|null}
   */
  forceEndSpeech() {
    const event = this._vadState.forceEnd();

    if (event) {
      this.emit('speech_ended', {
        audio: event.audio,
        durationMs: event.durationMs
      });
      return { audio: event.audio, durationMs: event.durationMs };
    }

    return null;
  }

  /**
   * Reset processor state (clears buffers and LSTM states)
   */
  reset() {
    this._vadState.reset();
    this._vad.resetState();
    this._consecutiveSpeechFrames = 0;
  }

  /**
   * Get current state snapshot for debugging
   * @returns {Object}
   */
  getSnapshot() {
    return {
      loaded: this._loaded,
      playbackActive: this._playbackActive,
      consecutiveSpeechFrames: this._consecutiveSpeechFrames,
      currentThreshold: this.currentThreshold,
      vadState: this._vadState.getSnapshot(),
      stats: this.getStats()
    };
  }

  /**
   * Get processing statistics
   * @returns {{framesProcessed: number, avgInferenceTimeMs: number, totalInferenceTimeMs: number}}
   */
  getStats() {
    return {
      framesProcessed: this._framesProcessed,
      avgInferenceTimeMs: this._framesProcessed > 0
        ? this._totalInferenceTimeMs / this._framesProcessed
        : 0,
      totalInferenceTimeMs: this._totalInferenceTimeMs
    };
  }

  /**
   * Release resources
   */
  async dispose() {
    await this._vad.dispose();
    this._loaded = false;
    this.removeAllListeners();
  }
}

/**
 * Create a VADProcessor instance
 *
 * @param {VADProcessorConfig} config - Configuration with modelPath required
 * @returns {VADProcessor}
 */
export function createVADProcessor(config) {
  return new VADProcessor(config);
}
