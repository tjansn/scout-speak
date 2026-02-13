// @ts-nocheck - Test file uses mocked streams and dynamic data
/**
 * Tests for AudioTest
 *
 * Per T037 acceptance criteria:
 * - FR-7: Mic test captures audio
 * - FR-7: Speaker test plays audio
 * - User confirms working audio
 *
 * Note: Integration tests require actual PulseAudio/hardware.
 * These unit tests focus on the non-hardware functionality.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Writable } from 'stream';
import {
  AudioTest,
  createAudioTest,
  DEFAULT_AUDIO_TEST_CONFIG
} from '../../../src/setup/audio-test.mjs';

/**
 * Create a mock output stream for testing
 * @returns {{stream: Writable, output: string[]}}
 */
function createMockOutput() {
  /** @type {string[]} */
  const output = [];

  const stream = new Writable({
    write(chunk, encoding, callback) {
      output.push(chunk.toString());
      callback();
    }
  });

  return { stream, output };
}

describe('AudioTest', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const audioTest = new AudioTest();
      assert.ok(audioTest);
      assert.strictEqual(audioTest.isRunning, false);
    });

    it('should accept custom configuration', () => {
      const audioTest = new AudioTest({
        recordDurationMs: 5000,
        sampleRate: 44100
      });
      assert.ok(audioTest);
    });

    it('should accept custom output stream', () => {
      const { stream } = createMockOutput();
      const audioTest = new AudioTest({ output: stream });
      assert.ok(audioTest);
    });
  });

  describe('DEFAULT_AUDIO_TEST_CONFIG', () => {
    it('should have correct default values', () => {
      assert.strictEqual(DEFAULT_AUDIO_TEST_CONFIG.recordDurationMs, 3000);
      assert.strictEqual(DEFAULT_AUDIO_TEST_CONFIG.sampleRate, 16000);
    });

    it('should be frozen', () => {
      assert.ok(Object.isFrozen(DEFAULT_AUDIO_TEST_CONFIG));
    });
  });

  describe('createAudioTest', () => {
    it('should create an AudioTest instance', () => {
      const audioTest = createAudioTest();
      assert.ok(audioTest instanceof AudioTest);
    });

    it('should pass config to constructor', () => {
      const audioTest = createAudioTest({ recordDurationMs: 5000 });
      assert.ok(audioTest);
    });
  });

  describe('isRunning', () => {
    it('should return false initially', () => {
      const audioTest = new AudioTest();
      assert.strictEqual(audioTest.isRunning, false);
    });
  });

  describe('recordedAudio', () => {
    it('should return null initially', () => {
      const audioTest = new AudioTest();
      assert.strictEqual(audioTest.recordedAudio, null);
    });
  });

  describe('generateTestTone', () => {
    it('should generate a buffer with correct size', () => {
      const audioTest = new AudioTest({ sampleRate: 16000 });
      const tone = audioTest.generateTestTone(1000, 440);

      // 1 second at 16000 Hz = 16000 samples * 2 bytes = 32000 bytes
      assert.strictEqual(tone.length, 32000);
    });

    it('should generate valid Int16LE samples', () => {
      const audioTest = new AudioTest({ sampleRate: 16000 });
      const tone = audioTest.generateTestTone(100, 440);

      // Check that samples are within Int16 range
      for (let i = 0; i < tone.length; i += 2) {
        const sample = tone.readInt16LE(i);
        assert.ok(sample >= -32768 && sample <= 32767, `Sample ${sample} out of range`);
      }
    });

    it('should use default parameters', () => {
      const audioTest = new AudioTest({ sampleRate: 16000 });
      const tone = audioTest.generateTestTone();

      // Default 1000ms at 16000 Hz = 16000 samples * 2 bytes = 32000 bytes
      assert.strictEqual(tone.length, 32000);
    });

    it('should generate different tones for different frequencies', () => {
      const audioTest = new AudioTest({ sampleRate: 16000 });
      const tone440 = audioTest.generateTestTone(100, 440);
      const tone880 = audioTest.generateTestTone(100, 880);

      // Tones should be different (different frequencies)
      let different = false;
      for (let i = 0; i < Math.min(tone440.length, tone880.length); i += 2) {
        if (tone440.readInt16LE(i) !== tone880.readInt16LE(i)) {
          different = true;
          break;
        }
      }
      assert.ok(different, 'Different frequencies should produce different samples');
    });
  });

  describe('events', () => {
    it('should extend EventEmitter', () => {
      const audioTest = new AudioTest();
      assert.strictEqual(typeof audioTest.on, 'function');
      assert.strictEqual(typeof audioTest.emit, 'function');
      assert.strictEqual(typeof audioTest.off, 'function');
    });
  });

  describe('testSpeaker without audio', () => {
    it('should return error when no audio data', async () => {
      const audioTest = new AudioTest();
      const result = await audioTest.testSpeaker();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('No audio data'));
    });

    it('should return error for empty buffer', async () => {
      const audioTest = new AudioTest();
      const result = await audioTest.testSpeaker(Buffer.alloc(0));

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('No audio data'));
    });
  });

  describe('_writeLine', () => {
    it('should write to output stream', () => {
      const { stream, output } = createMockOutput();
      const audioTest = new AudioTest({ output: stream });

      audioTest._writeLine('Test message');

      assert.strictEqual(output.length, 1);
      assert.strictEqual(output[0], 'Test message\n');
    });

    it('should write multiple lines', () => {
      const { stream, output } = createMockOutput();
      const audioTest = new AudioTest({ output: stream });

      audioTest._writeLine('Line 1');
      audioTest._writeLine('Line 2');

      assert.strictEqual(output.length, 2);
      assert.strictEqual(output[0], 'Line 1\n');
      assert.strictEqual(output[1], 'Line 2\n');
    });
  });
});

