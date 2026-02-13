/**
 * Streaming TTS - Orchestrates sentence-by-sentence TTS synthesis
 *
 * Per T024 and T027 and specs/system_architecture_and_data_flow.md:
 * - Split response into sentences, synthesize incrementally
 * - First audio plays after first sentence buffer fills
 * - Pipeline: Sentence 1 synthesize -> play, while Sentence 2 synthesizes
 * - Supports interruption (barge-in) - cancel remaining synthesis
 *
 * This module integrates:
 * - TTS (Piper wrapper)
 * - Sentence chunker
 * - Jitter buffer
 * - Audio playback
 */

import { EventEmitter } from 'events';
import { TTS } from './tts.mjs';
import { splitIntoSentences } from './sentence-chunker.mjs';
import { JitterBuffer } from './jitter-buffer.mjs';

/**
 * @typedef {Object} StreamingTTSStats
 * @property {boolean} speaking - Whether currently speaking
 * @property {number} currentSentence - Current sentence index
 * @property {number} totalSentences - Total number of sentences
 * @property {import('./jitter-buffer.mjs').JitterBufferStats} buffer - Jitter buffer stats
 */

/**
 * @typedef {Object} StreamingTTSConfig
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
export const DEFAULT_STREAMING_TTS_CONFIG = Object.freeze({
  modelPath: '',
  sampleRate: 22050,
  bufferSizeMs: 500,
  lowWatermarkMs: 100,
  frameDurationMs: 20,
  minChunkChars: 20
});

/**
 * StreamingTTS - High-level streaming text-to-speech
 */
export class StreamingTTS extends EventEmitter {
  /**
   * Create StreamingTTS instance
   * @param {Partial<StreamingTTSConfig>} [config={}] - Configuration
   */
  constructor(config = {}) {
    super();

    /** @type {StreamingTTSConfig} */
    this.config = { ...DEFAULT_STREAMING_TTS_CONFIG, ...config };

    /** @type {TTS} */
    this._tts = new TTS({
      modelPath: this.config.modelPath,
      sampleRate: this.config.sampleRate
    });

    /** @type {JitterBuffer} */
    this._jitterBuffer = new JitterBuffer({
      bufferSizeMs: this.config.bufferSizeMs,
      lowWatermarkMs: this.config.lowWatermarkMs,
      frameDurationMs: this.config.frameDurationMs,
      sampleRate: this.config.sampleRate
    });

    /** @type {boolean} */
    this._speaking = false;

    /** @type {boolean} */
    this._cancelled = false;

    /** @type {string[]} */
    this._pendingSentences = [];

    /** @type {number} */
    this._currentSentenceIndex = 0;

    // Forward jitter buffer events
    this._jitterBuffer.on('ready', () => this.emit('ready'));
    this._jitterBuffer.on('underrun', (data) => this.emit('underrun', data));
    this._jitterBuffer.on('drained', () => this._onDrained());

    // Forward TTS events
    this._tts.on('warning', (msg) => this.emit('warning', msg));
  }

  /**
   * Check if currently speaking
   * @returns {boolean}
   */
  get speaking() {
    return this._speaking;
  }

  /**
   * Get the jitter buffer (for external playback loop)
   * @returns {JitterBuffer}
   */
  get jitterBuffer() {
    return this._jitterBuffer;
  }

  /**
   * Get sample rate
   * @returns {number}
   */
  get sampleRate() {
    return this.config.sampleRate;
  }

  /**
   * Speak text with streaming synthesis
   *
   * Splits text into sentences and synthesizes them incrementally.
   * Audio chunks are fed to the jitter buffer for smooth playback.
   *
   * @param {string} text - Text to speak
   * @returns {Promise<void>} Resolves when synthesis is complete or cancelled
   */
  async speak(text) {
    if (this._speaking) {
      throw new Error('Already speaking');
    }

    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }

    this._speaking = true;
    this._cancelled = false;
    this._jitterBuffer.reset();

    // Split into sentences
    this._pendingSentences = splitIntoSentences(text, {
      minChunkChars: this.config.minChunkChars
    });

    // If no sentences (text too short), treat whole text as one sentence
    if (this._pendingSentences.length === 0) {
      this._pendingSentences = [text.trim()];
    }

    this._currentSentenceIndex = 0;

    this.emit('speak_started', {
      text,
      sentenceCount: this._pendingSentences.length
    });

    try {
      // Process sentences sequentially
      for (let i = 0; i < this._pendingSentences.length; i++) {
        if (this._cancelled) {
          break;
        }

        this._currentSentenceIndex = i;
        const sentence = this._pendingSentences[i];

        this.emit('sentence_started', {
          index: i,
          sentence,
          total: this._pendingSentences.length
        });

        // Synthesize sentence and feed chunks to jitter buffer
        for await (const chunk of this._tts.synthesize(sentence)) {
          if (this._cancelled) {
            break;
          }
          if (chunk) {
            this._jitterBuffer.write(chunk);
          }
        }

        this.emit('sentence_complete', {
          index: i,
          sentence,
          total: this._pendingSentences.length
        });
      }

      // Signal end of stream if not cancelled
      if (!this._cancelled) {
        this._jitterBuffer.end();
      }

    } catch (error) {
      if (!this._cancelled) {
        this._speaking = false;
        this.emit('error', error);
        throw error;
      }
    }
  }

  /**
   * Stop speaking immediately
   *
   * Cancels any ongoing synthesis and clears the buffer.
   * Used for barge-in functionality.
   */
  stop() {
    if (!this._speaking) {
      return;
    }

    this._cancelled = true;
    this._tts.stop();
    this._jitterBuffer.clear();
    this._speaking = false;
    this._pendingSentences = [];

    this.emit('speak_stopped');
  }

  /**
   * Read a frame from the jitter buffer
   *
   * Call this in a playback loop to get audio frames.
   *
   * @returns {Int16Array} Audio frame
   */
  readFrame() {
    return this._jitterBuffer.read();
  }

  /**
   * Check if jitter buffer is ready for playback
   * @returns {boolean}
   */
  isBufferReady() {
    return this._jitterBuffer.isReady;
  }

  /**
   * Get statistics
   * @returns {StreamingTTSStats}
   */
  getStats() {
    return {
      speaking: this._speaking,
      currentSentence: this._currentSentenceIndex,
      totalSentences: this._pendingSentences.length,
      buffer: this._jitterBuffer.getStats()
    };
  }

  /**
   * Handle jitter buffer drained event
   * @private
   */
  _onDrained() {
    this._speaking = false;
    this.emit('speak_complete');
  }
}

/**
 * Create a StreamingTTS instance
 * @param {Partial<StreamingTTSConfig>} [config={}] - Configuration
 * @returns {StreamingTTS}
 */
export function createStreamingTTS(config = {}) {
  return new StreamingTTS(config);
}
