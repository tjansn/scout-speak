/**
 * Tests for PulseAudio utilities
 *
 * Per T009 acceptance criteria:
 * - Detects if PulseAudio is running
 * - Starts PulseAudio if not running
 * - Fails gracefully with clear error if cannot start
 *
 * Note: Some tests may be skipped in environments without PulseAudio
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isPulseAudioRunning,
  startPulseAudio,
  ensurePulseAudio,
  isParecordAvailable,
  isPacatAvailable,
  checkPulseAudioTools,
  getDefaultDevices
} from '../../../src/audio/pulseaudio.mjs';

describe('PulseAudio', () => {
  describe('isPulseAudioRunning', () => {
    it('should return a boolean', () => {
      const result = isPulseAudioRunning();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('startPulseAudio', () => {
    it('should return a promise that resolves to boolean', async () => {
      const result = await startPulseAudio();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('ensurePulseAudio', () => {
    it('should return status object with running and error fields', async () => {
      const status = await ensurePulseAudio();

      assert.ok('running' in status);
      assert.ok('error' in status);
      assert.strictEqual(typeof status.running, 'boolean');

      if (!status.running) {
        assert.strictEqual(typeof status.error, 'string');
      } else {
        assert.strictEqual(status.error, null);
      }
    });
  });

  describe('isParecordAvailable', () => {
    it('should return a boolean', () => {
      const result = isParecordAvailable();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('isPacatAvailable', () => {
    it('should return a boolean', () => {
      const result = isPacatAvailable();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('checkPulseAudioTools', () => {
    it('should return object with available and missing fields', () => {
      const result = checkPulseAudioTools();

      assert.ok('available' in result);
      assert.ok('missing' in result);
      assert.strictEqual(typeof result.available, 'boolean');
      assert.ok(Array.isArray(result.missing));
    });

    it('should have consistent available field', () => {
      const result = checkPulseAudioTools();

      // available should be true only if missing is empty
      assert.strictEqual(result.available, result.missing.length === 0);
    });
  });

  describe('getDefaultDevices', () => {
    it('should return object with source and sink fields', () => {
      const devices = getDefaultDevices();

      assert.ok('source' in devices);
      assert.ok('sink' in devices);

      // Fields are either string or null
      assert.ok(devices.source === null || typeof devices.source === 'string');
      assert.ok(devices.sink === null || typeof devices.sink === 'string');
    });
  });
});

// Integration tests (only run if PulseAudio is available)
describe('PulseAudio Integration', () => {
  it('should detect running state correctly', async () => {
    const _initialRunning = isPulseAudioRunning();
    const status = await ensurePulseAudio();

    // If we could ensure it, it should be running
    if (status.running) {
      const nowRunning = isPulseAudioRunning();
      assert.strictEqual(nowRunning, true);
    }
  });
});
