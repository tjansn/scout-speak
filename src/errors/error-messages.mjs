/**
 * Error Message System
 *
 * Per T038 and PRD FR-9:
 * - All failure states have clear messages
 * - Messages understandable by tinkerer
 * - No silent failures
 *
 * This module provides centralized, user-friendly error messages
 * for all failure scenarios in Scout.
 */

import { EventEmitter } from 'events';

/**
 * @typedef {Object} ErrorInfo
 * @property {string} type - Error category (e.g., 'connection', 'stt', 'tts')
 * @property {string} code - Unique error code (e.g., 'OPENCLAW_UNREACHABLE')
 * @property {string} message - User-friendly error message
 * @property {string} [details] - Technical details for debugging
 * @property {boolean} recoverable - Whether the error can be recovered from
 * @property {string[]} [suggestions] - Suggested actions for the user
 */

/**
 * Error codes for all failure scenarios
 */
export const ErrorCode = Object.freeze({
  // Connection errors
  OPENCLAW_UNREACHABLE: 'OPENCLAW_UNREACHABLE',
  OPENCLAW_ERROR: 'OPENCLAW_ERROR',
  CONNECTION_LOST: 'CONNECTION_LOST',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',

  // Audio errors
  MIC_UNAVAILABLE: 'MIC_UNAVAILABLE',
  MIC_PERMISSION_DENIED: 'MIC_PERMISSION_DENIED',
  SPEAKER_UNAVAILABLE: 'SPEAKER_UNAVAILABLE',
  PULSEAUDIO_NOT_RUNNING: 'PULSEAUDIO_NOT_RUNNING',
  AUDIO_CAPTURE_ERROR: 'AUDIO_CAPTURE_ERROR',
  AUDIO_PLAYBACK_ERROR: 'AUDIO_PLAYBACK_ERROR',

  // STT errors
  STT_EMPTY: 'STT_EMPTY',
  STT_GARBAGE: 'STT_GARBAGE',
  STT_PROCESS_ERROR: 'STT_PROCESS_ERROR',
  WHISPER_NOT_FOUND: 'WHISPER_NOT_FOUND',

  // TTS errors
  TTS_FAILED: 'TTS_FAILED',
  TTS_PROCESS_ERROR: 'TTS_PROCESS_ERROR',
  PIPER_NOT_FOUND: 'PIPER_NOT_FOUND',

  // VAD errors
  VAD_MODEL_ERROR: 'VAD_MODEL_ERROR',
  VAD_PROCESS_ERROR: 'VAD_PROCESS_ERROR',

  // Config errors
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_MISSING: 'CONFIG_MISSING',

  // Session errors
  SESSION_ERROR: 'SESSION_ERROR',
  STATE_TRANSITION_ERROR: 'STATE_TRANSITION_ERROR',

  // General errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
});

/**
 * Error message templates for all error codes
 * @type {Record<string, {message: string, suggestions: string[]}>}
 */
