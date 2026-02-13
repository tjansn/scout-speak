// @ts-nocheck - Test file uses dynamic data
/**
 * Tests for ErrorMessageHandler
 *
 * Per T038 acceptance criteria:
 * - FR-9: All failure states have clear messages
 * - Messages understandable by tinkerer
 * - No silent failures
 *
 * Test Requirements:
 * - Unit test: each error type
 * - Integration test: error display
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Writable } from 'stream';
import {
  ErrorCode,
  ErrorMessageHandler,
  createErrorMessageHandler,
  createErrorInfo,
  formatErrorForDisplay,
  getErrorType,
  getErrorMessage,
  getErrorSuggestions,
  isRecoverable
} from '../../../src/errors/error-messages.mjs';

/**
 * Create a mock output stream for testing
 * @returns {{stream: Writable, output: string[]}}
 */
function createMockOutput() {
  /** @type {string[]} */
  const output = [];

  const stream = new Writable({
    write(chunk, encoding, callback) {
      output.push(chunk.toString());
      callback();
    }
  });

  return { stream, output };
}

describe('ErrorCode', () => {
  it('should have all connection error codes', () => {
    assert.ok(ErrorCode.OPENCLAW_UNREACHABLE);
    assert.ok(ErrorCode.OPENCLAW_ERROR);
    assert.ok(ErrorCode.CONNECTION_LOST);
    assert.ok(ErrorCode.GATEWAY_TIMEOUT);
  });

  it('should have all audio error codes', () => {
    assert.ok(ErrorCode.MIC_UNAVAILABLE);
    assert.ok(ErrorCode.MIC_PERMISSION_DENIED);
    assert.ok(ErrorCode.SPEAKER_UNAVAILABLE);
    assert.ok(ErrorCode.PULSEAUDIO_NOT_RUNNING);
    assert.ok(ErrorCode.AUDIO_CAPTURE_ERROR);
    assert.ok(ErrorCode.AUDIO_PLAYBACK_ERROR);
  });

  it('should have all STT error codes', () => {
    assert.ok(ErrorCode.STT_EMPTY);
    assert.ok(ErrorCode.STT_GARBAGE);
    assert.ok(ErrorCode.STT_PROCESS_ERROR);
    assert.ok(ErrorCode.WHISPER_NOT_FOUND);
  });

  it('should have all TTS error codes', () => {
    assert.ok(ErrorCode.TTS_FAILED);
    assert.ok(ErrorCode.TTS_PROCESS_ERROR);
    assert.ok(ErrorCode.PIPER_NOT_FOUND);
  });

  it('should have VAD error codes', () => {
    assert.ok(ErrorCode.VAD_MODEL_ERROR);
    assert.ok(ErrorCode.VAD_PROCESS_ERROR);
  });

  it('should have config error codes', () => {
    assert.ok(ErrorCode.CONFIG_INVALID);
    assert.ok(ErrorCode.CONFIG_MISSING);
  });

  it('should have session error codes', () => {
    assert.ok(ErrorCode.SESSION_ERROR);
    assert.ok(ErrorCode.STATE_TRANSITION_ERROR);
  });

  it('should have unknown error code', () => {
    assert.ok(ErrorCode.UNKNOWN_ERROR);
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(ErrorCode));
  });
});

describe('createErrorInfo', () => {
  it('should create error info for known code', () => {
    const error = createErrorInfo(ErrorCode.OPENCLAW_UNREACHABLE);

    assert.strictEqual(error.code, ErrorCode.OPENCLAW_UNREACHABLE);
    assert.strictEqual(error.message, 'Cannot reach OpenClaw');
    assert.strictEqual(error.type, 'connection');
    assert.ok(Array.isArray(error.suggestions));
    assert.ok(error.suggestions.length > 0);
  });

  it('should include details when provided', () => {
    const error = createErrorInfo(ErrorCode.STT_EMPTY, 'Audio was too quiet');

    assert.strictEqual(error.details, 'Audio was too quiet');
  });

  it('should handle unknown error codes', () => {
    const error = createErrorInfo('INVALID_CODE');

    assert.strictEqual(error.message, 'An unexpected error occurred');
    assert.ok(error.suggestions);
  });

  it('should set recoverable flag correctly', () => {
    const recoverableError = createErrorInfo(ErrorCode.STT_EMPTY);
    assert.strictEqual(recoverableError.recoverable, true);

    const fatalError = createErrorInfo(ErrorCode.WHISPER_NOT_FOUND);
    assert.strictEqual(fatalError.recoverable, false);
  });
});

