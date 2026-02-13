/**
 * Tests for AudioCapture module
 *
 * Per T010 acceptance criteria:
 * - FR-1: Captures voice ready for transcription
 * - Outputs correct format (16kHz, mono, s16le)
 * - Handles process errors gracefully
 * - Clean shutdown on stop()
 *
 * Note: Tests use mocking since parecord may not be available
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import {
  AudioCapture,
  createAudioCapture,
  DEFAULT_CAPTURE_CONFIG
} from '../../../src/audio/audio-capture.mjs';

describe('AudioCapture', () => {
  /** @type {AudioCapture} */
  let capture;

  beforeEach(() => {
    capture = new AudioCapture();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      assert.strictEqual(capture.config.sampleRate, DEFAULT_CAPTURE_CONFIG.sampleRate);
      assert.strictEqual(capture.config.channels, DEFAULT_CAPTURE_CONFIG.channels);
      assert.strictEqual(capture.config.format, DEFAULT_CAPTURE_CONFIG.format);
    });

    it('should merge custom config', () => {
      const custom = new AudioCapture({ sampleRate: 48000 });
      assert.strictEqual(custom.config.sampleRate, 48000);
      assert.strictEqual(custom.config.channels, DEFAULT_CAPTURE_CONFIG.channels);
    });

    it('should start not running', () => {
      assert.strictEqual(capture.running, false);
    });
  });

  describe('event emitter', () => {
    it('should be an EventEmitter', () => {
      assert.ok(capture instanceof EventEmitter);
    });

    it('should support onChunk method', () => {
      let received = false;
      capture.onChunk(() => { received = true; });
      capture.emit('chunk', new Int16Array(10));
      assert.strictEqual(received, true);
    });
  });

  describe('start/stop', () => {
    it('should throw when starting twice', () => {
      // Mock the process
      capture._running = true;
      assert.throws(
        () => capture.start(),
        /already running/
      );
    });

    it('should handle stop when not running', () => {
      // Should not throw
      capture.stop();
      assert.strictEqual(capture.running, false);
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      const stats = capture.getStats();
      assert.ok('running' in stats);
      assert.ok('pendingBytes' in stats);
      assert.strictEqual(typeof stats.running, 'boolean');
      assert.strictEqual(typeof stats.pendingBytes, 'number');
    });
  });

  describe('_handleData (internal)', () => {
    it('should emit chunks when enough data received', () => {
      /** @type {Int16Array[]} */
      const chunks = [];
      capture.onChunk((chunk) => chunks.push(chunk));

      // 480 samples * 2 bytes = 960 bytes for one chunk
      const data = Buffer.alloc(960);
      // @ts-expect-error - Testing private method
      capture._handleData(data);

      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].length, 480);
    });

    it('should buffer partial data', () => {
      /** @type {Int16Array[]} */
      const chunks = [];
      capture.onChunk((chunk) => chunks.push(chunk));

      // Send partial chunk
      // @ts-expect-error - Testing private method
      capture._handleData(Buffer.alloc(500));
      assert.strictEqual(chunks.length, 0);
      assert.strictEqual(capture.getStats().pendingBytes, 500);

      // Complete the chunk
      // @ts-expect-error - Testing private method
      capture._handleData(Buffer.alloc(460));
      assert.strictEqual(chunks.length, 1);
    });

    it('should emit multiple chunks from large buffer', () => {
      /** @type {Int16Array[]} */
      const chunks = [];
      capture.onChunk((chunk) => chunks.push(chunk));

      // 3 complete chunks worth of data
      // @ts-expect-error - Testing private method
      capture._handleData(Buffer.alloc(960 * 3));

      assert.strictEqual(chunks.length, 3);
    });
  });
});

describe('createAudioCapture', () => {
  it('should create AudioCapture instance', () => {
    const capture = createAudioCapture();
    assert.ok(capture instanceof AudioCapture);
  });

  it('should pass config to constructor', () => {
    const capture = createAudioCapture({ sampleRate: 44100 });
    assert.strictEqual(capture.config.sampleRate, 44100);
  });
});
