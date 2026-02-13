# whisper.cpp STT Specification

Documentation for whisper.cpp speech-to-text integration in Scout.

## Overview

whisper.cpp is a high-performance C++ implementation of OpenAI's Whisper automatic speech recognition model. Scout uses whisper.cpp for local, on-device transcription of user speech.

### Why whisper.cpp?

| Criterion | whisper.cpp | Alternative (Vosk) | Alternative (Cloud) |
|-----------|-------------|-------------------|---------------------|
| Local execution | Yes | Yes | No |
| aarch64 support | Excellent | Good | N/A |
| Accuracy | High | Medium | High |
| Model flexibility | tiny/base/small/medium | Limited | N/A |
| Latency | ~1-2s for short speech | ~1s | Network dependent |
| Dependencies | C++ build tools | Python bindings | API key |

whisper.cpp is chosen for its balance of accuracy, speed, and local-first operation on aarch64/Android.

## Installation (Termux)

### Prerequisites

```bash
pkg install git cmake clang make
```

### Build from Source

```bash
# Clone repository
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp

# Build with optimizations for aarch64
make -j8

# Verify build
./main --help
```

### Build Options

| Option | Command | Use Case |
|--------|---------|----------|
| Standard | `make -j8` | Default build |
| Debug | `make -j8 DEBUG=1` | Troubleshooting |
| No BLAS | `make -j8 WHISPER_NO_ACCELERATE=1` | Minimal dependencies |

## Model Selection

Download models from whisper.cpp repository:

```bash
# Download model script
./models/download-ggml-model.sh <model-name>
```

### Model Trade-offs

| Model | Size | RAM Usage | Inference Time* | Accuracy | Recommended For |
|-------|------|-----------|-----------------|----------|-----------------|
| `tiny.en` | 75 MB | ~125 MB | ~0.8s | Good | **Default** - best speed/accuracy balance |
| `base.en` | 142 MB | ~210 MB | ~1.5s | Better | Higher accuracy needs |
| `small.en` | 466 MB | ~600 MB | ~4s | High | Challenging audio |
| `medium.en` | 1.5 GB | ~1.8 GB | ~12s | Excellent | Not recommended for Phase 0 |

*Inference time estimated for ~5 seconds of speech on typical aarch64 Android device.

### Model Naming

- `.en` suffix: English-only models (faster, smaller)
- No suffix: Multilingual models (larger, slower for English)

**Scout Phase 0 uses English-only models** for optimal performance.

### Download Commands

```bash
# Recommended: tiny.en for Phase 0
./models/download-ggml-model.sh tiny.en

# Alternative: base.en for higher accuracy
./models/download-ggml-model.sh base.en
```

Model files are stored in `whisper.cpp/models/`:
- `ggml-tiny.en.bin` (75 MB)
- `ggml-base.en.bin` (142 MB)

## Usage

### CLI Command Format

```bash
./main -m <model-path> -f <audio-file> [options]
```

### Required Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `-m` | Path to model file | `-m models/ggml-tiny.en.bin` |
| `-f` | Input audio file | `-f input.wav` |

### Useful Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t <n>` | Number of threads | 4 |
| `-nt` | No timestamps in output | off |
| `-np` | No printing progress | off |
| `-of <fmt>` | Output format (txt/vtt/srt/json) | txt |
| `--no-fallback` | Disable temperature fallback | off |

### Audio Format Requirements

whisper.cpp requires specific audio format:

| Property | Required Value |
|----------|----------------|
| Container | WAV |
| Sample format | PCM signed 16-bit little-endian (s16le) |
| Sample rate | 16000 Hz |
| Channels | 1 (mono) |

**Converting from Scout's capture format:**

Scout's AudioCapture outputs raw PCM (16kHz, mono, s16le) which must be wrapped with a WAV header before passing to whisper.cpp.

### Output Format

By default, whisper.cpp outputs plain text to stdout:

```
[transcribed text here]
```

With `-nt` (no timestamps):
```
Hello, how are you doing today?
```

With timestamps (default):
```
[00:00:00.000 --> 00:00:02.500]   Hello, how are you doing today?
```

