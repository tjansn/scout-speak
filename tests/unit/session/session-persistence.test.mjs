/**
 * Tests for SessionPersistence
 *
 * Per T050 acceptance criteria:
 * - Capture `sessionId` from OpenClaw responses when provided
 * - Reuse session ID for subsequent requests in active session
 * - Persist last successful session ID for reconnect/resume behavior
 * - Reset session ID when user intentionally starts a new session
 *
 * Test Requirements:
 * - Unit test: session ID extraction/parsing
 * - Unit test: reuse vs reset logic
 * - Integration test: identity/memory continuity across multiple turns
 * - Integration test: reconnect resumes expected session behavior
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { unlink, mkdir, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SessionPersistence,
  createSessionPersistence
} from '../../../src/session/session-persistence.mjs';
import { createConfig, saveConfig } from '../../../src/config/config.mjs';

describe('SessionPersistence', () => {
  /** @type {string} */
  let testDir;
  /** @type {string} */
  let testConfigPath;

  beforeEach(async () => {
    testDir = join(tmpdir(), `scout-session-test-${Date.now()}`);
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

  describe('constructor', () => {
    it('should require configPath', () => {
      assert.throws(
        () => new SessionPersistence(/** @type {any} */ ({})),
        /configPath is required/
      );
    });

    it('should create instance with valid options', () => {
      const persistence = new SessionPersistence({ configPath: testConfigPath });
      assert.ok(persistence);
      assert.strictEqual(persistence.sessionId, null);
      assert.strictEqual(persistence.isInitialized, false);
    });

    it('should default autoSave to true', () => {
      const persistence = new SessionPersistence({ configPath: testConfigPath });
      // autoSave is private, but we can verify behavior in other tests
      assert.ok(persistence);
    });

    it('should accept autoSave option', () => {
      const persistence = new SessionPersistence({
        configPath: testConfigPath,
        autoSave: false
      });
      assert.ok(persistence);
    });
  });

  describe('init', () => {
    it('should initialize with empty session when config does not exist', async () => {
      const persistence = new SessionPersistence({ configPath: testConfigPath });

      const sessionId = await persistence.init();

      assert.strictEqual(sessionId, null);
      assert.strictEqual(persistence.isInitialized, true);
    });

    it('should load persisted session ID from config', async () => {
      // Create config with session ID
      const config = createConfig({ last_session_id: 'session-abc-123' });
      await saveConfig(testConfigPath, config);

      const persistence = new SessionPersistence({ configPath: testConfigPath });
      const sessionId = await persistence.init();

      assert.strictEqual(sessionId, 'session-abc-123');
      assert.strictEqual(persistence.sessionId, 'session-abc-123');
      assert.strictEqual(persistence.isInitialized, true);
    });

    it('should handle empty last_session_id as null', async () => {
      const config = createConfig({ last_session_id: '' });
      await saveConfig(testConfigPath, config);

      const persistence = new SessionPersistence({ configPath: testConfigPath });
      const sessionId = await persistence.init();

      assert.strictEqual(sessionId, null);
    });
  });

  describe('setSessionId', () => {
    it('should update session ID in memory', async () => {
      const config = createConfig();
      await saveConfig(testConfigPath, config);

      const persistence = new SessionPersistence({
        configPath: testConfigPath,
        autoSave: false
      });
      await persistence.init();

      await persistence.setSessionId('new-session-456');

      assert.strictEqual(persistence.sessionId, 'new-session-456');
    });

    it('should auto-save to config when autoSave is true', async () => {
      const config = createConfig();
      await saveConfig(testConfigPath, config);

      const persistence = new SessionPersistence({
        configPath: testConfigPath,
        autoSave: true
      });
      await persistence.init();

      await persistence.setSessionId('auto-saved-session');

      // Verify by creating new persistence and loading
      const persistence2 = new SessionPersistence({ configPath: testConfigPath });
      const loadedId = await persistence2.init();

      assert.strictEqual(loadedId, 'auto-saved-session');
    });

    it('should not auto-save when autoSave is false', async () => {
      const config = createConfig({ last_session_id: 'original' });
      await saveConfig(testConfigPath, config);

      const persistence = new SessionPersistence({
        configPath: testConfigPath,
        autoSave: false
      });
      await persistence.init();

      await persistence.setSessionId('not-saved');

      // Verify config still has original value
      const persistence2 = new SessionPersistence({ configPath: testConfigPath });
      const loadedId = await persistence2.init();

      assert.strictEqual(loadedId, 'original');
    });

    it('should handle null session ID', async () => {
      const config = createConfig({ last_session_id: 'to-be-cleared' });
      await saveConfig(testConfigPath, config);

      const persistence = new SessionPersistence({ configPath: testConfigPath });
      await persistence.init();

      await persistence.setSessionId(null);

      assert.strictEqual(persistence.sessionId, null);

      // Verify persisted as empty string
      const persistence2 = new SessionPersistence({ configPath: testConfigPath });
      const loadedId = await persistence2.init();
      assert.strictEqual(loadedId, null);
    });
  });

  describe('save', () => {
    it('should manually save session ID to config', async () => {
      const config = createConfig();
      await saveConfig(testConfigPath, config);

      const persistence = new SessionPersistence({
        configPath: testConfigPath,
        autoSave: false
      });
      await persistence.init();

      // Set without auto-save
      await persistence.setSessionId('manual-save-session');

      // Manually save
      await persistence.save();

      // Verify
      const persistence2 = new SessionPersistence({ configPath: testConfigPath });
      const loadedId = await persistence2.init();
      assert.strictEqual(loadedId, 'manual-save-session');
    });
  });

  describe('reset', () => {
    it('should clear session ID in memory and persist', async () => {
      const config = createConfig({ last_session_id: 'session-to-reset' });
      await saveConfig(testConfigPath, config);

      const persistence = new SessionPersistence({ configPath: testConfigPath });
      await persistence.init();
      assert.strictEqual(persistence.sessionId, 'session-to-reset');

      await persistence.reset();

      assert.strictEqual(persistence.sessionId, null);

      // Verify persisted
      const persistence2 = new SessionPersistence({ configPath: testConfigPath });
      const loadedId = await persistence2.init();
      assert.strictEqual(loadedId, null);
    });
  });

  describe('loadSessionId static method', () => {
    it('should load session ID from config file', async () => {
      const config = createConfig({ last_session_id: 'static-load-test' });
      await saveConfig(testConfigPath, config);

      const sessionId = await SessionPersistence.loadSessionId(testConfigPath);

      assert.strictEqual(sessionId, 'static-load-test');
    });

    it('should return null when config does not exist', async () => {
      const sessionId = await SessionPersistence.loadSessionId('/nonexistent/config.json');
      assert.strictEqual(sessionId, null);
    });

    it('should return null for empty session ID', async () => {
      const config = createConfig({ last_session_id: '' });
      await saveConfig(testConfigPath, config);

      const sessionId = await SessionPersistence.loadSessionId(testConfigPath);
      assert.strictEqual(sessionId, null);
    });
  });

  describe('createSessionPersistence', () => {
    it('should create a SessionPersistence instance', () => {
      const persistence = createSessionPersistence({ configPath: testConfigPath });
      assert.ok(persistence instanceof SessionPersistence);
    });
  });
});

