/**
 * Sentence Chunker - Split text into sentences for streaming TTS
 *
 * Per T024 and specs/algorithm_and_data_structures.md:
 * - Split text into sentences using punctuation (. ! ?)
 * - Enable streaming playback: synthesize and play incrementally
 * - First audio plays after first sentence synthesized (not waiting for full response)
 *
 * Configuration:
 * - sentence_delimiters: regex for splitting (default: /[.!?]+/)
 * - min_chunk_chars: minimum chars before synthesis (default: 20)
 */

/**
 * @typedef {Object} SentenceChunkerConfig
 * @property {RegExp} [delimiters=/[.!?]+/] - Regex for sentence delimiters
 * @property {number} [minChunkChars=20] - Minimum characters per chunk
 */

/**
 * Default configuration
 */
export const DEFAULT_CHUNKER_CONFIG = Object.freeze({
  delimiters: /[.!?]+/,
  minChunkChars: 20
});

/**
 * Split text into sentences
 *
 * @param {string} text - Text to split
 * @param {Partial<SentenceChunkerConfig>} [config={}] - Configuration
 * @returns {string[]} Array of sentences
 */
export function splitIntoSentences(text, config = {}) {
  const { delimiters = DEFAULT_CHUNKER_CONFIG.delimiters, minChunkChars = DEFAULT_CHUNKER_CONFIG.minChunkChars } = config;

  if (!text || typeof text !== 'string') {
    return [];
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  // Split by sentence-ending punctuation, keeping the punctuation
  const parts = trimmed.split(new RegExp(`(${delimiters.source})`, 'g'));

  const sentences = [];
  let current = '';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (!part) continue;

    // If this part is punctuation, append to current sentence
    if (delimiters.test(part)) {
      current += part;
      // If we have enough characters, save as a sentence
      if (current.trim().length >= minChunkChars) {
        sentences.push(current.trim());
        current = '';
      }
    } else {
      // If current already has content and this is new text, save current first
      if (current.trim() && current.trim().length >= minChunkChars) {
        sentences.push(current.trim());
        current = '';
      }
      current += part;
    }
  }

  // Handle remaining text
  if (current.trim()) {
    // If there's a previous sentence that's short, merge with it
    if (sentences.length > 0 && sentences[sentences.length - 1].length < minChunkChars) {
      sentences[sentences.length - 1] += ' ' + current.trim();
    } else if (current.trim().length < minChunkChars && sentences.length > 0) {
      // If remaining text is short, merge with last sentence
      sentences[sentences.length - 1] += ' ' + current.trim();
    } else {
      sentences.push(current.trim());
    }
  }

  // Final pass: merge very short sentences
  const merged = [];
  for (const sentence of sentences) {
    if (merged.length > 0 && sentence.length < minChunkChars) {
      merged[merged.length - 1] += ' ' + sentence;
    } else {
      merged.push(sentence);
    }
  }

  return merged.filter(s => s.trim().length > 0);
}

/**
 * Streaming sentence chunker
 *
 * Yields sentences as they are detected, enabling pipeline processing.
 *
 * @param {string} text - Text to chunk
 * @param {Partial<SentenceChunkerConfig>} [config={}] - Configuration
 * @yields {string} Sentences
 */
export function* chunkSentences(text, config = {}) {
  const sentences = splitIntoSentences(text, config);
  for (const sentence of sentences) {
    yield sentence;
  }
}

/**
 * Check if text appears to be complete (ends with punctuation)
 *
 * @param {string} text - Text to check
 * @param {RegExp} [delimiters=/[.!?]+/] - Delimiter pattern
 * @returns {boolean}
 */
export function endsWithPunctuation(text, delimiters = DEFAULT_CHUNKER_CONFIG.delimiters) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  return delimiters.test(text.trim().slice(-1));
}

/**
 * Estimate the number of sentences in text
 *
 * @param {string} text - Text to analyze
 * @param {RegExp} [delimiters=/[.!?]+/] - Delimiter pattern
 * @returns {number}
 */
export function estimateSentenceCount(text, delimiters = DEFAULT_CHUNKER_CONFIG.delimiters) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  const matches = text.match(new RegExp(delimiters.source, 'g'));
  return matches ? matches.length : (text.trim() ? 1 : 0);
}
