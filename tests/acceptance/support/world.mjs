/**
 * Cucumber World - provides context for all step definitions
 *
 * The World is the shared context passed to all step definitions.
 * It holds state across steps within a scenario.
 */
import { setWorldConstructor, World } from '@cucumber/cucumber';
import { createMockConfig } from '../../test-utils.mjs';

/**
 * ScoutWorld - test context for Scout acceptance tests
 */
export class ScoutWorld extends World {
  /**
   * @param {import('@cucumber/cucumber').IWorldOptions} options
   */
  constructor(options) {
    super(options);

    /** @type {import('../../test-utils.mjs').ScoutConfig|null} */
    this.config = null;

    /** @type {boolean} */
    this.gatewayRunning = false;

    /** @type {string|null} */
    this.lastMessage = null;

    /** @type {string|null} */
    this.lastResponse = null;

    /** @type {string|null} */
    this.lastError = null;

    /** @type {boolean} */
    this.audioPlayed = false;

    /** @type {string} */
    this.state = 'idle';
  }

  /**
   * Initialize Scout with test configuration
   */
  initializeWithTestConfig() {
    this.config = createMockConfig();
    this.state = 'ready';
  }

  /**
   * Set gateway status
   * @param {boolean} running
   */
  setGatewayStatus(running) {
    this.gatewayRunning = running;
  }

  /**
   * Simulate sending a message to OpenClaw
   * @param {string} message
   * @returns {Promise<{response: string|null, error: string|null}>}
   */
  async sendMessage(message) {
    this.lastMessage = message;
    this.lastError = null;
    this.lastResponse = null;

    if (!this.gatewayRunning) {
      this.lastError = 'Cannot reach OpenClaw';
      this.state = 'error';
      return { response: null, error: this.lastError };
    }

    // Mock successful response for testing
    this.lastResponse = `Response to: ${message}`;
    this.state = 'speaking';
    this.audioPlayed = true;
    return { response: this.lastResponse, error: null };
  }

  /**
   * Check if response came from OpenClaw (not faked)
   * @returns {boolean}
   */
  responseIsFromOpenClaw() {
    // In tests, we verify by checking that response is null when gateway is down
    // and non-null only when gateway is running
    return this.gatewayRunning && this.lastResponse !== null;
  }

  /**
   * Check if Scout generated a fake response
   * @returns {boolean}
   */
  hasGeneratedFakeResponse() {
    // Scout should never generate responses when gateway is down
    return !this.gatewayRunning && this.lastResponse !== null;
  }
}

setWorldConstructor(ScoutWorld);
