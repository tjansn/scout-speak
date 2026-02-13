/**
 * OpenClaw Client - CLI wrapper for OpenClaw gateway communication
 *
 * Per openclaw_api.md:
 * - Use CLI `openclaw agent --agent main --message "text" --json` for communication
 * - Handle exit codes: 0 (success), 1 (error), 7 (connection refused)
 * - Parse JSON response to extract result.payloads[0].text
 * - Support gateway token authentication
 * - Never log raw token values
 *
 * Per prd.md FR-3:
 * - Sends transcript to OpenClaw, receives response
 * - Shows error if unreachable (never fake responses)
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * @typedef {import('../config/config.mjs').Config} Config
 */

/**
 * @typedef {Object} OpenClawResponse
 * @property {string} text - Agent response text
 * @property {string|null} sessionId - Session identifier from response
 * @property {number} durationMs - Processing time in milliseconds
 */

/**
 * @typedef {Object} OpenClawRawResponse
 * @property {string} runId
 * @property {string} status
 * @property {string} summary
 * @property {{ payloads: Array<{ text: string, mediaUrl?: string|null }>, meta: { durationMs: number, agentMeta: { sessionId: string } } }} result
 */

/**
 * Error codes from OpenClaw CLI
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  CONNECTION_REFUSED: 7
};

/**
 * Error types for categorizing OpenClaw errors
 */
export const ERROR_TYPES = {
  PARSE_ERROR: 'PARSE_ERROR',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  CLI_ERROR: 'CLI_ERROR',
  TIMEOUT: 'TIMEOUT',
  GATEWAY_NOT_RUNNING: 'GATEWAY_NOT_RUNNING'
};

/**
 * Custom error class for OpenClaw errors
 */
export class OpenClawError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} type - Error type from ERROR_TYPES
   * @param {number} [exitCode] - Exit code if available
   */
  constructor(message, type, exitCode) {
    super(message);
    this.name = 'OpenClawError';
    this.type = type;
    this.exitCode = exitCode;
  }
}

/**
 * OpenClaw CLI wrapper client
 *
 * Provides methods to communicate with OpenClaw gateway via CLI commands.
 * Handles authentication, response parsing, and error conditions.
 */
export class OpenClawClient extends EventEmitter {
  /**
   * @param {Config} config - Scout configuration
   */
  constructor(config) {
    super();

    if (!config || typeof config !== 'object') {
      throw new Error('Config is required');
    }

    if (!config.gateway_url || typeof config.gateway_url !== 'string') {
      throw new Error('gateway_url is required in config');
    }

    /** @type {Config} */
    this._config = config;

    /** @type {string|null} */
    this._lastSessionId = null;

    /** @type {number} */
    this._timeout = 30000; // 30 second default timeout
  }

  /**
   * Get the current session ID
   * @returns {string|null}
   */
  get sessionId() {
    return this._lastSessionId;
  }

