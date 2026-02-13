/**
 * ConsoleUI - Terminal user interface for Scout
 *
 * Per T043 and PRD FR-12:
 * Renders conversation state to the terminal respecting display mode settings.
 * Connects to SessionManager events and updates the display accordingly.
 *
 * Features:
 * - Real-time status updates during conversation
 * - Display mode-aware rendering (voice_only, minimal, transcript)
 * - Error message display
 * - Conversation history in transcript mode
 */

import { EventEmitter } from 'events';
import { DisplayFormatter } from './display-formatter.mjs';

/**
 * @typedef {import('./display-formatter.mjs').DisplayMode} DisplayMode
 * @typedef {import('../session/session-manager.mjs').SessionManager} SessionManager
 */

/**
 * ANSI color codes for terminal output
 */
export const COLORS = Object.freeze({
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
});

/**
 * Status colors mapping
 * @type {Record<string, string>}
 */
const STATUS_COLORS = {
  idle: COLORS.dim,
  listening: COLORS.green,
  processing: COLORS.yellow,
  speaking: COLORS.blue,
  waiting_for_wakeword: COLORS.magenta
};

/**
 * ConsoleUI - Terminal interface for Scout voice conversations
 *
 * Renders SessionManager state to the terminal, respecting the configured
 * display mode. Provides visual feedback during the conversation lifecycle.
 *
 * @extends EventEmitter
 */
export class ConsoleUI extends EventEmitter {
  /**
   * Create a ConsoleUI instance
   * @param {Object} config - Configuration
   * @param {DisplayMode} [config.displayMode='minimal'] - Initial display mode
   * @param {boolean} [config.colorOutput=true] - Enable ANSI colors
   * @param {boolean} [config.clearOnUpdate=false] - Clear screen on updates
   * @param {NodeJS.WriteStream} [config.outputStream=process.stdout] - Output stream
   */
  constructor(config = {}) {
    super();

    /** @type {boolean} */
    this._colorOutput = config.colorOutput ?? true;

    /** @type {boolean} */
    this._clearOnUpdate = config.clearOnUpdate ?? false;

    /** @type {NodeJS.WriteStream} */
    this._output = config.outputStream ?? process.stdout;

    /** @type {DisplayFormatter} */
    this._formatter = new DisplayFormatter({
      displayMode: config.displayMode ?? 'minimal'
    });

    /** @type {SessionManager|null} */
    this._sessionManager = null;

    /** @type {boolean} */
    this._attached = false;

    // Forward formatter events
    this._formatter.on('mode_changed', (data) => this.emit('mode_changed', data));
  }

  /**
   * Get the current display mode
   * @returns {DisplayMode}
   */
  get displayMode() {
    return this._formatter.displayMode;
  }

  /**
   * Set the display mode
   *
   * Per FR-12: Mode changes take effect immediately
   *
   * @param {DisplayMode} mode - New display mode
   */
  setDisplayMode(mode) {
    this._formatter.setDisplayMode(mode);
    // Re-render with new mode
    if (this._attached) {
      this.render();
    }
  }

  /**
   * Attach to a SessionManager to receive events
   * @param {SessionManager} sessionManager - SessionManager instance
   */
  attach(sessionManager) {
    if (this._attached) {
      this.detach();
    }

    this._sessionManager = sessionManager;
    this._setupEventHandlers();
    this._attached = true;

    // Initialize with current state
    const state = sessionManager.getState();
    this._formatter.setStatus(state.status);

    this.emit('attached');
  }

  /**
   * Detach from the current SessionManager
   */
  detach() {
    if (!this._sessionManager) {
      return;
    }

    this._removeEventHandlers();
    this._sessionManager = null;
    this._attached = false;

    this.emit('detached');
  }

  /**
   * Check if attached to a SessionManager
   * @returns {boolean}
   */
  get isAttached() {
    return this._attached;
  }

