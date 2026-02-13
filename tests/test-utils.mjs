/**
 * Test utilities for Scout
 *
 * Provides common testing helpers, mock factories, and assertions
 * used across unit and integration tests.
 */

/**
 * @typedef {Object} ScoutConfig
 * @property {string} gateway_url
 * @property {string} gateway_token
 * @property {string} whisper_path
 * @property {string} stt_model_path
 * @property {string} tts_model_path
 * @property {string} tts_voice
 * @property {number} tts_sample_rate
 * @property {string} vad_model_path
 * @property {number} sample_rate
 * @property {number} vad_threshold
 * @property {number} silence_duration_ms
 * @property {number} min_speech_ms
 * @property {number} buffer_size_ms
 * @property {number} low_watermark_ms
 * @property {boolean} wake_word_enabled
 * @property {string} wake_word_phrase
 * @property {string} display_mode
 * @property {boolean} barge_in_enabled
 * @property {number} barge_in_cooldown_ms
 * @property {string} log_level
 * @property {boolean} log_to_file
 */

/**
 * @typedef {Object} MockEventEmitter
 * @property {function(string, Function): void} on
 * @property {function(string, Function): void} off
 * @property {function(string, ...any): void} emit
 * @property {function(string=): void} removeAllListeners
 * @property {function(string): number} getHandlerCount
 */

/**
 * Create a mock AudioBuffer for testing audio processing
 * @param {number} samples - Number of samples to generate
 * @param {number} [fillValue=0] - Value to fill (default 0)
 * @returns {Int16Array}
 */
export function createMockAudioBuffer(samples, fillValue = 0) {
  const buffer = new Int16Array(samples);
  if (fillValue !== 0) {
    buffer.fill(fillValue);
  }
  return buffer;
}

/**
 * Create a mock audio chunk with speech-like pattern
 * @param {number} durationMs - Duration in milliseconds
 * @param {number} [sampleRate=16000] - Sample rate (default 16000)
 * @returns {Int16Array}
 */
export function createMockSpeechAudio(durationMs, sampleRate = 16000) {
  const samples = Math.floor((durationMs / 1000) * sampleRate);
  const buffer = new Int16Array(samples);

  // Generate a simple sine wave to simulate speech
  const frequency = 440; // Hz
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    buffer[i] = Math.floor(Math.sin(2 * Math.PI * frequency * t) * 16000);
  }

  return buffer;
}

/**
 * Create a mock silence audio chunk
 * @param {number} durationMs - Duration in milliseconds
 * @param {number} [sampleRate=16000] - Sample rate (default 16000)
 * @returns {Int16Array}
 */
export function createMockSilenceAudio(durationMs, sampleRate = 16000) {
  const samples = Math.floor((durationMs / 1000) * sampleRate);
  return new Int16Array(samples); // All zeros
}

/**
 * Wait for a specified duration (useful for async tests)
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a mock config for testing
 * @param {Partial<ScoutConfig>} [overrides={}] - Properties to override
 * @returns {ScoutConfig}
 */
export function createMockConfig(overrides = {}) {
  return {
    gateway_url: 'http://localhost:18789',
    gateway_token: 'test-token',
    whisper_path: '/mock/path/to/whisper',
    stt_model_path: '/mock/path/to/whisper.bin',
    tts_model_path: '/mock/path/to/piper.onnx',
    tts_voice: 'en_US-lessac-medium',
    tts_sample_rate: 22050,
    vad_model_path: '/mock/path/to/vad.onnx',
    sample_rate: 16000,
    vad_threshold: 0.5,
    silence_duration_ms: 1200,
    min_speech_ms: 500,
    buffer_size_ms: 500,
    low_watermark_ms: 100,
    wake_word_enabled: false,
    wake_word_phrase: 'hey scout',
    display_mode: 'minimal',
    barge_in_enabled: true,
    barge_in_cooldown_ms: 200,
    log_level: 'info',
    log_to_file: false,
    ...overrides
  };
}

/**
 * Create a mock event emitter for testing event-based components
 * @returns {MockEventEmitter}
 */
export function createMockEventEmitter() {
  /** @type {Map<string, Function[]>} */
  const handlers = new Map();

  return {
    /**
     * @param {string} event
     * @param {Function} handler
     */
    on(event, handler) {
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }
      /** @type {Function[]} */ (handlers.get(event)).push(handler);
    },

    /**
     * @param {string} event
     * @param {Function} handler
     */
    off(event, handler) {
      if (handlers.has(event)) {
        const list = /** @type {Function[]} */ (handlers.get(event));
        const idx = list.indexOf(handler);
        if (idx !== -1) {
          list.splice(idx, 1);
        }
      }
    },

    /**
     * @param {string} event
     * @param {...any} args
     */
    emit(event, ...args) {
      if (handlers.has(event)) {
        /** @type {Function[]} */ (handlers.get(event)).forEach(handler => handler(...args));
      }
    },

    /**
     * @param {string} [event]
     */
    removeAllListeners(event) {
      if (event) {
        handlers.delete(event);
      } else {
        handlers.clear();
      }
    },

    /**
     * @param {string} event
     * @returns {number}
     */
    getHandlerCount(event) {
      return handlers.has(event) ? /** @type {Function[]} */ (handlers.get(event)).length : 0;
    }
  };
}

/**
 * Assert that a function throws with a specific message
 * @param {Function} fn - Function to execute
 * @param {string|RegExp} expectedMessage - Expected error message
 */
export function assertThrows(fn, expectedMessage) {
  let thrown = false;
  let actualMessage = '';

  try {
    fn();
  } catch (/** @type {any} */ error) {
    thrown = true;
    actualMessage = error.message;
  }

  if (!thrown) {
    throw new Error('Expected function to throw, but it did not');
  }

  if (expectedMessage instanceof RegExp) {
    if (!expectedMessage.test(actualMessage)) {
      throw new Error(`Expected error message to match ${expectedMessage}, got: ${actualMessage}`);
    }
  } else if (actualMessage !== expectedMessage) {
    throw new Error(`Expected error message "${expectedMessage}", got: "${actualMessage}"`);
  }
}

/**
 * Assert that an async function throws with a specific message
 * @param {Function} fn - Async function to execute
 * @param {string|RegExp} expectedMessage - Expected error message
 */
export async function assertThrowsAsync(fn, expectedMessage) {
  let thrown = false;
  let actualMessage = '';

  try {
    await fn();
  } catch (/** @type {any} */ error) {
    thrown = true;
    actualMessage = error.message;
  }

  if (!thrown) {
    throw new Error('Expected async function to throw, but it did not');
  }

  if (expectedMessage instanceof RegExp) {
    if (!expectedMessage.test(actualMessage)) {
      throw new Error(`Expected error message to match ${expectedMessage}, got: ${actualMessage}`);
    }
  } else if (actualMessage !== expectedMessage) {
    throw new Error(`Expected error message "${expectedMessage}", got: "${actualMessage}"`);
  }
}
