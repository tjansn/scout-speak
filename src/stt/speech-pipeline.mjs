/**
 * SpeechPipeline - Complete audio capture to transcription pipeline
 *
 * Per specs/system_architecture_and_data_flow.md:
 *   AudioCapture.onChunk(chunk)
 *     -> VAD.process(chunk)
 *       -> if speech_ended: STT.transcribe(audio)
 *         -> return transcript or "Didn't catch that"
 *
 * This module wires together:
 * - AudioCapture (parecord)
 * - VADProcessor (Silero VAD)
 * - STT (whisper.cpp)
 */

import { EventEmitter } from 'events';
import { AudioCapture } from '../audio/audio-capture.mjs';
import { VADProcessor } from '../vad/vad-processor.mjs';
import { STT, isGarbageTranscript } from './stt.mjs';

/**
 * @typedef {Object} SpeechPipelineConfig
 * @property {string} vadModelPath - Path to Silero VAD ONNX model
 * @property {string} whisperPath - Path to whisper.cpp executable
 * @property {string} sttModelPath - Path to whisper GGML model
 * @property {number} [sampleRate=16000] - Audio sample rate (Hz)
 * @property {number} [vadThreshold=0.5] - VAD speech threshold
 * @property {number} [bargeInThreshold=0.7] - VAD threshold during playback
 * @property {number} [silenceDurationMs=1200] - Silence duration to end speech
 * @property {number} [minSpeechMs=500] - Minimum speech duration
 * @property {number} [sttThreads=4] - STT thread count
 */

/**
 * @typedef {Object} TranscriptEvent
 * @property {string} text - Transcribed text
 * @property {number} audioDurationMs - Audio duration in ms
 * @property {number} sttDurationMs - STT inference time in ms
 */

/**
 * Default pipeline configuration
 */
export const DEFAULT_PIPELINE_CONFIG = Object.freeze({
  sampleRate: 16000,
  vadThreshold: 0.5,
  bargeInThreshold: 0.7,
  silenceDurationMs: 1200,
  minSpeechMs: 500,
  sttThreads: 4
});

/**
 * SpeechPipeline - Combines audio capture, VAD, and STT
 *
 * Events:
 * - 'ready': Pipeline initialized and ready
 * - 'speech_started': User started speaking
 * - 'speech_ended': User stopped speaking (before STT)
 * - 'transcript': Transcription completed
 * - 'empty_transcript': Speech detected but no valid transcription ("Didn't catch that")
 * - 'barge_in': User interrupted during playback
 * - 'error': Error occurred
 * - 'stopped': Pipeline stopped
 *
 * @extends EventEmitter
 */
export class SpeechPipeline extends EventEmitter {
  /**
   * Create a new SpeechPipeline
   * @param {SpeechPipelineConfig} config - Pipeline configuration
   */
  constructor(config) {
    super();

    // Validate required config
    if (!config.vadModelPath) {
      throw new Error('vadModelPath is required');
    }
    if (!config.whisperPath) {
      throw new Error('whisperPath is required');
    }
    if (!config.sttModelPath) {
      throw new Error('sttModelPath is required');
    }

    /** @type {SpeechPipelineConfig} */
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };

    /** @type {AudioCapture} */
    this._capture = new AudioCapture({
      sampleRate: this.config.sampleRate,
      channels: 1,
      format: 's16le'
    });

    /** @type {VADProcessor} */
    this._vad = new VADProcessor({
      modelPath: this.config.vadModelPath,
      threshold: this.config.vadThreshold,
      bargeInThreshold: this.config.bargeInThreshold,
      silenceDurationMs: this.config.silenceDurationMs,
      minSpeechMs: this.config.minSpeechMs,
      sampleRate: this.config.sampleRate
    });

    /** @type {STT} */
    this._stt = new STT({
      whisperPath: this.config.whisperPath,
      modelPath: this.config.sttModelPath,
      threads: this.config.sttThreads,
      sampleRate: this.config.sampleRate
    });

    /** @type {boolean} */
    this._initialized = false;

    /** @type {boolean} */
    this._running = false;

    /** @type {boolean} */
    this._transcribing = false;

    /** @type {number} */
    this._transcriptCount = 0;

    /** @type {number} */
    this._emptyTranscriptCount = 0;

