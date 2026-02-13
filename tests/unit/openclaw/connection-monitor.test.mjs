/**
 * Unit tests for ConnectionMonitor
 *
 * Tests per T020 requirements:
 * - Unit test: polling mechanism
 * - Unit test: state update on disconnect
 * - Integration test: actual disconnect/reconnect
 *
 * FR-8: Detects disconnection within 5 seconds
 */

import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import {
  ConnectionMonitor,
  createConnectionMonitor,
  DEFAULT_MONITOR_CONFIG
} from '../../../src/openclaw/connection-monitor.mjs';

/**
 * @typedef {Object} MockClient
 * @property {import('node:test').Mock<() => Promise<boolean>>} healthCheck
 */

/**
 * Create a mock OpenClawClient
 * @param {boolean} [healthResult=true] - What healthCheck should return
 * @returns {MockClient & import('../../../src/openclaw/openclaw-client.mjs').OpenClawClient}
 */
function createMockClient(healthResult = true) {
  return /** @type {any} */ ({
    healthCheck: mock.fn(() => Promise.resolve(healthResult))
  });
}

/**
 * @typedef {Object} MockState
 * @property {boolean} openclawConnected
 * @property {import('node:test').Mock<(connected: boolean) => void>} setOpenclawConnected
 */

/**
 * Create a mock ConversationState
 * @returns {MockState & import('../../../src/session/conversation-state.mjs').ConversationState}
 */
function createMockConversationState() {
  const state = /** @type {any} */ (new EventEmitter());
  state.openclawConnected = false;
  state.setOpenclawConnected = mock.fn((/** @type {boolean} */ connected) => {
    const wasConnected = state.openclawConnected;
    state.openclawConnected = connected;
    if (wasConnected !== connected) {
      state.emit('connectionChange', connected);
    }
  });
  return state;
}

/**
 * Get monitor with null check assertion
 * @param {ConnectionMonitor|null} m
 * @returns {ConnectionMonitor}
 */
function assertMonitor(m) {
  if (!m) throw new Error('Monitor not initialized');
  return m;
}

