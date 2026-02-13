/**
 * Audio Test - Microphone and Speaker Test for Setup Wizard
 *
 * Per T037 and PRD FR-7:
 * - Record short audio sample from microphone
 * - Play back recording through speakers
 * - Confirm user can hear the playback
 *
 * This module provides audio hardware verification during first-run setup.
 */

import { EventEmitter } from 'events';
import { AudioCapture } from '../audio/audio-capture.mjs';
import { AudioPlayback } from '../audio/audio-playback.mjs';
import { ensurePulseAudio } from '../audio/pulseaudio.mjs';

/**
 * @typedef {Object} AudioTestConfig
 * @property {number} [recordDurationMs=3000] - Duration to record in milliseconds
 * @property {number} [sampleRate=16000] - Sample rate for recording/playback
 * @property {NodeJS.WritableStream} [output] - Output stream for messages
 */

/**
 * @typedef {Object} AudioTestResult
 * @property {boolean} success - Whether the test completed successfully
 * @property {boolean} micWorking - Whether microphone captured audio
 * @property {boolean} speakerWorking - Whether user confirmed speaker playback
 * @property {string|null} error - Error message if failed
 */

/**
 * @typedef {Object} MicTestResult
 * @property {boolean} success - Whether mic test passed
 * @property {Buffer|null} audioData - Captured audio data
 * @property {number} durationMs - Actual recording duration
 * @property {string|null} error - Error message if failed
 */

/**
 * @typedef {Object} SpeakerTestResult
 * @property {boolean} success - Whether playback completed
 * @property {number} durationMs - Playback duration
 * @property {string|null} error - Error message if failed
 */

/**
 * Default configuration
 */
export const DEFAULT_AUDIO_TEST_CONFIG = Object.freeze({
  recordDurationMs: 3000,
  sampleRate: 16000
});

/**
 * AudioTest - Tests microphone and speaker hardware
 *
 * @extends EventEmitter
 */
export class AudioTest extends EventEmitter {
  /**
   * Create an AudioTest instance
   * @param {Partial<AudioTestConfig>} [config={}] - Configuration options
   */
  constructor(config = {}) {
    super();

    /** @type {AudioTestConfig} */
    this._config = {
      ...DEFAULT_AUDIO_TEST_CONFIG,
      ...config
    };

    /** @type {NodeJS.WritableStream} */
    this._output = config.output || process.stdout;

    /** @type {boolean} */
    this._running = false;

    /** @type {Buffer|null} */
    this._recordedAudio = null;
  }

  /**
   * Check if test is currently running
   * @returns {boolean}
   */
  get isRunning() {
    return this._running;
  }

  /**
   * Get recorded audio buffer
   * @returns {Buffer|null}
   */
  get recordedAudio() {
    return this._recordedAudio;
  }

  /**
   * Write a message to output
   * @param {string} message - Message to write
   * @private
   */
  _writeLine(message) {
    this._output.write(message + '\n');
  }

