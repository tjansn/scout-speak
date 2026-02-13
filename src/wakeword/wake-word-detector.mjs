/**
 * WakeWordDetector - STT-based keyword spotting for hands-free activation
 *
 * Per T042 (FR-11) and IMPLEMENTATION_PLAN.md:
 * - Optional wake word support for hands-free activation
 * - Off by default (to save battery and avoid false triggers)
 * - When enabled, only starts listening after wake phrase detected
 * - Uses STT-based keyword spotting (exact phrase match from STT)
 *
 * Implementation approach:
 * - Leverages existing VAD + STT pipeline for continuous low-power listening
 * - Compares transcripts against configured wake phrase
 * - Normalizes both for case-insensitive, punctuation-tolerant matching
 *
 * Events:
 * - 'detected': Wake word detected in transcript
 * - 'not_detected': Speech ended but no wake word found
 */

import { EventEmitter } from 'events';

/**
 * @typedef {Object} WakeWordDetectorConfig
 * @property {string} [wakePhrase='hey scout'] - Wake word phrase to detect
 * @property {boolean} [enabled=false] - Whether wake word detection is enabled
 * @property {number} [minMatchScore=0.8] - Minimum fuzzy match score (0-1)
 */

/**
 * @typedef {Object} WakeWordDetectedEvent
 * @property {string} transcript - The transcript that matched
 * @property {string} wakePhrase - The configured wake phrase
 * @property {number} matchScore - How well it matched (0-1)
 * @property {string} [remainingText] - Text after the wake phrase (if any)
 */

/**
 * Default configuration
 */
export const DEFAULT_WAKEWORD_CONFIG = Object.freeze({
  wakePhrase: 'hey scout',
  enabled: false,
  minMatchScore: 0.8
});

/**
 * WakeWordDetector - Detects wake phrases in transcribed speech
 *
 * @extends EventEmitter
 */
export class WakeWordDetector extends EventEmitter {
  /**
   * Create a new WakeWordDetector
   * @param {WakeWordDetectorConfig} [config={}] - Configuration
   */
  constructor(config = {}) {
    super();

    /** @type {WakeWordDetectorConfig} */
    this.config = { ...DEFAULT_WAKEWORD_CONFIG, ...config };

    /** @type {boolean} */
    this._enabled = this.config.enabled ?? false;

    /** @type {string} */
    this._wakePhrase = this._normalizeText(this.config.wakePhrase ?? 'hey scout');

    /** @type {string[]} */
    this._wakePhraseWords = this._wakePhrase.split(/\s+/).filter(w => w.length > 0);

    /** @type {number} */
    this._detectionCount = 0;

    /** @type {number} */
    this._missCount = 0;
  }

  /**
   * Check if wake word detection is enabled
   * @returns {boolean}
   */
  get isEnabled() {
    return this._enabled;
  }

  /**
   * Get the configured wake phrase
   * @returns {string}
   */
  get wakePhrase() {
    return this.config.wakePhrase ?? 'hey scout';
  }

  /**
   * Enable wake word detection
   */
  enable() {
    this._enabled = true;
  }

  /**
   * Disable wake word detection
   */
  disable() {
    this._enabled = false;
  }

  /**
   * Set enabled state
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = enabled;
  }

  /**
   * Update the wake phrase
   * @param {string} phrase - New wake phrase
   */
  setWakePhrase(phrase) {
    this.config.wakePhrase = phrase;
    this._wakePhrase = this._normalizeText(phrase);
    this._wakePhraseWords = this._wakePhrase.split(/\s+/).filter(w => w.length > 0);
  }

  /**
   * Check if a transcript contains the wake phrase
   *
   * @param {string} transcript - Transcribed speech to check
   * @returns {WakeWordDetectedEvent|null} Detection result or null if not detected
   */
  check(transcript) {
    if (!this._enabled) {
      return null;
    }

    if (!transcript || typeof transcript !== 'string') {
      return null;
    }

    const normalizedTranscript = this._normalizeText(transcript);
    const transcriptWords = normalizedTranscript.split(/\s+/).filter(w => w.length > 0);

    // Check for exact phrase match at the start
    const exactMatch = this._checkExactMatch(normalizedTranscript, transcriptWords);
    if (exactMatch) {
      return exactMatch;
    }

    // Check for fuzzy match
    const fuzzyMatch = this._checkFuzzyMatch(transcriptWords);
    if (fuzzyMatch) {
      return fuzzyMatch;
    }

    return null;
  }

  /**
   * Process a transcript and emit appropriate events
   *
   * @param {string} transcript - Transcribed speech
   * @returns {boolean} True if wake word was detected
   */
  processTranscript(transcript) {
    const result = this.check(transcript);

    if (result) {
      this._detectionCount++;
      this.emit('detected', result);
      return true;
    } else {
      this._missCount++;
      this.emit('not_detected', { transcript });
      return false;
    }
  }

