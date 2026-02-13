# Silero VAD Specification

Documentation for Silero VAD integration in Scout.

## Overview

Silero VAD (Voice Activity Detection) is a fast, accurate, and local neural network model for detecting human speech in audio streams. Scout uses Silero VAD to determine when the user starts and stops speaking, enabling seamless voice interaction without continuous speech-to-text processing.

### Why Silero VAD

| Criterion | How Silero Meets It |
|-----------|---------------------|
| Local operation | Runs entirely on-device via ONNX runtime |
| Low latency | ~2ms inference per 30ms frame |
| Accuracy | Neural network trained on diverse speech data; better than energy-based VAD |
| ONNX-based | Cross-platform, runs in Node.js via onnxruntime-node |
| Proven | Widely used in voice applications, well-documented |
| Small footprint | Model size ~2MB |

---

## Installation

### ONNX Runtime for Node.js

```bash
npm install onnxruntime-node
```

The `onnxruntime-node` package provides native ONNX inference for Node.js on multiple platforms including Linux aarch64 (Termux).

### Silero VAD Model Download

Download the Silero VAD v4 model from the official repository:

```bash
# Create models directory
mkdir -p ~/.openclaw/workspace/scout/models

# Download Silero VAD v4 model
curl -L -o ~/.openclaw/workspace/scout/models/silero_vad.onnx \
  https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx
```

**Model URL:** `https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx`

### Verification

Verify the model loads correctly:

```javascript
import * as ort from 'onnxruntime-node';

const session = await ort.InferenceSession.create('./models/silero_vad.onnx');
console.log('Model loaded successfully');
console.log('Input names:', session.inputNames);
console.log('Output names:', session.outputNames);
```

---

## Model Details

### Model Version

- **Version:** Silero VAD v4
- **Format:** ONNX
- **Size:** ~2MB

### Input Format

| Parameter | Value |
|-----------|-------|
| Sample rate | 16kHz (16000 Hz) |
| Channels | 1 (mono) |
| Sample format | Float32 normalized (-1.0 to 1.0) |
| Frame size | 30ms = 480 samples at 16kHz |

### Frame Size Calculation

```
Frame duration: 30ms
Sample rate: 16000 Hz
Samples per frame: 16000 * 0.030 = 480 samples
```

### Input Tensors

| Name | Shape | Type | Description |
|------|-------|------|-------------|
| input | [1, 480] | float32 | Audio frame (480 samples, normalized) |
| sr | [1] | int64 | Sample rate (16000) |
| h | [2, 1, 64] | float32 | Hidden state (LSTM) |
| c | [2, 1, 64] | float32 | Cell state (LSTM) |

### Output

| Name | Shape | Type | Description |
|------|-------|------|-------------|
| output | [1, 1] | float32 | Speech probability (0.0 to 1.0) |
| hn | [2, 1, 64] | float32 | Updated hidden state |
| cn | [2, 1, 64] | float32 | Updated cell state |

The model outputs a speech probability between 0.0 (no speech) and 1.0 (definite speech).

---

## Algorithm

### State Machine

```
        speech_started
    +------------------+
    |                  |
    v                  |
+-------+  speech   +-------+  silence   +----------+
| IDLE  |---------->| SPEECH|----------->| SILENCE  |
+-------+           +-------+            +----------+
    ^                                         |
    |           speech_ended                  |
    +-----------------------------------------+
           (after min_silence_ms)

    ^                  |
    |    +-------------+
    |    | (speech detected during silence)
    +----+
```

### Frame Processing Loop

```
For each 30ms audio frame:
  1. Normalize PCM samples to float32 (-1.0 to 1.0)
  2. Run Silero VAD inference -> speech probability (0.0 to 1.0)
  3. If probability > threshold (e.g., 0.5):
     - If not currently in speech -> emit "speech_started"
     - Mark as "in speech"
     - Increment speech_frames counter
     - Reset silence_frames counter
     - Buffer the audio frame
  4. If probability <= threshold:
     - Increment silence_frames counter
     - If in speech AND silence_frames > min_silence_frames:
       - If speech_frames >= min_speech_frames:
         - Emit "speech_ended" with buffered audio
       - Else:
         - Discard (too short, likely noise)
       - Reset state
```