**Scout uses `-nt` for clean text output.**

## Integration with Node.js

### Overview

Scout wraps whisper.cpp CLI using Node.js child_process:

1. Write PCM audio to temporary WAV file
2. Spawn whisper.cpp process
3. Parse stdout for transcribed text
4. Clean up temporary file

### Temp File Handling

```javascript
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

function createTempWavPath() {
  return join(tmpdir(), `scout-stt-${randomUUID()}.wav`);
}

function cleanup(filePath) {
  try {
    unlinkSync(filePath);
  } catch (err) {
    // Log but don't throw - cleanup is best-effort
    console.warn(`Failed to cleanup temp file: ${filePath}`);
  }
}
```

### WAV File Creation

```javascript
/**
 * Create WAV file from raw PCM data
 * @param {Int16Array} pcmData - 16-bit signed PCM samples
 * @param {number} sampleRate - Sample rate (default 16000)
 * @returns {Buffer} WAV file buffer
 */
function pcmToWav(pcmData, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length * 2; // 16-bit = 2 bytes per sample

  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);           // Subchunk size
  buffer.writeUInt16LE(1, 20);            // Audio format (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Copy PCM data
  const dataView = new Int16Array(buffer.buffer, 44);
  dataView.set(pcmData);

  return buffer;
}
```

### Process Spawning

```javascript
import { spawn } from 'child_process';

const WHISPER_PATH = '/path/to/whisper.cpp/main';
const MODEL_PATH = '/path/to/models/ggml-tiny.en.bin';

/**
 * Transcribe audio using whisper.cpp
 * @param {Int16Array} audio - PCM audio samples (16kHz, mono)
 * @returns {Promise<string>} Transcribed text
 */
async function transcribe(audio) {
  const wavPath = createTempWavPath();

  try {
    // Write audio to temp WAV file
    const wavBuffer = pcmToWav(audio);
    writeFileSync(wavPath, wavBuffer);

    // Run whisper.cpp
    const result = await runWhisper(wavPath);
    return result;
  } finally {
    cleanup(wavPath);
  }
}

function runWhisper(wavPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const errors = [];

    const proc = spawn(WHISPER_PATH, [
      '-m', MODEL_PATH,
      '-f', wavPath,
      '-nt',              // No timestamps
      '-np',              // No progress
      '-t', '4',          // 4 threads
      '--no-fallback'     // Disable temperature fallback
    ]);

    proc.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    proc.stderr.on('data', (chunk) => {
      errors.push(chunk);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const text = Buffer.concat(chunks).toString('utf-8').trim();
        resolve(text);
      } else {
        const errorMsg = Buffer.concat(errors).toString('utf-8');
        reject(new Error(`whisper.cpp exited with code ${code}: ${errorMsg}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start whisper.cpp: ${err.message}`));
    });
  });
}
```

### Output Parsing

whisper.cpp may output artifacts that need filtering:

```javascript
/**
 * Clean whisper.cpp output
 * @param {string} rawText - Raw output from whisper.cpp
 * @returns {string} Cleaned text
 */
function parseWhisperOutput(rawText) {
  let text = rawText.trim();

  // Remove common artifacts
  // [BLANK_AUDIO], (silence), etc.
  text = text.replace(/\[BLANK_AUDIO\]/gi, '');
  text = text.replace(/\(silence\)/gi, '');
  text = text.replace(/\[inaudible\]/gi, '');

  // Remove leading/trailing whitespace and normalize spaces
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}
```

### Complete STT Module