const ERROR_TEMPLATES = {
  [ErrorCode.OPENCLAW_UNREACHABLE]: {
    message: 'Cannot reach OpenClaw',
    suggestions: [
      'Check that the OpenClaw gateway is running',
      'Verify the gateway URL in your configuration',
      'Run: openclaw gateway health'
    ]
  },
  [ErrorCode.OPENCLAW_ERROR]: {
    message: 'OpenClaw returned an error',
    suggestions: [
      'Check the OpenClaw gateway logs',
      'Verify your API key is valid',
      'Try resetting the session'
    ]
  },
  [ErrorCode.CONNECTION_LOST]: {
    message: 'Connection lost',
    suggestions: [
      'Check your network connection',
      'Verify the gateway is still running',
      'Scout will attempt to reconnect automatically'
    ]
  },
  [ErrorCode.GATEWAY_TIMEOUT]: {
    message: 'Gateway connection timed out',
    suggestions: [
      'The gateway may be overloaded',
      'Try again in a moment',
      'Check gateway resource usage'
    ]
  },
  [ErrorCode.MIC_UNAVAILABLE]: {
    message: 'Microphone not available',
    suggestions: [
      'Check that a microphone is connected',
      'Verify PulseAudio is running: pulseaudio --check',
      'List available sources: pactl list sources short'
    ]
  },
  [ErrorCode.MIC_PERMISSION_DENIED]: {
    message: 'Microphone access denied',
    suggestions: [
      'Scout needs microphone access to hear your voice',
      'Check Termux permissions: termux-microphone-record',
      'Grant microphone permission in Android settings'
    ]
  },
  [ErrorCode.SPEAKER_UNAVAILABLE]: {
    message: 'Speaker not available',
    suggestions: [
      'Check that audio output is connected',
      'Verify PulseAudio is running',
      'List available sinks: pactl list sinks short'
    ]
  },
  [ErrorCode.PULSEAUDIO_NOT_RUNNING]: {
    message: 'PulseAudio is not running',
    suggestions: [
      'Start PulseAudio: pulseaudio --start',
      'Check PulseAudio status: pulseaudio --check',
      'Install PulseAudio: pkg install pulseaudio'
    ]
  },
  [ErrorCode.AUDIO_CAPTURE_ERROR]: {
    message: 'Audio capture failed',
    suggestions: [
      'Check microphone connection',
      'Restart PulseAudio: pulseaudio -k && pulseaudio --start',
      'Try running parecord manually'
    ]
  },
  [ErrorCode.AUDIO_PLAYBACK_ERROR]: {
    message: 'Audio playback failed',
    suggestions: [
      'Check speaker connection',
      'Restart PulseAudio',
      'Try running pacat manually'
    ]
  },
  [ErrorCode.STT_EMPTY]: {
    message: "Didn't catch that",
    suggestions: [
      'Please speak clearly',
      'Move closer to the microphone',
      'Reduce background noise'
    ]
  },
  [ErrorCode.STT_GARBAGE]: {
    message: "Didn't catch that",
    suggestions: [
      'Please speak clearly',
      'Try speaking a bit slower',
      'Ensure you are in a quiet environment'
    ]
  },
  [ErrorCode.STT_PROCESS_ERROR]: {
    message: 'Speech recognition failed',
    suggestions: [
      'Check that whisper.cpp is properly installed',
      'Verify the STT model exists',
      'Try running whisper manually'
    ]
  },
  [ErrorCode.WHISPER_NOT_FOUND]: {
    message: 'whisper.cpp not found',
    suggestions: [
      'Install whisper.cpp in your PATH',
      'Set stt_model_path in configuration',
      'See docs for whisper.cpp build instructions'
    ]
  },
  [ErrorCode.TTS_FAILED]: {
    message: 'Text-to-speech failed',
    suggestions: [
      'Check that Piper TTS is installed',
      'Verify the voice model exists',
      'The response will be displayed as text'
    ]
  },
  [ErrorCode.TTS_PROCESS_ERROR]: {
    message: 'TTS process error',
    suggestions: [
      'Restart the session',
      'Check Piper TTS installation',
      'Try running piper manually'
    ]
  },
  [ErrorCode.PIPER_NOT_FOUND]: {
    message: 'Piper TTS not found',
    suggestions: [
      'Install Piper: pip install piper-tts',
      'Set tts_model_path in configuration',
      'See docs for Piper installation'
    ]
  },
  [ErrorCode.VAD_MODEL_ERROR]: {
    message: 'Voice activity detection failed',
    suggestions: [
      'Check that Silero VAD model exists',
      'Set vad_model_path in configuration',
      'Re-download the VAD model'
    ]
  },
  [ErrorCode.VAD_PROCESS_ERROR]: {
    message: 'VAD processing error',
    suggestions: [
      'Restart the session',
      'Check available memory',
      'Verify ONNX runtime installation'
    ]
  },
  [ErrorCode.CONFIG_INVALID]: {
    message: 'Configuration is invalid',
    suggestions: [
      'Run setup wizard to reconfigure',
      'Check config file syntax',
      'Delete config and restart Scout'
    ]
  },
  [ErrorCode.CONFIG_MISSING]: {
    message: 'Configuration not found',
    suggestions: [
      'Run setup wizard to create configuration',
      'Scout will guide you through setup'
    ]
  },
  [ErrorCode.SESSION_ERROR]: {
    message: 'Session error occurred',
    suggestions: [
      'Try restarting the session',
      'Check system resources',
      'Review logs for details'
    ]
  },
  [ErrorCode.STATE_TRANSITION_ERROR]: {
    message: 'Invalid state transition',
    suggestions: [
      'This is a bug - please report it',
      'Try restarting the session'
    ]
  },
  [ErrorCode.UNKNOWN_ERROR]: {
    message: 'An unexpected error occurred',
    suggestions: [
      'Try restarting the session',
      'Check logs for details',
      'Report this issue if it persists'
    ]
  }
};

/**
 * Map error types to recovery status
 * @type {Record<string, boolean>}
 */
const RECOVERABLE_ERRORS = {
  [ErrorCode.OPENCLAW_UNREACHABLE]: true,
  [ErrorCode.OPENCLAW_ERROR]: true,
  [ErrorCode.CONNECTION_LOST]: true,
  [ErrorCode.GATEWAY_TIMEOUT]: true,
  [ErrorCode.STT_EMPTY]: true,
  [ErrorCode.STT_GARBAGE]: true,
  [ErrorCode.TTS_FAILED]: true,
  [ErrorCode.VAD_PROCESS_ERROR]: true,
  [ErrorCode.SESSION_ERROR]: true
};