describe('getErrorType', () => {
  it('should return connection for connection errors', () => {
    assert.strictEqual(getErrorType(ErrorCode.OPENCLAW_UNREACHABLE), 'connection');
    assert.strictEqual(getErrorType(ErrorCode.CONNECTION_LOST), 'connection');
    assert.strictEqual(getErrorType(ErrorCode.GATEWAY_TIMEOUT), 'connection');
  });

  it('should return audio for audio errors', () => {
    assert.strictEqual(getErrorType(ErrorCode.MIC_UNAVAILABLE), 'audio');
    assert.strictEqual(getErrorType(ErrorCode.SPEAKER_UNAVAILABLE), 'audio');
    assert.strictEqual(getErrorType(ErrorCode.PULSEAUDIO_NOT_RUNNING), 'audio');
  });

  it('should return stt for STT errors', () => {
    assert.strictEqual(getErrorType(ErrorCode.STT_EMPTY), 'stt');
    assert.strictEqual(getErrorType(ErrorCode.WHISPER_NOT_FOUND), 'stt');
  });

  it('should return tts for TTS errors', () => {
    assert.strictEqual(getErrorType(ErrorCode.TTS_FAILED), 'tts');
    assert.strictEqual(getErrorType(ErrorCode.PIPER_NOT_FOUND), 'tts');
  });

  it('should return vad for VAD errors', () => {
    assert.strictEqual(getErrorType(ErrorCode.VAD_MODEL_ERROR), 'vad');
    assert.strictEqual(getErrorType(ErrorCode.VAD_PROCESS_ERROR), 'vad');
  });

  it('should return config for config errors', () => {
    assert.strictEqual(getErrorType(ErrorCode.CONFIG_INVALID), 'config');
    assert.strictEqual(getErrorType(ErrorCode.CONFIG_MISSING), 'config');
  });

  it('should return session for session errors', () => {
    assert.strictEqual(getErrorType(ErrorCode.SESSION_ERROR), 'session');
    assert.strictEqual(getErrorType(ErrorCode.STATE_TRANSITION_ERROR), 'session');
  });

  it('should return unknown for unknown codes', () => {
    assert.strictEqual(getErrorType('SOMETHING_RANDOM'), 'unknown');
  });
});

describe('formatErrorForDisplay', () => {
  it('should format error with message', () => {
    const error = createErrorInfo(ErrorCode.OPENCLAW_UNREACHABLE);
    const formatted = formatErrorForDisplay(error);

    assert.ok(formatted.includes('[ERROR]'));
    assert.ok(formatted.includes('Cannot reach OpenClaw'));
  });

  it('should include suggestions by default', () => {
    const error = createErrorInfo(ErrorCode.OPENCLAW_UNREACHABLE);
    const formatted = formatErrorForDisplay(error);

    assert.ok(formatted.includes('Suggestions:'));
    assert.ok(formatted.includes('gateway'));
  });

  it('should exclude suggestions when disabled', () => {
    const error = createErrorInfo(ErrorCode.OPENCLAW_UNREACHABLE);
    const formatted = formatErrorForDisplay(error, { includeSuggestions: false });

    assert.ok(!formatted.includes('Suggestions:'));
  });

  it('should include details when enabled', () => {
    const error = createErrorInfo(ErrorCode.STT_EMPTY, 'Audio level was 0.001');
    const formatted = formatErrorForDisplay(error, { includeDetails: true });

    assert.ok(formatted.includes('Details:'));
    assert.ok(formatted.includes('Audio level was 0.001'));
  });

  it('should exclude details by default', () => {
    const error = createErrorInfo(ErrorCode.STT_EMPTY, 'Audio level was 0.001');
    const formatted = formatErrorForDisplay(error);

    assert.ok(!formatted.includes('Details:'));
  });
});

