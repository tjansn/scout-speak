/**
 * DisplayFormatter - Format conversation output based on display mode
 *
 * Per T043 and PRD FR-12:
 * - voice_only: Hidden speech/response, icon/indicator only
 * - minimal: Hidden speech/response, text status (Listening/Processing/Speaking)
 * - transcript: Show user speech and agent response, full conversation history
 *
 * This module provides formatting utilities that other components
 * use to render output appropriate to the current display mode.
 */

import { EventEmitter } from 'events';

/**
 * @typedef {'voice_only' | 'minimal' | 'transcript'} DisplayMode
 */

/**
 * @typedef {'idle' | 'listening' | 'processing' | 'speaking' | 'waiting_for_wakeword'} ConversationStatus
 */

/**
 * @typedef {Object} ConversationEntry
 * @property {'user' | 'agent'} role - Who said this
 * @property {string} text - The spoken/response text
 * @property {number} timestamp - When this occurred
 */

/**
 * @typedef {Object} FormattedOutput
 * @property {string} status - Status text for display
 * @property {string|null} transcript - User transcript (null if hidden)
 * @property {string|null} response - Agent response (null if hidden)
 * @property {ConversationEntry[]} history - Conversation history (empty if hidden)
 * @property {boolean} showStatusIndicator - Whether to show status indicator
 */

/**
 * Status icons for voice_only mode (no color, simple ASCII)
 * @type {Record<ConversationStatus, string>}
 */
export const STATUS_ICONS = Object.freeze({
  idle: '○',
  listening: '◉',
  processing: '◐',
  speaking: '◈',
  waiting_for_wakeword: '◇'
});

/**
 * Status text labels for minimal mode
 * @type {Record<ConversationStatus, string>}
 */
export const STATUS_LABELS = Object.freeze({
  idle: 'Idle',
  listening: 'Listening...',
  processing: 'Processing...',
  speaking: 'Speaking...',
  waiting_for_wakeword: 'Say wake word...'
});

/**
 * DisplayFormatter - Formats conversation output based on display mode
 *
 * Per FR-12: Configurable display mode that affects what text appears
 * on screen during conversation.
 *
 * @extends EventEmitter
 */
export class DisplayFormatter extends EventEmitter {
  /**
   * Create a DisplayFormatter instance
   * @param {Object} config - Configuration
   * @param {DisplayMode} [config.displayMode='minimal'] - Initial display mode
   * @param {number} [config.maxHistorySize=100] - Maximum conversation entries to keep
   */
  constructor(config = {}) {
    super();

    /** @type {DisplayMode} */
    this._displayMode = config.displayMode ?? 'minimal';

    /** @type {number} */
    this._maxHistorySize = config.maxHistorySize ?? 100;

    /** @type {ConversationEntry[]} */
    this._history = [];

    /** @type {ConversationStatus} */
    this._currentStatus = 'idle';

    /** @type {string|null} */
    this._lastTranscript = null;

    /** @type {string|null} */
    this._lastResponse = null;

    /** @type {string|null} */
    this._lastError = null;
  }

  /**
   * Get the current display mode
   * @returns {DisplayMode}
   */
  get displayMode() {
    return this._displayMode;
  }

  /**
   * Set the display mode
   *
   * Per FR-12: Mode changes take effect immediately
   *
   * @param {DisplayMode} mode - New display mode
   */
  setDisplayMode(mode) {
    if (!['voice_only', 'minimal', 'transcript'].includes(mode)) {
      throw new Error(`Invalid display mode: ${mode}. Must be one of: voice_only, minimal, transcript`);
    }

    const previousMode = this._displayMode;
    this._displayMode = mode;

    if (previousMode !== mode) {
      this.emit('mode_changed', { from: previousMode, to: mode });
    }
  }

  /**
   * Get current conversation status
   * @returns {ConversationStatus}
   */
  get currentStatus() {
    return this._currentStatus;
  }

  /**
   * Update the conversation status
   * @param {ConversationStatus} status - New status
   */
  setStatus(status) {
    const previousStatus = this._currentStatus;
    this._currentStatus = status;

    if (previousStatus !== status) {
      this.emit('status_changed', { from: previousStatus, to: status });
    }
  }

  /**
   * Record a user transcript
   * @param {string} text - Transcribed user speech
   */
  addTranscript(text) {
    this._lastTranscript = text;

    // Add to history for transcript mode
    this._addToHistory({
      role: 'user',
      text,
      timestamp: Date.now()
    });

    this.emit('transcript_added', { text });
  }

  /**
   * Record an agent response
   * @param {string} text - Agent response text
   */
  addResponse(text) {
    this._lastResponse = text;

    // Add to history for transcript mode
    this._addToHistory({
      role: 'agent',
      text,
      timestamp: Date.now()
    });

    this.emit('response_added', { text });
  }