  /**
   * Check for exact phrase match at the start of transcript
   *
   * @param {string} normalizedTranscript - Normalized transcript
   * @param {string[]} transcriptWords - Words from transcript
   * @returns {WakeWordDetectedEvent|null}
   * @private
   */
  _checkExactMatch(normalizedTranscript, transcriptWords) {
    // Check if transcript starts with wake phrase
    if (normalizedTranscript.startsWith(this._wakePhrase)) {
      const remainingText = normalizedTranscript.slice(this._wakePhrase.length).trim();
      return {
        transcript: normalizedTranscript,
        wakePhrase: this.wakePhrase,
        matchScore: 1.0,
        remainingText: remainingText || undefined
      };
    }

    // Check if first N words match wake phrase words
    if (transcriptWords.length >= this._wakePhraseWords.length) {
      const firstWords = transcriptWords.slice(0, this._wakePhraseWords.length);
      if (this._arraysEqual(firstWords, this._wakePhraseWords)) {
        const remainingWords = transcriptWords.slice(this._wakePhraseWords.length);
        return {
          transcript: normalizedTranscript,
          wakePhrase: this.wakePhrase,
          matchScore: 1.0,
          remainingText: remainingWords.length > 0 ? remainingWords.join(' ') : undefined
        };
      }
    }

    return null;
  }

  /**
   * Check for fuzzy match of wake phrase
   *
   * @param {string[]} transcriptWords - Words from transcript
   * @returns {WakeWordDetectedEvent|null}
   * @private
   */
  _checkFuzzyMatch(transcriptWords) {
    if (transcriptWords.length < this._wakePhraseWords.length) {
      return null;
    }

    // Check first N words with fuzzy matching
    const firstWords = transcriptWords.slice(0, this._wakePhraseWords.length);
    let totalScore = 0;

    for (let i = 0; i < this._wakePhraseWords.length; i++) {
      const score = this._wordSimilarity(firstWords[i], this._wakePhraseWords[i]);
      totalScore += score;
    }

    const avgScore = totalScore / this._wakePhraseWords.length;
    const minScore = this.config.minMatchScore ?? 0.8;

    if (avgScore >= minScore) {
      const remainingWords = transcriptWords.slice(this._wakePhraseWords.length);
      return {
        transcript: transcriptWords.join(' '),
        wakePhrase: this.wakePhrase,
        matchScore: avgScore,
        remainingText: remainingWords.length > 0 ? remainingWords.join(' ') : undefined
      };
    }

    return null;
  }

  /**
   * Calculate similarity between two words (0-1)
   *
   * Uses simple edit distance-based similarity
   *
   * @param {string} word1
   * @param {string} word2
   * @returns {number}
   * @private
   */
  _wordSimilarity(word1, word2) {
    if (word1 === word2) return 1.0;

    const len1 = word1.length;
    const len2 = word2.length;
    const maxLen = Math.max(len1, len2);

    if (maxLen === 0) return 1.0;

    // Simple Levenshtein distance
    const distance = this._levenshteinDistance(word1, word2);
    return 1 - (distance / maxLen);
  }

  /**
   * Calculate Levenshtein edit distance between two strings
   *
   * @param {string} s1
   * @param {string} s2
   * @returns {number}
   * @private
   */
  _levenshteinDistance(s1, s2) {
    const m = s1.length;
    const n = s2.length;

    // Create distance matrix
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    // Initialize base cases
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    // Fill in the rest
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(
            dp[i - 1][j],     // deletion
            dp[i][j - 1],     // insertion
            dp[i - 1][j - 1]  // substitution
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Normalize text for comparison
   *
   * @param {string} text
   * @returns {string}
   * @private
   */
  _normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim();
  }

  /**
   * Check if two arrays are equal
   *
   * @param {string[]} arr1
   * @param {string[]} arr2
   * @returns {boolean}
   * @private
   */
  _arraysEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
      if (arr1[i] !== arr2[i]) return false;
    }
    return true;
  }

  /**
   * Get detection statistics
   * @returns {{detectionCount: number, missCount: number, enabled: boolean, wakePhrase: string}}
   */
  getStats() {
    return {
      detectionCount: this._detectionCount,
      missCount: this._missCount,
      enabled: this._enabled,
      wakePhrase: this.wakePhrase
    };
  }

  /**
   * Reset detection counters
   */
  resetStats() {
    this._detectionCount = 0;
    this._missCount = 0;
  }

  /**
   * Dispose of resources
   */
  dispose() {
    this.removeAllListeners();
  }
}

/**
 * Create a WakeWordDetector instance
 *
 * @param {WakeWordDetectorConfig} [config={}] - Configuration
 * @returns {WakeWordDetector}
 */
export function createWakeWordDetector(config = {}) {
  return new WakeWordDetector(config);
}

export default WakeWordDetector;
