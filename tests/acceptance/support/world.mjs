/**
 * Cucumber World - provides context for all step definitions
 *
 * The World is the shared context passed to all step definitions.
 * It holds state across steps within a scenario.
 *
 * This implementation uses the actual OpenClawClient for testing,
 * but with mocked _exec method to simulate gateway responses.
 */
import { setWorldConstructor, World } from '@cucumber/cucumber';
import { createMockConfig } from '../../test-utils.mjs';
import { OpenClawClient, ERROR_TYPES } from '../../../src/openclaw/openclaw-client.mjs';

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

    /** @type {OpenClawClient|null} */
    this.client = null;

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
    this.client = new OpenClawClient(this.config);
    this.state = 'ready';
  }

  /**
   * Set gateway status
   * @param {boolean} running
   */
  setGatewayStatus(running) {
    this.gatewayRunning = running;

    // Mock the _exec method based on gateway status
    if (this.client) {
      // @ts-expect-error - mocking private method
      this.client._exec = async (args, _env) => {
        if (!this.gatewayRunning) {
          return {
            stdout: '',
            stderr: 'Connection refused',
            exitCode: 7
          };
        }

        // Extract message from args
        const msgIndex = args.indexOf('--message');
        const message = msgIndex >= 0 ? args[msgIndex + 1] : 'test';

        return {
          stdout: JSON.stringify({
            runId: 'test-run-id',
            status: 'ok',
            summary: 'completed',
            result: {
              payloads: [{ text: `Response from OpenClaw to: ${message}`, mediaUrl: null }],
              meta: {
                durationMs: 1000,
                agentMeta: {
                  sessionId: 'test-session-123',
                  provider: 'anthropic',
                  model: 'claude-opus-4-6'
                }
              }
            }
          }),
          stderr: '',
          exitCode: 0
        };
      };
    }
  }

  /**
   * Send a message to OpenClaw using the actual client
   * @param {string} message
   * @returns {Promise<{response: string|null, error: string|null}>}
   */
  async sendMessage(message) {
    this.lastMessage = message;
    this.lastError = null;
    this.lastResponse = null;

    if (!this.client) {
      this.lastError = 'Client not initialized';
      this.state = 'error';
      return { response: null, error: this.lastError };
    }

    try {
      const response = await this.client.send(message);
      this.lastResponse = response.text;
      this.state = 'speaking';
      this.audioPlayed = true;
      return { response: this.lastResponse, error: null };
    } catch (/** @type {any} */ error) {
      // Use the error message from OpenClawClient
      this.lastError = error.type === ERROR_TYPES.CONNECTION_REFUSED
        ? 'Cannot reach OpenClaw'
        : error.message;
      this.state = 'error';
      return { response: null, error: this.lastError };
    }
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