describe('T050: Session continuity scenarios', () => {
  /** @type {string} */
  let testDir;
  /** @type {string} */
  let testConfigPath;

  beforeEach(async () => {
    testDir = join(tmpdir(), `scout-session-scenario-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    testConfigPath = join(testDir, 'config.json');

    // Create initial config
    const config = createConfig();
    await saveConfig(testConfigPath, config);
  });

  afterEach(async () => {
    try {
      await unlink(testConfigPath);
    } catch {
      // Ignore
    }
    try {
      await rmdir(testDir);
    } catch {
      // Ignore
    }
  });

  it('should persist session ID across simulated restarts', async () => {
    // First "session" - receive a session ID from OpenClaw
    const persistence1 = new SessionPersistence({ configPath: testConfigPath });
    await persistence1.init();
    await persistence1.setSessionId('session-from-openclaw-xyz');

    // Simulate application restart - create new persistence instance
    const persistence2 = new SessionPersistence({ configPath: testConfigPath });
    const restoredId = await persistence2.init();

    assert.strictEqual(restoredId, 'session-from-openclaw-xyz');
  });

  it('should allow user to reset session for fresh conversation', async () => {
    // Setup existing session
    const config = createConfig({ last_session_id: 'old-session' });
    await saveConfig(testConfigPath, config);

    const persistence = new SessionPersistence({ configPath: testConfigPath });
    await persistence.init();
    assert.strictEqual(persistence.sessionId, 'old-session');

    // User requests fresh session
    await persistence.reset();

    // After restart, session should be null
    const persistence2 = new SessionPersistence({ configPath: testConfigPath });
    const restoredId = await persistence2.init();

    assert.strictEqual(restoredId, null);
  });

  it('should update persisted session when new one received', async () => {
    const config = createConfig({ last_session_id: 'initial-session' });
    await saveConfig(testConfigPath, config);

    const persistence = new SessionPersistence({ configPath: testConfigPath });
    await persistence.init();

    // New session ID from OpenClaw (e.g., context rotated)
    await persistence.setSessionId('rotated-session-new');

    // Verify persisted
    const persistence2 = new SessionPersistence({ configPath: testConfigPath });
    const loadedId = await persistence2.init();

    assert.strictEqual(loadedId, 'rotated-session-new');
  });
});
