// @ts-nocheck - Test file uses mocked streams and dynamic data
/**
 * Tests for SetupWizard
 *
 * Per T036 acceptance criteria:
 * - FR-7: Prompts for gateway URL
 * - FR-7: Prompts for gateway token
 * - FR-7: Tests authenticated connection
 * - Clear feedback on success/failure
 *
 * Test Requirements:
 * - Unit test: input handling
 * - Unit test: token validation and secure storage behavior
 * - Integration test: authenticated connection test
 *
 * Note: Interactive wizard tests require special handling of readline.
 * These tests focus on the non-interactive functionality.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SetupWizard,
  createSetupWizard,
  saveWizardConfig,
  DEFAULT_GATEWAY_URL
} from '../../../src/setup/setup-wizard.mjs';

describe('SetupWizard', () => {
  describe('constructor', () => {
    it('should create with skipConnectionTest option', () => {
      const wizard = new SetupWizard({ skipConnectionTest: true });
      assert.ok(wizard);
      assert.strictEqual(wizard.isRunning, false);
    });

    it('should have default config', () => {
      const wizard = new SetupWizard({ skipConnectionTest: true });
      const config = wizard.config;
      assert.strictEqual(config.gateway_url, DEFAULT_GATEWAY_URL);
      assert.strictEqual(config.gateway_token, '');
    });

    it('should expose config as copy', () => {
      const wizard = new SetupWizard({ skipConnectionTest: true });
      const config1 = wizard.config;
      const config2 = wizard.config;

      // Should be different objects
      assert.notStrictEqual(config1, config2);

      // But same values
      assert.deepStrictEqual(config1, config2);
    });
  });

  describe('cancel', () => {
    it('should emit cancelled event', () => {
      const wizard = new SetupWizard({ skipConnectionTest: true });

      let cancelledData = null;
      wizard.on('cancelled', (data) => { cancelledData = data; });

      wizard.cancel();

      assert.ok(cancelledData);
      assert.strictEqual(cancelledData.reason, 'user_cancelled');
    });

    it('should set isRunning to false', () => {
      const wizard = new SetupWizard({ skipConnectionTest: true });
      wizard._running = true;

      wizard.cancel();

      assert.strictEqual(wizard.isRunning, false);
    });
  });

  describe('DEFAULT_GATEWAY_URL', () => {
    it('should be localhost URL', () => {
      assert.ok(DEFAULT_GATEWAY_URL.includes('localhost'));
      assert.strictEqual(DEFAULT_GATEWAY_URL, 'http://localhost:18789');
    });
  });
});

describe('saveWizardConfig', () => {
  /** @type {string} */
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'scout-wizard-save-'));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should save config to file', async () => {
    const configPath = join(tempDir, 'config.json');
    const wizardConfig = {
      gateway_url: 'http://localhost:18789',
      gateway_token: 'test-token'
    };

    await saveWizardConfig(configPath, wizardConfig);

    const content = await readFile(configPath, 'utf-8');
    const saved = JSON.parse(content);

    assert.strictEqual(saved.gateway_url, 'http://localhost:18789');
    assert.strictEqual(saved.gateway_token, 'test-token');
  });

  it('should create directory if not exists', async () => {
    const configPath = join(tempDir, 'nested', 'dir', 'config.json');
    const wizardConfig = {
      gateway_url: 'http://localhost:18789',
      gateway_token: ''
    };

    await saveWizardConfig(configPath, wizardConfig);

    const content = await readFile(configPath, 'utf-8');
    const saved = JSON.parse(content);
    assert.ok(saved);
  });

  it('should include default config values', async () => {
    const configPath = join(tempDir, 'config.json');
    const wizardConfig = {
      gateway_url: 'http://localhost:18789',
      gateway_token: ''
    };

    await saveWizardConfig(configPath, wizardConfig);

    const content = await readFile(configPath, 'utf-8');
    const saved = JSON.parse(content);

    // Should have default values for other fields
    assert.strictEqual(saved.sample_rate, 16000);
    assert.strictEqual(saved.vad_threshold, 0.5);
    assert.strictEqual(saved.silence_duration_ms, 1200);
    assert.strictEqual(saved.display_mode, 'minimal');
  });

  it('should merge additional config', async () => {
    const configPath = join(tempDir, 'config.json');
    const wizardConfig = {
      gateway_url: 'http://localhost:18789',
      gateway_token: ''
    };

    await saveWizardConfig(configPath, wizardConfig, {
      vad_model_path: '/path/to/vad.onnx',
      log_level: 'debug'
    });

    const content = await readFile(configPath, 'utf-8');
    const saved = JSON.parse(content);

    assert.strictEqual(saved.vad_model_path, '/path/to/vad.onnx');
    assert.strictEqual(saved.log_level, 'debug');
  });

  it('should throw on validation error', async () => {
    const configPath = join(tempDir, 'config.json');
    const wizardConfig = {
      gateway_url: 'http://external-server.com:18789', // Not localhost
      gateway_token: ''
    };

    await assert.rejects(
      () => saveWizardConfig(configPath, wizardConfig),
      /localhost/i
    );
  });

  it('should throw for invalid vad_threshold', async () => {
    const configPath = join(tempDir, 'config.json');
    const wizardConfig = {
      gateway_url: 'http://localhost:18789',
      gateway_token: ''
    };

    await assert.rejects(
      () => saveWizardConfig(configPath, wizardConfig, { vad_threshold: 1.5 }),
      /vad_threshold/i
    );
  });
});

describe('createSetupWizard', () => {
  it('should create a SetupWizard instance', () => {
    const wizard = createSetupWizard({ skipConnectionTest: true });
    assert.ok(wizard instanceof SetupWizard);
  });

  it('should pass options to constructor', () => {
    const wizard = createSetupWizard({ skipConnectionTest: true });
    assert.ok(wizard);
    // Can't directly test private _skipConnectionTest, but wizard was created without error
  });
});

describe('SetupWizard URL validation', () => {
  it('should recognize localhost as valid', () => {
    const wizard = new SetupWizard({ skipConnectionTest: true });
    // Access the private method for testing URL validation
    assert.strictEqual(wizard._isValidUrl('http://localhost:18789'), true);
    assert.strictEqual(wizard._isValidUrl('http://127.0.0.1:18789'), true);
    assert.strictEqual(wizard._isValidUrl('http://localhost'), true);
  });

  it('should reject invalid URLs', () => {
    const wizard = new SetupWizard({ skipConnectionTest: true });
    assert.strictEqual(wizard._isValidUrl('not-a-url'), false);
    assert.strictEqual(wizard._isValidUrl(''), false);
    assert.strictEqual(wizard._isValidUrl('localhost'), false); // Missing protocol
  });
});

describe('SetupWizard events', () => {
  it('should extend EventEmitter', () => {
    const wizard = new SetupWizard({ skipConnectionTest: true });
    assert.strictEqual(typeof wizard.on, 'function');
    assert.strictEqual(typeof wizard.emit, 'function');
    assert.strictEqual(typeof wizard.off, 'function');
  });

  it('should emit events when cancel is called', () => {
    const wizard = new SetupWizard({ skipConnectionTest: true });
    const events = [];

    wizard.on('cancelled', (data) => events.push({ type: 'cancelled', data }));
    wizard.cancel();

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'cancelled');
    assert.strictEqual(events[0].data.reason, 'user_cancelled');
  });
});