### Threshold and Duration Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| vad_threshold | 0.5 | Speech probability threshold |
| min_silence_ms | 1200ms | Silence duration to end utterance |
| min_speech_ms | 500ms | Minimum speech duration to accept |

### Frame Count Calculations

```javascript
const FRAME_DURATION_MS = 30;
const min_silence_frames = Math.ceil(min_silence_ms / FRAME_DURATION_MS);  // 1200/30 = 40 frames
const min_speech_frames = Math.ceil(min_speech_ms / FRAME_DURATION_MS);    // 500/30 = 17 frames
```

### State Transitions

| Current State | Condition | Action | New State |
|---------------|-----------|--------|-----------|
| idle | probability > threshold | emit speech_started, buffer audio | speech |
| speech | probability > threshold | buffer audio, reset silence counter | speech |
| speech | probability <= threshold | increment silence counter | silence |
| silence | probability > threshold | reset silence counter | speech |
| silence | silence_frames > min_silence_frames | emit speech_ended (if long enough) | idle |

---

## Integration with Node.js

### ONNX Runtime Session Creation

```javascript
import * as ort from 'onnxruntime-node';

class SileroVAD {
  constructor() {
    this.session = null;
    this.h = null;  // Hidden state
    this.c = null;  // Cell state
    this.sampleRate = 16000;
  }

  async load(modelPath) {
    this.session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all'
    });

    // Initialize LSTM states to zeros
    this.h = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
    this.c = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
  }

  reset() {
    // Reset LSTM states
    this.h = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
    this.c = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
  }
}
```

### Input Tensor Format

```javascript
// Convert Int16 PCM to normalized Float32
function pcmToFloat32(pcmBuffer) {
  const int16 = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
  const float32 = new Float32Array(int16.length);

  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;  // Normalize to -1.0 to 1.0
  }

  return float32;
}

// Create input tensor for a 30ms frame (480 samples)
function createInputTensor(audioFrame) {
  const float32 = pcmToFloat32(audioFrame);
  return new ort.Tensor('float32', float32, [1, 480]);
}
```

### Inference Call

```javascript
async infer(audioFrame) {
  const input = createInputTensor(audioFrame);
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(this.sampleRate)]), [1]);

  const feeds = {
    input: input,
    sr: sr,
    h: this.h,
    c: this.c
  };

  const results = await this.session.run(feeds);

  // Update LSTM states for next frame
  this.h = results.hn;
  this.c = results.cn;

  // Extract speech probability
  const probability = results.output.data[0];
  return probability;
}
```

### Event Emission

```javascript
import { EventEmitter } from 'events';

class VADProcessor extends EventEmitter {
  constructor(config) {
    super();
    this.vad = new SileroVAD();
    this.threshold = config.vad_threshold || 0.5;
    this.minSilenceMs = config.min_silence_ms || 1200;
    this.minSpeechMs = config.min_speech_ms || 500;

    this.state = {
      inSpeech: false,
      speechBuffer: [],
      silenceFrames: 0,
      speechFrames: 0,
      lastProbability: 0
    };
  }

  async processFrame(audioFrame) {
    const probability = await this.vad.infer(audioFrame);
    this.state.lastProbability = probability;

    if (probability > this.threshold) {
      if (!this.state.inSpeech) {
        this.state.inSpeech = true;
        this.emit('speech_started');
      }
      this.state.speechFrames++;
      this.state.silenceFrames = 0;
      this.state.speechBuffer.push(audioFrame);
    } else {
      this.state.silenceFrames++;

      if (this.state.inSpeech) {
        const silenceMs = this.state.silenceFrames * 30;
        const speechMs = this.state.speechFrames * 30;

        if (silenceMs >= this.minSilenceMs) {
          if (speechMs >= this.minSpeechMs) {
            const audio = Buffer.concat(this.state.speechBuffer);
            this.emit('speech_ended', audio);
          }
          this.reset();
        }
      }
    }

    return { probability, inSpeech: this.state.inSpeech };
  }

  reset() {
    this.state.inSpeech = false;
    this.state.speechBuffer = [];
    this.state.silenceFrames = 0;
    this.state.speechFrames = 0;
    this.vad.reset();
  }
}
```

