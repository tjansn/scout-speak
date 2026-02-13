/**
 * SessionManager - Central orchestrator for voice conversation
 *
 * Per T029 and specs/system_architecture_and_data_flow.md:
 * - Coordinate all components (SpeechPipeline, OpenClawClient, TtsPlaybackPipeline)
 * - Manage state machine transitions via ConversationState
 * - Handle events from all modules
 * - Implement conversation flow:
 *   idle -> listening -> processing -> speaking -> listening -> ...
 *
 * State Machine:
 *   idle -> listening (session started or playback complete)
 *   listening -> processing (speech ended, sending to STT/OpenClaw)
 *   processing -> speaking (response received, TTS started)
 *   speaking -> listening (playback complete or barge-in)
 *   any -> idle (session ended or fatal error)
 *
 * Events:
 * - 'state_changed': State transition occurred
 * - 'transcript': User speech transcribed
 * - 'response': Agent response received
 * - 'speaking_started': TTS playback began
 * - 'speaking_complete': TTS playback finished
 * - 'barge_in': User interrupted agent
 * - 'error': Non-fatal error occurred
 * - 'connection_changed': OpenClaw connection status changed
 */

import { EventEmitter } from 'events';
import { ConversationState } from './conversation-state.mjs';
import { SessionPersistence } from './session-persistence.mjs';
import { SpeechPipeline } from '../stt/speech-pipeline.mjs';
import { OpenClawClient } from '../openclaw/openclaw-client.mjs';
import { ConnectionMonitor } from '../openclaw/connection-monitor.mjs';
import { TtsPlaybackPipeline } from '../tts/tts-playback-pipeline.mjs';

/**
 * @typedef {import('../config/config.mjs').Config} Config
 */

/**
 * @typedef {Object} SessionManagerConfig
 * @property {string} vadModelPath - Path to Silero VAD ONNX model
 * @property {string} whisperPath - Path to whisper.cpp executable
 * @property {string} sttModelPath - Path to whisper GGML model
 * @property {string} ttsModelPath - Path to Piper .onnx voice model
 * @property {string} gateway_url - OpenClaw gateway URL
 * @property {string} [gateway_token] - OpenClaw gateway token
 * @property {string} [configPath] - Path to config file for session persistence (T050)
 * @property {boolean} [persistSession=true] - Whether to persist session ID across restarts (T050)
 * @property {number} [sampleRate=16000] - Capture sample rate
 * @property {number} [ttsSampleRate=22050] - TTS sample rate
 * @property {number} [vadThreshold=0.5] - VAD speech threshold
 * @property {number} [bargeInThreshold=0.7] - VAD threshold during playback
 * @property {number} [silenceDurationMs=1200] - Silence to end speech
 * @property {number} [minSpeechMs=500] - Minimum speech duration
 * @property {number} [bufferSizeMs=500] - Jitter buffer size
 * @property {number} [lowWatermarkMs=100] - Start playback threshold
 * @property {number} [connectionPollMs=5000] - Connection check interval
 * @property {boolean} [bargeInEnabled=true] - Whether barge-in is enabled
 * @property {number} [bargeInCooldownMs=200] - Barge-in cooldown/debounce period
 */

/**
 * Default configuration
 * @type {Readonly<Partial<SessionManagerConfig>>}
 */
export const DEFAULT_SESSION_CONFIG = Object.freeze({
  sampleRate: 16000,
  ttsSampleRate: 22050,
  vadThreshold: 0.5,
  bargeInThreshold: 0.7,
  silenceDurationMs: 1200,
  minSpeechMs: 500,
  bufferSizeMs: 500,
  lowWatermarkMs: 100,
  connectionPollMs: 5000,
  bargeInEnabled: true,
  bargeInCooldownMs: 200,
  persistSession: true
});

/**
 * SessionManager - Central coordinator for voice conversations
 *
 * Orchestrates the complete voice pipeline:
 * - Audio capture and speech detection (SpeechPipeline)
 * - Message exchange with OpenClaw (OpenClawClient)
 * - Text-to-speech synthesis (TtsPlaybackPipeline)
 * - Connection monitoring (ConnectionMonitor)
 *
 * @extends EventEmitter
 */
