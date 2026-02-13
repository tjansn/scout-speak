/**
 * PulseAudio utilities
 *
 * Per T009 and audio_io.md:
 * - Detect if PulseAudio is running
 * - Start PulseAudio if not running
 * - Fail gracefully with clear error if cannot start
 */

import { spawn, execSync } from 'child_process';

/**
 * @typedef {Object} PulseAudioStatus
 * @property {boolean} running - Whether PulseAudio is running
 * @property {string|null} error - Error message if any
 */

/**
 * Check if PulseAudio is running
 * @returns {boolean}
 */
export function isPulseAudioRunning() {
  try {
    execSync('pulseaudio --check', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start PulseAudio daemon
 * @returns {Promise<boolean>} True if started successfully
 */
export async function startPulseAudio() {
  return new Promise((resolve) => {
    try {
      // Start pulseaudio in daemon mode
      const proc = spawn('pulseaudio', ['--start'], {
        stdio: 'ignore',
        detached: true
      });

      // Handle spawn error (e.g., command not found)
      proc.on('error', () => {
        resolve(false);
      });

      proc.unref();

      // Give it a moment to start
      setTimeout(() => {
        resolve(isPulseAudioRunning());
      }, 500);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Ensure PulseAudio is running, starting it if necessary
 * @returns {Promise<PulseAudioStatus>}
 */
export async function ensurePulseAudio() {
  // Check if already running
  if (isPulseAudioRunning()) {
    return { running: true, error: null };
  }

  // Try to start it
  const started = await startPulseAudio();

  if (started) {
    return { running: true, error: null };
  }

  return {
    running: false,
    error: 'Failed to start PulseAudio. Please ensure PulseAudio is installed and configured.'
  };
}

/**
 * Check if parecord command is available
 * @returns {boolean}
 */
export function isParecordAvailable() {
  try {
    execSync('which parecord', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if pacat command is available
 * @returns {boolean}
 */
export function isPacatAvailable() {
  try {
    execSync('which pacat', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if all PulseAudio tools are available
 * @returns {{available: boolean, missing: string[]}}
 */
export function checkPulseAudioTools() {
  const missing = [];

  if (!isParecordAvailable()) {
    missing.push('parecord');
  }

  if (!isPacatAvailable()) {
    missing.push('pacat');
  }

  return {
    available: missing.length === 0,
    missing
  };
}

/**
 * Kill PulseAudio (useful for cleanup in tests)
 * @returns {boolean}
 */
export function killPulseAudio() {
  try {
    execSync('pulseaudio --kill', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get default input/output device info
 * @returns {{source: string|null, sink: string|null}}
 */
export function getDefaultDevices() {
  try {
    const source = execSync('pactl get-default-source', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    const sink = execSync('pactl get-default-sink', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    return { source, sink };
  } catch {
    return { source: null, sink: null };
  }
}
