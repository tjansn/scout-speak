# Algorithms and Data Structures

## Overview

Scout's algorithms are straightforward. The complexity is in **timing and buffering** rather than computation. The core algorithms are:

1. Voice Activity Detection (VAD) — detect speech boundaries
2. Jitter Buffer — smooth audio playback
3. Barge-In Detection — interrupt playback when user speaks
4. Sample Rate Conversion — match audio formats

No complex algorithms beyond standard filtering/buffering are required.

---

## Core Algorithms

### 1. Voice Activity Detection (VAD)

**Goal:** Detect when the user starts and stops speaking, filtering out silence, background noise, and breathing.

**Approach:** Use Silero VAD model (ONNX) which classifies 30ms audio frames as speech/non-speech.

**How it works:**
```
For each 30ms audio frame:
  1. Run Silero VAD inference → speech probability (0.0 to 1.0)
  2. If probability > threshold (e.g., 0.5):
     - If not currently in speech → emit "speech_started"
     - Mark as "in speech"
     - Reset silence counter
  3. If probability <= threshold:
     - Increment silence counter
     - If silence counter > min_silence_frames (e.g., 40 = 1.2s):
       - Emit "speech_ended" with buffered audio
       - Reset state
```

**Complexity:** O(1) per frame (fixed model inference time ~2ms)

**Edge cases:**
- Very short utterances (<500ms): May be noise; optionally discard
- Long pauses mid-sentence: Configurable silence threshold
- Background music/TV: May trigger false positives; tune threshold

**Configuration:**
- `vad_threshold`: speech probability threshold (default: 0.5)
- `min_silence_ms`: silence duration to end utterance (default: 1200ms)
- `min_speech_ms`: minimum speech duration to accept (default: 500ms)

---

### 2. Jitter Buffer

**Goal:** Smooth audio playback to prevent choppy/clicking audio when TTS chunks arrive at irregular intervals.

**Approach:** Ring buffer with watermarks that accumulates audio before playback and maintains a buffer during playback.

**How it works:**
```
State:
  - buffer: ring buffer of PCM samples
  - playback_active: boolean
  - low_watermark: minimum samples before starting playback
  - high_watermark: maximum buffer size

On audio chunk received:
  1. Write chunk to ring buffer
  2. If not playback_active and buffer.size >= low_watermark:
     - Start playback
     - playback_active = true

On playback tick (every frame_duration):
  1. If buffer.size >= frame_size:
     - Read frame_size samples from buffer
     - Send to audio output
  2. Else if buffer.size > 0:
     - Read remaining samples, pad with silence (underrun)
     - Log warning
  3. Else:
     - Output silence (buffer empty)

On end-of-stream signal:
  1. Drain remaining buffer
  2. playback_active = false
```

**Complexity:** O(1) per operation (ring buffer read/write)

