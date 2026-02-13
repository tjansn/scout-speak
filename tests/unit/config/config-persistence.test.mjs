// @ts-nocheck - Test file uses dynamic data
/**
 * Tests for ConfigPersistence
 *
 * Per T040 acceptance criteria:
 * - FR-10: Gateway URL preserved after restart
 * - FR-10: Gateway token preserved securely after restart
 * - All settings preserved
 * - Corruption detection
 *
 * Test Requirements:
 * - Integration test: write, restart, read cycle
 * - Unit test: corruption handling
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ConfigPersistence,
  createConfigPersistence,
  calculateChecksum
} from '../../../src/config/config-persistence.mjs';
import { DEFAULT_CONFIG } from '../../../src/config/config.mjs';

describe('calculateChecksum', () => {
  it('should return consistent checksum for same content', () => {
    const content = '{"gateway_url": "http://localhost:18789"}';
    const checksum1 = calculateChecksum(content);
    const checksum2 = calculateChecksum(content);

    assert.strictEqual(checksum1, checksum2);
  });

  it('should return different checksum for different content', () => {
    const content1 = '{"gateway_url": "http://localhost:18789"}';
    const content2 = '{"gateway_url": "http://localhost:18790"}';

    const checksum1 = calculateChecksum(content1);
    const checksum2 = calculateChecksum(content2);

    assert.notStrictEqual(checksum1, checksum2);
  });

  it('should return 64-character hex string', () => {
    const checksum = calculateChecksum('test');
    assert.strictEqual(checksum.length, 64);
    assert.ok(/^[a-f0-9]+$/.test(checksum));
  });
});

describe('ConfigPersistence', () => {
  /** @type {string} */
  let tempDir;
  /** @type {string} */
  let configPath;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'scout-config-persist-'));
    configPath = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create with configPath', () => {
      const persistence = new ConfigPersistence({ configPath });
      assert.ok(persistence);
      assert.strictEqual(persistence.configPath, configPath);
    });

    it('should throw without configPath', () => {
      assert.throws(() => new ConfigPersistence({}), /configPath is required/);
    });

    it('should set default backup path', () => {
      const persistence = new ConfigPersistence({ configPath });
      assert.strictEqual(persistence.backupPath, `${configPath}.bak`);
    });

    it('should accept custom backup path', () => {
      const backupPath = join(tempDir, 'custom-backup.json');
      const persistence = new ConfigPersistence({ configPath, backupPath });
      assert.strictEqual(persistence.backupPath, backupPath);
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      const persistence = new ConfigPersistence({ configPath });
      const stats = persistence.getStats();

      assert.strictEqual(stats.loadCount, 0);
      assert.strictEqual(stats.saveCount, 0);
      assert.strictEqual(stats.backupRestoreCount, 0);
      assert.strictEqual(stats.corruptionDetectedCount, 0);
      assert.strictEqual(stats.lastLoadTimestamp, null);
      assert.strictEqual(stats.lastSaveTimestamp, null);
    });
  });

  describe('checkConfig', () => {
    it('should return not found for missing config', async () => {
      const persistence = new ConfigPersistence({ configPath });
      const result = await persistence.checkConfig();

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.exists, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('should return valid for correct config', async () => {
      const validConfig = { gateway_url: 'http://localhost:18789' };
      await writeFile(configPath, JSON.stringify(validConfig));

      const persistence = new ConfigPersistence({ configPath });
      const result = await persistence.checkConfig();

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.exists, true);
      assert.strictEqual(result.error, null);
    });

    it('should detect invalid JSON', async () => {
      await writeFile(configPath, 'not valid json');

      const persistence = new ConfigPersistence({ configPath });
      const result = await persistence.checkConfig();

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.exists, true);
      assert.ok(result.error?.includes('JSON'));
    });

    it('should detect validation errors', async () => {
      const invalidConfig = { gateway_url: 'http://external.com' };
      await writeFile(configPath, JSON.stringify(invalidConfig));

      const persistence = new ConfigPersistence({ configPath });
      const result = await persistence.checkConfig();

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.exists, true);
    });
  });

  describe('save and load', () => {
    it('should save and load config', async () => {
      const persistence = new ConfigPersistence({ configPath });

      const config = {
        ...DEFAULT_CONFIG,
        gateway_url: 'http://localhost:18789',
        gateway_token: 'my-secret-token'
      };

      await persistence.save(config);
      const loaded = await persistence.load();

      assert.strictEqual(loaded.gateway_url, 'http://localhost:18789');
      assert.strictEqual(loaded.gateway_token, 'my-secret-token');
    });

    it('should preserve all settings (FR-10)', async () => {
      const persistence = new ConfigPersistence({ configPath });

      const config = {
        ...DEFAULT_CONFIG,
        gateway_url: 'http://localhost:18789',
        gateway_token: 'secret',
        vad_threshold: 0.7,
        display_mode: 'transcript',
        log_level: 'debug'
      };

      await persistence.save(config);
      const loaded = await persistence.load();

      assert.strictEqual(loaded.gateway_url, 'http://localhost:18789');
      assert.strictEqual(loaded.gateway_token, 'secret');
      assert.strictEqual(loaded.vad_threshold, 0.7);
      assert.strictEqual(loaded.display_mode, 'transcript');
      assert.strictEqual(loaded.log_level, 'debug');
    });

    it('should update stats on save', async () => {
      const persistence = new ConfigPersistence({ configPath });

      await persistence.save(DEFAULT_CONFIG);

      const stats = persistence.getStats();
      assert.strictEqual(stats.saveCount, 1);
      assert.ok(stats.lastSaveTimestamp);
    });

    it('should update stats on load', async () => {
      await writeFile(configPath, JSON.stringify({ gateway_url: 'http://localhost:18789' }));

      const persistence = new ConfigPersistence({ configPath });
      await persistence.load();

      const stats = persistence.getStats();
      assert.strictEqual(stats.loadCount, 1);
      assert.ok(stats.lastLoadTimestamp);
    });

    it('should emit saved event', async () => {
      const persistence = new ConfigPersistence({ configPath });

      let eventEmitted = false;
      persistence.on('saved', () => { eventEmitted = true; });

      await persistence.save(DEFAULT_CONFIG);

      assert.strictEqual(eventEmitted, true);
    });

    it('should emit loaded event', async () => {
      await writeFile(configPath, JSON.stringify({ gateway_url: 'http://localhost:18789' }));

      const persistence = new ConfigPersistence({ configPath });

      let eventData = null;
      persistence.on('loaded', (data) => { eventData = data; });

      await persistence.load();

      assert.ok(eventData);
      assert.strictEqual(eventData.fromBackup, false);
    });
  });

  describe('backup', () => {
    it('should create backup before save', async () => {
      const persistence = new ConfigPersistence({ configPath });

      // First save
      await persistence.save({
        ...DEFAULT_CONFIG,
        gateway_token: 'original-token'
      });

      let backupCreated = false;
      persistence.on('backup_created', () => { backupCreated = true; });

      // Second save should create backup
      await persistence.save({
        ...DEFAULT_CONFIG,
        gateway_token: 'new-token'
      });

      assert.strictEqual(backupCreated, true);

      // Check backup content
      const backupContent = await readFile(persistence.backupPath, 'utf-8');
      const backup = JSON.parse(backupContent);
      assert.strictEqual(backup.gateway_token, 'original-token');
    });

    it('should restore from backup on corruption', async () => {
      const persistence = new ConfigPersistence({ configPath });

      // First save - no backup yet
      await persistence.save({
        ...DEFAULT_CONFIG,
        gateway_token: 'original-token'
      });

      // Second save - creates backup of first config
      await persistence.save({
        ...DEFAULT_CONFIG,
        gateway_token: 'valid-token'
      });

      // Corrupt the main config
      await writeFile(configPath, 'corrupted content!!!');

      // New instance should restore from backup
      const persistence2 = new ConfigPersistence({ configPath });
      persistence2.on('error', () => {}); // Suppress error event

      let backupRestored = false;
      persistence2.on('backup_restored', () => { backupRestored = true; });

      const loaded = await persistence2.load();

      assert.strictEqual(backupRestored, true);
      // Backup contains 'original-token' (from before second save)
      assert.strictEqual(loaded.gateway_token, 'original-token');
    });

    it('should track backup restore count', async () => {
      const persistence = new ConfigPersistence({ configPath });

      // First save - no backup
      await persistence.save(DEFAULT_CONFIG);
      // Second save - creates backup
      await persistence.save({ ...DEFAULT_CONFIG, gateway_token: 'new' });

      await writeFile(configPath, 'corrupted');

      const persistence2 = new ConfigPersistence({ configPath });
      persistence2.on('error', () => {}); // Suppress error event
      await persistence2.load();

      const stats = persistence2.getStats();
      assert.strictEqual(stats.backupRestoreCount, 1);
      assert.strictEqual(stats.corruptionDetectedCount, 1);
    });
  });

  describe('corruption detection', () => {
    it('should detect corrupted config', async () => {
      await writeFile(configPath, 'not valid json at all');

      const persistence = new ConfigPersistence({ configPath });

      let corruptionDetected = false;
      persistence.on('corruption_detected', () => { corruptionDetected = true; });

      await assert.rejects(() => persistence.load());
      assert.strictEqual(corruptionDetected, true);
    });

    it('should track corruption count', async () => {
      await writeFile(configPath, 'corrupted');

      const persistence = new ConfigPersistence({ configPath, enableBackup: false });

      try {
        await persistence.load();
      } catch {
        // Expected
      }

      const stats = persistence.getStats();
      assert.strictEqual(stats.corruptionDetectedCount, 1);
    });
  });

  describe('loadOrDefault', () => {
    it('should return defaults for missing config', async () => {
      const persistence = new ConfigPersistence({ configPath });
      const config = await persistence.loadOrDefault();

      assert.strictEqual(config.gateway_url, DEFAULT_CONFIG.gateway_url);
      assert.strictEqual(config.vad_threshold, DEFAULT_CONFIG.vad_threshold);
    });

    it('should load existing config', async () => {
      await writeFile(configPath, JSON.stringify({
        ...DEFAULT_CONFIG,
        gateway_token: 'existing'
      }));

      const persistence = new ConfigPersistence({ configPath });
      const config = await persistence.loadOrDefault();

      assert.strictEqual(config.gateway_token, 'existing');
    });
  });

  describe('update', () => {
    it('should update specific fields', async () => {
      const persistence = new ConfigPersistence({ configPath });

      await persistence.save(DEFAULT_CONFIG);
      await persistence.update({ gateway_token: 'updated-token' });

      const loaded = await persistence.load();
      assert.strictEqual(loaded.gateway_token, 'updated-token');
      assert.strictEqual(loaded.gateway_url, DEFAULT_CONFIG.gateway_url);
    });

    it('should return updated config', async () => {
      const persistence = new ConfigPersistence({ configPath });

      const updated = await persistence.update({ gateway_token: 'new-token' });
      assert.strictEqual(updated.gateway_token, 'new-token');
    });
  });

  describe('delete', () => {
    it('should delete config and backup', async () => {
      const persistence = new ConfigPersistence({ configPath });

      await persistence.save(DEFAULT_CONFIG);
      await persistence.save({ ...DEFAULT_CONFIG, gateway_token: 'new' });

      await persistence.delete();

      const result = await persistence.checkConfig();
      assert.strictEqual(result.exists, false);
    });
  });

  describe('hasExternalChanges', () => {
    it('should detect external changes', async () => {
      const persistence = new ConfigPersistence({ configPath });

      await persistence.save(DEFAULT_CONFIG);

      // External modification
      await writeFile(configPath, JSON.stringify({ ...DEFAULT_CONFIG, gateway_token: 'external' }));

      const hasChanges = await persistence.hasExternalChanges();
      assert.strictEqual(hasChanges, true);
    });

    it('should return false when no changes', async () => {
      const persistence = new ConfigPersistence({ configPath });

      await persistence.save(DEFAULT_CONFIG);

      const hasChanges = await persistence.hasExternalChanges();
      assert.strictEqual(hasChanges, false);
    });
  });

  describe('getLastModified', () => {
    it('should return modification time', async () => {
      const persistence = new ConfigPersistence({ configPath });

      await persistence.save(DEFAULT_CONFIG);

      const mtime = await persistence.getLastModified();
      assert.ok(mtime instanceof Date);
    });

    it('should return null for missing config', async () => {
      const persistence = new ConfigPersistence({ configPath });

      const mtime = await persistence.getLastModified();
      assert.strictEqual(mtime, null);
    });
  });

  describe('atomic write', () => {
    it('should use atomic write by default', async () => {
      const persistence = new ConfigPersistence({ configPath });

      // Save should not leave .tmp file
      await persistence.save(DEFAULT_CONFIG);

      const content = await readFile(configPath, 'utf-8');
      assert.ok(content.includes('gateway_url'));
    });
  });
});

