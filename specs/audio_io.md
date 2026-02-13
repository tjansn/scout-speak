# Audio I/O Specification

Investigation conducted on device (Saga) with Termux environment.

## Overview

Scout uses **PulseAudio** (`parecord`/`pacat`) for audio capture and playback in Phase 0. This provides raw PCM support needed for VAD and STT processing.

## Audio Capture

### Tool: `parecord` (PulseAudio)

**Why not `termux-microphone-record`?**
- Only supports encoded formats (aac, opus, amr_wb, amr_nb)
- Does NOT support raw PCM output
- Would require decode step before VAD/STT

### Command

```bash
parecord --raw --format=s16le --rate=16000 --channels=1 [output.pcm]
```

Or for streaming to stdout (for piping):
```bash
parecord --raw --format=s16le --rate=16000 --channels=1
```

### Parameters

| Parameter | Value | Reason |
|-----------|-------|--------|
| `--raw` | (flag) | Output raw PCM, no file header |
| `--format` | s16le | Signed 16-bit little-endian (standard for STT) |
| `--rate` | 16000 | 16kHz sample rate (Whisper/VAD requirement) |
| `--channels` | 1 | Mono (STT models expect mono) |

### Output Format

- **Type:** Raw PCM (no header)
- **Sample format:** Signed 16-bit little-endian (s16le)
- **Sample rate:** 16,000 Hz
- **Channels:** 1 (mono)
- **Byte rate:** 32,000 bytes/second (16000 × 2 bytes)
- **Frame size:** 2 bytes

### Integration (Node.js)

```javascript
import { spawn } from 'child_process';

function startCapture() {
  const proc = spawn('parecord', [
    '--raw',
    '--format=s16le',
    '--rate=16000',
    '--channels=1'
  ]);

  proc.stdout.on('data', (chunk) => {
    // chunk is Buffer of raw PCM samples
    // Process with VAD...
  });

  return proc;
}
```

---

## Audio Playback

### Tool: `pacat` (PulseAudio)

### Command

```bash
pacat --raw --format=s16le --rate=22050 --channels=1 [input.pcm]
```

Or for streaming from stdin:
```bash
cat audio.pcm | pacat --raw --format=s16le --rate=22050 --channels=1
```

### Parameters

| Parameter | Value | Reason |
|-----------|-------|--------|
| `--raw` | (flag) | Input is raw PCM, no file header |
| `--format` | s16le | Signed 16-bit little-endian |
| `--rate` | 22050 | Match Piper TTS output (voice-dependent) |
| `--channels` | 1 | Mono |

**Note:** Sample rate must match TTS output. Piper voices typically output at 22050Hz.

### Integration (Node.js)

```javascript
import { spawn } from 'child_process';

function startPlayback(sampleRate = 22050) {
  const proc = spawn('pacat', [
    '--raw',
    `--format=s16le`,
    `--rate=${sampleRate}`,
    '--channels=1'
  ]);

  return proc.stdin; // Writable stream for audio data
}

// Usage
const playbackStream = startPlayback();
playbackStream.write(audioBuffer);
```

---

## PulseAudio Setup

PulseAudio must be running for audio I/O.

### Start PulseAudio

```bash
pulseaudio --start
```

### Check Status

```bash
pulseaudio --check && echo "Running" || echo "Not running"
```

### Auto-start in Scout

Scout should check/start PulseAudio on initialization:

```javascript
import { execSync } from 'child_process';

function ensurePulseAudio() {
  try {
    execSync('pulseaudio --check');
  } catch {
    execSync('pulseaudio --start');
  }
}
```

---

## Sample Rate Considerations

| Component | Sample Rate | Notes |
|-----------|-------------|-------|
| Capture (VAD/STT) | 16,000 Hz | Whisper and Silero VAD expect 16kHz |
| Piper TTS output | 22,050 Hz | Most Piper voices (check model) |
| Playback | Match TTS | Must match synthesis output |

**No conversion needed in happy path:**
- Capture → VAD/STT: 16kHz mono
- TTS → Playback: 22050Hz mono (direct)

If using different TTS voice with different sample rate, adjust playback `--rate` accordingly.

---

## Tested Configuration

Verified working on Saga device:

```bash
# Capture test (2 seconds)
timeout 2 parecord --raw --format=s16le --rate=16000 --channels=1 test.pcm

# Verify format
ls -la test.pcm  # ~64KB for 2 seconds (32KB/s)

# Playback test
pacat --raw --format=s16le --rate=16000 --channels=1 test.pcm
```

---

## Latency Notes

PulseAudio introduces some latency compared to native Android audio APIs.

For lower latency (Phase 1), consider:
- `--latency-msec=20` flag for tighter timing
- Native AAudio/Oboe if Termux latency is insufficient

Current approach prioritizes simplicity and hackability over minimum latency.