  /**
   * Set an error message
   * @param {string|null} error - Error message or null to clear
   */
  setError(error) {
    this._lastError = error;
    this.emit('error_changed', { error });
  }

  /**
   * Clear the conversation history
   */
  clearHistory() {
    this._history = [];
    this._lastTranscript = null;
    this._lastResponse = null;
    this._lastError = null;
    this.emit('history_cleared');
  }

  /**
   * Get the formatted output based on current display mode
   *
   * Per FR-12 display mode behaviors:
   * - voice_only: Icon only, no text
   * - minimal: Status text only (Listening/Processing/Speaking)
   * - transcript: Full conversation with user speech and agent response
   *
   * @returns {FormattedOutput}
   */
  getFormattedOutput() {
    switch (this._displayMode) {
    case 'voice_only':
      return this._formatVoiceOnly();
    case 'minimal':
      return this._formatMinimal();
    case 'transcript':
      return this._formatTranscript();
    default:
      return this._formatMinimal();
    }
  }

  /**
   * Format status indicator (icon or text based on mode)
   * @returns {string}
   */
  formatStatusIndicator() {
    switch (this._displayMode) {
    case 'voice_only':
      return STATUS_ICONS[this._currentStatus] ?? STATUS_ICONS.idle;
    case 'minimal':
    case 'transcript':
      return STATUS_LABELS[this._currentStatus] ?? STATUS_LABELS.idle;
    default:
      return STATUS_LABELS[this._currentStatus] ?? STATUS_LABELS.idle;
    }
  }

  /**
   * Format user transcript (respects display mode)
   * @returns {string|null} - Transcript text or null if hidden
   */
  formatTranscript() {
    if (this._displayMode === 'transcript') {
      return this._lastTranscript;
    }
    return null;
  }

  /**
   * Format agent response (respects display mode)
   * @returns {string|null} - Response text or null if hidden
   */
  formatResponse() {
    if (this._displayMode === 'transcript') {
      return this._lastResponse;
    }
    return null;
  }

  /**
   * Format error message (shown in all modes)
   * @returns {string|null}
   */
  formatError() {
    return this._lastError;
  }

  /**
   * Get conversation history (respects display mode)
   * @returns {ConversationEntry[]} - History or empty if mode hides it
   */
  getHistory() {
    if (this._displayMode === 'transcript') {
      return [...this._history];
    }
    return [];
  }

  /**
   * Format output for console display
   *
   * Returns a string suitable for terminal output, respecting the
   * current display mode settings.
   *
   * @returns {string}
   */
  formatForConsole() {
    const lines = [];
    const output = this.getFormattedOutput();

    // Status line
    lines.push(`[${output.status}]`);

    // Error (shown in all modes)
    if (this._lastError) {
      lines.push(`Error: ${this._lastError}`);
    }

    // Transcript mode shows conversation
    if (this._displayMode === 'transcript') {
      if (output.transcript) {
        lines.push(`You: ${output.transcript}`);
      }
      if (output.response) {
        lines.push(`Agent: ${output.response}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get stats about the formatter
   * @returns {Object}
   */
  getStats() {
    return {
      displayMode: this._displayMode,
      currentStatus: this._currentStatus,
      historySize: this._history.length,
      hasError: this._lastError !== null
    };
  }

  /**
   * Format for voice_only mode
   * @returns {FormattedOutput}
   * @private
   */
  _formatVoiceOnly() {
    return {
      status: STATUS_ICONS[this._currentStatus] ?? STATUS_ICONS.idle,
      transcript: null,
      response: null,
      history: [],
      showStatusIndicator: true
    };
  }

  /**
   * Format for minimal mode
   * @returns {FormattedOutput}
   * @private
   */
  _formatMinimal() {
    return {
      status: STATUS_LABELS[this._currentStatus] ?? STATUS_LABELS.idle,
      transcript: null,
      response: null,
      history: [],
      showStatusIndicator: true
    };
  }

  /**
   * Format for transcript mode
   * @returns {FormattedOutput}
   * @private
   */
  _formatTranscript() {
    return {
      status: STATUS_LABELS[this._currentStatus] ?? STATUS_LABELS.idle,
      transcript: this._lastTranscript,
      response: this._lastResponse,
      history: [...this._history],
      showStatusIndicator: true
    };
  }

  /**
   * Add entry to conversation history
   * @param {ConversationEntry} entry - Entry to add
   * @private
   */
  _addToHistory(entry) {
    this._history.push(entry);

    // Trim history if exceeds max size
    if (this._history.length > this._maxHistorySize) {
      this._history = this._history.slice(-this._maxHistorySize);
    }
  }
}

/**
 * Create a DisplayFormatter instance
 * @param {Object} [config] - Configuration
 * @returns {DisplayFormatter}
 */
export function createDisplayFormatter(config) {
  return new DisplayFormatter(config);
}

export default DisplayFormatter;
