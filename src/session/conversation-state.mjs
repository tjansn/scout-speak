/**
 * ConversationState - Voice interaction state machine
 *
 * Per algorithm_and_data_structures.md:
 * - Track current state of voice interaction
 * - Enforce valid state transitions
 * - Emit events on state changes
 *
 * State transitions:
 *   idle -> listening        (session started or playback complete)
 *   listening -> processing  (speech ended, sending to STT/OpenClaw)
 *   processing -> speaking   (response received, TTS started)
 *   speaking -> listening    (playback complete or barge-in)
 *   any -> idle              (session ended or fatal error)
 */

import { EventEmitter } from 'events';

/**
 * @typedef {'idle' | 'waiting_for_wakeword' | 'listening' | 'processing' | 'speaking'} ConversationStatus
 */

/**
 * @typedef {Object} StateChangeEvent
 * @property {ConversationStatus} from - Previous state
 * @property {ConversationStatus} to - New state
 * @property {string} [reason] - Reason for transition
 */

/**
 * Valid state transitions
 * @type {Map<ConversationStatus, ConversationStatus[]>}
 */
const VALID_TRANSITIONS = new Map([
  ['idle', ['listening', 'waiting_for_wakeword']],
  ['waiting_for_wakeword', ['listening', 'idle']], // listening = wake word detected, idle = session end
  ['listening', ['processing', 'idle', 'waiting_for_wakeword']], // waiting_for_wakeword = return to wake word mode after turn
  ['processing', ['speaking', 'listening', 'idle']], // listening = error/retry, idle = fatal
  ['speaking', ['listening', 'idle', 'waiting_for_wakeword']] // waiting_for_wakeword = wake word mode after speaking
]);

/**
 * ConversationState - Manages the voice interaction state machine
 */
export class ConversationState extends EventEmitter {
  constructor() {
    super();

    /** @type {ConversationStatus} */
    this._status = 'idle';

    /** @type {string|null} */
    this._lastTranscript = null;

    /** @type {string|null} */
    this._lastResponse = null;

    /** @type {string|null} */
    this._error = null;

    /** @type {boolean} */
    this._openclawConnected = false;

    /** @type {string|null} */
    this._sessionId = null;
  }

  /**
   * Get current status
   * @returns {ConversationStatus}
   */
  get status() {
    return this._status;
  }

  /**
   * Get last transcript
   * @returns {string|null}
   */
  get lastTranscript() {
    return this._lastTranscript;
  }

  /**
   * Get last response
   * @returns {string|null}
   */
  get lastResponse() {
    return this._lastResponse;
  }

  /**
   * Get current error
   * @returns {string|null}
   */
  get error() {
    return this._error;
  }

  /**
   * Get OpenClaw connection status
   * @returns {boolean}
   */
  get openclawConnected() {
    return this._openclawConnected;
  }

  /**
   * Get session ID
   * @returns {string|null}
   */
  get sessionId() {
    return this._sessionId;
  }

  /**
   * Check if a state transition is valid
   * @param {ConversationStatus} from - Current state
   * @param {ConversationStatus} to - Target state
   * @returns {boolean}
   */
  isValidTransition(from, to) {
    const validTargets = VALID_TRANSITIONS.get(from);
    return validTargets !== undefined && validTargets.includes(to);
  }

  /**
   * Transition to a new state
   * @param {ConversationStatus} newStatus - Target state
   * @param {string} [reason] - Reason for transition
   * @throws {Error} If transition is invalid
   */
  transition(newStatus, reason) {
    const oldStatus = this._status;

    if (oldStatus === newStatus) {
      return; // No-op for same state
    }

    // Special case: any state can transition to idle (session end/fatal error)
    if (newStatus !== 'idle' && !this.isValidTransition(oldStatus, newStatus)) {
      throw new Error(
        `Invalid state transition: ${oldStatus} -> ${newStatus}. ` +
        `Valid transitions from ${oldStatus}: ${VALID_TRANSITIONS.get(oldStatus)?.join(', ') || 'none'}`
      );
    }

    this._status = newStatus;

    // Clear error on successful transitions (except to idle with error)
    if (newStatus !== 'idle') {
      this._error = null;
    }

    /** @type {StateChangeEvent} */
    const event = { from: oldStatus, to: newStatus, reason };
    this.emit('stateChange', event);
  }