---

## Configuration Parameters

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| vad_threshold | float | 0.5 | 0.0 - 1.0 | Speech probability threshold for detection |
| min_silence_ms | integer | 1200 | 100 - 5000 | Silence duration (ms) to end utterance |
| min_speech_ms | integer | 500 | 100 - 5000 | Minimum speech duration (ms) to accept |
| barge_in_threshold | float | 0.7 | 0.0 - 1.0 | Higher threshold during playback |

### Configuration in Scout

```json
{
  "vad_model_path": "/path/to/silero_vad.onnx",
  "vad_threshold": 0.5,
  "silence_duration_ms": 1200,
  "min_speech_ms": 500,
  "barge_in_enabled": true,
  "barge_in_cooldown_ms": 200
}
```

### Tuning Guidelines

| Situation | Adjustment |
|-----------|------------|
| Too many false positives | Increase vad_threshold (e.g., 0.6-0.7) |
| Missing soft speech | Decrease vad_threshold (e.g., 0.3-0.4) |
| Cutting off mid-sentence | Increase min_silence_ms (e.g., 1500-2000) |
| Too slow to respond | Decrease min_silence_ms (e.g., 800-1000) |
| Detecting coughs as speech | Increase min_speech_ms (e.g., 700-1000) |

---

## Performance Characteristics

### Inference Time

| Metric | Value |
|--------|-------|
| Inference time per frame | ~2ms (on modern CPU) |
| Frame duration | 30ms |
| Real-time factor | ~15x (plenty of headroom) |

### Memory Usage

| Component | Size |
|-----------|------|
| Model file | ~2MB |
| Runtime memory | ~10-20MB |
| LSTM state | 1KB |
| Audio buffer (30s max) | ~1MB |

### CPU Usage

- VAD inference uses minimal CPU (~5% on mobile SoC)
- Runs continuously during listening and playback (for barge-in)
- Does not impact other components significantly

---

## Echo Mitigation (Without AEC)

Scout Phase 0 does not implement Acoustic Echo Cancellation (AEC). Instead, the following software-based mitigations are used:

### Threshold Adjustment During Playback

```javascript
class VADProcessor {
  setPlaybackMode(isPlaying) {
    if (isPlaying) {
      this.activeThreshold = this.bargeInThreshold;  // Higher (0.7)
    } else {
      this.activeThreshold = this.threshold;  // Normal (0.5)
    }
  }
}
```

During TTS playback, raise the VAD threshold from 0.5 to 0.7 (configurable via `barge_in_threshold`). This reduces false positives from speaker audio being picked up by the microphone.

### Sustained Speech Requirement

Require 3 or more consecutive speech frames before triggering barge-in during playback:

```javascript
const BARGE_IN_CONSECUTIVE_FRAMES = 3;

if (isPlaying && probability > bargeInThreshold) {
  consecutiveSpeechFrames++;
  if (consecutiveSpeechFrames >= BARGE_IN_CONSECUTIVE_FRAMES) {
    emit('barge_in');
    stopPlayback();
  }
} else {
  consecutiveSpeechFrames = 0;
}
```

This filters out brief spikes from playback audio that momentarily exceed the threshold.

### Headphone Recommendation

For best experience, especially in noisy environments or when speaker volume is high, users should use headphones. This eliminates the echo problem entirely.

Document this recommendation in the README:

```
For best barge-in experience, use headphones. This prevents the
microphone from picking up speaker audio during agent responses.
```

---

## Troubleshooting

