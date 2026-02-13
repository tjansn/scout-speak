/**
 * Unit tests for Sentence Chunker
 *
 * Tests per T024 acceptance criteria:
 * - Text splits into sentences correctly
 * - First sentence synthesizes immediately
 * - Subsequent sentences pipeline behind playback
 * - Minimum chunk handling
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  splitIntoSentences,
  chunkSentences,
  endsWithPunctuation,
  estimateSentenceCount,
  DEFAULT_CHUNKER_CONFIG
} from '../../../src/tts/sentence-chunker.mjs';

describe('splitIntoSentences', () => {
  describe('basic splitting', () => {
    it('should split on period', () => {
      // Use longer sentences to exceed minChunkChars (20)
      const text = 'This is the first sentence here. This is the second sentence now.';
      const sentences = splitIntoSentences(text);
      assert.strictEqual(sentences.length, 2);
      assert.ok(sentences[0].includes('first sentence'));
      assert.ok(sentences[1].includes('second sentence'));
    });

    it('should split on exclamation mark', () => {
      const text = 'What an amazing thing to see! I cannot believe this happened!';
      const sentences = splitIntoSentences(text);
      assert.strictEqual(sentences.length, 2);
    });

    it('should split on question mark', () => {
      const text = 'How are you doing today? I am feeling quite fine now.';
      const sentences = splitIntoSentences(text);
      assert.strictEqual(sentences.length, 2);
    });

    it('should handle multiple punctuation', () => {
      const text = 'What?! Are you sure about that...';
      const sentences = splitIntoSentences(text);
      // Should handle this without crashing
      assert.ok(sentences.length >= 1);
    });

    it('should split short sentences with minChunkChars=0', () => {
      const text = 'Hello. World.';
      const sentences = splitIntoSentences(text, { minChunkChars: 0 });
      assert.strictEqual(sentences.length, 2);
    });
  });

  describe('minimum chunk handling', () => {
    it('should merge short sentences with minChunkChars', () => {
      const text = 'Hi. Yes.';
      const sentences = splitIntoSentences(text, { minChunkChars: 20 });
      // Should be merged since both are short
      assert.strictEqual(sentences.length, 1);
      assert.ok(sentences[0].includes('Hi') && sentences[0].includes('Yes'));
    });

    it('should keep long sentences separate', () => {
      const text = 'This is a longer sentence that exceeds minimum. This is another long one too.';
      const sentences = splitIntoSentences(text, { minChunkChars: 20 });
      assert.strictEqual(sentences.length, 2);
    });

    it('should respect custom minChunkChars', () => {
      const text = 'Hello world. Goodbye world.';
      // With lower threshold, should keep separate
      const sentences = splitIntoSentences(text, { minChunkChars: 5 });
      assert.strictEqual(sentences.length, 2);
    });
  });

  describe('edge cases', () => {
    it('should return empty array for null/undefined', () => {
      // @ts-ignore - testing invalid input
      assert.deepStrictEqual(splitIntoSentences(null), []);
      // @ts-ignore - testing invalid input
      assert.deepStrictEqual(splitIntoSentences(undefined), []);
    });

    it('should return empty array for empty string', () => {
      assert.deepStrictEqual(splitIntoSentences(''), []);
      assert.deepStrictEqual(splitIntoSentences('   '), []);
    });

    it('should handle text without punctuation', () => {
      const text = 'This is a sentence without ending punctuation';
      const sentences = splitIntoSentences(text);
      assert.strictEqual(sentences.length, 1);
      assert.strictEqual(sentences[0], text);
    });

    it('should trim whitespace', () => {
      const text = '  Hello world.   How are you.  ';
      const sentences = splitIntoSentences(text);
      sentences.forEach(s => {
        assert.strictEqual(s, s.trim());
      });
    });
  });

  describe('custom delimiters', () => {
    it('should accept custom delimiter regex', () => {
      const text = 'Hello there friend; world is amazing; test is great';
      const sentences = splitIntoSentences(text, { delimiters: /;/, minChunkChars: 5 });
      // Should split on semicolon
      assert.ok(sentences.length >= 2);
    });
  });
});

describe('chunkSentences', () => {
  it('should be a generator function', () => {
    const gen = chunkSentences('Hello. World.');
    assert.strictEqual(typeof gen.next, 'function');
  });

  it('should yield sentences', () => {
    const text = 'This is sentence one. This is sentence two.';
    const sentences = [...chunkSentences(text, { minChunkChars: 10 })];
    assert.strictEqual(sentences.length, 2);
  });

  it('should yield nothing for empty text', () => {
    const sentences = [...chunkSentences('')];
    assert.strictEqual(sentences.length, 0);
  });
});

describe('endsWithPunctuation', () => {
  it('should return true for period', () => {
    assert.strictEqual(endsWithPunctuation('Hello world.'), true);
  });

  it('should return true for exclamation', () => {
    assert.strictEqual(endsWithPunctuation('Hello!'), true);
  });

  it('should return true for question mark', () => {
    assert.strictEqual(endsWithPunctuation('How are you?'), true);
  });

  it('should return false without punctuation', () => {
    assert.strictEqual(endsWithPunctuation('Hello world'), false);
  });

  it('should return false for empty string', () => {
    assert.strictEqual(endsWithPunctuation(''), false);
  });

  it('should return false for null/undefined', () => {
    // @ts-ignore - testing invalid input
    assert.strictEqual(endsWithPunctuation(null), false);
    // @ts-ignore - testing invalid input
    assert.strictEqual(endsWithPunctuation(undefined), false);
  });

  it('should handle trailing whitespace', () => {
    assert.strictEqual(endsWithPunctuation('Hello.  '), true);
  });
});

describe('estimateSentenceCount', () => {
  it('should count sentences based on punctuation', () => {
    assert.strictEqual(estimateSentenceCount('Hello. World.'), 2);
    assert.strictEqual(estimateSentenceCount('Hello. World. Test.'), 3);
  });

  it('should count 1 for text without punctuation', () => {
    assert.strictEqual(estimateSentenceCount('Hello world'), 1);
  });

  it('should count 0 for empty text', () => {
    assert.strictEqual(estimateSentenceCount(''), 0);
    assert.strictEqual(estimateSentenceCount('   '), 0);
  });

  it('should return 0 for null/undefined', () => {
    // @ts-ignore - testing invalid input
    assert.strictEqual(estimateSentenceCount(null), 0);
    // @ts-ignore - testing invalid input
    assert.strictEqual(estimateSentenceCount(undefined), 0);
  });

  it('should count different punctuation', () => {
    assert.strictEqual(estimateSentenceCount('Hello! How? Yes.'), 3);
  });
});

describe('DEFAULT_CHUNKER_CONFIG', () => {
  it('should have expected defaults', () => {
    assert.ok(DEFAULT_CHUNKER_CONFIG.delimiters instanceof RegExp);
    assert.strictEqual(DEFAULT_CHUNKER_CONFIG.minChunkChars, 20);
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(DEFAULT_CHUNKER_CONFIG));
  });
});