    // Wire up VAD events
    this._setupVADEvents();
  }

  /**
   * Check if pipeline is initialized
   * @returns {boolean}
   */
  get isInitialized() {
    return this._initialized;
  }

  /**
   * Check if pipeline is running
   * @returns {boolean}
   */
  get isRunning() {
    return this._running;
  }

  /**
   * Check if currently transcribing
   * @returns {boolean}
   */
  get isTranscribing() {
    return this._transcribing;
  }

  /**
   * Initialize the pipeline (load VAD model)
   * @returns {Promise<boolean>}
   */
  async init() {
    if (this._initialized) {
      return true;
    }

    try {
      // Load VAD model
      await this._vad.load();

      // Verify STT is ready
      const sttStatus = this._stt.verify();
      if (!sttStatus.ready) {
        throw new Error(`STT not ready: ${sttStatus.errors.join(', ')}`);
      }

      this._initialized = true;
      this.emit('ready');

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('error', { type: 'init', message });
      throw err;
    }
  }

  /**
   * Start the speech pipeline
   * @returns {boolean}
   */
  start() {
    if (!this._initialized) {
      throw new Error('Pipeline not initialized. Call init() first.');
    }

    if (this._running) {
      return true;
    }

    // Start audio capture
    this._capture.start();

    // Process audio chunks through VAD
    this._capture.onChunk(async (chunk) => {
      if (!this._running) return;

      try {
        await this._vad.processFrame(chunk);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit('error', { type: 'vad', message });
      }
    });

    this._running = true;

    return true;
  }

  /**
   * Stop the speech pipeline
   */
  stop() {
    if (!this._running) {
      return;
    }

    // Stop audio capture
    this._capture.stop();

    // Force end any pending speech
    this._vad.forceEndSpeech();

    // Reset VAD state
    this._vad.reset();

    this._running = false;
    this.emit('stopped');
  }

  /**
   * Set playback mode (for barge-in detection)
   * @param {boolean} active - Whether playback is active
   */
  setPlaybackActive(active) {
    this._vad.setPlaybackActive(active);
  }

  /**
   * Wire up VAD events to pipeline events
   * @private
   */
  _setupVADEvents() {
    this._vad.on('speech_started', () => {
      this.emit('speech_started');
    });

    this._vad.on('speech_ended', async (data) => {
      this.emit('speech_ended', {
        durationMs: data.durationMs
      });

      // Run STT on the captured audio
      await this._transcribe(data.audio, data.durationMs);
    });

    this._vad.on('barge_in', (data) => {
      this.emit('barge_in', data);
    });
  }

  /**
   * Transcribe audio and emit result
   * @param {Int16Array} audio - Audio samples
   * @param {number} audioDurationMs - Audio duration in ms
   * @private
   */
  async _transcribe(audio, audioDurationMs) {
    if (this._transcribing) {
      // Already transcribing, skip
      return;
    }

    this._transcribing = true;

    try {
      const result = await this._stt.transcribe(audio);

      if (result.error || isGarbageTranscript(result.text)) {
        this._emptyTranscriptCount++;
        this.emit('empty_transcript', {
          error: result.error || 'EMPTY_TRANSCRIPT',
          audioDurationMs,
          sttDurationMs: result.durationMs
        });
      } else {
        this._transcriptCount++;
        this.emit('transcript', {
          text: result.text,
          audioDurationMs,
          sttDurationMs: result.durationMs
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('error', { type: 'stt', message });
    } finally {
      this._transcribing = false;
    }
  }

  /**
   * Get pipeline statistics
   * @returns {Object}
   */
  getStats() {
    return {
      initialized: this._initialized,
      running: this._running,
      transcribing: this._transcribing,
      transcriptCount: this._transcriptCount,
      emptyTranscriptCount: this._emptyTranscriptCount,
      capture: this._capture.getStats(),
      vad: this._vad.getStats(),
      stt: this._stt.getStats()
    };
  }

  /**
   * Get current state snapshot
   * @returns {Object}
   */
  getSnapshot() {
    return {
      initialized: this._initialized,
      running: this._running,
      transcribing: this._transcribing,
      vad: this._vad.getSnapshot()
    };
  }

  /**
   * Dispose of all resources
   */
  async dispose() {
    this.stop();

    await this._vad.dispose();
    this._stt.dispose();

    this._initialized = false;
    this.removeAllListeners();
  }
}

/**
 * Create a SpeechPipeline instance
 *
 * @param {SpeechPipelineConfig} config - Pipeline configuration
 * @returns {SpeechPipeline}
 */
export function createSpeechPipeline(config) {
  return new SpeechPipeline(config);
}