  /**
   * Check PulseAudio availability
   * @returns {Promise<boolean>}
   */
  async checkPulseAudio() {
    try {
      await ensurePulseAudio();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Test microphone by recording a short audio sample
   * @returns {Promise<MicTestResult>}
   */
  async testMicrophone() {
    if (this._running) {
      return {
        success: false,
        audioData: null,
        durationMs: 0,
        error: 'Test already running'
      };
    }

    this._running = true;
    this.emit('mic_test_started');

    try {
      // Check PulseAudio first
      const pulseAvailable = await this.checkPulseAudio();
      if (!pulseAvailable) {
        this._running = false;
        return {
          success: false,
          audioData: null,
          durationMs: 0,
          error: 'PulseAudio not available'
        };
      }

      const capture = new AudioCapture({
        sampleRate: this._config.sampleRate
      });

      /** @type {Buffer[]} */
      const chunks = [];
      const startTime = Date.now();

      return new Promise((resolve) => {
        // Collect audio chunks
        capture.on('chunk', (/** @type {Int16Array} */ chunk) => {
          const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          chunks.push(buffer);
          this.emit('mic_data', { samples: chunk.length });
        });

        // Handle errors
        capture.on('error', (err) => {
          this._running = false;
          capture.stop();
          resolve({
            success: false,
            audioData: null,
            durationMs: Date.now() - startTime,
            error: err.message || 'Capture error'
          });
        });

        // Start recording
        try {
          capture.start();
        } catch (/** @type {any} */ err) {
          this._running = false;
          resolve({
            success: false,
            audioData: null,
            durationMs: 0,
            error: err.message || 'Failed to start capture'
          });
          return;
        }

        // Stop after duration
        setTimeout(() => {
          capture.stop();
          this._running = false;

          const audioData = Buffer.concat(chunks);
          this._recordedAudio = audioData;

          const durationMs = Date.now() - startTime;
          const hasAudio = audioData.length > 0;

          this.emit('mic_test_complete', {
            success: hasAudio,
            bytes: audioData.length,
            durationMs
          });

          resolve({
            success: hasAudio,
            audioData: hasAudio ? audioData : null,
            durationMs,
            error: hasAudio ? null : 'No audio captured'
          });
        }, this._config.recordDurationMs);
      });

    } catch (/** @type {any} */ err) {
      this._running = false;
      return {
        success: false,
        audioData: null,
        durationMs: 0,
        error: err.message || 'Microphone test failed'
      };
    }
  }

  /**
   * Test speaker by playing back recorded audio
   * @param {Buffer} [audioData] - Audio data to play (uses recorded audio if not provided)
   * @returns {Promise<SpeakerTestResult>}
   */
  async testSpeaker(audioData) {
    const audio = audioData || this._recordedAudio;

    if (!audio || audio.length === 0) {
      return {
        success: false,
        durationMs: 0,
        error: 'No audio data to play'
      };
    }

    if (this._running) {
      return {
        success: false,
        durationMs: 0,
        error: 'Test already running'
      };
    }

    this._running = true;
    this.emit('speaker_test_started');

    try {
      // Check PulseAudio first
      const pulseAvailable = await this.checkPulseAudio();
      if (!pulseAvailable) {
        this._running = false;
        return {
          success: false,
          durationMs: 0,
          error: 'PulseAudio not available'
        };
      }

      const playback = new AudioPlayback({
        sampleRate: this._config.sampleRate
      });

      const startTime = Date.now();

      return new Promise((resolve) => {
        // Handle completion
        playback.on('complete', () => {
          this._running = false;
          const durationMs = Date.now() - startTime;

          this.emit('speaker_test_complete', {
            success: true,
            durationMs
          });

          resolve({
            success: true,
            durationMs,
            error: null
          });
        });

        // Handle stop (barge-in or manual stop)
        playback.on('stopped', () => {
          this._running = false;
          resolve({
            success: true,
            durationMs: Date.now() - startTime,
            error: null
          });
        });

        // Handle errors
        playback.on('error', (err) => {
          this._running = false;
          resolve({
            success: false,
            durationMs: Date.now() - startTime,
            error: err.message || 'Playback error'
          });
        });

        // Start playback
        try {
          playback.start(this._config.sampleRate);
          playback.write(audio);
          playback.end();
        } catch (/** @type {any} */ err) {
          this._running = false;
          resolve({
            success: false,
            durationMs: 0,
            error: err.message || 'Failed to start playback'
          });
        }
      });

    } catch (/** @type {any} */ err) {
      this._running = false;
      return {
        success: false,
        durationMs: 0,
        error: err.message || 'Speaker test failed'
      };
    }
  }

  /**
   * Run the complete audio test (mic + speaker)
   * @param {Object} [options] - Test options
   * @param {boolean} [options.skipMicTest=false] - Skip microphone test
   * @param {boolean} [options.skipSpeakerTest=false] - Skip speaker test
   * @returns {Promise<AudioTestResult>}
   */
  async runFullTest(options = {}) {
    const { skipMicTest = false, skipSpeakerTest = false } = options;

    this.emit('test_started');

    let micWorking = false;
    let speakerWorking = false;

    // Test microphone
    if (!skipMicTest) {
      this._writeLine('\n--- Microphone Test ---');
      this._writeLine('Speak into your microphone now...\n');

      const micResult = await this.testMicrophone();

      if (micResult.success) {
        this._writeLine(`[OK] Microphone captured ${micResult.audioData?.length || 0} bytes\n`);
        micWorking = true;
      } else {
        this._writeLine(`[ERROR] Microphone test failed: ${micResult.error}\n`);
        return {
          success: false,
          micWorking: false,
          speakerWorking: false,
          error: `Microphone test failed: ${micResult.error}`
        };
      }
    } else {
      micWorking = true;
    }

    // Test speaker
    if (!skipSpeakerTest && this._recordedAudio) {
      this._writeLine('--- Speaker Test ---');
      this._writeLine('Playing back your recording...\n');

      const speakerResult = await this.testSpeaker();

      if (speakerResult.success) {
        this._writeLine('[OK] Playback completed\n');
        speakerWorking = true;
      } else {
        this._writeLine(`[ERROR] Speaker test failed: ${speakerResult.error}\n`);
        return {
          success: false,
          micWorking,
          speakerWorking: false,
          error: `Speaker test failed: ${speakerResult.error}`
        };
      }
    } else if (!skipSpeakerTest) {
      this._writeLine('[SKIP] Speaker test skipped (no audio recorded)\n');
    } else {
      speakerWorking = true;
    }

    this.emit('test_complete', {
      micWorking,
      speakerWorking
    });

    return {
      success: micWorking && speakerWorking,
      micWorking,
      speakerWorking,
      error: null
    };
  }

  /**
   * Generate a test tone for speaker testing
   * @param {number} [durationMs=1000] - Tone duration in milliseconds
   * @param {number} [frequency=440] - Tone frequency in Hz
   * @returns {Buffer}
   */
  generateTestTone(durationMs = 1000, frequency = 440) {
    const sampleRate = this._config.sampleRate || 16000;
    const numSamples = Math.floor((durationMs / 1000) * sampleRate);
    const buffer = Buffer.alloc(numSamples * 2); // 16-bit = 2 bytes per sample

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const sample = Math.sin(2 * Math.PI * frequency * t) * 0.5 * 32767;
      buffer.writeInt16LE(Math.round(sample), i * 2);
    }

    return buffer;
  }

  /**
   * Test speaker with a generated tone (no microphone required)
   * @param {number} [durationMs=1000] - Tone duration
   * @param {number} [frequency=440] - Tone frequency
   * @returns {Promise<SpeakerTestResult>}
   */
  async testSpeakerWithTone(durationMs = 1000, frequency = 440) {
    const tone = this.generateTestTone(durationMs, frequency);
    return this.testSpeaker(tone);
  }
}

/**
 * Create an AudioTest instance
 * @param {Partial<AudioTestConfig>} [config={}] - Configuration
 * @returns {AudioTest}
 */
export function createAudioTest(config = {}) {
  return new AudioTest(config);
}

export default AudioTest;