describe('AudioTest runFullTest options', () => {
  it('should accept skipMicTest option', async () => {
    const { stream } = createMockOutput();
    const audioTest = new AudioTest({ output: stream });

    // With both skipped, should return success
    const result = await audioTest.runFullTest({
      skipMicTest: true,
      skipSpeakerTest: true
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.micWorking, true);
    assert.strictEqual(result.speakerWorking, true);
  });

  it('should emit test_started event', async () => {
    const audioTest = new AudioTest();
    let eventEmitted = false;

    audioTest.on('test_started', () => {
      eventEmitted = true;
    });

    await audioTest.runFullTest({
      skipMicTest: true,
      skipSpeakerTest: true
    });

    assert.strictEqual(eventEmitted, true);
  });

  it('should emit test_complete event', async () => {
    const audioTest = new AudioTest();
    let eventData = null;

    audioTest.on('test_complete', (data) => {
      eventData = data;
    });

    await audioTest.runFullTest({
      skipMicTest: true,
      skipSpeakerTest: true
    });

    assert.ok(eventData);
    assert.strictEqual(eventData.micWorking, true);
    assert.strictEqual(eventData.speakerWorking, true);
  });
});

describe('AudioTest result types', () => {
  describe('MicTestResult', () => {
    it('should have expected structure for success', async () => {
      const audioTest = new AudioTest();

      // Can't test actual mic without hardware, but can verify structure
      // by checking the "already running" case
      audioTest._running = true;
      const result = await audioTest.testMicrophone();

      assert.strictEqual(typeof result.success, 'boolean');
      assert.strictEqual(typeof result.durationMs, 'number');
      assert.ok('audioData' in result);
      assert.ok('error' in result);
    });
  });

  describe('SpeakerTestResult', () => {
    it('should have expected structure', async () => {
      const audioTest = new AudioTest();
      const result = await audioTest.testSpeaker();

      assert.strictEqual(typeof result.success, 'boolean');
      assert.strictEqual(typeof result.durationMs, 'number');
      assert.ok('error' in result);
    });
  });

  describe('AudioTestResult', () => {
    it('should have expected structure', async () => {
      const audioTest = new AudioTest();
      const result = await audioTest.runFullTest({
        skipMicTest: true,
        skipSpeakerTest: true
      });

      assert.strictEqual(typeof result.success, 'boolean');
      assert.strictEqual(typeof result.micWorking, 'boolean');
      assert.strictEqual(typeof result.speakerWorking, 'boolean');
      assert.ok('error' in result);
    });
  });
});

describe('AudioTest concurrent test prevention', () => {
  it('should prevent concurrent mic tests', async () => {
    const audioTest = new AudioTest();

    // Simulate running state
    audioTest._running = true;

    const result = await audioTest.testMicrophone();

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('already running'));
  });

  it('should prevent concurrent speaker tests', async () => {
    const audioTest = new AudioTest();

    // Set up audio data but mark as running
    audioTest._recordedAudio = audioTest.generateTestTone(100);
    audioTest._running = true;

    const result = await audioTest.testSpeaker();

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('already running'));
  });
});