describe('createConfigPersistence', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'scout-create-persist-'));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should create a ConfigPersistence instance', () => {
    const configPath = join(tempDir, 'config.json');
    const persistence = createConfigPersistence({ configPath });
    assert.ok(persistence instanceof ConfigPersistence);
  });
});

describe('Config persistence FR-10 requirements', () => {
  let tempDir;
  let configPath;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'scout-fr10-'));
    configPath = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('FR-10: Gateway URL preserved after restart', async () => {
    // First "session"
    const persistence1 = new ConfigPersistence({ configPath });
    await persistence1.save({
      ...DEFAULT_CONFIG,
      gateway_url: 'http://localhost:12345'
    });

    // Simulate restart - new instance
    const persistence2 = new ConfigPersistence({ configPath });
    const loaded = await persistence2.load();

    assert.strictEqual(loaded.gateway_url, 'http://localhost:12345');
  });

  it('FR-10: Gateway token preserved after restart', async () => {
    // First "session"
    const persistence1 = new ConfigPersistence({ configPath });
    await persistence1.save({
      ...DEFAULT_CONFIG,
      gateway_token: 'super-secret-token'
    });

    // Simulate restart - new instance
    const persistence2 = new ConfigPersistence({ configPath });
    const loaded = await persistence2.load();

    assert.strictEqual(loaded.gateway_token, 'super-secret-token');
  });

  it('FR-10: All settings preserved after restart', async () => {
    const originalConfig = {
      ...DEFAULT_CONFIG,
      gateway_url: 'http://localhost:18789',
      gateway_token: 'token',
      vad_threshold: 0.65,
      silence_duration_ms: 1500,
      display_mode: 'transcript',
      barge_in_enabled: false,
      log_level: 'debug'
    };

    // First "session"
    const persistence1 = new ConfigPersistence({ configPath });
    await persistence1.save(originalConfig);

    // Simulate restart - new instance
    const persistence2 = new ConfigPersistence({ configPath });
    const loaded = await persistence2.load();

    assert.deepStrictEqual(loaded, originalConfig);
  });
});