### Model Loading Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Model not found" | Wrong path in config | Verify `vad_model_path` points to existing file |
| "Invalid model format" | Corrupted download | Re-download model from official URL |
| "ONNX runtime error" | Missing native bindings | Reinstall `onnxruntime-node` |
| Slow first inference | Model initialization | First inference is slower; keep session alive |

### High False Positive Rate

| Issue | Cause | Solution |
|-------|-------|----------|
| Detects silence as speech | Threshold too low | Increase `vad_threshold` to 0.6-0.7 |
| Background noise triggers | Noisy environment | Increase threshold; use directional mic |
| Music/TV triggers | Non-speech audio | Increase threshold; lower media volume |
| Echo from speaker | No AEC | Use headphones; increase barge-in threshold |

### Missed Speech Detection

| Issue | Cause | Solution |
|-------|-------|----------|
| Soft speech not detected | Threshold too high | Decrease `vad_threshold` to 0.3-0.4 |
| Short utterances dropped | min_speech_ms too high | Decrease `min_speech_ms` to 300-400 |
| Words cut off | min_silence_ms too low | Increase `min_silence_ms` to 1500+ |
| Microphone gain too low | Hardware issue | Increase mic gain in system settings |

### Performance Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| High latency | Slow CPU | Expected ~2ms; check for other load |
| Memory growth | Buffer not cleared | Ensure reset() called after speech_ended |
| Choppy detection | Frame timing | Ensure consistent 30ms frame delivery |

---

## Examples

### Complete Model Loading Code

```javascript
import * as ort from 'onnxruntime-node';

class SileroVAD {
  constructor() {
    this.session = null;
    this.h = null;
    this.c = null;
    this.sampleRate = 16000;
    this.frameSize = 480;  // 30ms at 16kHz
  }

  async load(modelPath) {
    try {
      this.session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all'
      });

      this.resetState();
      console.log(`Silero VAD loaded from ${modelPath}`);
      return true;
    } catch (error) {
      console.error(`Failed to load VAD model: ${error.message}`);
      throw error;
    }
  }

  resetState() {
    this.h = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
    this.c = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
  }

  async infer(audioFrame) {
    if (!this.session) {
      throw new Error('VAD model not loaded');
    }

    // Convert Int16 PCM to Float32
    const int16 = new Int16Array(
      audioFrame.buffer,
      audioFrame.byteOffset,
      audioFrame.length / 2
    );
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    // Create tensors
    const input = new ort.Tensor('float32', float32, [1, this.frameSize]);
    const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(this.sampleRate)]), [1]);

    // Run inference
    const results = await this.session.run({
      input: input,
      sr: sr,
      h: this.h,
      c: this.c
    });

    // Update LSTM states
    this.h = results.hn;
    this.c = results.cn;

    return results.output.data[0];
  }
}

export { SileroVAD };
```

### Complete Processing Loop Code