  /**
   * Render the current state to the console
   */
  render() {
    if (this._clearOnUpdate) {
      this._clearScreen();
    }

    const output = this._formatter.formatForConsole();
    this._writeLine(this._colorize(output));
  }

  /**
   * Show a status message
   * @param {string} status - Status text
   */
  showStatus(status) {
    const coloredStatus = this._applyStatusColor(status, this._formatter.currentStatus);
    this._writeLine(`[${coloredStatus}]`);
  }

  /**
   * Show an error message
   * @param {string} message - Error message
   */
  showError(message) {
    const colored = this._colorOutput
      ? `${COLORS.red}Error: ${message}${COLORS.reset}`
      : `Error: ${message}`;
    this._writeLine(colored);
  }

  /**
   * Show a transcript entry (user speech)
   * @param {string} text - Transcribed text
   */
  showTranscript(text) {
    // Only show in transcript mode
    if (this._formatter.displayMode !== 'transcript') {
      return;
    }

    const colored = this._colorOutput
      ? `${COLORS.cyan}You: ${text}${COLORS.reset}`
      : `You: ${text}`;
    this._writeLine(colored);
  }

  /**
   * Show an agent response
   * @param {string} text - Response text
   */
  showResponse(text) {
    // Only show in transcript mode
    if (this._formatter.displayMode !== 'transcript') {
      return;
    }

    const colored = this._colorOutput
      ? `${COLORS.green}Agent: ${text}${COLORS.reset}`
      : `Agent: ${text}`;
    this._writeLine(colored);
  }

  /**
   * Show connection status
   * @param {boolean} connected - Whether connected
   */
  showConnectionStatus(connected) {
    const status = connected ? 'Connected' : 'Disconnected';
    const color = connected ? COLORS.green : COLORS.red;
    const colored = this._colorOutput
      ? `${color}[${status}]${COLORS.reset}`
      : `[${status}]`;
    this._writeLine(colored);
  }

  /**
   * Clear the conversation history display
   */
  clearDisplay() {
    this._formatter.clearHistory();
    if (this._clearOnUpdate) {
      this._clearScreen();
    }
    this.emit('display_cleared');
  }

  /**
   * Get stats about the UI
   * @returns {Object}
   */
  getStats() {
    return {
      attached: this._attached,
      displayMode: this._formatter.displayMode,
      colorOutput: this._colorOutput,
      formatterStats: this._formatter.getStats()
    };
  }

  /**
   * Dispose of resources
   */
  dispose() {
    this.detach();
    this._formatter.removeAllListeners();
    this.removeAllListeners();
  }

  /**
   * Set up event handlers for SessionManager
   * @private
   */
  _setupEventHandlers() {
    if (!this._sessionManager) return;

    // Store bound handlers for removal
    this._handlers = {
      state_changed: this._onStateChanged.bind(this),
      transcript: this._onTranscript.bind(this),
      response: this._onResponse.bind(this),
      error: this._onError.bind(this),
      connection_changed: this._onConnectionChanged.bind(this),
      speaking_started: this._onSpeakingStarted.bind(this),
      speaking_complete: this._onSpeakingComplete.bind(this),
      barge_in: this._onBargeIn.bind(this),
      wake_word_detected: this._onWakeWordDetected.bind(this)
    };

    for (const [event, handler] of Object.entries(this._handlers)) {
      this._sessionManager.on(event, handler);
    }
  }

  /**
   * Remove event handlers from SessionManager
   * @private
   */
  _removeEventHandlers() {
    if (!this._sessionManager || !this._handlers) return;

    for (const [event, handler] of Object.entries(this._handlers)) {
      this._sessionManager.off(event, handler);
    }

    this._handlers = null;
  }

  /**
   * Handle state change events
   * @param {{from: string, to: string, reason?: string}} data - State change data
   * @private
   */
  _onStateChanged(data) {
    this._formatter.setStatus(/** @type {import('./display-formatter.mjs').ConversationStatus} */ (data.to));
    this.showStatus(this._formatter.formatStatusIndicator());
    this.emit('state_displayed', data);
  }