/**
 * Create an ErrorInfo object from an error code
 * @param {string} code - Error code from ErrorCode
 * @param {string} [details] - Optional technical details
 * @returns {ErrorInfo}
 */
export function createErrorInfo(code, details) {
  const template = ERROR_TEMPLATES[code] || ERROR_TEMPLATES[ErrorCode.UNKNOWN_ERROR];

  return {
    type: getErrorType(code),
    code,
    message: template.message,
    details: details || undefined,
    recoverable: RECOVERABLE_ERRORS[code] || false,
    suggestions: template.suggestions
  };
}

/**
 * Get the error type category from an error code
 * @param {string} code - Error code
 * @returns {string}
 */
export function getErrorType(code) {
  if (code.startsWith('OPENCLAW') || code.startsWith('CONNECTION') || code.startsWith('GATEWAY')) {
    return 'connection';
  }
  if (code.startsWith('MIC') || code.startsWith('SPEAKER') || code.startsWith('AUDIO') || code.startsWith('PULSEAUDIO')) {
    return 'audio';
  }
  if (code.startsWith('STT') || code.startsWith('WHISPER')) {
    return 'stt';
  }
  if (code.startsWith('TTS') || code.startsWith('PIPER')) {
    return 'tts';
  }
  if (code.startsWith('VAD')) {
    return 'vad';
  }
  if (code.startsWith('CONFIG')) {
    return 'config';
  }
  if (code.startsWith('SESSION') || code.startsWith('STATE')) {
    return 'session';
  }
  return 'unknown';
}

/**
 * Format an error for display to the user
 * @param {ErrorInfo} error - Error info object
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.includeSuggestions=true] - Include suggestions
 * @param {boolean} [options.includeDetails=false] - Include technical details
 * @returns {string}
 */
export function formatErrorForDisplay(error, options = {}) {
  const { includeSuggestions = true, includeDetails = false } = options;

  let output = `[ERROR] ${error.message}`;

  if (includeDetails && error.details) {
    output += `\n  Details: ${error.details}`;
  }

  if (includeSuggestions && error.suggestions && error.suggestions.length > 0) {
    output += '\n  Suggestions:';
    for (const suggestion of error.suggestions) {
      output += `\n    - ${suggestion}`;
    }
  }

  return output;
}

/**
 * ErrorMessageHandler - Centralized error message handling
 *
 * @extends EventEmitter
 */
export class ErrorMessageHandler extends EventEmitter {
  /**
   * Create an ErrorMessageHandler instance
   * @param {Object} [options] - Options
   * @param {NodeJS.WritableStream} [options.output] - Output stream for error messages
   * @param {boolean} [options.showSuggestions=true] - Show suggestions by default
   * @param {boolean} [options.showDetails=false] - Show technical details by default
   */
  constructor(options = {}) {
    super();

    /** @type {NodeJS.WritableStream} */
    this._output = options.output || process.stderr;

    /** @type {boolean} */
    this._showSuggestions = options.showSuggestions !== false;

    /** @type {boolean} */
    this._showDetails = options.showDetails || false;

    /** @type {ErrorInfo[]} */
    this._errorHistory = [];

    /** @type {number} */
    this._maxHistorySize = 100;
  }

  /**
   * Handle an error by code
   * @param {string} code - Error code from ErrorCode
   * @param {string} [details] - Optional technical details
   * @returns {ErrorInfo}
   */
  handleError(code, details) {
    const error = createErrorInfo(code, details);
    this._recordError(error);
    this._displayError(error);
    this.emit('error', error);
    return error;
  }

  /**
   * Handle an error from an existing error object
   * @param {Object} errorObj - Error object with type and message
   * @param {string} errorObj.type - Error type
   * @param {string} errorObj.message - Error message
   * @returns {ErrorInfo}
   */
  handleErrorObject(errorObj) {
    // Try to map to a known error code
    const code = this._mapToErrorCode(errorObj);
    return this.handleError(code, errorObj.message);
  }

