// @ts-nocheck - Test file uses null assignment for cleanup
/**
 * Tests for WakeWordDetector
 *
 * Per T042 (FR-11) acceptance criteria:
 * - Given wake word is enabled in settings, when user says wake phrase, Scout begins listening
 * - Given wake word is disabled (default), then Scout only listens when manually activated
 * - Wake phrase configurable in config
 * - False positive rate acceptable
 *
 * Test Requirements:
 * - Unit test: wake word detection logic
 * - Unit test: enabled/disabled state handling
 * - Unit test: fuzzy matching behavior
 * - Unit test: remaining text extraction
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  WakeWordDetector,
  createWakeWordDetector,
  DEFAULT_WAKEWORD_CONFIG
} from '../../../src/wakeword/wake-word-detector.mjs';

describe('WakeWordDetector', () => {
  /** @type {WakeWordDetector} */
  let detector;

  afterEach(() => {
    if (detector) {
      detector.dispose();
      detector = null;
    }
  });

  describe('constructor', () => {
    it('should create detector with default config', () => {
      detector = new WakeWordDetector();

      assert.strictEqual(detector.isEnabled, false);
      assert.strictEqual(detector.wakePhrase, 'hey scout');
    });

    it('should accept custom wake phrase', () => {
      detector = new WakeWordDetector({
        wakePhrase: 'ok computer'
      });

      assert.strictEqual(detector.wakePhrase, 'ok computer');
    });

    it('should accept enabled state', () => {
      detector = new WakeWordDetector({
        enabled: true
      });

      assert.strictEqual(detector.isEnabled, true);
    });

    it('should accept custom min match score', () => {
      detector = new WakeWordDetector({
        minMatchScore: 0.9
      });

      assert.strictEqual(detector.config.minMatchScore, 0.9);
    });
  });

  describe('enable/disable', () => {
    beforeEach(() => {
      detector = new WakeWordDetector();
    });

    it('should enable detection', () => {
      detector.enable();

      assert.strictEqual(detector.isEnabled, true);
    });

    it('should disable detection', () => {
      detector.enable();
      detector.disable();

      assert.strictEqual(detector.isEnabled, false);
    });

    it('should set enabled state', () => {
      detector.setEnabled(true);
      assert.strictEqual(detector.isEnabled, true);

      detector.setEnabled(false);
      assert.strictEqual(detector.isEnabled, false);
    });
  });

  describe('setWakePhrase', () => {
    beforeEach(() => {
      detector = new WakeWordDetector({ enabled: true });
    });

    it('should update wake phrase', () => {
      detector.setWakePhrase('hello world');

      assert.strictEqual(detector.wakePhrase, 'hello world');
    });

    it('should detect new phrase after update', () => {
      detector.setWakePhrase('hello world');

      const result = detector.check('hello world');

      assert.ok(result);
      assert.strictEqual(result.matchScore, 1.0);
    });
  });

  describe('check - exact match', () => {
    beforeEach(() => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'hey scout'
      });
    });

    it('should detect exact wake phrase', () => {
      const result = detector.check('hey scout');

      assert.ok(result);
      assert.strictEqual(result.matchScore, 1.0);
      assert.strictEqual(result.wakePhrase, 'hey scout');
    });

    it('should detect wake phrase at start with remaining text', () => {
      const result = detector.check('hey scout what is the weather');

      assert.ok(result);
      assert.strictEqual(result.matchScore, 1.0);
      assert.strictEqual(result.remainingText, 'what is the weather');
    });

    it('should be case insensitive', () => {
      const result = detector.check('HEY SCOUT');

      assert.ok(result);
      assert.strictEqual(result.matchScore, 1.0);
    });

    it('should ignore punctuation', () => {
      const result = detector.check('Hey, Scout!');

      assert.ok(result);
      assert.strictEqual(result.matchScore, 1.0);
    });

    it('should handle extra whitespace', () => {
      const result = detector.check('hey   scout');

      assert.ok(result);
      assert.strictEqual(result.matchScore, 1.0);
    });

    it('should not detect when disabled', () => {
      detector.disable();

      const result = detector.check('hey scout');

      assert.strictEqual(result, null);
    });

    it('should return null for non-matching text', () => {
      const result = detector.check('hello there');

      assert.strictEqual(result, null);
    });

    it('should return null for empty input', () => {
      assert.strictEqual(detector.check(''), null);
      assert.strictEqual(detector.check(null), null);
      assert.strictEqual(detector.check(undefined), null);
    });

    it('should return null for partial match only', () => {
      const result = detector.check('hey');

      assert.strictEqual(result, null);
    });
  });

  describe('check - fuzzy match', () => {
    beforeEach(() => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'hey scout',
        minMatchScore: 0.7  // Lower threshold for testing fuzzy matches
      });
    });

    it('should detect similar phrases (minor typos)', () => {
      // "hay scout" has one character difference from "hey scout"
      const result = detector.check('hay scout');

      assert.ok(result, 'Should detect similar phrase');
      assert.ok(result.matchScore >= 0.7, 'Match score should be above threshold');
    });

    it('should not detect very different phrases', () => {
      const result = detector.check('goodbye world');

      assert.strictEqual(result, null);
    });

    it('should respect min match score', () => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'hey scout',
        minMatchScore: 0.99  // Very strict
      });

      // "hay scout" shouldn't match with strict threshold
      const result = detector.check('hay scout');

      assert.strictEqual(result, null);
    });
  });

  describe('processTranscript', () => {
    beforeEach(() => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'hey scout'
      });
    });

    it('should emit detected event on match', () => {
      let eventData = null;
      detector.on('detected', (data) => { eventData = data; });

      const result = detector.processTranscript('hey scout');

      assert.strictEqual(result, true);
      assert.ok(eventData);
      assert.strictEqual(eventData.wakePhrase, 'hey scout');
    });

    it('should emit not_detected event on no match', () => {
      let eventData = null;
      detector.on('not_detected', (data) => { eventData = data; });

      const result = detector.processTranscript('hello world');

      assert.strictEqual(result, false);
      assert.ok(eventData);
      assert.strictEqual(eventData.transcript, 'hello world');
    });

    it('should increment detection count', () => {
      detector.processTranscript('hey scout');
      detector.processTranscript('hey scout');
      detector.processTranscript('hey scout');

      const stats = detector.getStats();
      assert.strictEqual(stats.detectionCount, 3);
    });

    it('should increment miss count', () => {
      detector.processTranscript('hello');
      detector.processTranscript('world');

      const stats = detector.getStats();
      assert.strictEqual(stats.missCount, 2);
    });
  });

  describe('remaining text extraction', () => {
    beforeEach(() => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'hey scout'
      });
    });

    it('should extract remaining text after wake phrase', () => {
      const result = detector.check('hey scout what time is it');

      assert.ok(result);
      assert.strictEqual(result.remainingText, 'what time is it');
    });

    it('should have no remaining text for exact match', () => {
      const result = detector.check('hey scout');

      assert.ok(result);
      assert.strictEqual(result.remainingText, undefined);
    });

    it('should handle punctuation in remaining text', () => {
      const result = detector.check('hey scout, what is the weather?');

      assert.ok(result);
      assert.ok(result.remainingText);
      // Remaining text is normalized (punctuation removed)
      assert.ok(result.remainingText.includes('what'));
    });
  });

  describe('different wake phrases', () => {
    it('should detect single word phrase', () => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'computer'
      });

      const result = detector.check('computer play some music');

      assert.ok(result);
      assert.strictEqual(result.matchScore, 1.0);
      assert.strictEqual(result.remainingText, 'play some music');
    });

    it('should detect three word phrase', () => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'ok google assistant'
      });

      const result = detector.check('ok google assistant turn on the lights');

      assert.ok(result);
      assert.strictEqual(result.matchScore, 1.0);
    });

    it('should detect phrase with special characters in phrase', () => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'hey scout'  // Normal phrase
      });

      // Input with special chars
      const result = detector.check('Hey, Scout! What\'s up?');

      assert.ok(result);
      assert.strictEqual(result.matchScore, 1.0);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'hey scout'
      });
    });

    it('should return statistics', () => {
      const stats = detector.getStats();

      assert.strictEqual(stats.detectionCount, 0);
      assert.strictEqual(stats.missCount, 0);
      assert.strictEqual(stats.enabled, true);
      assert.strictEqual(stats.wakePhrase, 'hey scout');
    });

    it('should track detections and misses', () => {
      detector.processTranscript('hey scout');
      detector.processTranscript('hello');
      detector.processTranscript('hey scout do something');

      const stats = detector.getStats();
      assert.strictEqual(stats.detectionCount, 2);
      assert.strictEqual(stats.missCount, 1);
    });
  });

  describe('resetStats', () => {
    beforeEach(() => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'hey scout'
      });
    });

    it('should reset counters', () => {
      detector.processTranscript('hey scout');
      detector.processTranscript('hello');

      detector.resetStats();

      const stats = detector.getStats();
      assert.strictEqual(stats.detectionCount, 0);
      assert.strictEqual(stats.missCount, 0);
    });
  });

  describe('dispose', () => {
    it('should remove all listeners', () => {
      detector = new WakeWordDetector();
      detector.on('detected', () => {});
      detector.on('not_detected', () => {});

      assert.ok(detector.listenerCount('detected') > 0);

      detector.dispose();

      assert.strictEqual(detector.listenerCount('detected'), 0);
      assert.strictEqual(detector.listenerCount('not_detected'), 0);
    });
  });

  describe('createWakeWordDetector factory', () => {
    it('should create a WakeWordDetector instance', () => {
      detector = createWakeWordDetector();

      assert.ok(detector instanceof WakeWordDetector);
    });

    it('should pass config to constructor', () => {
      detector = createWakeWordDetector({
        enabled: true,
        wakePhrase: 'custom phrase'
      });

      assert.strictEqual(detector.isEnabled, true);
      assert.strictEqual(detector.wakePhrase, 'custom phrase');
    });
  });

  describe('DEFAULT_WAKEWORD_CONFIG', () => {
    it('should have expected defaults', () => {
      assert.strictEqual(DEFAULT_WAKEWORD_CONFIG.wakePhrase, 'hey scout');
      assert.strictEqual(DEFAULT_WAKEWORD_CONFIG.enabled, false);
      assert.strictEqual(DEFAULT_WAKEWORD_CONFIG.minMatchScore, 0.8);
    });

    it('should be frozen', () => {
      assert.ok(Object.isFrozen(DEFAULT_WAKEWORD_CONFIG));
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'hey scout'
      });
    });

    it('should handle very long input', () => {
      const longText = 'hey scout ' + 'a'.repeat(10000);
      const result = detector.check(longText);

      assert.ok(result);
      assert.strictEqual(result.matchScore, 1.0);
    });

    it('should handle unicode characters', () => {
      detector.setWakePhrase('hello world');
      const result = detector.check('hello world 你好');

      assert.ok(result);
    });

    it('should handle numbers in phrase', () => {
      detector.setWakePhrase('hey scout 2');
      const result = detector.check('hey scout 2 start');

      assert.ok(result);
    });

    it('should handle input that is only the wake phrase', () => {
      const result = detector.check('hey scout');

      assert.ok(result);
      assert.strictEqual(result.remainingText, undefined);
    });
  });

  describe('FR-11 acceptance criteria', () => {
    it('given wake word enabled, saying wake phrase returns detection', () => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'hey scout'
      });

      const result = detector.check('hey scout');

      assert.ok(result, 'Wake phrase should be detected when enabled');
    });

    it('given wake word disabled, saying wake phrase returns null', () => {
      detector = new WakeWordDetector({
        enabled: false,
        wakePhrase: 'hey scout'
      });

      const result = detector.check('hey scout');

      assert.strictEqual(result, null, 'Wake phrase should not be detected when disabled');
    });

    it('wake phrase should be configurable', () => {
      detector = new WakeWordDetector({
        enabled: true,
        wakePhrase: 'ok assistant'
      });

      // New phrase should work
      const result1 = detector.check('ok assistant');
      assert.ok(result1, 'Custom wake phrase should be detected');

      // Old phrase should not work
      const result2 = detector.check('hey scout');
      assert.strictEqual(result2, null, 'Default phrase should not be detected with custom phrase set');
    });
  });
});
