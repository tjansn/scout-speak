// @ts-nocheck - Test file uses mock objects with partial implementations
/**
 * ConsoleUI Unit Tests
 *
 * Tests the console UI rendering and SessionManager integration per T043 and FR-12.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import { ConsoleUI, createConsoleUI, COLORS } from '../../../src/ui/console-ui.mjs';

/**
 * @typedef {Object} MockState
 * @property {string} status
 * @property {string|null} lastTranscript
 * @property {string|null} lastResponse
 * @property {boolean} openclawConnected
 */

/**
 * Mock SessionManager for testing
 */
class MockSessionManager extends EventEmitter {
  constructor() {
    super();
    /** @type {MockState} */
    this._state = {
      status: 'idle',
      lastTranscript: null,
      lastResponse: null,
      openclawConnected: true
    };
  }

  /**
   * @returns {MockState}
   */
  getState() {
    return { ...this._state };
  }

  /**
   * @param {Partial<MockState>} updates
   */
  setState(updates) {
    Object.assign(this._state, updates);
  }
}

/**
 * Mock output stream for capturing console output
 */
class MockOutputStream {
  constructor() {
    /** @type {string[]} */
    this.output = [];
  }

  /**
   * @param {string} data
   * @returns {boolean}
   */
  write(data) {
    this.output.push(data);
    return true;
  }

  /**
   * @returns {string}
   */
  getOutput() {
    return this.output.join('');
  }

  clear() {
    this.output = [];
  }
}

