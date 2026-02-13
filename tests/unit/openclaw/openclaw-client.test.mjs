/**
 * Unit tests for OpenClawClient
 *
 * Tests per T018 requirements:
 * - CLI command construction
 * - Response parsing
 * - Error code handling
 * - Token propagation without token leakage in logs
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createMockConfig, assertThrows, assertThrowsAsync } from '../../test-utils.mjs';
import {
  OpenClawClient,
  OpenClawError,
  EXIT_CODES,
  ERROR_TYPES
} from '../../../src/openclaw/openclaw-client.mjs';

describe('OpenClawClient', () => {
  describe('constructor', () => {
    it('should require config object', () => {
      assertThrows(() => {
        // @ts-expect-error - testing invalid input
        new OpenClawClient();
      }, 'Config is required');
    });

    it('should require config to be an object', () => {
      assertThrows(() => {
        // @ts-expect-error - testing invalid input
        new OpenClawClient('not-an-object');
      }, 'Config is required');
    });

    it('should require gateway_url in config', () => {
      assertThrows(() => {
        // @ts-ignore - testing invalid input
        new OpenClawClient({});
      }, 'gateway_url is required in config');
    });

    it('should accept valid config', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);
      assert.ok(client instanceof OpenClawClient);
    });

    it('should initialize with null session ID', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);
      assert.strictEqual(client.sessionId, null);
    });
  });

  describe('setTimeout', () => {
    it('should set timeout value', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);
      client.setTimeout(5000);
      // Internal state - just verify no throw
      assert.ok(true);
    });

    it('should reject non-positive timeout', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      assertThrows(() => {
        client.setTimeout(0);
      }, 'Timeout must be a positive number');

      assertThrows(() => {
        client.setTimeout(-1000);
      }, 'Timeout must be a positive number');
    });

    it('should reject non-number timeout', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      assertThrows(() => {
        // @ts-expect-error - testing invalid input
        client.setTimeout('5000');
      }, 'Timeout must be a positive number');
    });
  });

  describe('_buildArgs', () => {
    it('should build correct CLI arguments', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // @ts-expect-error - accessing private method for testing
      const args = client._buildArgs('Hello world');

      assert.deepStrictEqual(args, [
        'agent',
        '--agent', 'main',
        '--message', 'Hello world',
        '--json'
      ]);
    });

    it('should include session ID when provided', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // @ts-expect-error - accessing private method for testing
      const args = client._buildArgs('Hello', { sessionId: 'test-session-123' });

      assert.ok(args.includes('--session-id'));
      assert.ok(args.includes('test-session-123'));
    });

    it('should preserve message with special characters', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);
      const message = 'Hello "world" with \'quotes\' and $pecial chars!';

      // @ts-expect-error - accessing private method for testing
      const args = client._buildArgs(message);

      assert.ok(args.includes(message));
    });
  });

  describe('_buildEnv', () => {
    it('should include process.env', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      /** @type {NodeJS.ProcessEnv} */
      // @ts-ignore - accessing internal method for testing
      const env = client._buildEnv();

      // Should have PATH at minimum
      assert.ok(env.PATH !== undefined);
    });

    it('should set OPENCLAW_GATEWAY_TOKEN when token configured', () => {
      const config = createMockConfig({ gateway_token: 'secret-token-123' });
      const client = new OpenClawClient(config);

      /** @type {NodeJS.ProcessEnv} */
      // @ts-ignore - accessing internal method for testing
      const env = client._buildEnv();

      assert.strictEqual(env.OPENCLAW_GATEWAY_TOKEN, 'secret-token-123');
    });

    it('should not set OPENCLAW_GATEWAY_TOKEN when token is empty', () => {
      const config = createMockConfig({ gateway_token: '' });
      const client = new OpenClawClient(config);

      /** @type {NodeJS.ProcessEnv} */
      // @ts-ignore - accessing internal method for testing
      const env = client._buildEnv();

      // Should not have the token env var set
      assert.strictEqual(env.OPENCLAW_GATEWAY_TOKEN, undefined);
    });
  });

  describe('_parseResponse', () => {
    it('should parse valid response', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      const stdout = JSON.stringify({
        runId: 'test-run-id',
        status: 'ok',
        summary: 'completed',
        result: {
          payloads: [{ text: 'Hello from OpenClaw!', mediaUrl: null }],
          meta: {
            durationMs: 1500,
            agentMeta: {
              sessionId: 'session-456',
              provider: 'anthropic',
              model: 'claude-opus-4-6'
            }
          }
        }
      });

      // @ts-expect-error - accessing private method for testing
      const response = client._parseResponse(stdout);

      assert.strictEqual(response.text, 'Hello from OpenClaw!');
      assert.strictEqual(response.sessionId, 'session-456');
      assert.strictEqual(response.durationMs, 1500);
    });

    it('should handle empty payloads gracefully', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      const stdout = JSON.stringify({
        status: 'ok',
        result: {
          payloads: [],
          meta: { durationMs: 100, agentMeta: {} }
        }
      });

      // @ts-expect-error - accessing private method for testing
      const response = client._parseResponse(stdout);

      assert.strictEqual(response.text, '');
      assert.strictEqual(response.sessionId, null);
    });

    it('should throw on invalid JSON', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      assertThrows(() => {
        // @ts-expect-error - accessing private method for testing
        client._parseResponse('not valid json');
      }, /Failed to parse OpenClaw response/);
    });

    it('should throw on non-ok status', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      const stdout = JSON.stringify({
        status: 'error',
        result: {}
      });

      assertThrows(() => {
        // @ts-expect-error - accessing private method for testing
        client._parseResponse(stdout);
      }, /OpenClaw returned error status/);
    });

    it('should store session ID for continuity', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      assert.strictEqual(client.sessionId, null);

      const stdout = JSON.stringify({
        status: 'ok',
        result: {
          payloads: [{ text: 'Test' }],
          meta: {
            durationMs: 100,
            agentMeta: { sessionId: 'persistent-session' }
          }
        }
      });

      // @ts-expect-error - accessing private method for testing
      client._parseResponse(stdout);

      assert.strictEqual(client.sessionId, 'persistent-session');
    });
  });

  describe('_categorizeError', () => {
    it('should return CONNECTION_REFUSED for exit code 7', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // @ts-expect-error - accessing private method for testing
      const error = client._categorizeError(EXIT_CODES.CONNECTION_REFUSED, '');

      assert.strictEqual(error.type, ERROR_TYPES.CONNECTION_REFUSED);
      assert.strictEqual(error.message, 'Cannot reach OpenClaw');
    });

    it('should detect gateway not running from stderr', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // @ts-expect-error - accessing private method for testing
      const error = client._categorizeError(1, 'Gateway not running');

      assert.strictEqual(error.type, ERROR_TYPES.GATEWAY_NOT_RUNNING);
    });

    it('should detect connection refused from stderr', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // @ts-expect-error - accessing private method for testing
      const error = client._categorizeError(1, 'ECONNREFUSED 127.0.0.1:18789');

      assert.strictEqual(error.type, ERROR_TYPES.GATEWAY_NOT_RUNNING);
    });

    it('should return CLI_ERROR for other errors', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // @ts-expect-error - accessing private method for testing
      const error = client._categorizeError(1, 'Some other error message');

      assert.strictEqual(error.type, ERROR_TYPES.CLI_ERROR);
      assert.ok(error.message.includes('Some other error message'));
    });
  });

  describe('send', () => {
    it('should reject empty message', async () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      await assertThrowsAsync(async () => {
        await client.send('');
      }, 'Message must be a non-empty string');
    });

    it('should reject non-string message', async () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      await assertThrowsAsync(async () => {
        // @ts-expect-error - testing invalid input
        await client.send(123);
      }, 'Message must be a non-empty string');
    });

    it('should trim message', async () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // Mock _exec to capture args
      /** @type {string[]} */
      let capturedArgs = [];
      // @ts-expect-error - mocking private method
      client._exec = mock.fn((/** @type {string[]} */ args) => {
        capturedArgs = args;
        return Promise.resolve({
          stdout: JSON.stringify({
            status: 'ok',
            result: { payloads: [{ text: 'Response' }], meta: { durationMs: 100, agentMeta: {} } }
          }),
          stderr: '',
          exitCode: 0
        });
      });

      await client.send('  Hello world  ');

      assert.ok(capturedArgs.includes('Hello world'));
      assert.ok(!capturedArgs.includes('  Hello world  '));
    });

    it('should emit sending event', async () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      let emittedData = null;
      client.on('sending', (data) => {
        emittedData = data;
      });

      // @ts-expect-error - mocking private method
      client._exec = mock.fn(() => Promise.resolve({
        stdout: JSON.stringify({
          status: 'ok',
          result: { payloads: [{ text: 'Response' }], meta: { durationMs: 100, agentMeta: {} } }
        }),
        stderr: '',
        exitCode: 0
      }));

      await client.send('Test message');

      assert.deepStrictEqual(emittedData, { message: 'Test message' });
    });

    it('should emit received event on success', async () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      /** @type {{ text: string, sessionId: string|null, durationMs: number }|null} */
      let emittedResponse = null;
      client.on('received', (response) => {
        emittedResponse = response;
      });

      // @ts-expect-error - mocking private method
      client._exec = mock.fn(() => Promise.resolve({
        stdout: JSON.stringify({
          status: 'ok',
          result: {
            payloads: [{ text: 'Hello!' }],
            meta: { durationMs: 200, agentMeta: { sessionId: 'sess-1' } }
          }
        }),
        stderr: '',
        exitCode: 0
      }));

      await client.send('Test');

      assert.ok(emittedResponse !== null);
      // @ts-ignore - TypeScript narrowing issue with event handler assignments
      assert.strictEqual(emittedResponse.text, 'Hello!');
      // @ts-ignore - TypeScript narrowing issue with event handler assignments
      assert.strictEqual(emittedResponse.sessionId, 'sess-1');
    });

    it('should emit error event on failure', async () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      /** @type {OpenClawError|null} */
      let emittedError = null;
      client.on('error', (error) => {
        emittedError = error;
      });

      // @ts-expect-error - mocking private method
      client._exec = mock.fn(() => Promise.resolve({
        stdout: '',
        stderr: 'Gateway not running',
        exitCode: 1
      }));

      try {
        await client.send('Test');
      } catch {
        // Expected
      }

      assert.ok(emittedError !== null);
      // @ts-ignore - TypeScript narrowing issue with event handler assignments
      assert.ok(emittedError instanceof OpenClawError);
    });
  });

  describe('healthCheck', () => {
    it('should return true on success', async () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // @ts-expect-error - mocking private method
      client._exec = mock.fn(() => Promise.resolve({
        stdout: '{"ok":true}',
        stderr: '',
        exitCode: 0
      }));

      const result = await client.healthCheck();

      assert.strictEqual(result, true);
    });

    it('should return false on non-zero exit', async () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // @ts-expect-error - mocking private method
      client._exec = mock.fn(() => Promise.resolve({
        stdout: '',
        stderr: 'Connection refused',
        exitCode: 7
      }));

      const result = await client.healthCheck();

      assert.strictEqual(result, false);
    });

    it('should return false on error', async () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // @ts-expect-error - mocking private method
      client._exec = mock.fn(() => Promise.reject(new Error('exec failed')));

      const result = await client.healthCheck();

      assert.strictEqual(result, false);
    });

    it('should call gateway health command', async () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      /** @type {string[]} */
      let capturedArgs = [];
      // @ts-expect-error - mocking private method
      client._exec = mock.fn((/** @type {string[]} */ args) => {
        capturedArgs = args;
        return Promise.resolve({
          stdout: '{"ok":true}',
          stderr: '',
          exitCode: 0
        });
      });

      await client.healthCheck();

      assert.deepStrictEqual(capturedArgs, ['gateway', 'health']);
    });
  });

  describe('resetSession', () => {
    it('should clear session ID', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      // Set session via parse
      const stdout = JSON.stringify({
        status: 'ok',
        result: {
          payloads: [{ text: 'Test' }],
          meta: { durationMs: 100, agentMeta: { sessionId: 'test-session' } }
        }
      });
      // @ts-expect-error - accessing private method
      client._parseResponse(stdout);

      assert.strictEqual(client.sessionId, 'test-session');

      client.resetSession();

      assert.strictEqual(client.sessionId, null);
    });

    it('should emit session_reset event', () => {
      const config = createMockConfig();
      const client = new OpenClawClient(config);

      let eventEmitted = false;
      client.on('session_reset', () => {
        eventEmitted = true;
      });

      client.resetSession();

      assert.strictEqual(eventEmitted, true);
    });
  });

  describe('OpenClawError', () => {
    it('should have correct properties', () => {
      const error = new OpenClawError('Test error', ERROR_TYPES.CLI_ERROR, 1);

      assert.strictEqual(error.name, 'OpenClawError');
      assert.strictEqual(error.message, 'Test error');
      assert.strictEqual(error.type, ERROR_TYPES.CLI_ERROR);
      assert.strictEqual(error.exitCode, 1);
    });

    it('should be instanceof Error', () => {
      const error = new OpenClawError('Test', ERROR_TYPES.CLI_ERROR);
      assert.ok(error instanceof Error);
    });
  });

  describe('token security', () => {
    it('should not include token in CLI args', async () => {
      const config = createMockConfig({ gateway_token: 'super-secret-token' });
      const client = new OpenClawClient(config);

      /** @type {string[]} */
      let capturedArgs = [];
      // @ts-expect-error - mocking private method
      client._exec = mock.fn((/** @type {string[]} */ args) => {
        capturedArgs = args;
        return Promise.resolve({
          stdout: JSON.stringify({
            status: 'ok',
            result: { payloads: [{ text: 'Response' }], meta: { durationMs: 100, agentMeta: {} } }
          }),
          stderr: '',
          exitCode: 0
        });
      });

      await client.send('Test');

      // Token should NOT be in args
      assert.ok(!capturedArgs.includes('super-secret-token'));
      assert.ok(!capturedArgs.join(' ').includes('super-secret-token'));
    });

    it('should pass token via environment variable', async () => {
      const config = createMockConfig({ gateway_token: 'env-token' });
      const client = new OpenClawClient(config);

      /** @type {NodeJS.ProcessEnv} */
      let capturedEnv = {};
      // @ts-expect-error - mocking private method
      client._exec = mock.fn((/** @type {string[]} */ _args, /** @type {NodeJS.ProcessEnv} */ env) => {
        capturedEnv = env;
        return Promise.resolve({
          stdout: JSON.stringify({
            status: 'ok',
            result: { payloads: [{ text: 'Response' }], meta: { durationMs: 100, agentMeta: {} } }
          }),
          stderr: '',
          exitCode: 0
        });
      });

      await client.send('Test');

      // Token should be in env
      assert.strictEqual(capturedEnv.OPENCLAW_GATEWAY_TOKEN, 'env-token');
    });
  });
});
