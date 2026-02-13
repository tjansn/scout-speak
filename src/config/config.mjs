/**
 * Config - Configuration schema and validation
 *
 * Per algorithm_and_data_structures.md:
 * - Load config from JSON file
 * - Validate all fields per rules
 * - Return clear error messages for invalid config
 * - Provide defaults for optional fields
 * - Enforce localhost-only URL and safe CLI argument handling
 * - FR-10: Config persists across restarts
 */

import { readFile, writeFile, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';

/**
 * @typedef {Object} Config
 * @property {string} gateway_url - OpenClaw gateway URL (localhost only)
 * @property {string} gateway_token - Authentication token for gateway
 * @property {string} stt_model_path - Path to whisper.cpp model
 * @property {string} tts_model_path - Path to Piper TTS voice model
 * @property {string} tts_voice - TTS voice name
 * @property {number} tts_sample_rate - TTS output sample rate
 * @property {string} vad_model_path - Path to Silero VAD model
 * @property {number} sample_rate - Audio capture sample rate
 * @property {number} vad_threshold - VAD speech probability threshold (0.0-1.0)
 * @property {number} silence_duration_ms - Silence duration to end utterance
 * @property {number} min_speech_ms - Minimum speech duration to accept
 * @property {number} buffer_size_ms - Jitter buffer total capacity
 * @property {number} low_watermark_ms - Start playback threshold
 * @property {boolean} wake_word_enabled - Enable wake word activation
 * @property {string} wake_word_phrase - Wake word phrase
 * @property {string} display_mode - Display mode (voice_only|minimal|transcript)
 * @property {boolean} barge_in_enabled - Enable barge-in interruption
 * @property {number} barge_in_cooldown_ms - Barge-in debounce period
 * @property {string} log_level - Log level (debug|info|warn|error)
 * @property {boolean} log_to_file - Enable file logging
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} field - Field name
 * @property {string} message - Error message
 */

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = Object.freeze({
  gateway_url: 'http://localhost:18789',
  gateway_token: '',
  stt_model_path: '',
  tts_model_path: '',
  tts_voice: 'en_US-lessac-medium',
  tts_sample_rate: 22050,
  vad_model_path: '',
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
  log_to_file: false
});

/**
 * Valid display modes
 */
export const DISPLAY_MODES = ['voice_only', 'minimal', 'transcript'];

/**
 * Valid log levels
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

/**
 * Check if a URL is localhost-only
 * @param {string} urlString - URL to check
 * @returns {boolean}
 */
export function isLocalhostUrl(urlString) {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    return host === 'localhost' ||
           host === '127.0.0.1' ||
           host === '[::1]' ||  // IPv6 localhost with brackets
           host === '::1' ||     // IPv6 localhost without brackets
           host.startsWith('127.');
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>}
 */
export async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate configuration object
 * @param {Partial<Config>} config - Configuration to validate
 * @param {object} options - Validation options
 * @param {boolean} [options.checkFilePaths=false] - Check if file paths exist
 * @returns {Promise<ValidationError[]>} Array of validation errors
 */
export async function validateConfig(config, options = {}) {
  const { checkFilePaths = false } = options;
  /** @type {ValidationError[]} */
  const errors = [];

  // Gateway URL validation
  if (config.gateway_url !== undefined) {
    if (typeof config.gateway_url !== 'string') {
      errors.push({ field: 'gateway_url', message: 'Gateway URL must be a string' });
    } else if (!isLocalhostUrl(config.gateway_url)) {
      errors.push({ field: 'gateway_url', message: 'Gateway URL must be localhost only' });
    }
  }

  // Gateway token validation
  if (config.gateway_token !== undefined) {
    if (typeof config.gateway_token !== 'string') {
      errors.push({ field: 'gateway_token', message: 'Gateway token must be a string' });
    }
    // Note: Empty token is allowed - gateway may not require auth
  }

  // STT model path validation
  if (config.stt_model_path !== undefined) {
    if (typeof config.stt_model_path !== 'string') {
      errors.push({ field: 'stt_model_path', message: 'STT model path must be a string' });
    } else if (checkFilePaths && config.stt_model_path && !await fileExists(config.stt_model_path)) {
      errors.push({ field: 'stt_model_path', message: 'STT model not found' });
    }
  }

  // TTS model path validation
  if (config.tts_model_path !== undefined) {
    if (typeof config.tts_model_path !== 'string') {
      errors.push({ field: 'tts_model_path', message: 'TTS model path must be a string' });
    } else if (checkFilePaths && config.tts_model_path && !await fileExists(config.tts_model_path)) {
      errors.push({ field: 'tts_model_path', message: 'TTS model not found' });
    }
  }

  // TTS voice validation
  if (config.tts_voice !== undefined && typeof config.tts_voice !== 'string') {
    errors.push({ field: 'tts_voice', message: 'TTS voice must be a string' });
  }

  // TTS sample rate validation
  if (config.tts_sample_rate !== undefined) {
    if (typeof config.tts_sample_rate !== 'number' || !Number.isInteger(config.tts_sample_rate)) {
      errors.push({ field: 'tts_sample_rate', message: 'TTS sample rate must be an integer' });
    } else if (config.tts_sample_rate < 8000 || config.tts_sample_rate > 48000) {
      errors.push({ field: 'tts_sample_rate', message: 'TTS sample rate must be between 8000 and 48000' });
    }
  }

  // VAD model path validation
  if (config.vad_model_path !== undefined) {
    if (typeof config.vad_model_path !== 'string') {
      errors.push({ field: 'vad_model_path', message: 'VAD model path must be a string' });
    } else if (checkFilePaths && config.vad_model_path && !await fileExists(config.vad_model_path)) {
      errors.push({ field: 'vad_model_path', message: 'VAD model not found' });
    }
  }

  // Sample rate validation
  if (config.sample_rate !== undefined) {
    if (typeof config.sample_rate !== 'number' || !Number.isInteger(config.sample_rate)) {
      errors.push({ field: 'sample_rate', message: 'Sample rate must be an integer' });
    } else if (config.sample_rate < 8000 || config.sample_rate > 48000) {
      errors.push({ field: 'sample_rate', message: 'Sample rate must be between 8000 and 48000' });
    }
  }

  // VAD threshold validation
  if (config.vad_threshold !== undefined) {
    if (typeof config.vad_threshold !== 'number') {
      errors.push({ field: 'vad_threshold', message: 'VAD threshold must be a number' });
    } else if (config.vad_threshold < 0.0 || config.vad_threshold > 1.0) {
      errors.push({ field: 'vad_threshold', message: 'VAD threshold must be 0-1' });
    }
  }

  // Silence duration validation
  if (config.silence_duration_ms !== undefined) {
    if (typeof config.silence_duration_ms !== 'number' || !Number.isInteger(config.silence_duration_ms)) {
      errors.push({ field: 'silence_duration_ms', message: 'Silence duration must be an integer' });
    } else if (config.silence_duration_ms < 100 || config.silence_duration_ms > 5000) {
      errors.push({ field: 'silence_duration_ms', message: 'Silence duration out of range' });
    }
  }

  // Min speech duration validation
  if (config.min_speech_ms !== undefined) {
    if (typeof config.min_speech_ms !== 'number' || !Number.isInteger(config.min_speech_ms)) {
      errors.push({ field: 'min_speech_ms', message: 'Min speech duration must be an integer' });
    } else if (config.min_speech_ms < 0 || config.min_speech_ms > 5000) {
      errors.push({ field: 'min_speech_ms', message: 'Min speech duration out of range' });
    }
  }

  // Buffer size validation
  if (config.buffer_size_ms !== undefined) {
    if (typeof config.buffer_size_ms !== 'number' || !Number.isInteger(config.buffer_size_ms)) {
      errors.push({ field: 'buffer_size_ms', message: 'Buffer size must be an integer' });
    } else if (config.buffer_size_ms < 50 || config.buffer_size_ms > 5000) {
      errors.push({ field: 'buffer_size_ms', message: 'Buffer size out of range' });
    }
  }

  // Low watermark validation
  if (config.low_watermark_ms !== undefined) {
    if (typeof config.low_watermark_ms !== 'number' || !Number.isInteger(config.low_watermark_ms)) {
      errors.push({ field: 'low_watermark_ms', message: 'Low watermark must be an integer' });
    } else if (config.low_watermark_ms < 10 || config.low_watermark_ms > 1000) {
      errors.push({ field: 'low_watermark_ms', message: 'Low watermark out of range' });
    }
  }

  // Wake word enabled validation
  if (config.wake_word_enabled !== undefined && typeof config.wake_word_enabled !== 'boolean') {
    errors.push({ field: 'wake_word_enabled', message: 'Wake word enabled must be a boolean' });
  }

  // Wake word phrase validation
  if (config.wake_word_phrase !== undefined && typeof config.wake_word_phrase !== 'string') {
    errors.push({ field: 'wake_word_phrase', message: 'Wake word phrase must be a string' });
  }

  // Display mode validation
  if (config.display_mode !== undefined) {
    if (typeof config.display_mode !== 'string') {
      errors.push({ field: 'display_mode', message: 'Display mode must be a string' });
    } else if (!DISPLAY_MODES.includes(config.display_mode)) {
      errors.push({ field: 'display_mode', message: `Display mode must be one of: ${DISPLAY_MODES.join(', ')}` });
    }
  }

  // Barge-in enabled validation
  if (config.barge_in_enabled !== undefined && typeof config.barge_in_enabled !== 'boolean') {
    errors.push({ field: 'barge_in_enabled', message: 'Barge-in enabled must be a boolean' });
  }

  // Barge-in cooldown validation
  if (config.barge_in_cooldown_ms !== undefined) {
    if (typeof config.barge_in_cooldown_ms !== 'number' || !Number.isInteger(config.barge_in_cooldown_ms)) {
      errors.push({ field: 'barge_in_cooldown_ms', message: 'Barge-in cooldown must be an integer' });
    } else if (config.barge_in_cooldown_ms < 0 || config.barge_in_cooldown_ms > 2000) {
      errors.push({ field: 'barge_in_cooldown_ms', message: 'Barge-in cooldown out of range' });
    }
  }

  // Log level validation
  if (config.log_level !== undefined) {
    if (typeof config.log_level !== 'string') {
      errors.push({ field: 'log_level', message: 'Log level must be a string' });
    } else if (!LOG_LEVELS.includes(config.log_level)) {
      errors.push({ field: 'log_level', message: `Log level must be one of: ${LOG_LEVELS.join(', ')}` });
    }
  }

  // Log to file validation
  if (config.log_to_file !== undefined && typeof config.log_to_file !== 'boolean') {
    errors.push({ field: 'log_to_file', message: 'Log to file must be a boolean' });
  }

  return errors;
}

/**
 * Load configuration from a JSON file
 * @param {string} filePath - Path to config file
 * @returns {Promise<Config>} Loaded and validated configuration
 * @throws {Error} If file cannot be read or config is invalid
 */
export async function loadConfig(filePath) {
  let fileContent;

  try {
    fileContent = await readFile(filePath, 'utf-8');
  } catch (/** @type {any} */ err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Config file not found: ${filePath}`);
    }
    throw new Error(`Failed to read config file: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw new Error('Config file contains invalid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Config must be a JSON object');
  }

  const errors = await validateConfig(parsed);
  if (errors.length > 0) {
    const messages = errors.map(e => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Config validation failed:\n${messages}`);
  }

  // Merge with defaults
  return { ...DEFAULT_CONFIG, ...parsed };
}

/**
 * Save configuration to a JSON file
 * @param {string} filePath - Path to config file
 * @param {Config} config - Configuration to save
 * @returns {Promise<void>}
 */
export async function saveConfig(filePath, config) {
  const errors = await validateConfig(config);
  if (errors.length > 0) {
    const messages = errors.map(e => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Config validation failed:\n${messages}`);
  }

  const content = JSON.stringify(config, null, 2) + '\n';
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Create a default configuration object
 * @param {Partial<Config>} [overrides={}] - Values to override defaults
 * @returns {Config}
 */
export function createConfig(overrides = {}) {
  return { ...DEFAULT_CONFIG, ...overrides };
}
