/**
 * TTS to Playback Pipeline - Wires TTS synthesis to audio playback
 *
 * Per T027 and specs/system_architecture_and_data_flow.md:
 * - TTS.synthesize(text) -> for each chunk: JitterBuffer.write(chunk)
 *    -> when watermark reached: AudioPlayback.start()
 *       -> JitterBuffer.read() -> AudioPlayback.write()
 * - on completion: drain buffer, signal complete
 *
 * Data Flow:
 *   StreamingTTS (sentence chunking + TTS) -> JitterBuffer -> AudioPlayback (pacat)
 *
 * Acceptance Criteria:
 * - Complete text-to-audio pipeline works
 * - Streaming reduces latency
 * - Smooth playback achieved
 * - FR-4: Audio begins within 500ms of synthesis start (after warm-up)
 * - FR-5: Continuous audio with no cuts/glitches
 */

import { EventEmitter } from 'events';
import { StreamingTTS } from './streaming-tts.mjs';
import { AudioPlayback } from '../audio/audio-playback.mjs';

/**
 * @typedef {Object} TtsPlaybackPipelineConfig
 * @property {string} modelPath - Path to Piper .onnx voice model
 * @property {number} sampleRate - TTS output sample rate
 * @property {number} bufferSizeMs - Jitter buffer size
 * @property {number} lowWatermarkMs - Start playback threshold
 * @property {number} frameDurationMs - Playback frame size
 * @property {number} minChunkChars - Minimum chars per sentence chunk
 */

/**
 * Default configuration
 */
export const DEFAULT_TTS_PLAYBACK_CONFIG = Object.freeze({
  modelPath: '',
  sampleRate: 22050,
  bufferSizeMs: 500,
  lowWatermarkMs: 100,
  frameDurationMs: 20,
  minChunkChars: 20
});

/**
 * TtsPlaybackPipeline - Complete text-to-speaker pipeline
 *
 * Orchestrates:
 * - StreamingTTS (sentence chunking + Piper synthesis)
 * - JitterBuffer (smooth audio buffering)
 * - AudioPlayback (PulseAudio pacat output)
 *
 * Events:
 * - 'speaking_started' - Playback has begun
 * - 'speaking_complete' - All audio has been played
 * - 'speaking_stopped' - Playback was interrupted (barge-in)
 * - 'error' - An error occurred
 * - 'ready' - Buffer reached watermark, playback starting
 */
export class TtsPlaybackPipeline extends EventEmitter {
  /**
   * Create TtsPlaybackPipeline instance
   * @param {Partial<TtsPlaybackPipelineConfig>} [config={}] - Configuration
   */
  constructor(config = {}) {
    super();

    /** @type {TtsPlaybackPipelineConfig} */
    this.config = { ...DEFAULT_TTS_PLAYBACK_CONFIG, ...config };

    /** @type {StreamingTTS} */
    this._streamingTts = new StreamingTTS({
      modelPath: this.config.modelPath,
      sampleRate: this.config.sampleRate,
      bufferSizeMs: this.config.bufferSizeMs,
      lowWatermarkMs: this.config.lowWatermarkMs,
      frameDurationMs: this.config.frameDurationMs,
      minChunkChars: this.config.minChunkChars
    });

    /** @type {AudioPlayback} */
    this._audioPlayback = new AudioPlayback({
      sampleRate: this.config.sampleRate,
      channels: 1,
      format: 's16le'
    });

    /** @type {boolean} */
    this._speaking = false;

    /** @type {boolean} */
    this._playbackStarted = false;

    /** @type {NodeJS.Timeout|null} */
    this._playbackInterval = null;

    /** @type {boolean} */
    this._disposed = false;

    this._setupEventHandlers();
  }

  /**
   * Check if currently speaking
   * @returns {boolean}
   */
  get speaking() {
    return this._speaking;
  }

  /**
   * Get the sample rate
   * @returns {number}
   */
  get sampleRate() {
    return this.config.sampleRate;
  }

  /**
   * Get the underlying StreamingTTS instance
   * @returns {StreamingTTS}
   */
  get streamingTts() {
    return this._streamingTts;
  }

  /**
   * Get the underlying AudioPlayback instance
   * @returns {AudioPlayback}
   */
  get audioPlayback() {
    return this._audioPlayback;
  }

  /**
   * Setup event handlers for child components
   * @private
   */
  _setupEventHandlers() {
    // When jitter buffer is ready (has enough audio), start playback
    this._streamingTts.on('ready', () => {
      if (!this._playbackStarted && this._speaking) {
        this._startPlayback();
      }
    });

    // Forward speak events from StreamingTTS
    this._streamingTts.on('speak_started', (data) => {
      this.emit('synthesis_started', data);
    });

    this._streamingTts.on('sentence_started', (data) => {
      this.emit('sentence_started', data);
    });

    this._streamingTts.on('sentence_complete', (data) => {
      this.emit('sentence_complete', data);
    });

    // When StreamingTTS completes, jitter buffer will drain
    this._streamingTts.on('speak_complete', () => {
      this.emit('synthesis_complete');
      // Playback continues until jitter buffer is drained
    });

    // When jitter buffer is fully drained, stop playback
    this._streamingTts.jitterBuffer.on('drained', () => {
      this._onPlaybackComplete();
    });

    // Forward underrun events (useful for debugging)
    this._streamingTts.on('underrun', (data) => {
      this.emit('underrun', data);
    });

    // Forward errors
    this._streamingTts.on('error', (err) => {
      this._handleError(err);
    });

    this._audioPlayback.on('error', (err) => {
      this._handleError(err);
    });

    // Handle audio playback complete (natural end or end() called)
    this._audioPlayback.on('complete', () => {
      // This fires when pacat exits normally - we handle completion via jitter buffer drain
    });

    // Handle audio playback stopped (barge-in via stop())
    this._audioPlayback.on('stopped', () => {
      // Already handled via stop() method
    });
  }