```javascript
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

class STT {
  constructor(config) {
    this.whisperPath = config.whisper_path || '/path/to/whisper.cpp/main';
    this.modelPath = config.stt_model_path;
    this.threads = config.stt_threads || 4;
  }

  /**
   * Transcribe audio to text
   * @param {Int16Array} audio - PCM samples (16kHz, mono, s16le)
   * @returns {Promise<string>} Transcribed text or empty string
   */
  async transcribe(audio) {
    if (!audio || audio.length === 0) {
      return '';
    }

    const wavPath = join(tmpdir(), `scout-stt-${randomUUID()}.wav`);

    try {
      // Create WAV file
      const wavBuffer = this.pcmToWav(audio);
      writeFileSync(wavPath, wavBuffer);

      // Run inference
      const rawText = await this.runInference(wavPath);

      // Parse and clean output
      const text = this.parseOutput(rawText);

      return text;
    } finally {
      this.cleanup(wavPath);
    }
  }

  pcmToWav(pcmData, sampleRate = 16000) {
    // ... (implementation from above)
  }

  runInference(wavPath) {
    return new Promise((resolve, reject) => {
      const stdout = [];
      const stderr = [];

      const proc = spawn(this.whisperPath, [
        '-m', this.modelPath,
        '-f', wavPath,
        '-nt',
        '-np',
        '-t', String(this.threads),
        '--no-fallback'
      ]);

      proc.stdout.on('data', (chunk) => stdout.push(chunk));
      proc.stderr.on('data', (chunk) => stderr.push(chunk));

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(stdout).toString('utf-8'));
        } else {
          reject(new Error(`whisper.cpp error (${code}): ${Buffer.concat(stderr).toString()}`));
        }
      });

      proc.on('error', reject);
    });
  }

  parseOutput(rawText) {
    let text = rawText.trim();
    text = text.replace(/\[BLANK_AUDIO\]/gi, '');
    text = text.replace(/\(silence\)/gi, '');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  cleanup(filePath) {
    try {
      unlinkSync(filePath);
    } catch {
      // Best-effort cleanup
    }
  }
}

export { STT };
```

## Performance Characteristics

### Inference Time Estimates (aarch64)

Tested on typical Android devices with Snapdragon 8-series SoC:

| Model | 2s Audio | 5s Audio | 10s Audio |
|-------|----------|----------|-----------|
| tiny.en | ~0.4s | ~0.8s | ~1.5s |
| base.en | ~0.8s | ~1.5s | ~3s |
| small.en | ~2s | ~4s | ~8s |

**Note:** Actual performance varies by device. First inference may be slower due to model loading.

### Memory Usage

| Model | Peak RAM | Steady State |
|-------|----------|--------------|
| tiny.en | ~150 MB | ~125 MB |
| base.en | ~250 MB | ~210 MB |
| small.en | ~700 MB | ~600 MB |

### Thread Configuration

| Threads | Latency | CPU Usage | Recommendation |
|---------|---------|-----------|----------------|
| 1 | Slowest | ~25% | Not recommended |
| 2 | Moderate | ~50% | Battery saving |
| 4 | **Fast** | ~100% | **Default** |
| 8 | Fastest | ~100%+ | Diminishing returns |

## Error Handling

### Exit Codes

| Code | Meaning | Recovery |
|------|---------|----------|
| 0 | Success | Process output |
| 1 | General error | Check stderr, log error |
| 2 | Invalid arguments | Check command construction |
| 127 | Command not found | Verify whisper.cpp path |

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `failed to open 'model.bin'` | Model file not found | Verify `stt_model_path` in config |
| `failed to load model` | Corrupt/incompatible model | Re-download model |
| `failed to open 'audio.wav'` | Input file not found | Check temp file creation |
| `invalid WAV file` | Wrong audio format | Verify WAV header creation |
| `GGML_ASSERT: ggml.c` | Memory/model issue | Try smaller model |

### Error Handling in Code

```javascript
async transcribe(audio) {
  try {
    const text = await this.runInference(wavPath);

    if (this.isGarbageOutput(text)) {
      return { text: '', error: 'EMPTY_TRANSCRIPT' };
    }

    return { text, error: null };
  } catch (err) {
    if (err.message.includes('failed to open')) {
      return { text: '', error: 'MODEL_NOT_FOUND' };
    }
    if (err.message.includes('invalid WAV')) {
      return { text: '', error: 'INVALID_AUDIO' };
    }
    return { text: '', error: 'STT_ERROR' };
  }
}

isGarbageOutput(text) {
  if (!text || text.length === 0) return true;
  if (text === '[BLANK_AUDIO]') return true;
  // Only punctuation or very short
  if (/^[\s.,!?]+$/.test(text)) return true;
  if (text.length < 2) return true;
  return false;
}
```

