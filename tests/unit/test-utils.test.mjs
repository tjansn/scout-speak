/**
 * Tests for test utilities themselves
 * Ensures our testing infrastructure works correctly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createMockAudioBuffer,
  createMockSpeechAudio,
  createMockSilenceAudio,
  wait,
  createMockConfig,
  createMockEventEmitter,
  assertThrows,
  assertThrowsAsync
} from '../test-utils.mjs';

describe('Test Utilities', () => {
  describe('createMockAudioBuffer', () => {
    it('should create buffer with specified size', () => {
      const buffer = createMockAudioBuffer(100);
      assert.strictEqual(buffer.length, 100);
    });

    it('should fill buffer with zeros by default', () => {
      const buffer = createMockAudioBuffer(10);
      assert.ok(buffer.every(v => v === 0));
    });

    it('should fill buffer with specified value', () => {
      const buffer = createMockAudioBuffer(10, 1000);
      assert.ok(buffer.every(v => v === 1000));
    });
  });

  describe('createMockSpeechAudio', () => {
    it('should create buffer with correct duration', () => {
      const buffer = createMockSpeechAudio(100, 16000);
      // 100ms at 16kHz = 1600 samples
      assert.strictEqual(buffer.length, 1600);
    });

    it('should contain non-zero values (speech-like)', () => {
      const buffer = createMockSpeechAudio(100, 16000);
      const hasNonZero = buffer.some(v => v !== 0);
      assert.ok(hasNonZero, 'Buffer should contain non-zero values');
    });
  });

  describe('createMockSilenceAudio', () => {
    it('should create buffer with correct duration', () => {
      const buffer = createMockSilenceAudio(100, 16000);
      assert.strictEqual(buffer.length, 1600);
    });

    it('should contain all zeros', () => {
      const buffer = createMockSilenceAudio(100, 16000);
      assert.ok(buffer.every(v => v === 0));
    });
  });

  describe('wait', () => {
    it('should wait for specified duration', async () => {
      const start = Date.now();
      await wait(50);
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 45, `Expected at least 45ms, got ${elapsed}ms`);
    });
  });

  describe('createMockConfig', () => {
    it('should return default config', () => {
      const config = createMockConfig();
      assert.strictEqual(config.gateway_url, 'http://localhost:18789');
      assert.strictEqual(config.sample_rate, 16000);
    });

    it('should apply overrides', () => {
      const config = createMockConfig({ sample_rate: 48000 });
      assert.strictEqual(config.sample_rate, 48000);
      assert.strictEqual(config.gateway_url, 'http://localhost:18789');
    });
  });

  describe('createMockEventEmitter', () => {
    it('should handle event subscription and emission', () => {
      const emitter = createMockEventEmitter();
      /** @type {string|null} */
      let received = null;

      emitter.on('test', (/** @type {string} */ data) => { received = data; });
      emitter.emit('test', 'hello');

      assert.strictEqual(received, 'hello');
    });

    it('should support multiple handlers', () => {
      const emitter = createMockEventEmitter();
      /** @type {number[]} */
      const results = [];

      emitter.on('test', () => results.push(1));
      emitter.on('test', () => results.push(2));
      emitter.emit('test');

      assert.deepStrictEqual(results, [1, 2]);
    });

    it('should support handler removal', () => {
      const emitter = createMockEventEmitter();
      let count = 0;
      const handler = () => { count++; };

      emitter.on('test', handler);
      emitter.emit('test');
      emitter.off('test', handler);
      emitter.emit('test');

      assert.strictEqual(count, 1);
    });

    it('should track handler count', () => {
      const emitter = createMockEventEmitter();
      assert.strictEqual(emitter.getHandlerCount('test'), 0);

      emitter.on('test', () => {});
      assert.strictEqual(emitter.getHandlerCount('test'), 1);
    });
  });

  describe('assertThrows', () => {
    it('should pass when function throws expected error', () => {
      assertThrows(
        () => { throw new Error('Expected error'); },
        'Expected error'
      );
    });

    it('should pass with regex match', () => {
      assertThrows(
        () => { throw new Error('Error: something went wrong'); },
        /something went wrong/
      );
    });

    it('should fail when function does not throw', () => {
      assert.throws(
        () => assertThrows(() => {}, 'Expected error'),
        /Expected function to throw/
      );
    });
  });

  describe('assertThrowsAsync', () => {
    it('should pass when async function throws expected error', async () => {
      await assertThrowsAsync(
        async () => { throw new Error('Async error'); },
        'Async error'
      );
    });

    it('should fail when async function does not throw', async () => {
      await assert.rejects(
        assertThrowsAsync(async () => {}, 'Expected error'),
        /Expected async function to throw/
      );
    });
  });
});