describe('getErrorMessage', () => {
  it('should return message for known codes', () => {
    assert.strictEqual(getErrorMessage(ErrorCode.STT_EMPTY), "Didn't catch that");
    assert.strictEqual(getErrorMessage(ErrorCode.CONNECTION_LOST), 'Connection lost');
  });

  it('should return generic message for unknown codes', () => {
    assert.strictEqual(getErrorMessage('INVALID'), 'An unexpected error occurred');
  });
});

describe('getErrorSuggestions', () => {
  it('should return suggestions array', () => {
    const suggestions = getErrorSuggestions(ErrorCode.PULSEAUDIO_NOT_RUNNING);

    assert.ok(Array.isArray(suggestions));
    assert.ok(suggestions.length > 0);
    assert.ok(suggestions.some(s => s.includes('pulseaudio')));
  });

  it('should return copy of suggestions', () => {
    const suggestions1 = getErrorSuggestions(ErrorCode.STT_EMPTY);
    const suggestions2 = getErrorSuggestions(ErrorCode.STT_EMPTY);

    assert.notStrictEqual(suggestions1, suggestions2);
    assert.deepStrictEqual(suggestions1, suggestions2);
  });
});

describe('isRecoverable', () => {
  it('should return true for recoverable errors', () => {
    assert.strictEqual(isRecoverable(ErrorCode.STT_EMPTY), true);
    assert.strictEqual(isRecoverable(ErrorCode.CONNECTION_LOST), true);
    assert.strictEqual(isRecoverable(ErrorCode.TTS_FAILED), true);
  });

  it('should return false for non-recoverable errors', () => {
    assert.strictEqual(isRecoverable(ErrorCode.WHISPER_NOT_FOUND), false);
    assert.strictEqual(isRecoverable(ErrorCode.CONFIG_MISSING), false);
  });
});