  /**
   * Set the timeout for CLI commands
   * @param {number} timeoutMs - Timeout in milliseconds
   */
  setTimeout(timeoutMs) {
    if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
      throw new Error('Timeout must be a positive number');
    }
    this._timeout = timeoutMs;
  }

  /**
   * Build CLI arguments for the openclaw command
   * @param {string} message - User message to send
   * @param {Object} [options={}] - Additional options
   * @param {string} [options.sessionId] - Explicit session ID
   * @returns {string[]}
   * @private
   */
  _buildArgs(message, options = {}) {
    const args = ['agent', '--agent', 'main', '--message', message, '--json'];

    // Add session ID if provided
    if (options.sessionId) {
      args.push('--session-id', options.sessionId);
    }

    return args;
  }

  /**
   * Build environment variables for the openclaw process
   * @returns {NodeJS.ProcessEnv}
   * @private
   */
  _buildEnv() {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env };

    // Pass gateway token via environment variable if configured
    // Never log the token value
    if (this._config.gateway_token) {
      env.OPENCLAW_GATEWAY_TOKEN = this._config.gateway_token;
    }

    return env;
  }

  /**
   * Parse the JSON response from OpenClaw CLI
   * @param {string} stdout - Raw stdout output
   * @returns {OpenClawResponse}
   * @throws {OpenClawError}
   * @private
   */
  _parseResponse(stdout) {
    /** @type {OpenClawRawResponse} */
    let parsed;

    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new OpenClawError(
        `Failed to parse OpenClaw response: ${/** @type {Error} */ (err).message}`,
        ERROR_TYPES.PARSE_ERROR
      );
    }

    // Validate response structure
    if (!parsed || typeof parsed !== 'object') {
      throw new OpenClawError('Invalid response: not an object', ERROR_TYPES.PARSE_ERROR);
    }

    if (parsed.status !== 'ok') {
      throw new OpenClawError(
        `OpenClaw returned error status: ${parsed.status}`,
        ERROR_TYPES.CLI_ERROR
      );
    }

    // Extract text from payloads
    const text = parsed.result?.payloads?.[0]?.text || '';

    // Extract session ID
    const sessionId = parsed.result?.meta?.agentMeta?.sessionId || null;

    // Extract duration
    const durationMs = parsed.result?.meta?.durationMs || 0;

    // Store session ID for continuity
    if (sessionId) {
      this._lastSessionId = sessionId;
    }

    return { text, sessionId, durationMs };
  }

  /**
   * Execute an OpenClaw CLI command
   * @param {string[]} args - CLI arguments
   * @param {NodeJS.ProcessEnv} env - Environment variables
   * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
   * @private
   */
  _exec(args, env) {
    return new Promise((resolve, reject) => {
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timeoutId = null;
      let killed = false;

      const proc = spawn('openclaw', args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (/** @type {Buffer} */ data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (/** @type {Buffer} */ data) => {
        stderr += data.toString();
      });

      proc.on('error', (/** @type {Error} */ err) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(new OpenClawError(
          `Failed to execute openclaw: ${err.message}`,
          ERROR_TYPES.CLI_ERROR
        ));
      });

      proc.on('close', (/** @type {number|null} */ code) => {
        if (timeoutId) clearTimeout(timeoutId);

        if (killed) {
          reject(new OpenClawError('Command timed out', ERROR_TYPES.TIMEOUT));
          return;
        }

        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      // Set timeout
      timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
      }, this._timeout);
    });
  }

  /**
   * Categorize error based on exit code and stderr
   * @param {number} exitCode - Process exit code
   * @param {string} stderr - Standard error output
   * @returns {OpenClawError}
   * @private
   */
  _categorizeError(exitCode, stderr) {
    const stderrLower = stderr.toLowerCase();

    if (exitCode === EXIT_CODES.CONNECTION_REFUSED) {
      return new OpenClawError(
        'Cannot reach OpenClaw',
        ERROR_TYPES.CONNECTION_REFUSED,
        exitCode
      );
    }

    if (stderrLower.includes('gateway not running') ||
        stderrLower.includes('connection refused') ||
        stderrLower.includes('econnrefused')) {
      return new OpenClawError(
        'Cannot reach OpenClaw',
        ERROR_TYPES.GATEWAY_NOT_RUNNING,
        exitCode
      );
    }

    // Extract meaningful error message from stderr
    const errorMessage = stderr.trim() || 'Unknown error';
    return new OpenClawError(
      `OpenClaw error: ${errorMessage}`,
      ERROR_TYPES.CLI_ERROR,
      exitCode
    );
  }

  /**
   * Send a message to OpenClaw and receive a response
   *
   * @param {string} message - User message to send
   * @param {Object} [options={}] - Additional options
   * @param {string} [options.sessionId] - Explicit session ID to use
   * @returns {Promise<OpenClawResponse>}
   * @throws {OpenClawError}
   */
  async send(message, options = {}) {
    if (!message || typeof message !== 'string') {
      throw new Error('Message must be a non-empty string');
    }

    const args = this._buildArgs(message.trim(), options);
    const env = this._buildEnv();

    this.emit('sending', { message: message.trim() });

    const { stdout, stderr, exitCode } = await this._exec(args, env);

    if (exitCode !== EXIT_CODES.SUCCESS) {
      const error = this._categorizeError(exitCode, stderr);
      this.emit('error', error);
      throw error;
    }

    const response = this._parseResponse(stdout);
    this.emit('received', response);

    return response;
  }

  /**
   * Check if OpenClaw gateway is healthy
   *
   * @returns {Promise<boolean>} True if gateway is reachable and healthy
   */
  async healthCheck() {
    try {
      const { exitCode } = await this._exec(['gateway', 'health'], this._buildEnv());
      return exitCode === EXIT_CODES.SUCCESS;
    } catch {
      return false;
    }
  }

  /**
   * Reset the session (clears stored session ID)
   */
  resetSession() {
    this._lastSessionId = null;
    this.emit('session_reset');
  }
}

export default OpenClawClient;