  /**
   * Handle transcript events
   * @param {{text: string, audioDurationMs?: number, sttDurationMs?: number}} data - Transcript data
   * @private
   */
  _onTranscript(data) {
    this._formatter.addTranscript(data.text);
    this.showTranscript(data.text);
    this.emit('transcript_displayed', data);
  }

  /**
   * Handle response events
   * @param {{text: string, sessionId?: string}} data - Response data
   * @private
   */
  _onResponse(data) {
    this._formatter.addResponse(data.text);
    this.showResponse(data.text);
    this.emit('response_displayed', data);
  }

  /**
   * Handle error events
   * @param {{type: string, message: string}} data - Error data
   * @private
   */
  _onError(data) {
    this._formatter.setError(data.message);
    this.showError(data.message);
    this.emit('error_displayed', data);
  }

  /**
   * Handle connection change events
   * @param {{connected: boolean}} data - Connection data
   * @private
   */
  _onConnectionChanged(data) {
    this.showConnectionStatus(data.connected);
    this.emit('connection_displayed', data);
  }

  /**
   * Handle speaking started events
   * @param {{text?: string}} data - Speaking data
   * @private
   */
  _onSpeakingStarted(data) {
    // Status already handled by state_changed
    this.emit('speaking_displayed', data);
  }

  /**
   * Handle speaking complete events
   * @private
   */
  _onSpeakingComplete() {
    // Status already handled by state_changed
    this.emit('speaking_complete_displayed');
  }

  /**
   * Handle barge-in events
   * @private
   */
  _onBargeIn() {
    if (this._formatter.displayMode !== 'voice_only') {
      this._writeLine(this._colorOutput
        ? `${COLORS.yellow}[Interrupted]${COLORS.reset}`
        : '[Interrupted]');
    }
    this.emit('barge_in_displayed');
  }

  /**
   * Handle wake word detected events
   * @param {Object} data - Wake word data
   * @private
   */
  _onWakeWordDetected(data) {
    if (this._formatter.displayMode !== 'voice_only') {
      this._writeLine(this._colorOutput
        ? `${COLORS.magenta}[Wake word detected]${COLORS.reset}`
        : '[Wake word detected]');
    }
    this.emit('wake_word_displayed', data);
  }

  /**
   * Apply status color to text
   * @param {string} text - Text to color
   * @param {string} status - Current status
   * @returns {string}
   * @private
   */
  _applyStatusColor(text, status) {
    if (!this._colorOutput) {
      return text;
    }
    const color = STATUS_COLORS[status] ?? COLORS.reset;
    return `${color}${text}${COLORS.reset}`;
  }

  /**
   * Colorize output based on content
   * @param {string} output - Output to colorize
   * @returns {string}
   * @private
   */
  _colorize(output) {
    if (!this._colorOutput) {
      return output;
    }

    // Apply colors to different parts of the output
    return output
      .replace(/^\[(.+?)\]$/m, (_, status) =>
        `[${this._applyStatusColor(status, this._formatter.currentStatus)}]`)
      .replace(/^Error: (.+)$/m, `${COLORS.red}Error: $1${COLORS.reset}`)
      .replace(/^You: (.+)$/m, `${COLORS.cyan}You: $1${COLORS.reset}`)
      .replace(/^Agent: (.+)$/m, `${COLORS.green}Agent: $1${COLORS.reset}`);
  }

  /**
   * Write a line to the output stream
   * @param {string} text - Text to write
   * @private
   */
  _writeLine(text) {
    this._output.write(text + '\n');
  }

  /**
   * Clear the screen
   * @private
   */
  _clearScreen() {
    // ANSI escape sequence to clear screen and move cursor to top
    this._output.write('\x1b[2J\x1b[H');
  }
}

/**
 * Create a ConsoleUI instance
 * @param {Object} [config] - Configuration
 * @returns {ConsoleUI}
 */
export function createConsoleUI(config) {
  return new ConsoleUI(config);
}

export default ConsoleUI;