  /**
   * Start listening (session start)
   */
  startListening() {
    this.transition('listening', 'session_started');
  }

  /**
   * Start waiting for wake word (FR-11)
   * Used when wake word is enabled to gate listening
   */
  startWaitingForWakeWord() {
    this.transition('waiting_for_wakeword', 'wake_word_mode');
  }

  /**
   * Wake word detected, start listening (FR-11)
   */
  wakeWordDetected() {
    if (this._status === 'waiting_for_wakeword') {
      this.transition('listening', 'wake_word_detected');
    }
  }

  /**
   * Return to waiting for wake word (after turn completion)
   */
  returnToWakeWordMode() {
    this.transition('waiting_for_wakeword', 'turn_complete');
  }

  /**
   * Start processing (speech ended)
   * @param {string} transcript - The transcribed text
   */
  startProcessing(transcript) {
    this._lastTranscript = transcript;
    this.transition('processing', 'speech_ended');
  }

  /**
   * Start speaking (response received)
   * @param {string} response - The response text
   */
  startSpeaking(response) {
    this._lastResponse = response;
    this.transition('speaking', 'response_received');
  }

  /**
   * Handle playback complete
   */
  playbackComplete() {
    this.transition('listening', 'playback_complete');
  }

  /**
   * Handle barge-in (user interrupt)
   */
  bargeIn() {
    if (this._status === 'speaking') {
      this.transition('listening', 'barge_in');
    }
  }

  /**
   * Stop session (return to idle)
   * @param {string} [reason='session_ended'] - Reason for stopping
   */
  stop(reason = 'session_ended') {
    this.transition('idle', reason);
  }

  /**
   * Handle error
   * @param {string} errorMessage - Error message
   * @param {boolean} [fatal=false] - If true, transitions to idle
   */
  setError(errorMessage, fatal = false) {
    this._error = errorMessage;

    if (fatal) {
      this.transition('idle', 'fatal_error');
    } else {
      this.emit('error', errorMessage);
    }
  }

  /**
   * Clear error
   */
  clearError() {
    this._error = null;
    this.emit('errorCleared');
  }

  /**
   * Update OpenClaw connection status
   * @param {boolean} connected
   */
  setOpenclawConnected(connected) {
    const wasConnected = this._openclawConnected;
    this._openclawConnected = connected;

    if (wasConnected !== connected) {
      this.emit('connectionChange', connected);
    }
  }

  /**
   * Set session ID
   * @param {string|null} sessionId
   */
  setSessionId(sessionId) {
    this._sessionId = sessionId;
  }

  /**
   * Reset state for new session
   */
  reset() {
    this._status = 'idle';
    this._lastTranscript = null;
    this._lastResponse = null;
    this._error = null;
    this._sessionId = null;
    // Note: Don't reset openclawConnected - that's connection state, not session state
    this.emit('reset');
  }

  /**
   * Check if currently in a state that allows user interaction
   * @returns {boolean}
   */
  isInteractive() {
    return this._status === 'listening' || this._status === 'speaking';
  }

  /**
   * Check if currently waiting for wake word (FR-11)
   * @returns {boolean}
   */
  isWaitingForWakeWord() {
    return this._status === 'waiting_for_wakeword';
  }

  /**
   * Check if currently processing (STT or OpenClaw call)
   * @returns {boolean}
   */
  isProcessing() {
    return this._status === 'processing';
  }

  /**
   * Check if session is active (not idle)
   * @returns {boolean}
   */
  isActive() {
    return this._status !== 'idle';
  }

  /**
   * Get a snapshot of current state
   * @returns {{status: ConversationStatus, lastTranscript: string|null, lastResponse: string|null, error: string|null, openclawConnected: boolean, sessionId: string|null}}
   */
  getSnapshot() {
    return {
      status: this._status,
      lastTranscript: this._lastTranscript,
      lastResponse: this._lastResponse,
      error: this._error,
      openclawConnected: this._openclawConnected,
      sessionId: this._sessionId
    };
  }
}

/**
 * Create a new ConversationState instance
 * @returns {ConversationState}
 */
export function createConversationState() {
  return new ConversationState();
}