## Troubleshooting

### Compilation Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `make: clang: not found` | Missing compiler | `pkg install clang` |
| `fatal error: 'stdlib.h' not found` | Missing headers | `pkg install ndk-multilib` |
| `undefined reference to pthread_*` | Missing pthread | Ensure make uses `-lpthread` |
| Build hangs | Insufficient memory | Reduce parallelism: `make -j2` |

### Model Download Failures

| Issue | Cause | Solution |
|-------|-------|----------|
| `curl: command not found` | Missing curl | `pkg install curl` |
| Download incomplete | Network issue | Re-run download script |
| Hash mismatch | Corrupt download | Delete and re-download |
| Disk full | Insufficient space | Free space, models need 75MB-1.5GB |

### Poor Transcription Quality

| Symptom | Possible Cause | Solution |
|---------|----------------|----------|
| Empty output | Audio too quiet | Check mic gain |
| Gibberish text | Wrong audio format | Verify 16kHz mono s16le |
| Cut-off words | Speech clipped | Adjust VAD silence threshold |
| Wrong words | Background noise | Use larger model (base.en) |
| Repeated phrases | Model hallucination | Enable `--no-fallback` |

### Runtime Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Very slow inference | Thermal throttling | Wait for device to cool |
| Out of memory | Model too large | Use smaller model |
| Temp files not cleaned | Crash during processing | Implement cleanup on startup |

## Examples

### Build Commands

```bash
# Full build sequence for Termux
pkg install git cmake clang make

git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp

# Standard build
make -j8

# Download recommended model
./models/download-ggml-model.sh tiny.en

# Verify installation
./main -m models/ggml-tiny.en.bin -f samples/jfk.wav
```

### Transcription Command

```bash
# Basic transcription
./main -m models/ggml-tiny.en.bin -f audio.wav

# Production settings (Scout defaults)
./main \
  -m models/ggml-tiny.en.bin \
  -f audio.wav \
  -nt \
  -np \
  -t 4 \
  --no-fallback
```

### Node.js Integration Example

```javascript
import { STT } from './stt/index.mjs';

// Configuration
const config = {
  whisper_path: '/data/data/com.termux/files/home/whisper.cpp/main',
  stt_model_path: '/data/data/com.termux/files/home/whisper.cpp/models/ggml-tiny.en.bin',
  stt_threads: 4
};

// Initialize
const stt = new STT(config);

// Transcribe audio from VAD
async function handleSpeechEnded(audioBuffer) {
  const startTime = Date.now();

  const result = await stt.transcribe(audioBuffer);

  const duration = Date.now() - startTime;
  console.log(`STT completed in ${duration}ms`);

  if (result.error === 'EMPTY_TRANSCRIPT') {
    console.log("Didn't catch that");
    return null;
  }

  if (result.error) {
    console.error(`STT error: ${result.error}`);
    return null;
  }

  console.log(`Transcript: ${result.text}`);
  return result.text;
}
```

## Configuration

Scout config should include:

```json
{
  "stt": {
    "whisper_path": "/path/to/whisper.cpp/main",
    "model_path": "/path/to/models/ggml-tiny.en.bin",
    "threads": 4
  }
}
```

Users can swap models by changing `model_path` to a different GGML model file.

## Setup Verification

Test whisper.cpp installation:

```bash
# Create test audio (or use sample)
ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 -ac 1 test.wav

# Or record with PulseAudio
parecord --raw --format=s16le --rate=16000 --channels=1 | \
  ffmpeg -f s16le -ar 16000 -ac 1 -i - test.wav

# Test transcription
./main -m models/ggml-tiny.en.bin -f test.wav -nt
```

## References

- whisper.cpp GitHub: https://github.com/ggerganov/whisper.cpp
- Model downloads: https://huggingface.co/ggerganov/whisper.cpp
- Original Whisper paper: https://arxiv.org/abs/2212.04356
- GGML format: https://github.com/ggerganov/ggml
