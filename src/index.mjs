/**
 * Scout - Local-first voice interface for OpenClaw AI agents
 *
 * Entry point for the Scout voice pipeline application.
 * Coordinates audio capture, VAD, STT, OpenClaw communication, TTS, and playback.
 */

import { EventEmitter } from 'events';

/**
 * Scout application class - coordinates all voice pipeline components
 */
export class Scout extends EventEmitter {
  constructor() {
    super();
    this.state = 'idle'; // idle | listening | processing | speaking
  }

  /**
   * Initialize Scout with configuration
   * @param {object} config - Configuration object
   */
  async init(config) {
    this.config = config;
    console.log('[Scout] Initializing...');
    // Component initialization will be added in later tasks
  }

  /**
   * Start the voice conversation session
   */
  async start() {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start: Scout is in ${this.state} state`);
    }
    this.state = 'listening';
    this.emit('stateChange', this.state);
    console.log('[Scout] Session started, listening...');
  }

  /**
   * Stop the voice conversation session
   */
  async stop() {
    this.state = 'idle';
    this.emit('stateChange', this.state);
    console.log('[Scout] Session stopped');
  }

  /**
   * Get current state
   * @returns {string} Current state
   */
  getState() {
    return this.state;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const _scout = new Scout();
  console.log('[Scout] Voice interface for OpenClaw');
  console.log('[Scout] Implementation in progress...');
}
