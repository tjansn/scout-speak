// @ts-nocheck - Test file
/**
 * DisplayFormatter Unit Tests
 *
 * Tests the display mode formatting logic per T043 and FR-12:
 * - voice_only: Hidden speech/response, icon only
 * - minimal: Hidden speech/response, text status
 * - transcript: Show full conversation history
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  DisplayFormatter,
  createDisplayFormatter,
  STATUS_ICONS,
  STATUS_LABELS
} from '../../../src/ui/display-formatter.mjs';

/**
 * @typedef {import('../../../src/ui/display-formatter.mjs').ConversationStatus} ConversationStatus
 * @typedef {import('../../../src/ui/display-formatter.mjs').DisplayMode} DisplayMode
 */

describe('DisplayFormatter', () => {
  describe('constructor', () => {
    it('should create with default minimal mode', () => {
      const formatter = new DisplayFormatter();
      assert.strictEqual(formatter.displayMode, 'minimal');
    });

    it('should create with specified display mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      assert.strictEqual(formatter.displayMode, 'transcript');
    });

    it('should create with voice_only mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'voice_only' });
      assert.strictEqual(formatter.displayMode, 'voice_only');
    });

    it('should set initial status to idle', () => {
      const formatter = new DisplayFormatter();
      assert.strictEqual(formatter.currentStatus, 'idle');
    });

    it('should respect maxHistorySize config', () => {
      const formatter = new DisplayFormatter({ maxHistorySize: 50 });
      // Add entries beyond limit
      for (let i = 0; i < 60; i++) {
        formatter.addTranscript(`Message ${i}`);
      }
      formatter.setDisplayMode('transcript');
      const history = formatter.getHistory();
      assert.strictEqual(history.length, 50);
    });
  });

  describe('setDisplayMode', () => {
    it('should change mode to voice_only', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.setDisplayMode('voice_only');
      assert.strictEqual(formatter.displayMode, 'voice_only');
    });

    it('should change mode to minimal', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.setDisplayMode('minimal');
      assert.strictEqual(formatter.displayMode, 'minimal');
    });

    it('should change mode to transcript', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.setDisplayMode('transcript');
      assert.strictEqual(formatter.displayMode, 'transcript');
    });

    it('should emit mode_changed event', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      const onModeChanged = mock.fn();
      formatter.on('mode_changed', onModeChanged);

      formatter.setDisplayMode('transcript');

      assert.strictEqual(onModeChanged.mock.calls.length, 1);
      assert.deepStrictEqual(onModeChanged.mock.calls[0].arguments[0], {
        from: 'minimal',
        to: 'transcript'
      });
    });

    it('should not emit event when mode unchanged', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      const onModeChanged = mock.fn();
      formatter.on('mode_changed', onModeChanged);

      formatter.setDisplayMode('minimal');

      assert.strictEqual(onModeChanged.mock.calls.length, 0);
    });

    it('should reject invalid mode', () => {
      const formatter = new DisplayFormatter();
      assert.throws(() => {
        formatter.setDisplayMode('invalid');
      }, /Invalid display mode/);
    });
  });

  describe('setStatus', () => {
    it('should update current status', () => {
      const formatter = new DisplayFormatter();
      formatter.setStatus('listening');
      assert.strictEqual(formatter.currentStatus, 'listening');
    });

    it('should emit status_changed event', () => {
      const formatter = new DisplayFormatter();
      const onStatusChanged = mock.fn();
      formatter.on('status_changed', onStatusChanged);

      formatter.setStatus('processing');

      assert.strictEqual(onStatusChanged.mock.calls.length, 1);
      assert.deepStrictEqual(onStatusChanged.mock.calls[0].arguments[0], {
        from: 'idle',
        to: 'processing'
      });
    });

    it('should not emit event when status unchanged', () => {
      const formatter = new DisplayFormatter();
      const onStatusChanged = mock.fn();
      formatter.on('status_changed', onStatusChanged);

      formatter.setStatus('idle');

      assert.strictEqual(onStatusChanged.mock.calls.length, 0);
    });

    it('should handle all valid statuses', () => {
      const formatter = new DisplayFormatter();
      const statuses = ['idle', 'listening', 'processing', 'speaking', 'waiting_for_wakeword'];

      for (const status of statuses) {
        formatter.setStatus(status);
        assert.strictEqual(formatter.currentStatus, status);
      }
    });
  });

  describe('addTranscript', () => {
    it('should store transcript text', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addTranscript('Hello world');

      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.transcript, 'Hello world');
    });

    it('should add to history', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addTranscript('Test message');

      const history = formatter.getHistory();
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].role, 'user');
      assert.strictEqual(history[0].text, 'Test message');
    });

    it('should emit transcript_added event', () => {
      const formatter = new DisplayFormatter();
      const onTranscriptAdded = mock.fn();
      formatter.on('transcript_added', onTranscriptAdded);

      formatter.addTranscript('Hello');

      assert.strictEqual(onTranscriptAdded.mock.calls.length, 1);
      assert.deepStrictEqual(onTranscriptAdded.mock.calls[0].arguments[0], {
        text: 'Hello'
      });
    });
  });

  describe('addResponse', () => {
    it('should store response text', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addResponse('Agent response');

      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.response, 'Agent response');
    });

    it('should add to history', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addResponse('Agent response');

      const history = formatter.getHistory();
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].role, 'agent');
      assert.strictEqual(history[0].text, 'Agent response');
    });

    it('should emit response_added event', () => {
      const formatter = new DisplayFormatter();
      const onResponseAdded = mock.fn();
      formatter.on('response_added', onResponseAdded);

      formatter.addResponse('Response');

      assert.strictEqual(onResponseAdded.mock.calls.length, 1);
      assert.deepStrictEqual(onResponseAdded.mock.calls[0].arguments[0], {
        text: 'Response'
      });
    });
  });

  describe('setError', () => {
    it('should store error message', () => {
      const formatter = new DisplayFormatter();
      formatter.setError('Connection lost');
      assert.strictEqual(formatter.formatError(), 'Connection lost');
    });

    it('should allow clearing error with null', () => {
      const formatter = new DisplayFormatter();
      formatter.setError('Error');
      formatter.setError(null);
      assert.strictEqual(formatter.formatError(), null);
    });

    it('should emit error_changed event', () => {
      const formatter = new DisplayFormatter();
      const onErrorChanged = mock.fn();
      formatter.on('error_changed', onErrorChanged);

      formatter.setError('Test error');

      assert.strictEqual(onErrorChanged.mock.calls.length, 1);
      assert.deepStrictEqual(onErrorChanged.mock.calls[0].arguments[0], {
        error: 'Test error'
      });
    });
  });

  describe('clearHistory', () => {
    it('should clear conversation history', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addTranscript('Hello');
      formatter.addResponse('Hi there');

      formatter.clearHistory();

      assert.strictEqual(formatter.getHistory().length, 0);
    });

    it('should clear last transcript and response', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addTranscript('Hello');
      formatter.addResponse('Hi');

      formatter.clearHistory();

      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.transcript, null);
      assert.strictEqual(output.response, null);
    });

    it('should clear error', () => {
      const formatter = new DisplayFormatter();
      formatter.setError('Error');
      formatter.clearHistory();
      assert.strictEqual(formatter.formatError(), null);
    });

    it('should emit history_cleared event', () => {
      const formatter = new DisplayFormatter();
      const onHistoryCleared = mock.fn();
      formatter.on('history_cleared', onHistoryCleared);

      formatter.clearHistory();

      assert.strictEqual(onHistoryCleared.mock.calls.length, 1);
    });
  });

  describe('getFormattedOutput - voice_only mode', () => {
    let formatter;

    beforeEach(() => {
      formatter = new DisplayFormatter({ displayMode: 'voice_only' });
    });

    it('should return icon for status', () => {
      formatter.setStatus('listening');
      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.status, STATUS_ICONS.listening);
    });

    it('should hide transcript', () => {
      formatter.addTranscript('Hello');
      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.transcript, null);
    });

    it('should hide response', () => {
      formatter.addResponse('Response');
      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.response, null);
    });

    it('should return empty history', () => {
      formatter.addTranscript('Hello');
      formatter.addResponse('Hi');
      const output = formatter.getFormattedOutput();
      assert.deepStrictEqual(output.history, []);
    });

    it('should show status indicator', () => {
      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.showStatusIndicator, true);
    });
  });

  describe('getFormattedOutput - minimal mode', () => {
    let formatter;

    beforeEach(() => {
      formatter = new DisplayFormatter({ displayMode: 'minimal' });
    });

    it('should return text label for status', () => {
      formatter.setStatus('listening');
      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.status, STATUS_LABELS.listening);
    });

    it('should hide transcript', () => {
      formatter.addTranscript('Hello');
      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.transcript, null);
    });

    it('should hide response', () => {
      formatter.addResponse('Response');
      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.response, null);
    });

    it('should return empty history', () => {
      formatter.addTranscript('Hello');
      formatter.addResponse('Hi');
      const output = formatter.getFormattedOutput();
      assert.deepStrictEqual(output.history, []);
    });
  });

  describe('getFormattedOutput - transcript mode', () => {
    let formatter;

    beforeEach(() => {
      formatter = new DisplayFormatter({ displayMode: 'transcript' });
    });

    it('should return text label for status', () => {
      formatter.setStatus('speaking');
      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.status, STATUS_LABELS.speaking);
    });

    it('should show transcript', () => {
      formatter.addTranscript('Hello agent');
      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.transcript, 'Hello agent');
    });

    it('should show response', () => {
      formatter.addResponse('Hello user');
      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.response, 'Hello user');
    });

    it('should return conversation history', () => {
      formatter.addTranscript('Hello');
      formatter.addResponse('Hi');

      const output = formatter.getFormattedOutput();
      assert.strictEqual(output.history.length, 2);
      assert.strictEqual(output.history[0].role, 'user');
      assert.strictEqual(output.history[1].role, 'agent');
    });
  });

  describe('formatStatusIndicator', () => {
    it('should return icon in voice_only mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'voice_only' });
      formatter.setStatus('processing');
      assert.strictEqual(formatter.formatStatusIndicator(), STATUS_ICONS.processing);
    });

    it('should return label in minimal mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.setStatus('speaking');
      assert.strictEqual(formatter.formatStatusIndicator(), STATUS_LABELS.speaking);
    });

    it('should return label in transcript mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.setStatus('listening');
      assert.strictEqual(formatter.formatStatusIndicator(), STATUS_LABELS.listening);
    });
  });

  describe('formatTranscript', () => {
    it('should return transcript in transcript mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addTranscript('Test');
      assert.strictEqual(formatter.formatTranscript(), 'Test');
    });

    it('should return null in minimal mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.addTranscript('Test');
      assert.strictEqual(formatter.formatTranscript(), null);
    });

    it('should return null in voice_only mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'voice_only' });
      formatter.addTranscript('Test');
      assert.strictEqual(formatter.formatTranscript(), null);
    });
  });

  describe('formatResponse', () => {
    it('should return response in transcript mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addResponse('Response');
      assert.strictEqual(formatter.formatResponse(), 'Response');
    });

    it('should return null in minimal mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.addResponse('Response');
      assert.strictEqual(formatter.formatResponse(), null);
    });

    it('should return null in voice_only mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'voice_only' });
      formatter.addResponse('Response');
      assert.strictEqual(formatter.formatResponse(), null);
    });
  });

  describe('getHistory', () => {
    it('should return history in transcript mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addTranscript('Hello');
      formatter.addResponse('Hi');

      const history = formatter.getHistory();
      assert.strictEqual(history.length, 2);
    });

    it('should return empty in minimal mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.addTranscript('Hello');
      formatter.addResponse('Hi');

      const history = formatter.getHistory();
      assert.strictEqual(history.length, 0);
    });

    it('should return empty in voice_only mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'voice_only' });
      formatter.addTranscript('Hello');
      formatter.addResponse('Hi');

      const history = formatter.getHistory();
      assert.strictEqual(history.length, 0);
    });

    it('should return a copy of history', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addTranscript('Hello');

      const history1 = formatter.getHistory();
      const history2 = formatter.getHistory();

      assert.notStrictEqual(history1, history2);
      assert.deepStrictEqual(history1, history2);
    });
  });

  describe('formatForConsole', () => {
    it('should include status line', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.setStatus('listening');

      const output = formatter.formatForConsole();
      assert.ok(output.includes('[Listening...]'));
    });

    it('should include error if present', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.setError('Connection lost');

      const output = formatter.formatForConsole();
      assert.ok(output.includes('Error: Connection lost'));
    });

    it('should include transcript in transcript mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addTranscript('Hello');

      const output = formatter.formatForConsole();
      assert.ok(output.includes('You: Hello'));
    });

    it('should include response in transcript mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.addResponse('Hi there');

      const output = formatter.formatForConsole();
      assert.ok(output.includes('Agent: Hi there'));
    });

    it('should not include transcript in minimal mode', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.addTranscript('Hello');

      const output = formatter.formatForConsole();
      assert.ok(!output.includes('You:'));
    });
  });

  describe('getStats', () => {
    it('should return current stats', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.setStatus('speaking');
      formatter.addTranscript('Hello');
      formatter.setError('Test error');

      const stats = formatter.getStats();

      assert.strictEqual(stats.displayMode, 'transcript');
      assert.strictEqual(stats.currentStatus, 'speaking');
      assert.strictEqual(stats.historySize, 1);
      assert.strictEqual(stats.hasError, true);
    });
  });

  describe('STATUS_ICONS', () => {
    it('should have icons for all statuses', () => {
      const expectedStatuses = ['idle', 'listening', 'processing', 'speaking', 'waiting_for_wakeword'];
      for (const status of expectedStatuses) {
        assert.ok(STATUS_ICONS[status], `Missing icon for status: ${status}`);
      }
    });
  });

  describe('STATUS_LABELS', () => {
    it('should have labels for all statuses', () => {
      const expectedStatuses = ['idle', 'listening', 'processing', 'speaking', 'waiting_for_wakeword'];
      for (const status of expectedStatuses) {
        assert.ok(STATUS_LABELS[status], `Missing label for status: ${status}`);
      }
    });
  });

  describe('createDisplayFormatter factory', () => {
    it('should create DisplayFormatter instance', () => {
      const formatter = createDisplayFormatter({ displayMode: 'transcript' });
      assert.ok(formatter instanceof DisplayFormatter);
      assert.strictEqual(formatter.displayMode, 'transcript');
    });

    it('should work with no config', () => {
      const formatter = createDisplayFormatter();
      assert.ok(formatter instanceof DisplayFormatter);
      assert.strictEqual(formatter.displayMode, 'minimal');
    });
  });

  describe('FR-12 Acceptance Criteria', () => {
    it('AC: Settings allow selecting display mode', () => {
      const formatter = new DisplayFormatter();

      // Can set to all three modes
      formatter.setDisplayMode('voice_only');
      assert.strictEqual(formatter.displayMode, 'voice_only');

      formatter.setDisplayMode('minimal');
      assert.strictEqual(formatter.displayMode, 'minimal');

      formatter.setDisplayMode('transcript');
      assert.strictEqual(formatter.displayMode, 'transcript');
    });

    it('AC: Main screen reflects choice - voice_only hides text', () => {
      const formatter = new DisplayFormatter({ displayMode: 'voice_only' });
      formatter.addTranscript('User speech');
      formatter.addResponse('Agent response');

      const output = formatter.getFormattedOutput();

      // Voice only shows icon, hides text
      assert.strictEqual(output.status, STATUS_ICONS.idle);
      assert.strictEqual(output.transcript, null);
      assert.strictEqual(output.response, null);
    });

    it('AC: Main screen reflects choice - minimal shows status only', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.setStatus('listening');
      formatter.addTranscript('User speech');
      formatter.addResponse('Agent response');

      const output = formatter.getFormattedOutput();

      // Minimal shows text status, hides conversation
      assert.strictEqual(output.status, STATUS_LABELS.listening);
      assert.strictEqual(output.transcript, null);
      assert.strictEqual(output.response, null);
    });

    it('AC: Main screen reflects choice - transcript shows all', () => {
      const formatter = new DisplayFormatter({ displayMode: 'transcript' });
      formatter.setStatus('speaking');
      formatter.addTranscript('User speech');
      formatter.addResponse('Agent response');

      const output = formatter.getFormattedOutput();

      // Transcript shows everything
      assert.strictEqual(output.status, STATUS_LABELS.speaking);
      assert.strictEqual(output.transcript, 'User speech');
      assert.strictEqual(output.response, 'Agent response');
      assert.strictEqual(output.history.length, 2);
    });

    it('AC: Mode changes take effect immediately', () => {
      const formatter = new DisplayFormatter({ displayMode: 'minimal' });
      formatter.addTranscript('Hello');

      // Initially hidden
      assert.strictEqual(formatter.formatTranscript(), null);

      // Change mode
      formatter.setDisplayMode('transcript');

      // Immediately visible
      assert.strictEqual(formatter.formatTranscript(), 'Hello');
    });
  });
});