```javascript
import { EventEmitter } from 'events';
import { SileroVAD } from './silero-vad.mjs';

class VADProcessor extends EventEmitter {
  constructor(config) {
    super();

    this.vad = new SileroVAD();
    this.config = {
      vadThreshold: config.vad_threshold ?? 0.5,
      bargeInThreshold: config.barge_in_threshold ?? 0.7,
      minSilenceMs: config.min_silence_ms ?? 1200,
      minSpeechMs: config.min_speech_ms ?? 500,
      frameDurationMs: 30
    };

    this.state = {
      inSpeech: false,
      speechBuffer: [],
      silenceFrames: 0,
      speechFrames: 0,
      lastProbability: 0,
      isPlaybackActive: false,
      consecutiveSpeechFrames: 0
    };

    this.minSilenceFrames = Math.ceil(
      this.config.minSilenceMs / this.config.frameDurationMs
    );
    this.minSpeechFrames = Math.ceil(
      this.config.minSpeechMs / this.config.frameDurationMs
    );
  }

  async load(modelPath) {
    await this.vad.load(modelPath);
  }

  getActiveThreshold() {
    return this.state.isPlaybackActive
      ? this.config.bargeInThreshold
      : this.config.vadThreshold;
  }

  setPlaybackActive(isActive) {
    this.state.isPlaybackActive = isActive;
    this.state.consecutiveSpeechFrames = 0;
  }

  async processFrame(audioFrame) {
    const probability = await this.vad.infer(audioFrame);
    this.state.lastProbability = probability;

    const threshold = this.getActiveThreshold();
    const isSpeech = probability > threshold;

    // Handle barge-in during playback
    if (this.state.isPlaybackActive) {
      if (isSpeech) {
        this.state.consecutiveSpeechFrames++;
        if (this.state.consecutiveSpeechFrames >= 3) {
          this.emit('barge_in');
          this.state.consecutiveSpeechFrames = 0;
        }
      } else {
        this.state.consecutiveSpeechFrames = 0;
      }
      return { probability, isSpeech, state: 'playback' };
    }

    // Normal VAD processing
    if (isSpeech) {
      if (!this.state.inSpeech) {
        this.state.inSpeech = true;
        this.emit('speech_started');
      }
      this.state.speechFrames++;
      this.state.silenceFrames = 0;
      this.state.speechBuffer.push(Buffer.from(audioFrame));
    } else {
      this.state.silenceFrames++;

      if (this.state.inSpeech && this.state.silenceFrames >= this.minSilenceFrames) {
        if (this.state.speechFrames >= this.minSpeechFrames) {
          const audio = Buffer.concat(this.state.speechBuffer);
          this.emit('speech_ended', audio);
        } else {
          // Too short, discard
          this.emit('speech_discarded', {
            reason: 'too_short',
            durationMs: this.state.speechFrames * this.config.frameDurationMs
          });
        }
        this.reset();
      }
    }

    return {
      probability,
      isSpeech,
      state: this.state.inSpeech ? 'speech' : 'idle'
    };
  }

  reset() {
    this.state.inSpeech = false;
    this.state.speechBuffer = [];
    this.state.silenceFrames = 0;
    this.state.speechFrames = 0;
    this.state.consecutiveSpeechFrames = 0;
    this.vad.resetState();
  }

  getState() {
    return { ...this.state };
  }
}

export { VADProcessor };
```

### Event Handling Example

```javascript
import { VADProcessor } from './vad-processor.mjs';

async function main() {
  const vad = new VADProcessor({
    vad_threshold: 0.5,
    barge_in_threshold: 0.7,
    min_silence_ms: 1200,
    min_speech_ms: 500
  });

  await vad.load('./models/silero_vad.onnx');

  // Event handlers
  vad.on('speech_started', () => {
    console.log('[VAD] Speech started');
    // Update UI, prepare buffers
  });

  vad.on('speech_ended', (audio) => {
    console.log(`[VAD] Speech ended, ${audio.length} bytes`);
    // Send to STT for transcription
    processAudio(audio);
  });

  vad.on('speech_discarded', (info) => {
    console.log(`[VAD] Speech discarded: ${info.reason} (${info.durationMs}ms)`);
  });

  vad.on('barge_in', () => {
    console.log('[VAD] Barge-in detected');
    // Stop TTS playback
    stopPlayback();
    // Transition to listening state
  });

  // Processing loop (example with AudioCapture)
  audioCapture.on('chunk', async (chunk) => {
    // Ensure we have exactly 480 samples (960 bytes for 16-bit)
    const frameSize = 960;  // 480 samples * 2 bytes
    for (let i = 0; i < chunk.length; i += frameSize) {
      const frame = chunk.slice(i, i + frameSize);
      if (frame.length === frameSize) {
        await vad.processFrame(frame);
      }
    }
  });

  // Notify VAD when playback starts/stops
  audioPlayback.on('start', () => vad.setPlaybackActive(true));
  audioPlayback.on('stop', () => vad.setPlaybackActive(false));
}
```

---

## References

- Silero VAD GitHub: https://github.com/snakers4/silero-vad
- ONNX Runtime Node.js: https://www.npmjs.com/package/onnxruntime-node
- Model documentation: https://github.com/snakers4/silero-vad/wiki