  /**
   * Speak text through the complete pipeline
   *
   * This method:
   * 1. Starts StreamingTTS synthesis (sentence-by-sentence)
   * 2. When jitter buffer reaches watermark, starts AudioPlayback
   * 3. Runs playback loop reading from jitter buffer to audio output
   * 4. Completes when all audio has been played
   *
   * @param {string} text - Text to speak
   * @returns {Promise<void>} Resolves when speaking is complete or stopped
   */
  async speak(text) {
    if (this._disposed) {
      throw new Error('TtsPlaybackPipeline has been disposed');
    }

    if (this._speaking) {
      throw new Error('Already speaking');
    }

    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }

    this._speaking = true;
    this._playbackStarted = false;

    this.emit('speaking_started', { text });

    try {
      // Start synthesis - this feeds the jitter buffer
      // The 'ready' event will trigger _startPlayback()
      await this._streamingTts.speak(text);

      // If playback hasn't started yet (very short text), start it now
      if (!this._playbackStarted && this._streamingTts.jitterBuffer.bufferedSamples > 0) {
        this._startPlayback();
      }

      // Wait for playback to complete (drained event sets _speaking to false)
      await this._waitForPlaybackComplete();

    } catch (error) {
      this._speaking = false;
      this._stopPlayback();
      throw error;
    }
  }

  /**
   * Stop speaking immediately
   *
   * Used for barge-in - stops synthesis and playback immediately.
   */
  stop() {
    if (!this._speaking) {
      return;
    }

    // Stop TTS synthesis
    this._streamingTts.stop();

    // Stop playback loop and audio output
    this._stopPlayback();

    this._speaking = false;
    this._playbackStarted = false;

    this.emit('speaking_stopped');
  }

  /**
   * Start the playback loop
   * @private
   */
  _startPlayback() {
    if (this._playbackStarted) {
      return;
    }

    this._playbackStarted = true;
    this._audioPlayback.start(this.config.sampleRate);

    this.emit('ready');

    // Calculate interval based on frame duration (slightly faster to prevent underruns)
    const intervalMs = Math.max(1, Math.floor(this.config.frameDurationMs * 0.8));

    // Start playback loop
    this._playbackInterval = setInterval(() => {
      this._playbackTick();
    }, intervalMs);
  }

  /**
   * Single tick of the playback loop
   * @private
   */
  _playbackTick() {
    if (!this._speaking || !this._playbackStarted) {
      return;
    }

    const jitterBuffer = this._streamingTts.jitterBuffer;

    // Read frame from jitter buffer (padded with silence if underrun)
    const frame = jitterBuffer.read();

    // Write to audio playback
    if (frame && frame.length > 0) {
      this._audioPlayback.write(frame);
    }
  }

  /**
   * Stop the playback loop and audio output
   * @private
   */
  _stopPlayback() {
    if (this._playbackInterval) {
      clearInterval(this._playbackInterval);
      this._playbackInterval = null;
    }

    if (this._audioPlayback.running) {
      this._audioPlayback.stop();
    }
  }

  /**
   * Handle playback completion (jitter buffer drained)
   * @private
   */
  _onPlaybackComplete() {
    this._stopPlayback();
    this._speaking = false;
    this._playbackStarted = false;

    this.emit('speaking_complete');
  }

  /**
   * Wait for playback to complete
   * @private
   * @returns {Promise<void>}
   */
  _waitForPlaybackComplete() {
    return new Promise((resolve) => {
      if (!this._speaking) {
        resolve();
        return;
      }

      const onComplete = () => {
        this.removeListener('speaking_stopped', onStopped);
        resolve();
      };

      const onStopped = () => {
        this.removeListener('speaking_complete', onComplete);
        resolve();
      };

      this.once('speaking_complete', onComplete);
      this.once('speaking_stopped', onStopped);
    });
  }

  /**
   * Handle errors from child components
   * @private
   * @param {Error} err - The error
   */
  _handleError(err) {
    this._speaking = false;
    this._stopPlayback();
    this.emit('error', err);
  }

  /**
   * @typedef {Object} TtsPlaybackPipelineStats
   * @property {boolean} speaking - Whether currently speaking
   * @property {boolean} playbackStarted - Whether playback has started
   * @property {{speaking: boolean, currentSentence: number, totalSentences: number, buffer: Object}} synthesis - Synthesis stats
   * @property {{running: boolean, bytesWritten: number}} playback - Playback stats
   */

  /**
   * Get statistics
   * @returns {TtsPlaybackPipelineStats}
   */
  getStats() {
    return {
      speaking: this._speaking,
      playbackStarted: this._playbackStarted,
      synthesis: this._streamingTts.getStats(),
      playback: this._audioPlayback.getStats()
    };
  }

  /**
   * Dispose resources
   *
   * Call this when done with the pipeline to clean up.
   */
  dispose() {
    this._disposed = true;
    this.stop();
    this._audioPlayback.removeAllListeners();
    this._streamingTts.removeAllListeners();
    this.removeAllListeners();
  }
}

/**
 * Create a TtsPlaybackPipeline instance
 * @param {Partial<TtsPlaybackPipelineConfig>} [config={}] - Configuration
 * @returns {TtsPlaybackPipeline}
 */
export function createTtsPlaybackPipeline(config = {}) {
  return new TtsPlaybackPipeline(config);
}
