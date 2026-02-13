# Piper TTS Specification

Documentation for Piper TTS integration in Scout.

## Overview

Piper is a fast, local neural text-to-speech system. Scout uses Piper for synthesizing agent responses to audio.

## Installation (Termux)

```bash
pip install piper-tts
```

Or download prebuilt binary from: https://github.com/rhasspy/piper/releases

## Voice Models

Download voice models from: https://huggingface.co/rhasspy/piper-voices

Recommended for English:
- `en_US-lessac-medium` — Good quality, reasonable speed
- `en_US-amy-low` — Faster, lower quality
- `en_GB-alan-medium` — British accent option

Each voice has two files:
- `*.onnx` — Model file
- `*.onnx.json` — Config (includes sample rate)

## Streaming Output

### Command (Streaming)

```bash
echo "Hello, this is a test." | piper --model en_US-lessac-medium.onnx --output_raw | \
  pacat --raw --format=s16le --rate=22050 --channels=1
```

### Parameters

| Parameter | Description |
|-----------|-------------|
| `--model` | Path to .onnx voice model |
| `--output_raw` | Stream raw PCM to stdout (enables streaming) |
| `--output_file` | Write to file instead (batch mode) |

### Output Format

- **Type:** Raw PCM (no header)
- **Sample format:** Signed 16-bit little-endian (S16_LE)
- **Channels:** 1 (mono)
- **Sample rate:** Voice-dependent (check .onnx.json)
  - Most voices: 22050 Hz
  - Some high-quality: 44100 Hz

## Streaming Behavior

### How It Works

1. Piper synthesizes **sentence by sentence**
2. Audio streams to stdout as each sentence completes
3. Playback can begin after first sentence (not waiting for full text)

### Limitations

- **Not word-level:** Cannot stream word-by-word (would sound bad)
- **Sentence boundaries:** Uses punctuation (`.`, `!`, `?`) to detect sentences
- **Cold start latency:** First inference takes longer (~4-14 seconds)
- **Keep process alive:** Persistent process avoids cold start per utterance

## Performance Optimization

### Keep Piper Running

Avoid starting Piper for each utterance. Instead:

```javascript
// Start once, reuse
const piper = spawn('piper', ['--model', modelPath, '--output_raw']);

// Send text, get audio
function synthesize(text) {
  piper.stdin.write(text + '\n');
  // Audio streams from piper.stdout
}
```

**Note:** This approach requires investigation into Piper's stdin handling for multiple inputs.

### Alternative: Sentence Chunking

If Piper doesn't support stdin streaming of multiple texts:

```javascript
function synthesizeSentences(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  for (const sentence of sentences) {
    const proc = spawn('piper', ['--model', modelPath, '--output_raw']);
    proc.stdin.write(sentence);
    proc.stdin.end();

    proc.stdout.on('data', (chunk) => {
      // Stream to playback
    });
  }
}
```

## Integration with Scout

### Node.js Integration

```javascript
import { spawn } from 'child_process';

const PIPER_MODEL = '/path/to/en_US-lessac-medium.onnx';
const SAMPLE_RATE = 22050; // Check model's .json config

function synthesize(text) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    const proc = spawn('piper', [
      '--model', PIPER_MODEL,
      '--output_raw'
    ]);

    proc.stdin.write(text);
    proc.stdin.end();

    proc.stdout.on('data', (chunk) => {
      chunks.push(chunk);
      // Or stream directly to playback for lower latency
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`Piper exited with code ${code}`));
      }
    });
  });
}
```

### Streaming to Playback

```javascript
function synthesizeAndPlay(text) {
  const piper = spawn('piper', ['--model', PIPER_MODEL, '--output_raw']);
  const playback = spawn('pacat', [
    '--raw', '--format=s16le', `--rate=${SAMPLE_RATE}`, '--channels=1'
  ]);

  // Pipe TTS output directly to playback
  piper.stdout.pipe(playback.stdin);

  piper.stdin.write(text);
  piper.stdin.end();

  return new Promise((resolve) => {
    playback.on('close', resolve);
  });
}
```

## Voice Configuration

Scout config should include:

```json
{
  "tts": {
    "engine": "piper",
    "model": "/path/to/voice.onnx",
    "sampleRate": 22050
  }
}
```

Users can swap voices by changing model path and sample rate.

## Setup Verification

Test Piper installation:

```bash
# Synthesize to file
echo "Testing Piper TTS" | piper --model en_US-lessac-medium.onnx --output_file test.wav

# Play result
pacat test.wav

# Test streaming
echo "Testing streaming output" | piper --model en_US-lessac-medium.onnx --output_raw | \
  pacat --raw --format=s16le --rate=22050 --channels=1
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "Model not found" | Wrong path | Check model path in config |
| No audio output | Sample rate mismatch | Check model's .json for correct rate |
| Choppy audio | Buffer underrun | Increase playback buffer |
| Slow startup | Cold start | Keep Piper process alive |
| Garbled audio | Wrong format | Ensure s16le format in playback |

## References

- Piper GitHub: https://github.com/rhasspy/piper
- Voices: https://huggingface.co/rhasspy/piper-voices
- Streaming discussion: https://github.com/rhasspy/piper/issues/25
