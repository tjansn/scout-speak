/**
 * Tests for Logger
 *
 * Per T041 acceptance criteria:
 * - Log levels work correctly
 * - File logging creates log file
 * - Useful debug information for troubleshooting
 *
 * Per T041 test requirements:
 * - Unit test: log level filtering
 * - Unit test: file writing
 * - Integration test: useful log output
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFile, mkdir, rm, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Logger, createLoggerFromConfig, getLogger } from '../../../src/utils/logger.mjs';
import { createMockConfig } from '../../test-utils.mjs';

describe('Logger', () => {
  /** @type {string} */
  let testDir;
  /** @type {string} */
  let testLogPath;

  // Store original console methods for restoration
  /** @type {typeof console.log} */
  let originalConsoleLog;
  /** @type {typeof console.warn} */
  let originalConsoleWarn;
  /** @type {typeof console.error} */
  let originalConsoleError;

  // Capture arrays for mocked console output
  /** @type {string[]} */
  let consoleLogCalls;
  /** @type {string[]} */
  let consoleWarnCalls;
  /** @type {string[]} */
  let consoleErrorCalls;

  beforeEach(async () => {
    testDir = join(tmpdir(), `scout-logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    testLogPath = join(testDir, 'test.log');

    // Reset global logger before each test
    Logger.resetGlobal();

    // Store original console methods
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;

    // Initialize capture arrays
    consoleLogCalls = [];
    consoleWarnCalls = [];
    consoleErrorCalls = [];

    // Mock console methods
    console.log = (...args) => {
      consoleLogCalls.push(args.join(' '));
    };
    console.warn = (...args) => {
      consoleWarnCalls.push(args.join(' '));
    };
    console.error = (...args) => {
      consoleErrorCalls.push(args.join(' '));
    };
  });

  afterEach(async () => {
    // Restore original console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;

    // Reset global logger after each test
    Logger.resetGlobal();

    // Clean up test files
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Constructor', () => {
    it('should create logger with default options', () => {
      const logger = new Logger();
      assert.strictEqual(logger.getLevel(), 'info');
      assert.strictEqual(logger.isFileLoggingEnabled(), false);
    });

    it('should create logger with custom log level', () => {
      const logger = new Logger({ level: 'debug' });
      assert.strictEqual(logger.getLevel(), 'debug');
    });

    it('should throw for invalid log level', () => {
      assert.throws(
        () => new Logger({ level: 'verbose' }),
        /Invalid log level: verbose/
      );
    });

    it('should throw when toFile is true but filePath is missing', () => {
      assert.throws(
        () => new Logger({ toFile: true }),
        /filePath is required when toFile is enabled/
      );
    });

    it('should accept valid file logging config', () => {
      const logger = new Logger({
        toFile: true,
        filePath: testLogPath
      });
      assert.strictEqual(logger.isFileLoggingEnabled(), true);
      assert.strictEqual(logger.getFilePath(), testLogPath);
    });
  });

  describe('Log Level Filtering', () => {
    it('should log all levels when level is debug', () => {
      const logger = new Logger({ level: 'debug', colorize: false });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      // Give async operations time to complete
      assert.ok(consoleLogCalls.some(c => c.includes('debug message')));
      assert.ok(consoleLogCalls.some(c => c.includes('info message')));
      assert.ok(consoleWarnCalls.some(c => c.includes('warn message')));
      assert.ok(consoleErrorCalls.some(c => c.includes('error message')));
    });

    it('should filter debug when level is info', () => {
      const logger = new Logger({ level: 'info', colorize: false });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');

      assert.ok(!consoleLogCalls.some(c => c.includes('debug message')));
      assert.ok(consoleLogCalls.some(c => c.includes('info message')));
      assert.ok(consoleWarnCalls.some(c => c.includes('warn message')));
    });

    it('should filter debug and info when level is warn', () => {
      const logger = new Logger({ level: 'warn', colorize: false });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      assert.ok(!consoleLogCalls.some(c => c.includes('debug message')));
      assert.ok(!consoleLogCalls.some(c => c.includes('info message')));
      assert.ok(consoleWarnCalls.some(c => c.includes('warn message')));
      assert.ok(consoleErrorCalls.some(c => c.includes('error message')));
    });

    it('should only log errors when level is error', () => {
      const logger = new Logger({ level: 'error', colorize: false });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      assert.strictEqual(consoleLogCalls.length, 0);
      assert.strictEqual(consoleWarnCalls.length, 0);
      assert.ok(consoleErrorCalls.some(c => c.includes('error message')));
    });
  });

  describe('setLevel', () => {
    it('should change log level dynamically', () => {
      const logger = new Logger({ level: 'error', colorize: false });

      // Should not log info at error level
      logger.info('hidden');
      assert.strictEqual(consoleLogCalls.length, 0);

      // Change to info level
      logger.setLevel('info');
      logger.info('visible');

      assert.ok(consoleLogCalls.some(c => c.includes('visible')));
    });

    it('should throw for invalid level in setLevel', () => {
      const logger = new Logger();
      assert.throws(
        () => logger.setLevel('invalid'),
        /Invalid log level/
      );
    });
  });

  describe('Log Message Formatting', () => {
    it('should include timestamp by default', () => {
      const logger = new Logger({ level: 'info', colorize: false });
      logger.info('test message');

      // Check for ISO-like timestamp format
      const logOutput = consoleLogCalls[0];
      assert.ok(logOutput.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/), 'Should include timestamp');
    });

    it('should include log level', () => {
      const logger = new Logger({ level: 'debug', colorize: false });

      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');

      assert.ok(consoleLogCalls.some(c => c.includes('DEBUG')));
      assert.ok(consoleLogCalls.some(c => c.includes('INFO')));
      assert.ok(consoleWarnCalls.some(c => c.includes('WARN')));
      assert.ok(consoleErrorCalls.some(c => c.includes('ERROR')));
    });

    it('should include metadata as JSON', () => {
      const logger = new Logger({ level: 'info', colorize: false });
      logger.info('message with meta', { key: 'value', count: 42 });

      const logOutput = consoleLogCalls[0];
      assert.ok(logOutput.includes('"key":"value"'));
      assert.ok(logOutput.includes('"count":42'));
    });

    it('should not include empty metadata', () => {
      const logger = new Logger({ level: 'info', colorize: false });
      logger.info('message without meta');
      logger.info('message with empty meta', {});

      // Neither should have JSON braces at the end
      assert.ok(!consoleLogCalls[0].endsWith('{}'));
    });
  });

  describe('Component Logger (child)', () => {
    it('should create child logger with component name', () => {
      const parent = new Logger({ level: 'info', colorize: false });
      const child = parent.child('VAD');

      assert.strictEqual(child.getComponent(), 'VAD');
      assert.strictEqual(child.getLevel(), 'info');
    });

    it('should include component name in output', () => {
      const parent = new Logger({ level: 'info', colorize: false });
      const child = parent.child('STT');
      child.info('processing audio');

      const logOutput = consoleLogCalls[0];
      assert.ok(logOutput.includes('[STT]'));
      assert.ok(logOutput.includes('processing audio'));
    });

    it('should inherit parent config', () => {
      const parent = new Logger({
        level: 'debug',
        toFile: true,
        filePath: testLogPath,
        colorize: false
      });
      const child = parent.child('TTS');

      assert.strictEqual(child.getLevel(), 'debug');
      assert.strictEqual(child.isFileLoggingEnabled(), true);
      assert.strictEqual(child.getFilePath(), testLogPath);
    });
  });

  describe('File Logging', () => {
    it('should create log file on first write', async () => {
      const logger = new Logger({
        level: 'info',
        toFile: true,
        filePath: testLogPath,
        colorize: false
      });

      logger.info('first message');

      // Wait for async file write
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check file exists
      await access(testLogPath);
      const content = await readFile(testLogPath, 'utf-8');
      assert.ok(content.includes('first message'));
    });

    it('should append to existing log file', async () => {
      const logger = new Logger({
        level: 'info',
        toFile: true,
        filePath: testLogPath,
        colorize: false
      });

      logger.info('message 1');
      logger.info('message 2');

      // Wait for async file writes
      await new Promise(resolve => setTimeout(resolve, 100));

      const content = await readFile(testLogPath, 'utf-8');
      assert.ok(content.includes('message 1'));
      assert.ok(content.includes('message 2'));
    });

    it('should create log directory if it does not exist', async () => {
      const nestedLogPath = join(testDir, 'nested', 'deep', 'scout.log');
      const logger = new Logger({
        level: 'info',
        toFile: true,
        filePath: nestedLogPath,
        colorize: false
      });

      logger.info('nested log message');

      // Wait for async file write
      await new Promise(resolve => setTimeout(resolve, 100));

      const content = await readFile(nestedLogPath, 'utf-8');
      assert.ok(content.includes('nested log message'));
    });

    it('should not include ANSI colors in file output', async () => {
      const logger = new Logger({
        level: 'info',
        toFile: true,
        filePath: testLogPath,
        colorize: true // colors enabled for console
      });

      logger.info('color test');

      // Wait for async file write
      await new Promise(resolve => setTimeout(resolve, 100));

      const content = await readFile(testLogPath, 'utf-8');
      // Should not contain ANSI escape codes
      assert.ok(!content.includes('\x1b['));
    });

    it('should respect log level for file output', async () => {
      const logger = new Logger({
        level: 'warn',
        toFile: true,
        filePath: testLogPath,
        colorize: false
      });

      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      // Wait for async file writes
      await new Promise(resolve => setTimeout(resolve, 100));

      const content = await readFile(testLogPath, 'utf-8');
      assert.ok(!content.includes('debug msg'));
      assert.ok(!content.includes('info msg'));
      assert.ok(content.includes('warn msg'));
      assert.ok(content.includes('error msg'));
    });
  });

  describe('Global Logger', () => {
    it('should create singleton on first call', () => {
      const logger1 = Logger.getGlobal({ level: 'debug' });
      const logger2 = Logger.getGlobal({ level: 'error' }); // config ignored

      assert.strictEqual(logger1, logger2);
      assert.strictEqual(logger2.getLevel(), 'debug');
    });

    it('should allow reconfiguration via configure', () => {
      Logger.configure({ level: 'debug', colorize: false });
      const logger1 = Logger.getGlobal();
      assert.strictEqual(logger1.getLevel(), 'debug');

      Logger.configure({ level: 'error', colorize: false });
      const logger2 = Logger.getGlobal();
      assert.strictEqual(logger2.getLevel(), 'error');

      // They are different instances now
      assert.notStrictEqual(logger1, logger2);
    });

    it('should reset global instance', () => {
      Logger.configure({ level: 'debug', colorize: false });
      const logger1 = Logger.getGlobal();

      Logger.resetGlobal();

      const logger2 = Logger.getGlobal({ level: 'info', colorize: false });
      assert.notStrictEqual(logger1, logger2);
      assert.strictEqual(logger2.getLevel(), 'info');
    });
  });

  describe('createLoggerFromConfig', () => {
    it('should create logger from Scout config', () => {
      const config = createMockConfig({
        log_level: 'debug',
        log_to_file: false
      });

      const logger = createLoggerFromConfig(config);

      assert.strictEqual(logger.getLevel(), 'debug');
      assert.strictEqual(logger.isFileLoggingEnabled(), false);
    });

    it('should enable file logging when config specifies', () => {
      const config = createMockConfig({
        log_level: 'info',
        log_to_file: true
      });

      const logger = createLoggerFromConfig(config, testLogPath);

      assert.strictEqual(logger.isFileLoggingEnabled(), true);
      assert.strictEqual(logger.getFilePath(), testLogPath);
    });

    it('should use default log path when not specified', () => {
      const config = createMockConfig({
        log_to_file: true
      });

      const logger = createLoggerFromConfig(config);

      const filePath = logger.getFilePath();
      assert.ok(filePath !== null && filePath.includes('.scout/scout.log'));
    });
  });

  describe('getLogger', () => {
    it('should get component logger from global instance', () => {
      Logger.configure({ level: 'info', colorize: false });

      const vadLogger = getLogger('VAD');
      const sttLogger = getLogger('STT');

      assert.strictEqual(vadLogger.getComponent(), 'VAD');
      assert.strictEqual(sttLogger.getComponent(), 'STT');
    });

    it('should share config with global instance', () => {
      Logger.configure({ level: 'debug', colorize: false });

      const componentLogger = getLogger('Test');

      assert.strictEqual(componentLogger.getLevel(), 'debug');
    });
  });

  describe('Integration: Useful Debug Output', () => {
    it('should produce actionable debug output', () => {
      const logger = new Logger({ level: 'debug', colorize: false });
      const vadLogger = logger.child('VAD');
      const sttLogger = logger.child('STT');

      // Simulate typical debug logging scenario
      vadLogger.debug('Frame received', { samples: 480, speechProb: 0.23 });
      vadLogger.info('Speech started');
      vadLogger.debug('Frame received', { samples: 480, speechProb: 0.87 });
      vadLogger.info('Speech ended', { durationMs: 1523 });
      sttLogger.info('Transcribing', { audioMs: 1523 });
      sttLogger.debug('Model loaded', { model: 'tiny.en' });
      sttLogger.info('Transcription complete', { text: 'hello world', latencyMs: 234 });

      // Verify output is useful for debugging
      assert.ok(consoleLogCalls.some(c => c.includes('[VAD]') && c.includes('Speech started')));
      assert.ok(consoleLogCalls.some(c => c.includes('[STT]') && c.includes('Transcription complete')));
      assert.ok(consoleLogCalls.some(c => c.includes('"speechProb"')));
      assert.ok(consoleLogCalls.some(c => c.includes('"latencyMs"')));
    });

    it('should log errors with stack-like context', () => {
      const logger = new Logger({ level: 'error', colorize: false });
      const clientLogger = logger.child('OpenClawClient');

      clientLogger.error('Connection failed', {
        url: 'http://localhost:18789',
        code: 'ECONNREFUSED',
        attempt: 3
      });

      const errorOutput = consoleErrorCalls[0];
      assert.ok(errorOutput.includes('[OpenClawClient]'));
      assert.ok(errorOutput.includes('Connection failed'));
      assert.ok(errorOutput.includes('ECONNREFUSED'));
    });
  });
});