export class SessionManager extends EventEmitter {
  /**
   * Create a SessionManager instance
   * @param {SessionManagerConfig} config - Session configuration
   */
  constructor(config) {
    super();

    this._validateConfig(config);

    /** @type {SessionManagerConfig} */
    this._config = { ...DEFAULT_SESSION_CONFIG, ...config };

    /** @type {ConversationState} */
    this._state = new ConversationState();

    /** @type {SpeechPipeline|null} */
    this._speechPipeline = null;

    /** @type {OpenClawClient} */
    this._openclawClient = new OpenClawClient(/** @type {import('../config/config.mjs').Config} */ ({
      gateway_url: this._config.gateway_url,
      gateway_token: this._config.gateway_token || ''
    }));

    /** @type {ConnectionMonitor} */
    this._connectionMonitor = new ConnectionMonitor(
      this._openclawClient,
      this._state,
      { pollIntervalMs: this._config.connectionPollMs }
    );

    /** @type {TtsPlaybackPipeline|null} */
    this._ttsPipeline = null;

    /** @type {boolean} */
    this._initialized = false;

    /** @type {boolean} */
    this._running = false;

    /** @type {boolean} */
    this._processingTranscript = false;

    /** @type {number} - Timestamp of last barge-in for cooldown */
    this._lastBargeInTime = 0;

    /** @type {SessionPersistence|null} - Session persistence for reconnect/resume (T050) */
    this._sessionPersistence = null;
    if (this._config.persistSession && this._config.configPath) {
      this._sessionPersistence = new SessionPersistence({
        configPath: this._config.configPath,
        autoSave: true
      });
    }

    this._setupStateEvents();
    this._setupConnectionEvents();
  }

  /**
   * Validate required configuration
   * @param {SessionManagerConfig} config
   * @private
   */
  _validateConfig(config) {
    /** @type {(keyof SessionManagerConfig)[]} */
    const required = ['vadModelPath', 'whisperPath', 'sttModelPath', 'ttsModelPath', 'gateway_url'];
    for (const field of required) {
      if (!config[field]) {
        throw new Error(`${field} is required`);
      }
    }
  }

  /**
   * Get the current conversation state
   * @returns {ConversationState}
   */
  get state() {
    return this._state;
  }

  /**
   * Get current status
   * @returns {import('./conversation-state.mjs').ConversationStatus}
   */
  get status() {
    return this._state.status;
  }

  /**
   * Check if session is running
   * @returns {boolean}
   */
  get isRunning() {
    return this._running;
  }

  /**
   * Check if session is initialized
   * @returns {boolean}
   */
  get isInitialized() {
    return this._initialized;
  }

  /**
   * Initialize the session manager and all components
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized) {
      return;
    }

    // Initialize session persistence and restore previous session ID (T050)
    if (this._sessionPersistence) {
      const restoredSessionId = await this._sessionPersistence.init();
      if (restoredSessionId) {
        this._state.setSessionId(restoredSessionId);
        this.emit('session_restored', { sessionId: restoredSessionId });
      }
    }

    // Create and initialize speech pipeline
    this._speechPipeline = new SpeechPipeline({
      vadModelPath: this._config.vadModelPath,
      whisperPath: this._config.whisperPath,
      sttModelPath: this._config.sttModelPath,
      sampleRate: this._config.sampleRate,
      vadThreshold: this._config.vadThreshold,
      bargeInThreshold: this._config.bargeInThreshold,
      silenceDurationMs: this._config.silenceDurationMs,
      minSpeechMs: this._config.minSpeechMs
    });

    // Create TTS pipeline
    this._ttsPipeline = new TtsPlaybackPipeline({
      modelPath: this._config.ttsModelPath,
      sampleRate: this._config.ttsSampleRate,
      bufferSizeMs: this._config.bufferSizeMs,
      lowWatermarkMs: this._config.lowWatermarkMs
    });

    // Wire up speech pipeline events
    this._setupSpeechPipelineEvents();

    // Wire up TTS pipeline events
    this._setupTtsPipelineEvents();

    // Initialize speech pipeline (loads VAD model)
    await this._speechPipeline.init();

    // Start connection monitoring
    this._connectionMonitor.start();

    this._initialized = true;
    this.emit('initialized');
  }

  /**
   * Start the session (begin listening)
   * @returns {Promise<void>}
   */
  async start() {
    if (!this._initialized) {
      throw new Error('SessionManager not initialized. Call init() first.');
    }

    if (this._running) {
      return;
    }

    this._running = true;

    // Check connection before starting
    const connected = await this._connectionMonitor.check();
    if (!connected) {
      this._state.setError('Cannot reach OpenClaw', false);
      this.emit('error', { type: 'connection', message: 'Cannot reach OpenClaw' });
    }

    // Start speech pipeline (audio capture + VAD)
    if (this._speechPipeline) {
      this._speechPipeline.start();
    }

    // Transition to listening state
    this._state.startListening();

    this.emit('started');
  }

  /**
   * Stop the session
   */
  stop() {
    if (!this._running) {
      return;
    }

    // Stop TTS if speaking
    if (this._ttsPipeline && this._ttsPipeline.speaking) {
      this._ttsPipeline.stop();
    }

    // Stop speech pipeline
    if (this._speechPipeline) {
      this._speechPipeline.stop();
    }

    this._running = false;
    this._processingTranscript = false;

    // Transition to idle
    this._state.stop('session_ended');

    this.emit('stopped');
  }