  /**
   * Map an error object to an error code
   * @param {{type: string, message: string}} errorObj - Error object
   * @returns {string}
   * @private
   */
  _mapToErrorCode(errorObj) {
    const { type, message } = errorObj;
    const lowerMessage = (message || '').toLowerCase();

    // Connection errors
    if (type === 'connection' || lowerMessage.includes('cannot reach')) {
      return ErrorCode.OPENCLAW_UNREACHABLE;
    }
    if (lowerMessage.includes('connection lost') || lowerMessage.includes('disconnected')) {
      return ErrorCode.CONNECTION_LOST;
    }
    if (lowerMessage.includes('timeout')) {
      return ErrorCode.GATEWAY_TIMEOUT;
    }

    // STT errors
    if (type === 'stt') {
      if (lowerMessage.includes('empty') || lowerMessage.includes("didn't catch")) {
        return ErrorCode.STT_EMPTY;
      }
      if (lowerMessage.includes('garbage') || lowerMessage.includes('noise')) {
        return ErrorCode.STT_GARBAGE;
      }
      return ErrorCode.STT_PROCESS_ERROR;
    }

    // TTS errors
    if (type === 'tts' || type === 'tts_speak') {
      if (lowerMessage.includes('not found')) {
        return ErrorCode.PIPER_NOT_FOUND;
      }
      return ErrorCode.TTS_FAILED;
    }

    // VAD errors
    if (type === 'vad') {
      return ErrorCode.VAD_PROCESS_ERROR;
    }

    // Audio errors
    if (type === 'audio_capture') {
      return ErrorCode.AUDIO_CAPTURE_ERROR;
    }
    if (type === 'audio_playback') {
      return ErrorCode.AUDIO_PLAYBACK_ERROR;
    }
    if (lowerMessage.includes('pulseaudio')) {
      return ErrorCode.PULSEAUDIO_NOT_RUNNING;
    }

    // Config errors
    if (type === 'config') {
      if (lowerMessage.includes('missing') || lowerMessage.includes('not found')) {
        return ErrorCode.CONFIG_MISSING;
      }
      return ErrorCode.CONFIG_INVALID;
    }

    // Session errors
    if (type === 'state' || type === 'state_transition') {
      return ErrorCode.STATE_TRANSITION_ERROR;
    }
    if (type === 'session' || type === 'session_error') {
      return ErrorCode.SESSION_ERROR;
    }

    // OpenClaw errors
    if (type === 'openclaw') {
      return ErrorCode.OPENCLAW_ERROR;
    }

    return ErrorCode.UNKNOWN_ERROR;
  }

  /**
   * Record an error in history
   * @param {ErrorInfo} error - Error info
   * @private
   */
  _recordError(error) {
    this._errorHistory.push(error);
    if (this._errorHistory.length > this._maxHistorySize) {
      this._errorHistory.shift();
    }
  }

  /**
   * Display an error to the output stream
   * @param {ErrorInfo} error - Error info
   * @private
   */
  _displayError(error) {
    const formatted = formatErrorForDisplay(error, {
      includeSuggestions: this._showSuggestions,
      includeDetails: this._showDetails
    });
    this._output.write(formatted + '\n');
  }

  /**
   * Get error history
   * @returns {ErrorInfo[]}
   */
  getErrorHistory() {
    return [...this._errorHistory];
  }

  /**
   * Get recent errors of a specific type
   * @param {string} type - Error type
   * @param {number} [limit=10] - Maximum number to return
   * @returns {ErrorInfo[]}
   */
  getErrorsByType(type, limit = 10) {
    return this._errorHistory
      .filter(e => e.type === type)
      .slice(-limit);
  }

  /**
   * Clear error history
   */
  clearHistory() {
    this._errorHistory = [];
  }

  /**
   * Check if a specific error code occurred recently
   * @param {string} code - Error code
   * @param {number} [_withinMs=60000] - Time window in milliseconds (reserved for future use)
   * @returns {boolean}
   */
  hasRecentError(code, _withinMs = 60000) {
    // Note: Would need to add timestamps to errors for this to work properly
    // For now, just check if it's in history (withinMs is reserved for future use)
    return this._errorHistory.some(e => e.code === code);
  }
}

/**
 * Create an ErrorMessageHandler instance
 * @param {Object} [options] - Options
 * @returns {ErrorMessageHandler}
 */
export function createErrorMessageHandler(options) {
  return new ErrorMessageHandler(options);
}

/**
 * Get the user-friendly message for an error code
 * @param {string} code - Error code
 * @returns {string}
 */
export function getErrorMessage(code) {
  const template = ERROR_TEMPLATES[code] || ERROR_TEMPLATES[ErrorCode.UNKNOWN_ERROR];
  return template.message;
}

/**
 * Get suggestions for an error code
 * @param {string} code - Error code
 * @returns {string[]}
 */
export function getErrorSuggestions(code) {
  const template = ERROR_TEMPLATES[code] || ERROR_TEMPLATES[ErrorCode.UNKNOWN_ERROR];
  return [...template.suggestions];
}

/**
 * Check if an error code is recoverable
 * @param {string} code - Error code
 * @returns {boolean}
 */
export function isRecoverable(code) {
  return RECOVERABLE_ERRORS[code] || false;
}

export default ErrorMessageHandler;