**Edge cases:**
- Buffer underrun: Pad with silence, continue (don't click)
- Buffer overflow: Drop oldest samples (shouldn't happen with backpressure)
- Barge-in: Immediately clear buffer, stop playback

**Configuration:**
- `buffer_size_ms`: total buffer capacity (default: 500ms)
- `low_watermark_ms`: start playback threshold (default: 100ms)
- `frame_duration_ms`: playback frame size (default: 20ms)

---

### 3. Barge-In Detection

**Goal:** Detect when user starts speaking during agent playback and immediately interrupt.

**Approach:** Run VAD continuously, even during playback. On speech detection, cancel playback.

**How it works:**
```
During playback:
  1. Continue capturing microphone audio
  2. Run VAD on captured audio (same as normal)
  3. If VAD detects speech_started:
     - Emit "barge_in" event
     - Stop TTS synthesis (if streaming)
     - Clear jitter buffer
     - Stop audio playback immediately
     - Transition to "listening" state
     - Begin buffering new utterance
```

**Complexity:** O(1) — just VAD check + state change

**Edge cases:**
- Echo/feedback: Playback audio picked up by mic; tune VAD threshold higher during playback
- Cough/sneeze: May trigger interrupt; acceptable tradeoff
- Multiple rapid interrupts: Debounce with short cooldown (~200ms)

**Echo mitigation (no AEC):**
- Raise VAD threshold during playback (e.g., 0.5 → 0.7)
- Require sustained speech (e.g., 3+ consecutive speech frames) to trigger barge-in
- Document "use headphones for best experience"

**Configuration:**
- `barge_in_enabled`: toggle (default: true)
- `barge_in_cooldown_ms`: debounce period (default: 200ms)

---

### 4. Streaming TTS (Sentence Chunking)

**Goal:** Start audio playback before the entire response is synthesized, reducing perceived latency.

**Approach:** Split agent response into sentences, synthesize and play incrementally.

**How it works:**
```
On agent response received:
  1. Split text into sentences using punctuation (. ! ?)
  2. For each sentence:
     a. Send to Piper TTS for synthesis
     b. Stream audio chunks to jitter buffer
     c. Start playback after first sentence buffer fills
  3. Continue until all sentences synthesized and played

Parallel pipeline:
  Sentence 1: [synthesize] → [play]
  Sentence 2:              [synthesize] → [play]
  Sentence 3:                           [synthesize] → [play]
```

**Complexity:** O(n) where n = response length; parallelism hides latency

**Edge cases:**
- Very short response (one sentence): Degrades to batch mode (acceptable)
- Very long sentence: May delay first audio; consider word-level chunking
- Barge-in mid-sentence: Cancel remaining synthesis, clear buffers

**Configuration:**
- `sentence_delimiters`: regex for splitting (default: `/[.!?]+/`)
- `min_chunk_chars`: minimum chars before synthesis (default: 20)

---

### 5. Sample Rate Conversion

**Goal:** Convert between sample rates used by different components.

**Formats:**
- Microphone/VAD/STT: 16kHz mono
- TTS output: depends on Piper config (16kHz or 22050Hz)
- Playback: matches TTS output

**Approach:** Simple linear interpolation for upsampling; averaging for downsampling.

**Upsample 16kHz → 48kHz stereo (if needed for some outputs):**
```
For each input sample:
  - Output sample 3 times (left channel)
  - Output sample 3 times (right channel)
  - Linear interpolate between samples for smoother result
```

**Downsample 48kHz stereo → 16kHz mono (from existing Discord code):**
```
For each group of 6 samples (3 stereo pairs):
  - Average left and right channels
  - Average the 3 mono samples
  - Output 1 sample
```

**Complexity:** O(n) where n = number of samples

**Existing implementation:** `upsample16to48stereo()` and `downsample48to16mono()` in `voice/` directory can be reused.

---

## Key Data Structures

### AudioBuffer (Ring Buffer)

**Purpose:** Efficient FIFO buffer for audio samples with O(1) read/write.

```
AudioBuffer {
  data: Int16Array(capacity)
  read_pos: number
  write_pos: number
  size: number  // current fill level
  capacity: number

  write(samples: Int16Array): void
  read(count: number): Int16Array
  clear(): void
  available(): number
}
```

**Invariants:**
- `0 <= size <= capacity`
- `read_pos` and `write_pos` wrap around at `capacity`
- `size = (write_pos - read_pos + capacity) % capacity`

---

### ConversationState

**Purpose:** Track current state of the voice interaction.

```
ConversationState {
  status: "idle" | "listening" | "processing" | "speaking"
  current_audio_buffer: AudioBuffer | null
  last_transcript: string | null
  last_response: string | null
  error: string | null
  openclaw_connected: boolean
}
```

**State transitions:**
```
idle → listening        (session started or playback complete)
listening → processing  (speech ended, sending to STT/OpenClaw)
processing → speaking   (response received, TTS started)
speaking → listening    (playback complete or barge-in)
any → idle              (session ended or fatal error)
```

---

### Config

**Purpose:** Persistent configuration loaded from JSON file.

```
Config {
  // OpenClaw
  gateway_url: string       // "http://localhost:18789"
  gateway_token: string     // auth token

  // Models
  stt_model_path: string    // "/path/to/whisper/tiny.en"
  tts_voice: string         // "en_US-lessac-medium"
  vad_model_path: string    // "/path/to/silero_vad.onnx"

  // Audio
  sample_rate: number       // 16000
  vad_threshold: number     // 0.5
  silence_duration_ms: number // 1200
  buffer_size_ms: number    // 500

  // Features
  wake_word_enabled: boolean // false
  wake_word_phrase: string   // "hey scout"
  display_mode: "voice_only" | "minimal" | "transcript"

  // Debug
  log_level: "debug" | "info" | "warn" | "error"
  log_to_file: boolean
}
```

---

### VADState

**Purpose:** Track VAD algorithm state across frames.

```
VADState {
  in_speech: boolean
  speech_buffer: AudioBuffer
  silence_frames: number
  speech_frames: number
  last_probability: number
}
```

---

## Validation Rules

### Config Validation

| Field | Rule | Error |
|-------|------|-------|
| gateway_url | Must be valid URL, localhost only | "Invalid gateway URL" |
| gateway_token | Non-empty string | "Gateway token required" |
| stt_model_path | File must exist | "STT model not found" |
| tts_voice | Must be valid Piper voice | "TTS voice not found" |
| vad_threshold | 0.0 to 1.0 | "VAD threshold must be 0-1" |
| silence_duration_ms | 100 to 5000 | "Silence duration out of range" |

### Audio Validation

| Input | Rule | Action |
|-------|------|--------|
| Microphone audio | Must be 16kHz mono PCM | Convert if different |
| STT transcript | Non-empty after trimming | Discard if empty |
| OpenClaw response | Must have text content | Show error if missing |
| TTS audio | Must be valid PCM | Log error, show text fallback |

---

## Alternatives Considered

### VAD Alternatives

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Silero VAD** | Accurate, fast, proven | ONNX dependency | Chosen |
| Energy-based | No ML dependency | Many false positives | Rejected |
| WebRTC VAD | Built into some libs | Less accurate | Fallback option |

### Buffer Alternatives

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Ring buffer** | O(1), fixed memory | Fixed capacity | Chosen |
| Dynamic array | Grows as needed | Allocation overhead | Rejected |
| Linked list | Easy insert/remove | Cache unfriendly | Rejected |

### Interpolation Alternatives

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Linear** | Simple, fast | Slight aliasing | Chosen for Phase 0 |
| Sinc/Lanczos | Higher quality | More compute | Phase 1 if needed |
| No interpolation | Simplest | Audible artifacts | Rejected |
