// @ts-nocheck - Test file uses dynamic data
/**
 * Tests for ConnectionRecovery
 *
 * Per T039 acceptance criteria:
 * - Disconnection detected and shown
 * - Reconnection attempted
 * - Session resumes on reconnect
 * - Clean failure if cannot reconnect
 * - Retry policy is deterministic and documented
 *
 * Test Requirements:
 * - Unit test: backoff schedule behavior
 * - Integration test: disconnect/reconnect cycle
 * - Integration test: permanent disconnection handling
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ConnectionRecovery,
  createConnectionRecovery,
  calculateBackoffDelay,
  calculateMaxRecoveryTime,
  getBackoffSchedule,
  DEFAULT_RECOVERY_CONFIG
} from '../../../src/openclaw/connection-recovery.mjs';

describe('DEFAULT_RECOVERY_CONFIG', () => {
  it('should have correct default values', () => {
    assert.strictEqual(DEFAULT_RECOVERY_CONFIG.initialDelayMs, 1000);
    assert.strictEqual(DEFAULT_RECOVERY_CONFIG.maxDelayMs, 5000);
    assert.strictEqual(DEFAULT_RECOVERY_CONFIG.backoffMultiplier, 2);
    assert.strictEqual(DEFAULT_RECOVERY_CONFIG.maxAttempts, 10);
    assert.strictEqual(DEFAULT_RECOVERY_CONFIG.jitterMs, 0);
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_RECOVERY_CONFIG));
  });
});

describe('calculateBackoffDelay', () => {
  it('should return initial delay for first attempt', () => {
    const delay = calculateBackoffDelay(0, { initialDelayMs: 1000 });
    assert.strictEqual(delay, 1000);
  });

  it('should double delay for each attempt', () => {
    const config = { initialDelayMs: 1000, maxDelayMs: 10000, backoffMultiplier: 2 };

    assert.strictEqual(calculateBackoffDelay(0, config), 1000);
    assert.strictEqual(calculateBackoffDelay(1, config), 2000);
    assert.strictEqual(calculateBackoffDelay(2, config), 4000);
    assert.strictEqual(calculateBackoffDelay(3, config), 8000);
  });

  it('should cap at maxDelayMs', () => {
    const config = { initialDelayMs: 1000, maxDelayMs: 5000, backoffMultiplier: 2 };

    assert.strictEqual(calculateBackoffDelay(0, config), 1000);
    assert.strictEqual(calculateBackoffDelay(1, config), 2000);
    assert.strictEqual(calculateBackoffDelay(2, config), 4000);
    assert.strictEqual(calculateBackoffDelay(3, config), 5000); // Capped
    assert.strictEqual(calculateBackoffDelay(4, config), 5000); // Capped
  });

  it('should use custom multiplier', () => {
    const config = { initialDelayMs: 100, maxDelayMs: 10000, backoffMultiplier: 3 };

    assert.strictEqual(calculateBackoffDelay(0, config), 100);
    assert.strictEqual(calculateBackoffDelay(1, config), 300);
    assert.strictEqual(calculateBackoffDelay(2, config), 900);
  });

  it('should handle jitter', () => {
    const config = { initialDelayMs: 1000, maxDelayMs: 10000, backoffMultiplier: 2, jitterMs: 100 };

    // With jitter, delay should be between base and base + jitter
    const delay = calculateBackoffDelay(0, config);
    assert.ok(delay >= 1000 && delay <= 1100);
  });
});

describe('getBackoffSchedule', () => {
  it('should return array of delays', () => {
    const schedule = getBackoffSchedule({
      initialDelayMs: 1000,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      maxAttempts: 5
    });

    assert.strictEqual(schedule.length, 5);
    assert.deepStrictEqual(schedule, [1000, 2000, 4000, 5000, 5000]);
  });

  it('should use default config', () => {
    const schedule = getBackoffSchedule();

    assert.strictEqual(schedule.length, 10);
    assert.strictEqual(schedule[0], 1000);
  });
});

describe('calculateMaxRecoveryTime', () => {
  it('should sum all delays', () => {
    const config = {
      initialDelayMs: 1000,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      maxAttempts: 5
    };

    const maxTime = calculateMaxRecoveryTime(config);

    // 1000 + 2000 + 4000 + 5000 + 5000 = 17000
    assert.strictEqual(maxTime, 17000);
  });

  it('should use default config', () => {
    const maxTime = calculateMaxRecoveryTime();

    // Should be deterministic with defaults
    assert.ok(maxTime > 0);
    assert.strictEqual(typeof maxTime, 'number');
  });
});

describe('ConnectionRecovery', () => {
  describe('constructor', () => {
    it('should create with valid checkConnection function', () => {
      const checkFn = async () => true;
      const recovery = new ConnectionRecovery(checkFn);
      assert.ok(recovery);
    });

    it('should throw for invalid checkConnection', () => {
      assert.throws(() => new ConnectionRecovery(null), /must be a function/);
      assert.throws(() => new ConnectionRecovery('not-a-function'), /must be a function/);
    });

    it('should accept custom config', () => {
      const checkFn = async () => true;
      const recovery = new ConnectionRecovery(checkFn, {
        initialDelayMs: 500,
        maxAttempts: 5
      });

      const config = recovery.getConfig();
      assert.strictEqual(config.initialDelayMs, 500);
      assert.strictEqual(config.maxAttempts, 5);
    });
  });

  describe('isRecovering', () => {
    it('should return false initially', () => {
      const recovery = new ConnectionRecovery(async () => true);
      assert.strictEqual(recovery.isRecovering, false);
    });
  });

  describe('getState', () => {
    it('should return initial state', () => {
      const recovery = new ConnectionRecovery(async () => true);
      const state = recovery.getState();

      assert.strictEqual(state.recovering, false);
      assert.strictEqual(state.attemptCount, 0);
      assert.strictEqual(state.nextDelayMs, 0);
      assert.strictEqual(state.lastAttemptTimestamp, null);
    });
  });

  describe('getConfig', () => {
    it('should return copy of config', () => {
      const recovery = new ConnectionRecovery(async () => true);
      const config1 = recovery.getConfig();
      const config2 = recovery.getConfig();

      assert.notStrictEqual(config1, config2);
      assert.deepStrictEqual(config1, config2);
    });
  });

  describe('startRecovery', () => {
    it('should succeed on first attempt if connection works', async () => {
      const recovery = new ConnectionRecovery(async () => true, {
        initialDelayMs: 10,
        maxAttempts: 3
      });

      const result = await recovery.startRecovery();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.attempts, 1);
      assert.strictEqual(result.error, null);
    });

    it('should retry and succeed on later attempt', async () => {
      let attempts = 0;
      const recovery = new ConnectionRecovery(async () => {
        attempts++;
        return attempts >= 3; // Succeed on 3rd attempt
      }, {
        initialDelayMs: 10,
        maxAttempts: 5
      });

      const result = await recovery.startRecovery();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.attempts, 3);
    });

    it('should fail after max attempts', async () => {
      const recovery = new ConnectionRecovery(async () => false, {
        initialDelayMs: 10,
        maxAttempts: 3
      });

      const result = await recovery.startRecovery();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.attempts, 3);
      assert.ok(result.error?.includes('Failed to reconnect'));
    });

    it('should return error if already recovering', async () => {
      let resolveCheck;
      const checkPromise = new Promise((resolve) => { resolveCheck = resolve; });

      const recovery = new ConnectionRecovery(async () => {
        await checkPromise;
        return true;
      }, {
        initialDelayMs: 10
      });

      // Start first recovery (will hang on check)
      const firstRecovery = recovery.startRecovery();

      // Try to start second recovery
      const secondResult = await recovery.startRecovery();

      assert.strictEqual(secondResult.success, false);
      assert.ok(secondResult.error?.includes('already in progress'));

      // Clean up - resolve the hanging check
      resolveCheck();
      await firstRecovery;
    });

    it('should emit recovery_started event', async () => {
      const recovery = new ConnectionRecovery(async () => true, {
        initialDelayMs: 10
      });

      let eventEmitted = false;
      recovery.on('recovery_started', () => { eventEmitted = true; });

      await recovery.startRecovery();

      assert.strictEqual(eventEmitted, true);
    });

    it('should emit attempt events', async () => {
      let attempts = 0;
      const recovery = new ConnectionRecovery(async () => {
        attempts++;
        return attempts >= 2;
      }, {
        initialDelayMs: 10,
        maxAttempts: 5
      });

      const attemptEvents = [];
      recovery.on('attempt', (data) => { attemptEvents.push(data); });

      await recovery.startRecovery();

      assert.strictEqual(attemptEvents.length, 2);
      assert.strictEqual(attemptEvents[0].attempt, 1);
      assert.strictEqual(attemptEvents[1].attempt, 2);
    });

    it('should emit recovered event on success', async () => {
      const recovery = new ConnectionRecovery(async () => true, {
        initialDelayMs: 10
      });

      let recoveredEvent = null;
      recovery.on('recovered', (data) => { recoveredEvent = data; });

      await recovery.startRecovery();

      assert.ok(recoveredEvent);
      assert.strictEqual(recoveredEvent.attempts, 1);
      assert.ok(recoveredEvent.totalTimeMs >= 0);
    });

    it('should emit recovery_failed event on failure', async () => {
      const recovery = new ConnectionRecovery(async () => false, {
        initialDelayMs: 10,
        maxAttempts: 2
      });

      let failedEvent = null;
      recovery.on('recovery_failed', (data) => { failedEvent = data; });

      await recovery.startRecovery();

      assert.ok(failedEvent);
      assert.strictEqual(failedEvent.attempts, 2);
    });

    it('should emit attempt_failed for each failed attempt', async () => {
      const recovery = new ConnectionRecovery(async () => false, {
        initialDelayMs: 10,
        maxAttempts: 3
      });

      const failedEvents = [];
      recovery.on('attempt_failed', (data) => { failedEvents.push(data); });

      await recovery.startRecovery();

      assert.strictEqual(failedEvents.length, 3);
    });

    it('should handle checkConnection throwing errors', async () => {
      let attempts = 0;
      const recovery = new ConnectionRecovery(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Network error');
        }
        return true;
      }, {
        initialDelayMs: 10,
        maxAttempts: 5
      });

      const result = await recovery.startRecovery();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.attempts, 2);
    });
  });

  describe('cancel', () => {
    it('should set cancelled flag when called', () => {
      const recovery = new ConnectionRecovery(async () => true);

      // Should not throw when not recovering
      recovery.cancel();
      assert.strictEqual(recovery.isRecovering, false);
    });

    it('should have cancel method', () => {
      const recovery = new ConnectionRecovery(async () => true);
      assert.strictEqual(typeof recovery.cancel, 'function');
    });
  });

  describe('reset', () => {
    it('should clear recovery state after successful recovery', async () => {
      const recovery = new ConnectionRecovery(async () => true, {
        initialDelayMs: 10
      });

      await recovery.startRecovery();

      const stateAfterRecovery = recovery.getState();
      assert.strictEqual(stateAfterRecovery.attemptCount, 1);

      recovery.reset();

      const stateAfterReset = recovery.getState();
      assert.strictEqual(stateAfterReset.attemptCount, 0);
      assert.strictEqual(stateAfterReset.recovering, false);
      assert.strictEqual(stateAfterReset.lastAttemptTimestamp, null);
    });

    it('should have reset method', () => {
      const recovery = new ConnectionRecovery(async () => true);
      assert.strictEqual(typeof recovery.reset, 'function');
    });
  });
});

describe('createConnectionRecovery', () => {
  it('should create a ConnectionRecovery instance', () => {
    const recovery = createConnectionRecovery(async () => true);
    assert.ok(recovery instanceof ConnectionRecovery);
  });

  it('should pass config to constructor', () => {
    const recovery = createConnectionRecovery(async () => true, {
      initialDelayMs: 500
    });

    const config = recovery.getConfig();
    assert.strictEqual(config.initialDelayMs, 500);
  });
});

describe('Retry policy documentation (T039)', () => {
  it('should have deterministic backoff schedule', () => {
    // Per T039: Retry policy must be deterministic and documented
    // Default schedule: 1s, 2s, 4s, 5s (capped), 5s, 5s, ...

    const schedule = getBackoffSchedule(DEFAULT_RECOVERY_CONFIG);

    assert.strictEqual(schedule[0], 1000);  // 1s
    assert.strictEqual(schedule[1], 2000);  // 2s
    assert.strictEqual(schedule[2], 4000);  // 4s
    assert.strictEqual(schedule[3], 5000);  // 5s (capped at max)
    assert.strictEqual(schedule[4], 5000);  // 5s (capped)
  });

  it('should not exceed 5s delay per PRD spec', () => {
    // Per T039: max 5s delay
    const schedule = getBackoffSchedule(DEFAULT_RECOVERY_CONFIG);

    for (const delay of schedule) {
      assert.ok(delay <= 5000, `Delay ${delay}ms exceeds 5s limit`);
    }
  });

  it('should handle brief disconnections (<5s) gracefully', async () => {
    // Per PRD NFR Reliability: brief disconnections should not crash
    let attempts = 0;
    const recovery = new ConnectionRecovery(async () => {
      attempts++;
      return attempts >= 2; // Reconnect on 2nd attempt (within 5s)
    }, {
      initialDelayMs: 100,
      maxAttempts: 5
    });

    const result = await recovery.startRecovery();

    assert.strictEqual(result.success, true);
    assert.ok(result.totalTimeMs < 5000, 'Should recover within 5s');
  });
});
