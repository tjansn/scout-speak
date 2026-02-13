/**
 * Tests for VADState
 *
 * Per T008 acceptance criteria:
 * - Tracks speech/silence state correctly
 * - Buffers audio during speech
 * - Emits events at state transitions
 * - Configurable thresholds
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  VADState,
  createVADState,
  DEFAULT_VAD_CONFIG
} from '../../../src/vad/vad-state.mjs';

/**
 * Create a mock audio frame
 * @param {number} samples - Number of samples
 * @param {number} value - Fill value
 * @returns {Int16Array}
 */
function createFrame(samples, value = 1000) {
  const frame = new Int16Array(samples);
  frame.fill(value);
  return frame;
}

describe('VADState', () => {
  /** @type {VADState} */
  let vad;
  /** @type {number} */
  let samplesPerFrame;

  beforeEach(() => {
    vad = new VADState({
      threshold: 0.5,
      silenceDurationMs: 300, // Shorter for testing
      minSpeechMs: 60,        // Shorter for testing
      sampleRate: 16000,
      frameDurationMs: 30
    });
    samplesPerFrame = 480; // 30ms at 16kHz
  });

  describe('initial state', () => {
    it('should start not in speech', () => {
      assert.strictEqual(vad.inSpeech, false);
    });

    it('should have zero counters', () => {
      assert.strictEqual(vad.silenceFrames, 0);
      assert.strictEqual(vad.speechFrames, 0);
    });

    it('should use configured threshold', () => {
      assert.strictEqual(vad.currentThreshold, 0.5);
    });
  });

  describe('speech detection', () => {
    it('should detect speech start when probability exceeds threshold', () => {
      const frame = createFrame(samplesPerFrame);
      const event = vad.update(0.6, frame);

      assert.deepStrictEqual(event, { type: 'speech_started' });
      assert.strictEqual(vad.inSpeech, true);
      assert.strictEqual(vad.speechFrames, 1);
    });

    it('should not emit event when probability is below threshold', () => {
      const frame = createFrame(samplesPerFrame);
      const event = vad.update(0.4, frame);

      assert.strictEqual(event, null);
      assert.strictEqual(vad.inSpeech, false);
    });

    it('should not emit event for continued speech', () => {
      const frame = createFrame(samplesPerFrame);

      const event1 = vad.update(0.6, frame);
      assert.deepStrictEqual(event1, { type: 'speech_started' });

      const event2 = vad.update(0.7, frame);
      assert.strictEqual(event2, null);

      assert.strictEqual(vad.speechFrames, 2);
    });
  });

  describe('silence duration tracking', () => {
    it('should track silence frames during speech', () => {
      const frame = createFrame(samplesPerFrame);

      // Start speech
      vad.update(0.6, frame);
      vad.update(0.7, frame);

      // Silence
      vad.update(0.3, frame);
      assert.strictEqual(vad.silenceFrames, 1);

      vad.update(0.2, frame);
      assert.strictEqual(vad.silenceFrames, 2);
    });

    it('should reset silence counter on resumed speech', () => {
      const frame = createFrame(samplesPerFrame);

      // Start speech
      vad.update(0.6, frame);
      vad.update(0.7, frame);

      // Brief silence
      vad.update(0.3, frame);
      assert.strictEqual(vad.silenceFrames, 1);

      // Resume speech
      vad.update(0.6, frame);
      assert.strictEqual(vad.silenceFrames, 0);
    });
  });

  describe('speech ended detection', () => {
    it('should emit speech_ended after silence threshold', () => {
      const frame = createFrame(samplesPerFrame);

      // Start speech (need enough frames to meet minSpeechMs)
      vad.update(0.6, frame); // speech_started
      vad.update(0.7, frame);
      vad.update(0.7, frame);

      // Silence for 300ms = 10 frames at 30ms each
      /** @type {import('../../../src/vad/vad-state.mjs').VADEvent|null} */
      let endEvent = null;
      for (let i = 0; i < 10; i++) {
        const event = vad.update(0.2, frame);
        if (event && event.type === 'speech_ended') {
          endEvent = event;
        }
      }

      assert.ok(endEvent, 'Should emit speech_ended');
      assert.strictEqual(endEvent?.type, 'speech_ended');
      assert.ok('audio' in endEvent && endEvent.audio instanceof Int16Array);
      assert.ok('durationMs' in endEvent && endEvent.durationMs > 0);
    });

    it('should reset state after speech ended', () => {
      const frame = createFrame(samplesPerFrame);

      // Complete speech cycle
      vad.update(0.6, frame);
      vad.update(0.7, frame);
      vad.update(0.7, frame);

      for (let i = 0; i < 10; i++) {
        vad.update(0.2, frame);
      }

      assert.strictEqual(vad.inSpeech, false);
      assert.strictEqual(vad.speechFrames, 0);
      assert.strictEqual(vad.silenceFrames, 0);
    });
  });

  describe('minimum speech duration filter', () => {
    it('should discard speech shorter than minimum', () => {
      const frame = createFrame(samplesPerFrame);

      // Very short speech (1 frame = 30ms, less than 60ms minimum)
      vad.update(0.6, frame); // speech_started

      // Immediate silence
      /** @type {import('../../../src/vad/vad-state.mjs').VADEvent|null} */
      let endEvent = null;
      for (let i = 0; i < 10; i++) {
        const event = vad.update(0.2, frame);
        if (event && event.type === 'speech_ended') {
          endEvent = event;
        }
      }

      // Should not emit speech_ended for too-short speech
      assert.strictEqual(endEvent, null);
      assert.strictEqual(vad.inSpeech, false);
    });

    it('should accept speech longer than minimum', () => {
      const frame = createFrame(samplesPerFrame);

      // Speech for 90ms (3 frames, > 60ms minimum)
      vad.update(0.6, frame);
      vad.update(0.7, frame);
      vad.update(0.7, frame);

      // Silence to trigger end
      /** @type {import('../../../src/vad/vad-state.mjs').VADEvent|null} */
      let endEvent = null;
      for (let i = 0; i < 10; i++) {
        const event = vad.update(0.2, frame);
        if (event && event.type === 'speech_ended') {
          endEvent = event;
        }
      }

      assert.ok(endEvent, 'Should emit speech_ended');
    });
  });

  describe('audio buffering', () => {
    it('should buffer audio during speech', () => {
      const frame1 = createFrame(samplesPerFrame, 100);
      const frame2 = createFrame(samplesPerFrame, 200);
      const frame3 = createFrame(samplesPerFrame, 300);

      vad.update(0.6, frame1);
      vad.update(0.7, frame2);
      vad.update(0.7, frame3);

      // Check buffered duration
      const bufferedMs = vad.getBufferedDurationMs();
      assert.strictEqual(bufferedMs, 90); // 3 frames * 30ms
    });

    it('should include silence frames in buffer', () => {
      const frame = createFrame(samplesPerFrame, 1000);

      // 3 speech frames
      vad.update(0.6, frame);
      vad.update(0.7, frame);
      vad.update(0.7, frame);

      // 2 silence frames (not enough to trigger end)
      vad.update(0.3, frame);
      vad.update(0.3, frame);

      const bufferedMs = vad.getBufferedDurationMs();
      assert.strictEqual(bufferedMs, 150); // 5 frames * 30ms
    });
  });

  describe('barge-in mode', () => {
    it('should use higher threshold in barge-in mode', () => {
      vad = new VADState({
        threshold: 0.5,
        bargeInThreshold: 0.7
      });

      assert.strictEqual(vad.currentThreshold, 0.5);

      vad.setBargeInMode(true);
      assert.strictEqual(vad.currentThreshold, 0.7);

      vad.setBargeInMode(false);
      assert.strictEqual(vad.currentThreshold, 0.5);
    });

    it('should not detect speech below barge-in threshold', () => {
      vad = new VADState({
        threshold: 0.5,
        bargeInThreshold: 0.7
      });
      vad.setBargeInMode(true);

      const frame = createFrame(480);
      const event = vad.update(0.6, frame); // Above normal, below barge-in

      assert.strictEqual(event, null);
      assert.strictEqual(vad.inSpeech, false);
    });

    it('should detect speech above barge-in threshold', () => {
      vad = new VADState({
        threshold: 0.5,
        bargeInThreshold: 0.7
      });
      vad.setBargeInMode(true);

      const frame = createFrame(480);
      const event = vad.update(0.8, frame);

      assert.deepStrictEqual(event, { type: 'speech_started' });
    });
  });

  describe('forceEnd', () => {
    it('should end speech immediately if long enough', () => {
      const frame = createFrame(samplesPerFrame);

      // Start speech
      vad.update(0.6, frame);
      vad.update(0.7, frame);
      vad.update(0.7, frame);

      const event = vad.forceEnd();

      assert.ok(event, 'Should return speech_ended event');
      assert.strictEqual(event?.type, 'speech_ended');
      assert.strictEqual(vad.inSpeech, false);
    });

    it('should return null if speech too short', () => {
      const frame = createFrame(samplesPerFrame);

      // Very short speech
      vad.update(0.6, frame);

      const event = vad.forceEnd();

      assert.strictEqual(event, null);
      assert.strictEqual(vad.inSpeech, false);
    });

    it('should return null if not in speech', () => {
      const event = vad.forceEnd();
      assert.strictEqual(event, null);
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      const frame = createFrame(samplesPerFrame);

      // Build up some state
      vad.update(0.6, frame);
      vad.update(0.7, frame);
      vad.setBargeInMode(true);

      vad.reset();

      assert.strictEqual(vad.inSpeech, false);
      assert.strictEqual(vad.speechFrames, 0);
      assert.strictEqual(vad.silenceFrames, 0);
      // bargeInMode should NOT be reset
      assert.strictEqual(vad.currentThreshold, 0.7);
    });
  });

  describe('getSnapshot', () => {
    it('should return complete state snapshot', () => {
      const frame = createFrame(samplesPerFrame);

      vad.update(0.6, frame);
      vad.update(0.7, frame);
      vad.setBargeInMode(true);

      const snapshot = vad.getSnapshot();

      assert.deepStrictEqual(snapshot, {
        inSpeech: true,
        silenceFrames: 0,
        speechFrames: 2,
        lastProbability: 0.7,
        bufferedMs: 60,
        bargeInMode: true
      });
    });
  });

  describe('processBatch', () => {
    it('should process multiple frames and return events', () => {
      const audio = new Int16Array(samplesPerFrame * 5);
      audio.fill(1000);

      const probabilities = [0.6, 0.7, 0.7, 0.2, 0.2];
      const events = vad.processBatch(probabilities, audio);

      // Should have speech_started from first frame
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'speech_started');
    });
  });

  describe('createVADState', () => {
    it('should create VADState with defaults', () => {
      const state = createVADState();
      assert.ok(state instanceof VADState);
      assert.strictEqual(state.currentThreshold, DEFAULT_VAD_CONFIG.threshold);
    });

    it('should create VADState with custom config', () => {
      const state = createVADState({ threshold: 0.6 });
      assert.strictEqual(state.currentThreshold, 0.6);
    });
  });
});