describe('ConnectionMonitor', () => {
  /** @type {ConnectionMonitor|null} */
  let monitor = null;

  afterEach(() => {
    if (monitor) {
      monitor.dispose();
      monitor = null;
    }
  });

  describe('constructor', () => {
    it('should require a valid client with healthCheck', () => {
      assert.throws(() => {
        // @ts-expect-error - testing invalid input
        new ConnectionMonitor();
      }, /Valid OpenClawClient with healthCheck method is required/);
    });

    it('should require client to have healthCheck method', () => {
      assert.throws(() => {
        // @ts-expect-error - testing invalid input
        new ConnectionMonitor({});
      }, /Valid OpenClawClient with healthCheck method is required/);
    });

    it('should accept valid client without conversationState', () => {
      const client = createMockClient();
      monitor = new ConnectionMonitor(client);
      assert.ok(monitor instanceof ConnectionMonitor);
    });

    it('should accept valid client with conversationState', () => {
      const client = createMockClient();
      const state = createMockConversationState();
      monitor = new ConnectionMonitor(client, state);
      assert.ok(monitor instanceof ConnectionMonitor);
    });

    it('should use default config', () => {
      const client = createMockClient();
      monitor = new ConnectionMonitor(client);
      assert.strictEqual(monitor.isRunning, false);
      assert.strictEqual(monitor.isConnected, false);
    });

    it('should accept custom config', () => {
      const client = createMockClient();
      monitor = new ConnectionMonitor(client, null, { pollIntervalMs: 1000 });
      assert.ok(monitor instanceof ConnectionMonitor);
    });
  });

  describe('start', () => {
    it('should return true on first start', () => {
      const client = createMockClient();
      monitor = new ConnectionMonitor(client);

      const result = monitor.start();

      assert.strictEqual(result, true);
      assert.strictEqual(monitor.isRunning, true);
    });

    it('should return false if already running', () => {
      const client = createMockClient();
      monitor = new ConnectionMonitor(client);

      monitor.start();
      const result = monitor.start();

      assert.strictEqual(result, false);
    });

    it('should perform immediate health check', async () => {
      const client = createMockClient(true);
      monitor = new ConnectionMonitor(client);
      const m = assertMonitor(monitor);

      const checkPromise = new Promise((resolve) => {
        m.on('checkComplete', resolve);
      });

      m.start();

      const event = await checkPromise;
      assert.deepStrictEqual(event, { connected: true });
      assert.strictEqual(client.healthCheck.mock.calls.length, 1);
    });

    it('should delay first check when initialDelayMs is set', async () => {
      const client = createMockClient(true);
      monitor = new ConnectionMonitor(client, null, { initialDelayMs: 50, pollIntervalMs: 100 });

      monitor.start();

      // Should not have checked immediately
      assert.strictEqual(client.healthCheck.mock.calls.length, 0);

      // Wait for the delay
      await new Promise((resolve) => setTimeout(resolve, 80));

      assert.strictEqual(client.healthCheck.mock.calls.length, 1);
    });
  });

  describe('stop', () => {
    it('should stop monitoring', () => {
      const client = createMockClient();
      monitor = new ConnectionMonitor(client);

      monitor.start();
      assert.strictEqual(monitor.isRunning, true);

      monitor.stop();
      assert.strictEqual(monitor.isRunning, false);
    });

    it('should not throw when not running', () => {
      const client = createMockClient();
      monitor = new ConnectionMonitor(client);

      // Should not throw
      monitor.stop();
      assert.strictEqual(monitor.isRunning, false);
    });

    it('should stop polling after stop', async () => {
      const client = createMockClient(true);
      monitor = new ConnectionMonitor(client, null, { pollIntervalMs: 50 });

      monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 20));

      const checkCountAtStop = monitor.getStats().checkCount;
      monitor.stop();

      // Wait for what would be more polling
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not have additional checks
      assert.strictEqual(monitor.getStats().checkCount, checkCountAtStop);
    });
  });

  describe('polling mechanism', () => {
    it('should poll at configured interval', async () => {
      const client = createMockClient(true);
      monitor = new ConnectionMonitor(client, null, { pollIntervalMs: 50 });

      monitor.start();

      // Wait for a few polling cycles
      await new Promise((resolve) => setTimeout(resolve, 180));

      // Should have at least 3-4 checks (initial + intervals)
      const stats = monitor.getStats();
      assert.ok(stats.checkCount >= 3, `Expected >= 3 checks, got ${stats.checkCount}`);
    });

    it('should use 5 second default polling interval (FR-8 requirement)', () => {
      assert.strictEqual(DEFAULT_MONITOR_CONFIG.pollIntervalMs, 5000);
    });
  });

  describe('state updates', () => {
    it('should update ConversationState on connect', async () => {
      const client = createMockClient(true);
      const state = createMockConversationState();
      monitor = new ConnectionMonitor(client, state);
      const m = assertMonitor(monitor);

      const checkPromise = new Promise((resolve) => {
        m.on('checkComplete', resolve);
      });

      m.start();
      await checkPromise;

      assert.strictEqual(state.setOpenclawConnected.mock.calls.length, 1);
      assert.deepStrictEqual(state.setOpenclawConnected.mock.calls[0].arguments, [true]);
      assert.strictEqual(state.openclawConnected, true);
    });

    it('should update ConversationState on disconnect', async () => {
      const client = createMockClient(false);
      const state = createMockConversationState();
      monitor = new ConnectionMonitor(client, state);
      const m = assertMonitor(monitor);

      const checkPromise = new Promise((resolve) => {
        m.on('checkComplete', resolve);
      });

      m.start();
      await checkPromise;

      assert.strictEqual(state.setOpenclawConnected.mock.calls.length, 1);
      assert.deepStrictEqual(state.setOpenclawConnected.mock.calls[0].arguments, [false]);
      assert.strictEqual(state.openclawConnected, false);
    });

    it('should emit connected event on status change to connected', async () => {
      const client = createMockClient(true);
      monitor = new ConnectionMonitor(client);
      const m = assertMonitor(monitor);

      const connectedPromise = new Promise((resolve) => {
        m.on('connected', resolve);
      });

      m.start();
      await connectedPromise;

      assert.strictEqual(m.isConnected, true);
    });

    it('should emit disconnected event on status change to disconnected', async () => {
      // Start connected, then disconnect
      let connectResult = true;
      const client = /** @type {any} */ ({
        healthCheck: mock.fn(() => Promise.resolve(connectResult))
      });
      monitor = new ConnectionMonitor(client, null, { pollIntervalMs: 50 });
      const m = assertMonitor(monitor);

      // Wait for initial connected state
      const connectedPromise = new Promise((resolve) => {
        m.on('connected', resolve);
      });
      m.start();
      await connectedPromise;

      // Now simulate disconnect
      connectResult = false;
      const disconnectedPromise = new Promise((resolve) => {
        m.on('disconnected', resolve);
      });

      // Wait for the disconnect event
      await disconnectedPromise;

      assert.strictEqual(m.isConnected, false);
    });

    it('should not emit duplicate events for same status', async () => {
      const client = createMockClient(true);
      monitor = new ConnectionMonitor(client, null, { pollIntervalMs: 30 });
      const m = assertMonitor(monitor);

      let connectedCount = 0;
      m.on('connected', () => connectedCount++);

      m.start();

      // Wait for multiple polls
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only emit connected once
      assert.strictEqual(connectedCount, 1);
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      const client = createMockClient();
      monitor = new ConnectionMonitor(client);

      const stats = monitor.getStats();

      assert.deepStrictEqual(stats, {
        checkCount: 0,
        consecutiveFailures: 0,
        isRunning: false,
        isConnected: false
      });
    });

    it('should track check count', async () => {
      const client = createMockClient(true);
      monitor = new ConnectionMonitor(client, null, { pollIntervalMs: 30 });

      monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = monitor.getStats();
      assert.ok(stats.checkCount >= 2);
    });

    it('should track consecutive failures', async () => {
      const client = createMockClient(false);
      monitor = new ConnectionMonitor(client, null, { pollIntervalMs: 30 });

      monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = monitor.getStats();
      assert.ok(stats.consecutiveFailures >= 2);
    });

    it('should reset consecutive failures on success', async () => {
      let healthy = false;
      const client = /** @type {any} */ ({
        healthCheck: mock.fn(() => Promise.resolve(healthy))
      });
      monitor = new ConnectionMonitor(client, null, { pollIntervalMs: 30 });

      monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Should have failures
      let stats = monitor.getStats();
      assert.ok(stats.consecutiveFailures >= 1);

      // Now succeed
      healthy = true;
      await new Promise((resolve) => setTimeout(resolve, 50));

      stats = monitor.getStats();
      assert.strictEqual(stats.consecutiveFailures, 0);
    });
  });

  describe('check (manual)', () => {
    it('should perform single health check', async () => {
      const client = createMockClient(true);
      monitor = new ConnectionMonitor(client);

      const result = await monitor.check();

      assert.strictEqual(result, true);
      assert.strictEqual(client.healthCheck.mock.calls.length, 1);
    });

    it('should update state on manual check', async () => {
      const client = createMockClient(true);
      const state = createMockConversationState();
      monitor = new ConnectionMonitor(client, state);

      await monitor.check();

      assert.strictEqual(state.openclawConnected, true);
    });

    it('should return false when healthCheck fails', async () => {
      const client = createMockClient(false);
      monitor = new ConnectionMonitor(client);

      const result = await monitor.check();

      assert.strictEqual(result, false);
    });
  });

  describe('error handling', () => {
    it('should emit error and return false when healthCheck throws', async () => {
      const client = /** @type {any} */ ({
        healthCheck: mock.fn(() => Promise.reject(new Error('Network error')))
      });
      monitor = new ConnectionMonitor(client);

      let errorEmitted = false;
      monitor.on('error', () => {
        errorEmitted = true;
      });

      const result = await monitor.check();

      assert.strictEqual(result, false);
      assert.strictEqual(errorEmitted, true);
      assert.strictEqual(monitor.isConnected, false);
    });

    it('should continue polling after error', async () => {
      let callCount = 0;
      const client = /** @type {any} */ ({
        healthCheck: mock.fn(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error('First call fails'));
          }
          return Promise.resolve(true);
        })
      });
      monitor = new ConnectionMonitor(client, null, { pollIntervalMs: 30 });

      // Suppress the error event from the first check
      monitor.on('error', () => {});

      monitor.start();

      // Wait for initial check to complete (and fail) plus a couple more polling cycles
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have continued polling after the error
      assert.ok(client.healthCheck.mock.calls.length >= 2,
        `Expected at least 2 health checks, got ${client.healthCheck.mock.calls.length}`);
    });
  });

  describe('dispose', () => {
    it('should stop monitoring and remove listeners', () => {
      const client = createMockClient();
      monitor = new ConnectionMonitor(client);

      let eventCount = 0;
      monitor.on('connected', () => eventCount++);

      monitor.start();
      monitor.dispose();

      assert.strictEqual(monitor.isRunning, false);
      // Verify listeners are removed
      assert.strictEqual(monitor.listenerCount('connected'), 0);
    });
  });

  describe('FR-8 compliance', () => {
    it('should detect connection status within 5 seconds (default config)', () => {
      // Verify default interval is 5000ms per FR-8
      assert.strictEqual(DEFAULT_MONITOR_CONFIG.pollIntervalMs, 5000);
    });

    it('should immediately detect status on start', async () => {
      const startTime = Date.now();
      const client = createMockClient(true);
      monitor = new ConnectionMonitor(client);
      const m = assertMonitor(monitor);

      const checkPromise = new Promise((resolve) => {
        m.on('checkComplete', resolve);
      });

      m.start();
      await checkPromise;

      const elapsed = Date.now() - startTime;

      // Should detect within a few ms, not 5 seconds
      assert.ok(elapsed < 100, `Detection took ${elapsed}ms, expected < 100ms`);
      assert.strictEqual(m.isConnected, true);
    });
  });
});

describe('createConnectionMonitor', () => {
  it('should create ConnectionMonitor instance', () => {
    const client = createMockClient();
    const monitor = createConnectionMonitor(client);
    try {
      assert.ok(monitor instanceof ConnectionMonitor);
    } finally {
      monitor.dispose();
    }
  });

  it('should pass all arguments to constructor', () => {
    const client = createMockClient();
    const state = createMockConversationState();
    const config = { pollIntervalMs: 1000 };

    const monitor = createConnectionMonitor(client, state, config);
    try {
      assert.ok(monitor instanceof ConnectionMonitor);
    } finally {
      monitor.dispose();
    }
  });
});

describe('DEFAULT_MONITOR_CONFIG', () => {
  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_MONITOR_CONFIG));
  });

  it('should have correct defaults', () => {
    assert.strictEqual(DEFAULT_MONITOR_CONFIG.pollIntervalMs, 5000);
    assert.strictEqual(DEFAULT_MONITOR_CONFIG.initialDelayMs, 0);
  });
});
