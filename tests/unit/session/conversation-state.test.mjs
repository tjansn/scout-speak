/**
 * Tests for ConversationState
 *
 * Per T007 acceptance criteria:
 * - State machine enforces valid transitions
 * - Invalid transitions throw/log error
 * - State changes emit events for observers
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  ConversationState,
  createConversationState
} from '../../../src/session/conversation-state.mjs';

describe('ConversationState', () => {
  /** @type {ConversationState} */
  let state;

  beforeEach(() => {
    state = new ConversationState();
  });

  describe('initial state', () => {
    it('should start in idle state', () => {
      assert.strictEqual(state.status, 'idle');
    });

    it('should have no transcript or response', () => {
      assert.strictEqual(state.lastTranscript, null);
      assert.strictEqual(state.lastResponse, null);
    });

    it('should have no error', () => {
      assert.strictEqual(state.error, null);
    });

    it('should not be connected to OpenClaw initially', () => {
      assert.strictEqual(state.openclawConnected, false);
    });
  });

  describe('valid state transitions', () => {
    it('should allow idle -> listening', () => {
      state.startListening();
      assert.strictEqual(state.status, 'listening');
    });

    it('should allow listening -> processing', () => {
      state.startListening();
      state.startProcessing('Hello');
      assert.strictEqual(state.status, 'processing');
      assert.strictEqual(state.lastTranscript, 'Hello');
    });

    it('should allow processing -> speaking', () => {
      state.startListening();
      state.startProcessing('Hello');
      state.startSpeaking('Hi there!');
      assert.strictEqual(state.status, 'speaking');
      assert.strictEqual(state.lastResponse, 'Hi there!');
    });

    it('should allow speaking -> listening (playback complete)', () => {
      state.startListening();
      state.startProcessing('Hello');
      state.startSpeaking('Hi there!');
      state.playbackComplete();
      assert.strictEqual(state.status, 'listening');
    });

    it('should allow speaking -> listening (barge-in)', () => {
      state.startListening();
      state.startProcessing('Hello');
      state.startSpeaking('Hi there!');
      state.bargeIn();
      assert.strictEqual(state.status, 'listening');
    });

    it('should allow any state -> idle', () => {
      state.startListening();
      state.stop();
      assert.strictEqual(state.status, 'idle');

      state.startListening();
      state.startProcessing('Hello');
      state.stop();
      assert.strictEqual(state.status, 'idle');

      state.startListening();
      state.startProcessing('Hello');
      state.startSpeaking('Hi');
      state.stop();
      assert.strictEqual(state.status, 'idle');
    });
  });

  describe('invalid state transitions', () => {
    it('should throw for idle -> processing', () => {
      assert.throws(
        () => state.startProcessing('Hello'),
        /Invalid state transition: idle -> processing/
      );
    });

    it('should throw for idle -> speaking', () => {
      assert.throws(
        () => state.startSpeaking('Hello'),
        /Invalid state transition: idle -> speaking/
      );
    });

    it('should throw for listening -> speaking (skip processing)', () => {
      state.startListening();
      assert.throws(
        () => state.startSpeaking('Hello'),
        /Invalid state transition: listening -> speaking/
      );
    });
  });

  describe('state change events', () => {
    it('should emit stateChange event on transition', () => {
      /** @type {Array<{from: string, to: string, reason?: string}>} */
      const events = [];
      state.on('stateChange', (event) => events.push(event));

      state.startListening();

      assert.strictEqual(events.length, 1);
      assert.deepStrictEqual(events[0], {
        from: 'idle',
        to: 'listening',
        reason: 'session_started'
      });
    });

    it('should emit events for full conversation cycle', () => {
      /** @type {Array<{from: string, to: string, reason?: string}>} */
      const events = [];
      state.on('stateChange', (event) => events.push(event));

      state.startListening();
      state.startProcessing('Hello');
      state.startSpeaking('Hi there!');
      state.playbackComplete();

      assert.strictEqual(events.length, 4);
      assert.strictEqual(events[0].to, 'listening');
      assert.strictEqual(events[1].to, 'processing');
      assert.strictEqual(events[2].to, 'speaking');
      assert.strictEqual(events[3].to, 'listening');
    });

    it('should not emit event for same state transition', () => {
      state.startListening();

      /** @type {Array<{from: string, to: string}>} */
      const events = [];
      state.on('stateChange', (event) => events.push(event));

      // Try to transition to same state via direct transition
      state.transition('listening');

      assert.strictEqual(events.length, 0);
    });
  });

  describe('error handling', () => {
    it('should set and clear error', () => {
      // Add listener to prevent unhandled error
      state.on('error', () => {});
      state.setError('Test error');
      assert.strictEqual(state.error, 'Test error');

      state.clearError();
      assert.strictEqual(state.error, null);
    });

    it('should emit error event on non-fatal error', () => {
      state.startListening();
      let emittedError = null;
      state.on('error', (err) => { emittedError = err; });

      state.setError('Non-fatal error', false);

      assert.strictEqual(emittedError, 'Non-fatal error');
      assert.strictEqual(state.status, 'listening'); // Should stay in current state
    });

    it('should transition to idle on fatal error', () => {
      state.startListening();
      state.setError('Fatal error', true);

      assert.strictEqual(state.status, 'idle');
      assert.strictEqual(state.error, 'Fatal error');
    });
  });

  describe('OpenClaw connection status', () => {
    it('should update connection status', () => {
      state.setOpenclawConnected(true);
      assert.strictEqual(state.openclawConnected, true);

      state.setOpenclawConnected(false);
      assert.strictEqual(state.openclawConnected, false);
    });

    it('should emit connectionChange event', () => {
      /** @type {boolean[]} */
      const changes = [];
      state.on('connectionChange', (connected) => changes.push(connected));

      state.setOpenclawConnected(true);
      state.setOpenclawConnected(false);
      state.setOpenclawConnected(false); // Same value, no event

      assert.deepStrictEqual(changes, [true, false]);
    });
  });

  describe('session ID', () => {
    it('should set and get session ID', () => {
      state.setSessionId('session-123');
      assert.strictEqual(state.sessionId, 'session-123');
    });

    it('should allow null session ID', () => {
      state.setSessionId('session-123');
      state.setSessionId(null);
      assert.strictEqual(state.sessionId, null);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      state.on('error', () => {}); // Prevent unhandled error
      state.startListening();
      state.startProcessing('Hello');
      state.startSpeaking('Hi');
      state.setError('Some error');
      state.setSessionId('session-123');

      state.reset();

      assert.strictEqual(state.status, 'idle');
      assert.strictEqual(state.lastTranscript, null);
      assert.strictEqual(state.lastResponse, null);
      assert.strictEqual(state.error, null);
      assert.strictEqual(state.sessionId, null);
    });

    it('should preserve connection status on reset', () => {
      state.setOpenclawConnected(true);
      state.startListening();
      state.reset();

      assert.strictEqual(state.openclawConnected, true);
    });

    it('should emit reset event', () => {
      let resetEmitted = false;
      state.on('reset', () => { resetEmitted = true; });

      state.reset();

      assert.strictEqual(resetEmitted, true);
    });
  });

  describe('helper methods', () => {
    it('should correctly report interactive state', () => {
      assert.strictEqual(state.isInteractive(), false);

      state.startListening();
      assert.strictEqual(state.isInteractive(), true);

      state.startProcessing('Hello');
      assert.strictEqual(state.isInteractive(), false);

      state.startSpeaking('Hi');
      assert.strictEqual(state.isInteractive(), true);
    });

    it('should correctly report processing state', () => {
      assert.strictEqual(state.isProcessing(), false);

      state.startListening();
      assert.strictEqual(state.isProcessing(), false);

      state.startProcessing('Hello');
      assert.strictEqual(state.isProcessing(), true);

      state.startSpeaking('Hi');
      assert.strictEqual(state.isProcessing(), false);
    });

    it('should correctly report active state', () => {
      assert.strictEqual(state.isActive(), false);

      state.startListening();
      assert.strictEqual(state.isActive(), true);

      state.stop();
      assert.strictEqual(state.isActive(), false);
    });
  });

  describe('getSnapshot', () => {
    it('should return complete state snapshot', () => {
      state.startListening();
      state.startProcessing('Hello world');
      state.startSpeaking('Hi there!');
      state.setOpenclawConnected(true);
      state.setSessionId('session-xyz');

      const snapshot = state.getSnapshot();

      assert.deepStrictEqual(snapshot, {
        status: 'speaking',
        lastTranscript: 'Hello world',
        lastResponse: 'Hi there!',
        error: null,
        openclawConnected: true,
        sessionId: 'session-xyz'
      });
    });
  });

  describe('createConversationState', () => {
    it('should create a new ConversationState instance', () => {
      const newState = createConversationState();
      assert.ok(newState instanceof ConversationState);
      assert.strictEqual(newState.status, 'idle');
    });
  });
});
