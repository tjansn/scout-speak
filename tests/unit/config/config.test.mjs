/**
 * Tests for Config Schema and Validation
 *
 * Per T006 acceptance criteria:
 * - Load config from JSON file
 * - Validate all fields per rules
 * - Return clear error messages for invalid config
 * - Provide defaults for optional fields
 * - Enforce localhost-only URL
 * - FR-10: Config persists across restarts
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFile, unlink, mkdir, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  validateConfig,
  loadConfig,
  saveConfig,
  createConfig,
  isLocalhostUrl,
  DEFAULT_CONFIG,
  DISPLAY_MODES,
  LOG_LEVELS
} from '../../../src/config/config.mjs';

describe('Config', () => {
  /** @type {string} */
  let testDir;
  /** @type {string} */
  let testConfigPath;

  beforeEach(async () => {
    testDir = join(tmpdir(), `scout-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    testConfigPath = join(testDir, 'config.json');
  });

  afterEach(async () => {
    try {
      await unlink(testConfigPath);
    } catch {
      // Ignore if file doesn't exist
    }
    try {
      await rmdir(testDir);
    } catch {
      // Ignore if dir doesn't exist
    }
  });

  describe('isLocalhostUrl', () => {
    it('should accept localhost', () => {
      assert.strictEqual(isLocalhostUrl('http://localhost:18789'), true);
      assert.strictEqual(isLocalhostUrl('http://localhost'), true);
      assert.strictEqual(isLocalhostUrl('https://localhost:8080'), true);
    });

    it('should accept 127.0.0.1', () => {
      assert.strictEqual(isLocalhostUrl('http://127.0.0.1:18789'), true);
      assert.strictEqual(isLocalhostUrl('http://127.0.0.1'), true);
    });

    it('should accept IPv6 localhost', () => {
      assert.strictEqual(isLocalhostUrl('http://[::1]:18789'), true);
    });

    it('should reject non-localhost URLs', () => {
      assert.strictEqual(isLocalhostUrl('http://example.com'), false);
      assert.strictEqual(isLocalhostUrl('http://192.168.1.1'), false);
      assert.strictEqual(isLocalhostUrl('http://10.0.0.1'), false);
    });

    it('should reject invalid URLs', () => {
      assert.strictEqual(isLocalhostUrl('not-a-url'), false);
      assert.strictEqual(isLocalhostUrl(''), false);
    });
  });

  describe('validateConfig', () => {
    it('should pass valid config', async () => {
      const config = {
        gateway_url: 'http://localhost:18789',
        gateway_token: 'test-token',
        vad_threshold: 0.5,
        silence_duration_ms: 1200
      };

      const errors = await validateConfig(config);
      assert.strictEqual(errors.length, 0);
    });

    it('should reject non-localhost gateway URL', async () => {
      const config = { gateway_url: 'http://example.com:18789' };
      const errors = await validateConfig(config);

      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].field, 'gateway_url');
      assert.ok(errors[0].message.includes('localhost'));
    });

    it('should reject invalid vad_threshold', async () => {
      const errors1 = await validateConfig({ vad_threshold: -0.1 });
      assert.ok(errors1.some(e => e.field === 'vad_threshold'));

      const errors2 = await validateConfig({ vad_threshold: 1.1 });
      assert.ok(errors2.some(e => e.field === 'vad_threshold'));

      const errors3 = await validateConfig(/** @type {any} */ ({ vad_threshold: 'invalid' }));
      assert.ok(errors3.some(e => e.field === 'vad_threshold'));
    });

    it('should reject silence_duration_ms out of range', async () => {
      const errors1 = await validateConfig({ silence_duration_ms: 50 });
      assert.ok(errors1.some(e => e.field === 'silence_duration_ms'));

      const errors2 = await validateConfig({ silence_duration_ms: 6000 });
      assert.ok(errors2.some(e => e.field === 'silence_duration_ms'));
    });

    it('should reject invalid display_mode', async () => {
      const errors = await validateConfig({ display_mode: 'invalid' });
      assert.ok(errors.some(e => e.field === 'display_mode'));
    });

    it('should accept valid display_mode values', async () => {
      for (const mode of DISPLAY_MODES) {
        const errors = await validateConfig({ display_mode: mode });
        const modeErrors = errors.filter(e => e.field === 'display_mode');
        assert.strictEqual(modeErrors.length, 0, `${mode} should be valid`);
      }
    });

    it('should reject invalid log_level', async () => {
      const errors = await validateConfig({ log_level: 'verbose' });
      assert.ok(errors.some(e => e.field === 'log_level'));
    });

    it('should accept valid log_level values', async () => {
      for (const level of LOG_LEVELS) {
        const errors = await validateConfig({ log_level: level });
        const levelErrors = errors.filter(e => e.field === 'log_level');
        assert.strictEqual(levelErrors.length, 0, `${level} should be valid`);
      }
    });

    it('should reject non-boolean booleans', async () => {
      const errors = await validateConfig(/** @type {any} */ ({
        wake_word_enabled: 'true',
        barge_in_enabled: 1,
        log_to_file: 'yes'
      }));

      assert.ok(errors.some(e => e.field === 'wake_word_enabled'));
      assert.ok(errors.some(e => e.field === 'barge_in_enabled'));
      assert.ok(errors.some(e => e.field === 'log_to_file'));
    });

    it('should collect multiple errors', async () => {
      const errors = await validateConfig({
        gateway_url: 'http://example.com',
        vad_threshold: 2.0,
        silence_duration_ms: -100
      });

      assert.ok(errors.length >= 3);
    });
  });

  describe('loadConfig', () => {
    it('should load valid config from file', async () => {
      const configData = {
        gateway_url: 'http://localhost:8080',
        gateway_token: 'my-token'
      };
      await writeFile(testConfigPath, JSON.stringify(configData));

      const config = await loadConfig(testConfigPath);

      assert.strictEqual(config.gateway_url, 'http://localhost:8080');
      assert.strictEqual(config.gateway_token, 'my-token');
    });

    it('should merge with defaults', async () => {
      const configData = { gateway_token: 'my-token' };
      await writeFile(testConfigPath, JSON.stringify(configData));

      const config = await loadConfig(testConfigPath);

      assert.strictEqual(config.gateway_token, 'my-token');
      assert.strictEqual(config.gateway_url, DEFAULT_CONFIG.gateway_url);
      assert.strictEqual(config.vad_threshold, DEFAULT_CONFIG.vad_threshold);
    });

    it('should throw for missing file', async () => {
      await assert.rejects(
        loadConfig('/nonexistent/config.json'),
        /Config file not found/
      );
    });

    it('should throw for invalid JSON', async () => {
      await writeFile(testConfigPath, 'not valid json {');

      await assert.rejects(
        loadConfig(testConfigPath),
        /invalid JSON/
      );
    });

    it('should throw for non-object config', async () => {
      await writeFile(testConfigPath, JSON.stringify([1, 2, 3]));

      await assert.rejects(
        loadConfig(testConfigPath),
        /must be a JSON object/
      );
    });

    it('should throw for invalid config values', async () => {
      await writeFile(testConfigPath, JSON.stringify({
        gateway_url: 'http://example.com'
      }));

      await assert.rejects(
        loadConfig(testConfigPath),
        /Config validation failed/
      );
    });
  });

  describe('saveConfig', () => {
    it('should save config to file', async () => {
      const config = createConfig({ gateway_token: 'saved-token' });

      await saveConfig(testConfigPath, config);

      const loaded = await loadConfig(testConfigPath);
      assert.strictEqual(loaded.gateway_token, 'saved-token');
    });

    it('should throw for invalid config', async () => {
      const invalidConfig = createConfig({ vad_threshold: 5.0 });

      await assert.rejects(
        saveConfig(testConfigPath, invalidConfig),
        /Config validation failed/
      );
    });
  });

  describe('createConfig', () => {
    it('should create config with defaults', () => {
      const config = createConfig();

      assert.strictEqual(config.gateway_url, DEFAULT_CONFIG.gateway_url);
      assert.strictEqual(config.vad_threshold, DEFAULT_CONFIG.vad_threshold);
      assert.strictEqual(config.silence_duration_ms, DEFAULT_CONFIG.silence_duration_ms);
    });

    it('should apply overrides', () => {
      const config = createConfig({
        gateway_token: 'custom-token',
        vad_threshold: 0.7
      });

      assert.strictEqual(config.gateway_token, 'custom-token');
      assert.strictEqual(config.vad_threshold, 0.7);
      assert.strictEqual(config.gateway_url, DEFAULT_CONFIG.gateway_url);
    });
  });

  describe('FR-10: Config persistence', () => {
    it('should preserve gateway URL after restart simulation', async () => {
      const originalConfig = createConfig({
        gateway_url: 'http://localhost:9999',
        gateway_token: 'persist-test'
      });

      await saveConfig(testConfigPath, originalConfig);

      // Simulate restart by loading fresh
      const loadedConfig = await loadConfig(testConfigPath);

      assert.strictEqual(loadedConfig.gateway_url, 'http://localhost:9999');
      assert.strictEqual(loadedConfig.gateway_token, 'persist-test');
    });

    it('should preserve all settings after restart simulation', async () => {
      const originalConfig = createConfig({
        vad_threshold: 0.65,
        silence_duration_ms: 1500,
        display_mode: 'transcript',
        wake_word_enabled: true,
        wake_word_phrase: 'hello scout'
      });

      await saveConfig(testConfigPath, originalConfig);
      const loadedConfig = await loadConfig(testConfigPath);

      assert.strictEqual(loadedConfig.vad_threshold, 0.65);
      assert.strictEqual(loadedConfig.silence_duration_ms, 1500);
      assert.strictEqual(loadedConfig.display_mode, 'transcript');
      assert.strictEqual(loadedConfig.wake_word_enabled, true);
      assert.strictEqual(loadedConfig.wake_word_phrase, 'hello scout');
    });
  });
});
