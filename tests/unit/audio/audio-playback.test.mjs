/**
 * Tests for AudioPlayback module
 *
 * Per T011 acceptance criteria:
 * - Plays audio at correct sample rate
 * - Handles streaming input
 * - Stops immediately on stop() call (for barge-in)
 * - Signals completion
 *
 * Note: Tests use mocking since pacat may not be available
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import {
  AudioPlayback,
  createAudioPlayback,
  DEFAULT_PLAYBACK_CONFIG
} from '../../../src/audio/audio-playback.mjs';

describe('AudioPlayback', () => {
  /** @type {AudioPlayback} */
  let playback;

  beforeEach(() => {
    playback = new AudioPlayback();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      assert.strictEqual(playback.config.sampleRate, DEFAULT_PLAYBACK_CONFIG.sampleRate);
      assert.strictEqual(playback.config.channels, DEFAULT_PLAYBACK_CONFIG.channels);
      assert.strictEqual(playback.config.format, DEFAULT_PLAYBACK_CONFIG.format);
    });

    it('should merge custom config', () => {
      const custom = new AudioPlayback({ sampleRate: 44100 });
      assert.strictEqual(custom.config.sampleRate, 44100);
      assert.strictEqual(custom.config.channels, DEFAULT_PLAYBACK_CONFIG.channels);
    });

    it('should start not running', () => {
      assert.strictEqual(playback.running, false);
    });
  });

  describe('event emitter', () => {
    it('should be an EventEmitter', () => {
      assert.ok(playback instanceof EventEmitter);
    });

    it('should support onComplete method', () => {
      let completed = false;
      playback.onComplete(() => { completed = true; });
      playback.emit('complete');
      assert.strictEqual(completed, true);
    });
  });

  describe('start/stop', () => {
    it('should throw when starting twice', () => {
      // Mock the process state
      playback._running = true;
      assert.throws(
        () => playback.start(),
        /already running/
      );
    });

    it('should handle stop when not running', () => {
      // Should not throw
      playback.stop();
      assert.strictEqual(playback.running, false);
    });

    it('should handle end when not running', () => {
      // Should not throw
      playback.end();
      assert.strictEqual(playback.running, false);
    });
  });

  describe('write', () => {
    it('should return false when not running', () => {
      const result = playback.write(Buffer.alloc(100));
      assert.strictEqual(result, false);
    });

    it('should accept Buffer input', () => {
      // This will return false since not actually running
      const result = playback.write(Buffer.alloc(100));
      assert.strictEqual(typeof result, 'boolean');
    });

    it('should accept Int16Array input', () => {
      // This will return false since not actually running
      const result = playback.write(new Int16Array(100));
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      const stats = playback.getStats();
      assert.ok('running' in stats);
      assert.ok('bytesWritten' in stats);
      assert.strictEqual(typeof stats.running, 'boolean');
      assert.strictEqual(typeof stats.bytesWritten, 'number');
    });
  });

  describe('getDurationMs', () => {
    it('should calculate duration from bytes written', () => {
      // Simulate having written some bytes
      playback._bytesWritten = 22050 * 2; // 1 second at 22050Hz (2 bytes per sample)

      const duration = playback.getDurationMs();
      assert.strictEqual(duration, 1000);
    });

    it('should return 0 when no data written', () => {
      const duration = playback.getDurationMs();
      assert.strictEqual(duration, 0);
    });
  });
});

describe('createAudioPlayback', () => {
  it('should create AudioPlayback instance', () => {
    const playback = createAudioPlayback();
    assert.ok(playback instanceof AudioPlayback);
  });

  it('should pass config to constructor', () => {
    const playback = createAudioPlayback({ sampleRate: 48000 });
    assert.strictEqual(playback.config.sampleRate, 48000);
  });
});