  /**
   * Register callback for state changes
   * @param {function({from: string, to: string, reason?: string}): void} callback
   */
  onStateChange(callback) {
    this._state.on('stateChange', callback);
  }

  /**
   * Get state snapshot
   * @returns {ReturnType<ConversationState['getSnapshot']>}
   */
  getState() {
    return this._state.getSnapshot();
  }

  /**
   * Get session statistics
   * @returns {Object}
   */
  getStats() {
    return {
      initialized: this._initialized,
      running: this._running,
      status: this._state.status,
      openclawConnected: this._state.openclawConnected,
      speechPipeline: this._speechPipeline?.getStats() ?? null,
      ttsPipeline: this._ttsPipeline?.getStats() ?? null,
      connectionMonitor: this._connectionMonitor.getStats()
    };
  }

  /**
   * Set up state change event forwarding
   * @private
   */
  _setupStateEvents() {
    this._state.on('stateChange', (event) => {
      this.emit('state_changed', event);
    });

    this._state.on('error', (message) => {
      this.emit('error', { type: 'state', message });
    });

    this._state.on('connectionChange', (connected) => {
      this.emit('connection_changed', { connected });
    });
  }

  /**
   * Set up connection monitor events
   * @private
   */
  _setupConnectionEvents() {
    this._connectionMonitor.on('connected', () => {
      // Clear any previous connection error
      if (this._state.error?.includes('Cannot reach OpenClaw')) {
        this._state.clearError();
      }
    });

    this._connectionMonitor.on('disconnected', () => {
      this._state.setError('Cannot reach OpenClaw', false);
    });

    this._connectionMonitor.on('error', (err) => {
      this.emit('error', { type: 'connection_monitor', message: err.message });
    });
  }

  /**
   * Set up speech pipeline event handlers
   * @private
   */
  _setupSpeechPipelineEvents() {
    if (!this._speechPipeline) return;

    this._speechPipeline.on('speech_started', () => {
      // If we're speaking, this is a barge-in
      if (this._state.status === 'speaking') {
        this._handleBargeIn();
      }
    });

    this._speechPipeline.on('transcript', async (data) => {
      await this._handleTranscript(data.text, data.audioDurationMs, data.sttDurationMs);
    });

    this._speechPipeline.on('empty_transcript', (data) => {
      // Speech detected but couldn't be transcribed
      this._state.setError("Didn't catch that", false);
      this.emit('empty_transcript', data);
    });

    this._speechPipeline.on('barge_in', () => {
      this._handleBargeIn();
    });

    this._speechPipeline.on('error', (data) => {
      this.emit('error', { type: data.type, message: data.message });

      // If fatal error, stop session
      if (data.type === 'init') {
        this._state.setError(data.message, true);
      }
    });
  }

  /**
   * Set up TTS pipeline event handlers
   * @private
   */
  _setupTtsPipelineEvents() {
    if (!this._ttsPipeline) return;

    this._ttsPipeline.on('speaking_started', (data) => {
      // Set playback active for barge-in detection
      this._speechPipeline?.setPlaybackActive(true);
      this.emit('speaking_started', data);
    });

    this._ttsPipeline.on('speaking_complete', () => {
      // Playback finished, return to listening
      this._speechPipeline?.setPlaybackActive(false);
      this.emit('speaking_complete');

      // Continue conversation loop
      if (this._running && this._state.status === 'speaking') {
        this._state.playbackComplete();
      }
    });

    this._ttsPipeline.on('speaking_stopped', () => {
      // Playback was interrupted (barge-in)
      this._speechPipeline?.setPlaybackActive(false);
    });

    this._ttsPipeline.on('error', (err) => {
      this._speechPipeline?.setPlaybackActive(false);
      this.emit('error', { type: 'tts', message: err.message });

      // TTS error is non-fatal - emit the text and continue
      if (this._state.status === 'speaking') {
        this.emit('tts_fallback', { text: this._state.lastResponse });
        this._state.playbackComplete();
      }
    });
  }

  /**
   * Handle barge-in (user interrupted agent)
   *
   * Per T030 and algorithm_and_data_structures.md:
   * - Stops TTS synthesis and playback immediately
   * - Clears jitter buffer
   * - Transitions to listening state
   * - Enforces cooldown to prevent rapid repeated interrupts
   *
   * @private
   */
  _handleBargeIn() {
    // Check if barge-in is enabled
    if (this._config.bargeInEnabled === false) {
      return;
    }

    if (this._state.status !== 'speaking') {
      return;
    }

    // Check cooldown to prevent rapid repeated interrupts
    const now = Date.now();
    const cooldownMs = this._config.bargeInCooldownMs ?? 200;
    if (now - this._lastBargeInTime < cooldownMs) {
      return;
    }
    this._lastBargeInTime = now;

    // Stop TTS immediately
    if (this._ttsPipeline) {
      this._ttsPipeline.stop();
    }

    // Transition state
    this._state.bargeIn();

    this.emit('barge_in');
  }

