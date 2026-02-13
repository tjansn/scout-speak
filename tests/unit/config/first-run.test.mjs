// @ts-nocheck - Test file uses dynamic event data
/**
 * Tests for FirstRunDetector
 *
 * Per T035 acceptance criteria:
 * - Detects missing config
 * - Triggers setup wizard on first run
 * - Skips wizard if config exists
 *
 * Test Requirements:
 * - Unit test: detection logic
 * - Integration test: wizard trigger
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  FirstRunDetector,
  createFirstRunDetector,
  isFirstRun,
  checkFirstRun,
  DEFAULT_CONFIG_PATH
} from '../../../src/config/first-run.mjs';

describe('FirstRunDetector', () => {
  /** @type {string} */
  let tempDir;
  /** @type {string} */
  let configPath;

  beforeEach(async () => {
    // Create a temporary directory for test config files
    tempDir = await mkdtemp(join(tmpdir(), 'scout-firstrun-test-'));
    configPath = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create with default config path', () => {
      const detector = new FirstRunDetector();
      assert.strictEqual(detector.configPath, DEFAULT_CONFIG_PATH);
    });

    it('should create with custom config path', () => {
      const detector = new FirstRunDetector(configPath);
      assert.strictEqual(detector.configPath, configPath);
    });

    it('should have null status initially', () => {
      const detector = new FirstRunDetector(configPath);
      assert.strictEqual(detector.status, null);
    });
  });

  describe('check - missing config', () => {
    it('should detect missing config file', async () => {
      const detector = new FirstRunDetector(configPath);
      const result = await detector.check();

      assert.strictEqual(result.needsSetup, true);
      assert.strictEqual(result.reason, 'missing');
      assert.ok(result.errors.some(e => e.includes('not found')));
    });

    it('should set status when config is missing', async () => {
      const detector = new FirstRunDetector(configPath);
      await detector.check();

      const status = detector.status;
      assert.ok(status);
      assert.strictEqual(status.isFirstRun, true);
      assert.strictEqual(status.configExists, false);
      assert.strictEqual(status.configValid, false);
    });

    it('should emit first_run_detected event', async () => {
      const detector = new FirstRunDetector(configPath);

      let eventData = null;
      detector.on('first_run_detected', (data) => { eventData = data; });

      await detector.check();

      assert.ok(eventData);
      assert.strictEqual(eventData.reason, 'missing');
      assert.strictEqual(eventData.configPath, configPath);
    });
  });

  describe('check - valid config', () => {
    it('should detect valid config file', async () => {
      // Create a valid config file
      const validConfig = {
        gateway_url: 'http://localhost:18789',
        gateway_token: 'test-token',
        vad_threshold: 0.5
      };
      await writeFile(configPath, JSON.stringify(validConfig));

      const detector = new FirstRunDetector(configPath);
      const result = await detector.check();

      assert.strictEqual(result.needsSetup, false);
      assert.strictEqual(result.reason, 'valid');
      assert.strictEqual(result.errors.length, 0);
    });

    it('should set status when config is valid', async () => {
      const validConfig = {
        gateway_url: 'http://localhost:18789',
        gateway_token: 'test-token'
      };
      await writeFile(configPath, JSON.stringify(validConfig));

      const detector = new FirstRunDetector(configPath);
      await detector.check();

      const status = detector.status;
      assert.ok(status);
      assert.strictEqual(status.isFirstRun, false);
      assert.strictEqual(status.configExists, true);
      assert.strictEqual(status.configValid, true);
    });

    it('should emit config_valid event', async () => {
      const validConfig = {
        gateway_url: 'http://localhost:18789'
      };
      await writeFile(configPath, JSON.stringify(validConfig));

      const detector = new FirstRunDetector(configPath);

      let eventData = null;
      detector.on('config_valid', (data) => { eventData = data; });

      await detector.check();

      assert.ok(eventData);
      assert.strictEqual(eventData.configPath, configPath);
    });
  });

  describe('check - invalid config', () => {
    it('should detect invalid JSON', async () => {
      // Create an invalid JSON file
      await writeFile(configPath, 'not valid json {');

      const detector = new FirstRunDetector(configPath);
      const result = await detector.check();

      assert.strictEqual(result.needsSetup, true);
      assert.strictEqual(result.reason, 'invalid');
      assert.ok(result.errors.length > 0);
    });

    it('should detect empty config file', async () => {
      // Create an empty file
      await writeFile(configPath, '');

      const detector = new FirstRunDetector(configPath);
      const result = await detector.check();

      assert.strictEqual(result.needsSetup, true);
      assert.strictEqual(result.reason, 'invalid');
    });

    it('should detect config with invalid values', async () => {
      // Create config with invalid gateway URL
      const invalidConfig = {
        gateway_url: 'http://external-server.com:18789' // Not localhost
      };
      await writeFile(configPath, JSON.stringify(invalidConfig));

      const detector = new FirstRunDetector(configPath);
      const result = await detector.check();

      assert.strictEqual(result.needsSetup, true);
      assert.strictEqual(result.reason, 'invalid');
      assert.ok(result.errors.some(e => e.includes('localhost')));
    });

    it('should detect config with invalid types', async () => {
      const invalidConfig = {
        gateway_url: 'http://localhost:18789',
        vad_threshold: 'not a number' // Should be number
      };
      await writeFile(configPath, JSON.stringify(invalidConfig));

      const detector = new FirstRunDetector(configPath);
      const result = await detector.check();

      assert.strictEqual(result.needsSetup, true);
      assert.strictEqual(result.reason, 'invalid');
    });

    it('should emit first_run_detected event for invalid config', async () => {
      await writeFile(configPath, 'invalid json');

      const detector = new FirstRunDetector(configPath);

      let eventData = null;
      detector.on('first_run_detected', (data) => { eventData = data; });

      await detector.check();

      assert.ok(eventData);
      assert.strictEqual(eventData.reason, 'invalid');
    });
  });

  describe('needsSetupWizard', () => {
    it('should return true when config is missing', async () => {
      const detector = new FirstRunDetector(configPath);
      const needsSetup = await detector.needsSetupWizard();
      assert.strictEqual(needsSetup, true);
    });

    it('should return false when config is valid', async () => {
      const validConfig = { gateway_url: 'http://localhost:18789' };
      await writeFile(configPath, JSON.stringify(validConfig));

      const detector = new FirstRunDetector(configPath);
      const needsSetup = await detector.needsSetupWizard();
      assert.strictEqual(needsSetup, false);
    });
  });

  describe('getStatus', () => {
    it('should return status after check', async () => {
      const detector = new FirstRunDetector(configPath);
      const status = await detector.getStatus();

      assert.ok(status);
      assert.strictEqual(typeof status.isFirstRun, 'boolean');
      assert.strictEqual(typeof status.configExists, 'boolean');
      assert.strictEqual(typeof status.configValid, 'boolean');
      assert.ok(Array.isArray(status.validationErrors));
      assert.strictEqual(status.configPath, configPath);
    });

    it('should call check if status is null', async () => {
      const detector = new FirstRunDetector(configPath);
      assert.strictEqual(detector.status, null);

      await detector.getStatus();
      assert.ok(detector.status);
    });
  });

  describe('createFirstRunDetector', () => {
    it('should create a FirstRunDetector instance', () => {
      const detector = createFirstRunDetector(configPath);
      assert.ok(detector instanceof FirstRunDetector);
      assert.strictEqual(detector.configPath, configPath);
    });

    it('should work with default path when no argument', () => {
      const detector = createFirstRunDetector();
      assert.ok(detector instanceof FirstRunDetector);
      assert.strictEqual(detector.configPath, DEFAULT_CONFIG_PATH);
    });
  });

  describe('isFirstRun helper', () => {
    it('should return true when config missing', async () => {
      const result = await isFirstRun(configPath);
      assert.strictEqual(result, true);
    });

    it('should return false when config valid', async () => {
      const validConfig = { gateway_url: 'http://localhost:18789' };
      await writeFile(configPath, JSON.stringify(validConfig));

      const result = await isFirstRun(configPath);
      assert.strictEqual(result, false);
    });
  });

  describe('checkFirstRun helper', () => {
    it('should return check result for missing config', async () => {
      const result = await checkFirstRun(configPath);

      assert.strictEqual(result.needsSetup, true);
      assert.strictEqual(result.reason, 'missing');
    });

    it('should return check result for valid config', async () => {
      const validConfig = { gateway_url: 'http://localhost:18789' };
      await writeFile(configPath, JSON.stringify(validConfig));

      const result = await checkFirstRun(configPath);

      assert.strictEqual(result.needsSetup, false);
      assert.strictEqual(result.reason, 'valid');
    });
  });

  describe('wizard trigger logic', () => {
    it('should trigger wizard for completely fresh installation', async () => {
      // Fresh install = no config file at all
      const detector = new FirstRunDetector(configPath);
      const result = await detector.check();

      assert.strictEqual(result.needsSetup, true);
      assert.strictEqual(result.reason, 'missing');
    });

    it('should trigger wizard for corrupt config', async () => {
      // Corrupt config = file exists but invalid
      await writeFile(configPath, '{ invalid: json ]');

      const detector = new FirstRunDetector(configPath);
      const result = await detector.check();

      assert.strictEqual(result.needsSetup, true);
      assert.strictEqual(result.reason, 'invalid');
    });

    it('should skip wizard for complete valid config', async () => {
      // Complete valid config with all required fields
      const completeConfig = {
        gateway_url: 'http://localhost:18789',
        gateway_token: 'my-token',
        stt_model_path: '/path/to/model',
        tts_model_path: '/path/to/voice',
        vad_model_path: '/path/to/vad',
        vad_threshold: 0.5,
        display_mode: 'minimal'
      };
      await writeFile(configPath, JSON.stringify(completeConfig));

      const detector = new FirstRunDetector(configPath);
      const result = await detector.check();

      assert.strictEqual(result.needsSetup, false);
      assert.strictEqual(result.reason, 'valid');
    });
  });
});