describe('ConsoleUI', () => {
  /** @type {ConsoleUI} */
  let consoleUI;
  /** @type {MockOutputStream} */
  let mockOutput;

  beforeEach(() => {
    mockOutput = new MockOutputStream();
    consoleUI = new ConsoleUI({
      displayMode: 'minimal',
      colorOutput: false,
      outputStream: mockOutput
    });
  });

  describe('constructor', () => {
    it('should create with default settings', () => {
      const ui = new ConsoleUI();
      assert.strictEqual(ui.displayMode, 'minimal');
      assert.strictEqual(ui.isAttached, false);
    });

    it('should accept custom display mode', () => {
      const ui = new ConsoleUI({ displayMode: 'transcript' });
      assert.strictEqual(ui.displayMode, 'transcript');
    });

    it('should accept custom output stream', () => {
      const stream = new MockOutputStream();
      const ui = new ConsoleUI({ outputStream: stream, colorOutput: false });
      ui.showStatus('Test');
      assert.ok(stream.getOutput().includes('Test'));
    });
  });

  describe('setDisplayMode', () => {
    it('should change mode to voice_only', () => {
      consoleUI.setDisplayMode('voice_only');
      assert.strictEqual(consoleUI.displayMode, 'voice_only');
    });

    it('should change mode to minimal', () => {
      consoleUI.setDisplayMode('minimal');
      assert.strictEqual(consoleUI.displayMode, 'minimal');
    });

    it('should change mode to transcript', () => {
      consoleUI.setDisplayMode('transcript');
      assert.strictEqual(consoleUI.displayMode, 'transcript');
    });

    it('should emit mode_changed event', () => {
      const onModeChanged = mock.fn();
      consoleUI.on('mode_changed', onModeChanged);

      consoleUI.setDisplayMode('transcript');

      assert.strictEqual(onModeChanged.mock.calls.length, 1);
      assert.deepStrictEqual(onModeChanged.mock.calls[0].arguments[0], {
        from: 'minimal',
        to: 'transcript'
      });
    });

    it('should reject invalid mode', () => {
      assert.throws(() => {
        consoleUI.setDisplayMode('invalid');
      }, /Invalid display mode/);
    });
  });

  describe('attach', () => {
    it('should attach to SessionManager', () => {
      const sessionManager = new MockSessionManager();
      consoleUI.attach(sessionManager);

      assert.strictEqual(consoleUI.isAttached, true);
    });

    it('should emit attached event', () => {
      const onAttached = mock.fn();
      consoleUI.on('attached', onAttached);

      const sessionManager = new MockSessionManager();
      consoleUI.attach(sessionManager);

      assert.strictEqual(onAttached.mock.calls.length, 1);
    });

    it('should detach from previous SessionManager when re-attaching', () => {
      const session1 = new MockSessionManager();
      const session2 = new MockSessionManager();

      consoleUI.attach(session1);
      consoleUI.attach(session2);

      // Emit from session1 should not affect UI
      session1.emit('state_changed', { from: 'idle', to: 'listening' });

      // Output should only have content from session2 initial state
      // (no 'Listening' from session1)
    });
  });

  describe('detach', () => {
    it('should detach from SessionManager', () => {
      const sessionManager = new MockSessionManager();
      consoleUI.attach(sessionManager);
      consoleUI.detach();

      assert.strictEqual(consoleUI.isAttached, false);
    });

    it('should emit detached event', () => {
      const onDetached = mock.fn();
      consoleUI.on('detached', onDetached);

      const sessionManager = new MockSessionManager();
      consoleUI.attach(sessionManager);
      consoleUI.detach();

      assert.strictEqual(onDetached.mock.calls.length, 1);
    });

    it('should not fail when not attached', () => {
      assert.doesNotThrow(() => {
        consoleUI.detach();
      });
    });
  });

  describe('showStatus', () => {
    it('should write status to output', () => {
      consoleUI.showStatus('Listening...');
      assert.ok(mockOutput.getOutput().includes('[Listening...]'));
    });
  });

  describe('showError', () => {
    it('should write error to output', () => {
      consoleUI.showError('Connection lost');
      assert.ok(mockOutput.getOutput().includes('Error: Connection lost'));
    });

    it('should apply red color when colors enabled', () => {
      const colorUI = new ConsoleUI({
        colorOutput: true,
        outputStream: mockOutput
      });
      colorUI.showError('Test error');
      assert.ok(mockOutput.getOutput().includes(COLORS.red));
    });
  });

  describe('showTranscript', () => {
    it('should show transcript in transcript mode', () => {
      consoleUI.setDisplayMode('transcript');
      consoleUI.showTranscript('Hello world');
      assert.ok(mockOutput.getOutput().includes('You: Hello world'));
    });

    it('should not show transcript in minimal mode', () => {
      consoleUI.setDisplayMode('minimal');
      consoleUI.showTranscript('Hello world');
      assert.ok(!mockOutput.getOutput().includes('You:'));
    });

    it('should not show transcript in voice_only mode', () => {
      consoleUI.setDisplayMode('voice_only');
      consoleUI.showTranscript('Hello world');
      assert.ok(!mockOutput.getOutput().includes('You:'));
    });
  });

  describe('showResponse', () => {
    it('should show response in transcript mode', () => {
      consoleUI.setDisplayMode('transcript');
      consoleUI.showResponse('Agent response');
      assert.ok(mockOutput.getOutput().includes('Agent: Agent response'));
    });

    it('should not show response in minimal mode', () => {
      consoleUI.setDisplayMode('minimal');
      consoleUI.showResponse('Agent response');
      assert.ok(!mockOutput.getOutput().includes('Agent:'));
    });

    it('should not show response in voice_only mode', () => {
      consoleUI.setDisplayMode('voice_only');
      consoleUI.showResponse('Agent response');
      assert.ok(!mockOutput.getOutput().includes('Agent:'));
    });
  });

  describe('showConnectionStatus', () => {
    it('should show Connected when connected', () => {
      consoleUI.showConnectionStatus(true);
      assert.ok(mockOutput.getOutput().includes('[Connected]'));
    });

    it('should show Disconnected when not connected', () => {
      consoleUI.showConnectionStatus(false);
      assert.ok(mockOutput.getOutput().includes('[Disconnected]'));
    });
  });

  describe('clearDisplay', () => {
    it('should emit display_cleared event', () => {
      const onCleared = mock.fn();
      consoleUI.on('display_cleared', onCleared);

      consoleUI.clearDisplay();

      assert.strictEqual(onCleared.mock.calls.length, 1);
    });
  });

  describe('getStats', () => {
    it('should return current stats', () => {
      consoleUI.setDisplayMode('transcript');

      const stats = consoleUI.getStats();

      assert.strictEqual(stats.attached, false);
      assert.strictEqual(stats.displayMode, 'transcript');
      assert.strictEqual(stats.colorOutput, false);
      assert.ok(stats.formatterStats);
    });
  });

  describe('dispose', () => {
    it('should detach from SessionManager', () => {
      const sessionManager = new MockSessionManager();
      consoleUI.attach(sessionManager);
      consoleUI.dispose();

      assert.strictEqual(consoleUI.isAttached, false);
    });
  });

  describe('SessionManager event handling', () => {
    let sessionManager;

    beforeEach(() => {
      sessionManager = new MockSessionManager();
      consoleUI.attach(sessionManager);
      mockOutput.clear();
    });

    it('should handle state_changed events', () => {
      const onStateDisplayed = mock.fn();
      consoleUI.on('state_displayed', onStateDisplayed);

      sessionManager.emit('state_changed', { from: 'idle', to: 'listening' });

      assert.ok(mockOutput.getOutput().includes('[Listening...]'));
      assert.strictEqual(onStateDisplayed.mock.calls.length, 1);
    });

    it('should handle transcript events in transcript mode', () => {
      consoleUI.setDisplayMode('transcript');
      mockOutput.clear();

      const onTranscriptDisplayed = mock.fn();
      consoleUI.on('transcript_displayed', onTranscriptDisplayed);

      sessionManager.emit('transcript', { text: 'Hello agent' });

      assert.ok(mockOutput.getOutput().includes('You: Hello agent'));
      assert.strictEqual(onTranscriptDisplayed.mock.calls.length, 1);
    });

    it('should handle response events in transcript mode', () => {
      consoleUI.setDisplayMode('transcript');
      mockOutput.clear();

      const onResponseDisplayed = mock.fn();
      consoleUI.on('response_displayed', onResponseDisplayed);

      sessionManager.emit('response', { text: 'Hello user' });

      assert.ok(mockOutput.getOutput().includes('Agent: Hello user'));
      assert.strictEqual(onResponseDisplayed.mock.calls.length, 1);
    });

    it('should handle error events', () => {
      const onErrorDisplayed = mock.fn();
      consoleUI.on('error_displayed', onErrorDisplayed);

      sessionManager.emit('error', { type: 'connection', message: 'Connection lost' });

      assert.ok(mockOutput.getOutput().includes('Error: Connection lost'));
      assert.strictEqual(onErrorDisplayed.mock.calls.length, 1);
    });

    it('should handle connection_changed events', () => {
      const onConnectionDisplayed = mock.fn();
      consoleUI.on('connection_displayed', onConnectionDisplayed);

      sessionManager.emit('connection_changed', { connected: false });

      assert.ok(mockOutput.getOutput().includes('[Disconnected]'));
      assert.strictEqual(onConnectionDisplayed.mock.calls.length, 1);
    });

    it('should handle speaking_started events', () => {
      const onSpeakingDisplayed = mock.fn();
      consoleUI.on('speaking_displayed', onSpeakingDisplayed);

      sessionManager.emit('speaking_started', { text: 'Response' });

      assert.strictEqual(onSpeakingDisplayed.mock.calls.length, 1);
    });

    it('should handle speaking_complete events', () => {
      const onCompleteDisplayed = mock.fn();
      consoleUI.on('speaking_complete_displayed', onCompleteDisplayed);

      sessionManager.emit('speaking_complete');

      assert.strictEqual(onCompleteDisplayed.mock.calls.length, 1);
    });

    it('should handle barge_in events', () => {
      const onBargeInDisplayed = mock.fn();
      consoleUI.on('barge_in_displayed', onBargeInDisplayed);

      sessionManager.emit('barge_in');

      assert.ok(mockOutput.getOutput().includes('[Interrupted]'));
      assert.strictEqual(onBargeInDisplayed.mock.calls.length, 1);
    });

    it('should handle wake_word_detected events', () => {
      const onWakeWordDisplayed = mock.fn();
      consoleUI.on('wake_word_displayed', onWakeWordDisplayed);

      sessionManager.emit('wake_word_detected', { phrase: 'hey scout' });

      assert.ok(mockOutput.getOutput().includes('[Wake word detected]'));
      assert.strictEqual(onWakeWordDisplayed.mock.calls.length, 1);
    });
  });

  describe('Color output', () => {
    let colorUI;
    let colorOutput;

    beforeEach(() => {
      colorOutput = new MockOutputStream();
      colorUI = new ConsoleUI({
        displayMode: 'minimal',
        colorOutput: true,
        outputStream: colorOutput
      });
    });

    it('should apply colors to error output', () => {
      colorUI.showError('Test error');
      const output = colorOutput.getOutput();
      assert.ok(output.includes(COLORS.red));
      assert.ok(output.includes(COLORS.reset));
    });

    it('should apply colors to connection status', () => {
      colorUI.showConnectionStatus(true);
      const output = colorOutput.getOutput();
      assert.ok(output.includes(COLORS.green));
    });

    it('should apply colors to disconnected status', () => {
      colorUI.showConnectionStatus(false);
      const output = colorOutput.getOutput();
      assert.ok(output.includes(COLORS.red));
    });

    it('should apply colors to transcript in transcript mode', () => {
      colorUI.setDisplayMode('transcript');
      colorOutput.clear();
      colorUI.showTranscript('Hello');
      const output = colorOutput.getOutput();
      assert.ok(output.includes(COLORS.cyan));
    });

    it('should apply colors to response in transcript mode', () => {
      colorUI.setDisplayMode('transcript');
      colorOutput.clear();
      colorUI.showResponse('Hello');
      const output = colorOutput.getOutput();
      assert.ok(output.includes(COLORS.green));
    });
  });

  describe('createConsoleUI factory', () => {
    it('should create ConsoleUI instance', () => {
      const ui = createConsoleUI({ displayMode: 'transcript' });
      assert.ok(ui instanceof ConsoleUI);
      assert.strictEqual(ui.displayMode, 'transcript');
    });

    it('should work with no config', () => {
      const ui = createConsoleUI();
      assert.ok(ui instanceof ConsoleUI);
      assert.strictEqual(ui.displayMode, 'minimal');
    });
  });

  describe('FR-12 Integration', () => {
    let sessionManager;

    beforeEach(() => {
      sessionManager = new MockSessionManager();
      consoleUI.setDisplayMode('transcript');
      consoleUI.attach(sessionManager);
      mockOutput.clear();
    });

    it('should show full conversation in transcript mode', () => {
      sessionManager.emit('transcript', { text: 'What is the weather?' });
      sessionManager.emit('response', { text: 'It is sunny today.' });

      const output = mockOutput.getOutput();
      assert.ok(output.includes('You: What is the weather?'));
      assert.ok(output.includes('Agent: It is sunny today.'));
    });

    it('should hide conversation in minimal mode', () => {
      consoleUI.setDisplayMode('minimal');
      mockOutput.clear();

      sessionManager.emit('transcript', { text: 'Hello' });
      sessionManager.emit('response', { text: 'Hi there' });

      const output = mockOutput.getOutput();
      assert.ok(!output.includes('You:'));
      assert.ok(!output.includes('Agent:'));
    });

    it('should respond immediately when mode changes', () => {
      // Start in transcript mode (set in beforeEach)
      sessionManager.emit('transcript', { text: 'Hello' });
      assert.ok(mockOutput.getOutput().includes('You: Hello'));

      // Change to minimal mode
      consoleUI.setDisplayMode('minimal');
      mockOutput.clear();

      // New transcript should not show
      sessionManager.emit('transcript', { text: 'World' });
      assert.ok(!mockOutput.getOutput().includes('You:'));
    });
  });

  describe('T028: TTS Fallback to Text Display', () => {
    let sessionManager;

    beforeEach(() => {
      sessionManager = new MockSessionManager();
      consoleUI.attach(sessionManager);
      mockOutput.clear();
    });

    describe('showTtsFallback', () => {
      it('should display fallback notice and response text', () => {
        consoleUI.showTtsFallback('This is the agent response');

        const output = mockOutput.getOutput();
        assert.ok(output.includes('[Audio unavailable - showing text]'));
        assert.ok(output.includes('Agent: This is the agent response'));
      });

      it('should display response text in transcript mode', () => {
        consoleUI.setDisplayMode('transcript');
        mockOutput.clear();

        consoleUI.showTtsFallback('Response in transcript mode');

        const output = mockOutput.getOutput();
        assert.ok(output.includes('[Audio unavailable - showing text]'));
        assert.ok(output.includes('Agent: Response in transcript mode'));
      });

      it('should display response text in minimal mode', () => {
        consoleUI.setDisplayMode('minimal');
        mockOutput.clear();

        consoleUI.showTtsFallback('Response in minimal mode');

        const output = mockOutput.getOutput();
        assert.ok(output.includes('[Audio unavailable - showing text]'));
        assert.ok(output.includes('Agent: Response in minimal mode'));
      });

      it('should display response text in voice_only mode (without notice)', () => {
        consoleUI.setDisplayMode('voice_only');
        mockOutput.clear();

        consoleUI.showTtsFallback('Response in voice only mode');

        const output = mockOutput.getOutput();
        // Should NOT include the notice in voice_only mode
        assert.ok(!output.includes('[Audio unavailable - showing text]'));
        // But MUST include the response text (since audio is unavailable)
        assert.ok(output.includes('Agent: Response in voice only mode'));
      });
    });

    describe('tts_fallback event handling', () => {
      it('should handle tts_fallback events', () => {
        const onFallbackDisplayed = mock.fn();
        consoleUI.on('tts_fallback_displayed', onFallbackDisplayed);

        sessionManager.emit('tts_fallback', { text: 'Fallback response text' });

        const output = mockOutput.getOutput();
        assert.ok(output.includes('[Audio unavailable - showing text]'));
        assert.ok(output.includes('Agent: Fallback response text'));
        assert.strictEqual(onFallbackDisplayed.mock.calls.length, 1);
        assert.deepStrictEqual(onFallbackDisplayed.mock.calls[0].arguments[0], {
          text: 'Fallback response text'
        });
      });

      it('should handle tts_fallback in all display modes', () => {
        // Test each display mode
        const modes = ['voice_only', 'minimal', 'transcript'];

        for (const mode of modes) {
          consoleUI.setDisplayMode(mode);
          mockOutput.clear();

          sessionManager.emit('tts_fallback', { text: `Fallback in ${mode} mode` });

          const output = mockOutput.getOutput();
          // Response text should always be shown
          assert.ok(
            output.includes(`Agent: Fallback in ${mode} mode`),
            `Response should be shown in ${mode} mode`
          );
        }
      });
    });

    describe('Color output for TTS fallback', () => {
      let colorUI;
      let colorOutput;

      beforeEach(() => {
        colorOutput = new MockOutputStream();
        colorUI = new ConsoleUI({
          displayMode: 'minimal',
          colorOutput: true,
          outputStream: colorOutput
        });
      });

      it('should apply yellow color to fallback notice', () => {
        colorUI.showTtsFallback('Test response');
        const output = colorOutput.getOutput();
        assert.ok(output.includes(COLORS.yellow));
        assert.ok(output.includes('[Audio unavailable - showing text]'));
      });

      it('should apply green color to response text', () => {
        colorUI.showTtsFallback('Test response');
        const output = colorOutput.getOutput();
        assert.ok(output.includes(COLORS.green));
        assert.ok(output.includes('Agent: Test response'));
      });
    });

    describe('FR-9: Error handling per spec', () => {
      it('should inform user when TTS fails and show text fallback', () => {
        // Per PRD FR-9: "TTS fails: Show text response as fallback"
        sessionManager.emit('tts_fallback', { text: 'This is the actual agent response' });

        const output = mockOutput.getOutput();
        // User should be informed that TTS failed
        assert.ok(output.includes('[Audio unavailable - showing text]'));
        // User should see the actual response text
        assert.ok(output.includes('Agent: This is the actual agent response'));
      });

      it('should not generate fake responses (only display OpenClaw response)', () => {
        // Per spec: "Never generate or synthesize fallback text"
        // The displayed text should be exactly what was passed (from OpenClaw)
        const openclawResponse = 'This is the real OpenClaw response';
        sessionManager.emit('tts_fallback', { text: openclawResponse });

        const output = mockOutput.getOutput();
        assert.ok(output.includes(`Agent: ${openclawResponse}`));
        // Should not contain any other "Agent:" prefix with different text
        const agentLines = output.split('\n').filter(line => line.includes('Agent:'));
        assert.strictEqual(agentLines.length, 1);
      });
    });
  });
});