describe('ErrorMessageHandler', () => {
  describe('constructor', () => {
    it('should create with default options', () => {
      const handler = new ErrorMessageHandler();
      assert.ok(handler);
    });

    it('should accept custom output stream', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      assert.ok(handler);
    });

    it('should accept showSuggestions option', () => {
      const handler = new ErrorMessageHandler({ showSuggestions: false });
      assert.ok(handler);
    });
  });

  describe('handleError', () => {
    it('should create and emit error info', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });

      let emittedError = null;
      handler.on('error', (err) => { emittedError = err; });

      const result = handler.handleError(ErrorCode.STT_EMPTY);

      assert.strictEqual(result.code, ErrorCode.STT_EMPTY);
      assert.ok(emittedError);
      assert.strictEqual(emittedError.code, ErrorCode.STT_EMPTY);
    });

    it('should display error to output', () => {
      const { stream, output } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      handler.handleError(ErrorCode.CONNECTION_LOST);

      assert.strictEqual(output.length, 1);
      assert.ok(output[0].includes('Connection lost'));
    });

    it('should record error in history', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      handler.handleError(ErrorCode.STT_EMPTY);
      handler.handleError(ErrorCode.CONNECTION_LOST);

      const history = handler.getErrorHistory();
      assert.strictEqual(history.length, 2);
    });
  });

  describe('handleErrorObject', () => {
    it('should map error object to error code', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      const result = handler.handleErrorObject({
        type: 'connection',
        message: 'Cannot reach OpenClaw'
      });

      assert.strictEqual(result.code, ErrorCode.OPENCLAW_UNREACHABLE);
    });

    it('should handle STT errors', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      const result = handler.handleErrorObject({
        type: 'stt',
        message: 'Empty transcript'
      });

      assert.strictEqual(result.code, ErrorCode.STT_EMPTY);
    });

    it('should handle TTS errors', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      const result = handler.handleErrorObject({
        type: 'tts',
        message: 'TTS failed'
      });

      assert.strictEqual(result.code, ErrorCode.TTS_FAILED);
    });

    it('should fall back to unknown for unrecognized errors', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      const result = handler.handleErrorObject({
        type: 'random',
        message: 'Something weird happened'
      });

      assert.strictEqual(result.code, ErrorCode.UNKNOWN_ERROR);
    });
  });

  describe('getErrorHistory', () => {
    it('should return copy of history', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      handler.handleError(ErrorCode.STT_EMPTY);

      const history1 = handler.getErrorHistory();
      const history2 = handler.getErrorHistory();

      assert.notStrictEqual(history1, history2);
      assert.deepStrictEqual(history1, history2);
    });
  });

  describe('getErrorsByType', () => {
    it('should filter errors by type', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      handler.handleError(ErrorCode.STT_EMPTY);
      handler.handleError(ErrorCode.CONNECTION_LOST);
      handler.handleError(ErrorCode.STT_GARBAGE);

      const sttErrors = handler.getErrorsByType('stt');
      assert.strictEqual(sttErrors.length, 2);
      assert.ok(sttErrors.every(e => e.type === 'stt'));
    });

    it('should respect limit parameter', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      handler.handleError(ErrorCode.STT_EMPTY);
      handler.handleError(ErrorCode.STT_GARBAGE);
      handler.handleError(ErrorCode.STT_EMPTY);

      const sttErrors = handler.getErrorsByType('stt', 2);
      assert.strictEqual(sttErrors.length, 2);
    });
  });

  describe('clearHistory', () => {
    it('should clear all errors', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      handler.handleError(ErrorCode.STT_EMPTY);
      handler.handleError(ErrorCode.CONNECTION_LOST);

      handler.clearHistory();

      assert.strictEqual(handler.getErrorHistory().length, 0);
    });
  });

  describe('hasRecentError', () => {
    it('should return true if error exists in history', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      handler.handleError(ErrorCode.STT_EMPTY);

      assert.strictEqual(handler.hasRecentError(ErrorCode.STT_EMPTY), true);
    });

    it('should return false if error not in history', () => {
      const { stream } = createMockOutput();
      const handler = new ErrorMessageHandler({ output: stream });
      handler.on('error', () => {}); // Prevent unhandled error

      handler.handleError(ErrorCode.STT_EMPTY);

      assert.strictEqual(handler.hasRecentError(ErrorCode.CONNECTION_LOST), false);
    });
  });
});

describe('createErrorMessageHandler', () => {
  it('should create an ErrorMessageHandler instance', () => {
    const handler = createErrorMessageHandler();
    assert.ok(handler instanceof ErrorMessageHandler);
  });

  it('should pass options to constructor', () => {
    const { stream } = createMockOutput();
    const handler = createErrorMessageHandler({ output: stream });
    assert.ok(handler);
  });
});

describe('Error messages per PRD FR-9', () => {
  it('should have message for OpenClaw unreachable', () => {
    const error = createErrorInfo(ErrorCode.OPENCLAW_UNREACHABLE);
    assert.strictEqual(error.message, 'Cannot reach OpenClaw');
  });

  it('should have message for STT empty', () => {
    const error = createErrorInfo(ErrorCode.STT_EMPTY);
    assert.strictEqual(error.message, "Didn't catch that");
  });

  it('should have message for connection lost', () => {
    const error = createErrorInfo(ErrorCode.CONNECTION_LOST);
    assert.strictEqual(error.message, 'Connection lost');
  });

  it('should have message for TTS failed with text fallback suggestion', () => {
    const error = createErrorInfo(ErrorCode.TTS_FAILED);
    assert.ok(error.suggestions.some(s => s.includes('displayed as text')));
  });

  it('should have message for mic permission with explanation', () => {
    const error = createErrorInfo(ErrorCode.MIC_PERMISSION_DENIED);
    assert.ok(error.suggestions.some(s => s.includes('microphone access')));
  });
});