describe('FirstRunDetector edge cases', () => {
  /** @type {string} */
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'scout-firstrun-edge-'));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should handle config in non-existent directory', async () => {
    const nonExistentPath = join(tempDir, 'does', 'not', 'exist', 'config.json');
    const detector = new FirstRunDetector(nonExistentPath);

    const result = await detector.check();
    assert.strictEqual(result.needsSetup, true);
    assert.strictEqual(result.reason, 'missing');
  });

  it('should handle config that is actually a directory', async () => {
    const dirPath = join(tempDir, 'config.json');
    await mkdir(dirPath);

    const detector = new FirstRunDetector(dirPath);
    const result = await detector.check();

    assert.strictEqual(result.needsSetup, true);
    // Either 'invalid' or 'missing' depending on how fs treats directories
    assert.ok(['invalid', 'missing'].includes(result.reason));
  });

  it('should handle config with array instead of object', async () => {
    const configPath = join(tempDir, 'config.json');
    await writeFile(configPath, '[]');

    const detector = new FirstRunDetector(configPath);
    const result = await detector.check();

    assert.strictEqual(result.needsSetup, true);
    assert.strictEqual(result.reason, 'invalid');
  });

  it('should handle config with null', async () => {
    const configPath = join(tempDir, 'config.json');
    await writeFile(configPath, 'null');

    const detector = new FirstRunDetector(configPath);
    const result = await detector.check();

    assert.strictEqual(result.needsSetup, true);
    assert.strictEqual(result.reason, 'invalid');
  });

  it('should handle config with just a number', async () => {
    const configPath = join(tempDir, 'config.json');
    await writeFile(configPath, '42');

    const detector = new FirstRunDetector(configPath);
    const result = await detector.check();

    assert.strictEqual(result.needsSetup, true);
    assert.strictEqual(result.reason, 'invalid');
  });
});