  /**
   * Handle transcript from speech pipeline
   * @param {string} text - Transcribed text
   * @param {number} audioDurationMs - Audio duration
   * @param {number} sttDurationMs - STT processing time
   * @private
   */
  async _handleTranscript(text, audioDurationMs, sttDurationMs) {
    // Prevent processing if we're not in the right state
    if (!this._running || this._state.status !== 'listening') {
      return;
    }

    // Prevent concurrent transcript processing
    if (this._processingTranscript) {
      return;
    }

    this._processingTranscript = true;

    try {
      // Emit transcript event
      this.emit('transcript', { text, audioDurationMs, sttDurationMs });

      // Transition to processing state
      this._state.startProcessing(text);

      // Send to OpenClaw
      const response = await this._sendToOpenClaw(text);

      if (!response) {
        // Error already handled in _sendToOpenClaw
        // Transition back to listening
        this._state.transition('listening', 'openclaw_error');
        return;
      }

      // Emit response event
      this.emit('response', { text: response.text, sessionId: response.sessionId });

      // Update session ID and persist for reconnect/resume (T050)
      if (response.sessionId) {
        this._state.setSessionId(response.sessionId);
        // Persist session ID asynchronously (don't block response flow)
        if (this._sessionPersistence) {
          this._sessionPersistence.setSessionId(response.sessionId).catch((err) => {
            this.emit('error', { type: 'session_persistence', message: err.message });
          });
        }
      }

      // Transition to speaking and start TTS
      this._state.startSpeaking(response.text);

      // Speak the response
      await this._speakResponse(response.text);

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('error', { type: 'transcript_handler', message });

      // Return to listening on error (only if not already in listening or idle)
      // Check status using snapshot to avoid TypeScript narrowing issues
      const snapshot = this._state.getSnapshot();
      if (snapshot.status === 'processing' || snapshot.status === 'speaking') {
        this._state.transition('listening', 'error');
      }
    } finally {
      this._processingTranscript = false;
    }
  }

  /**
   * Send message to OpenClaw
   * @param {string} message - User message
   * @returns {Promise<{text: string, sessionId: string|null}|null>}
   * @private
   */
  async _sendToOpenClaw(message) {
    try {
      const response = await this._openclawClient.send(message, {
        sessionId: this._state.sessionId ?? undefined
      });

      // Clear any previous connection error
      this._state.clearError();

      return response;
    } catch (err) {
      const error = /** @type {Error} */ (err);
      const message = error.message || 'Unknown error';

      // Set error on state (non-fatal)
      this._state.setError(message, false);
      this.emit('error', { type: 'openclaw', message });

      return null;
    }
  }

  /**
   * Speak response using TTS
   * @param {string} text - Text to speak
   * @private
   */
  async _speakResponse(text) {
    if (!this._ttsPipeline) {
      throw new Error('TTS pipeline not initialized');
    }

    try {
      await this._ttsPipeline.speak(text);
    } catch (err) {
      // Error handling done in TTS pipeline events
      const message = err instanceof Error ? err.message : String(err);
      this.emit('error', { type: 'tts_speak', message });
    }
  }

  /**
   * Reset the session - clears session ID for a fresh conversation (T050)
   *
   * Per T050: Reset session ID when user intentionally starts a new session.
   * This clears both in-memory and persisted session ID.
   *
   * @returns {Promise<void>}
   */
  async resetSession() {
    // Clear in-memory session ID
    this._state.setSessionId(null);
    this._openclawClient.resetSession();

    // Clear persisted session ID
    if (this._sessionPersistence) {
      await this._sessionPersistence.reset();
    }

    this.emit('session_reset');
  }

  /**
   * Get the current session ID
   * @returns {string|null}
   */
  get sessionId() {
    return this._state.sessionId;
  }

  /**
   * Dispose of all resources
   */
  async dispose() {
    this.stop();

    // Stop connection monitoring
    this._connectionMonitor.dispose();

    // Dispose speech pipeline
    if (this._speechPipeline) {
      await this._speechPipeline.dispose();
      this._speechPipeline = null;
    }

    // Dispose TTS pipeline
    if (this._ttsPipeline) {
      this._ttsPipeline.dispose();
      this._ttsPipeline = null;
    }

    // Reset state
    this._state.reset();

    this._initialized = false;
    this.removeAllListeners();
  }
}

/**
 * Create a SessionManager instance
 * @param {SessionManagerConfig} config - Session configuration
 * @returns {SessionManager}
 */
export function createSessionManager(config) {
  return new SessionManager(config);
}

export default SessionManager;
