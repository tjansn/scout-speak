# System Architecture and Data Flow

## High-Level Architecture

Scout is an **I/O layer** around OpenClaw. It handles audio capture, speech recognition, speech synthesis, and playback — but never generates agent responses.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Android Phone                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      Termux Environment                    │  │
│  │                                                            │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │                 Scout Voice Layer                    │  │  │
│  │  │                                                      │  │  │
│  │  │   ┌──────────┐   ┌──────────┐   ┌──────────────┐   │  │  │
│  │  │   │  Audio   │   │   VAD    │   │     STT      │   │  │  │
│  │  │   │ Capture  │──▶│ (Silero) │──▶│ (whisper.cpp)│   │  │  │
│  │  │   └──────────┘   └──────────┘   └──────┬───────┘   │  │  │
│  │  │                                        │           │  │  │
│  │  │                                        ▼           │  │  │
│  │  │   ┌──────────┐   ┌──────────┐   ┌──────────────┐   │  │  │
│  │  │   │  Audio   │   │   TTS    │   │   OpenClaw   │   │  │  │
│  │  │   │ Playback │◀──│ (Piper)  │◀──│   Client     │   │  │  │
│  │  │   └──────────┘   └──────────┘   └──────┬───────┘   │  │  │
│  │  │                                        │           │  │  │
│  │  │   ┌──────────────────────────────────┐ │           │  │  │
│  │  │   │        Session Manager           │◀┘           │  │  │
│  │  │   │  (state, config, UI feedback)    │             │  │  │
│  │  │   └──────────────────────────────────┘             │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                           │                                │  │
│  │                           ▼                                │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              OpenClaw Gateway (:18789)               │  │  │
│  │  │         (agent brain, memory, tools, identity)       │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Components and Responsibilities

### Audio Capture
- Records microphone input via `termux-microphone-record`
- Outputs PCM chunks (16kHz, mono, 16-bit)
- Runs continuously while session is active

### Voice Activity Detection (VAD)
- Detects speech start/end events
- Filters out background noise, breathing, silence
- Triggers STT only when speech is complete
- Uses Silero VAD (ONNX, ~2ms per 30ms frame)

### Speech-to-Text (STT)
- Transcribes audio segment to text
- Uses whisper.cpp with tiny.en or base.en model
- Input: WAV file or PCM buffer
- Output: transcribed text string

### OpenClaw Client
- Sends user transcript to OpenClaw via CLI: `openclaw agent --agent main --message "text" --json`
- Parses JSON response: `result.payloads[0].text`
- Gateway must be running: `openclaw gateway run --port 18789`
- Handles connection errors, timeouts, retries
- Never generates fallback responses
- See `specs/openclaw_api.md` for full protocol documentation

### Text-to-Speech (TTS)
- Converts agent text to audio
- Uses Piper TTS with user-configurable voice
- **Streams audio via sentence chunking** — split response into sentences, synthesize incrementally
- First audio plays after first sentence synthesized (not waiting for full response)
- Supports interruption (barge-in) — cancel remaining synthesis

### Audio Playback
- Plays synthesized audio via pulseaudio (`pacat`)
- Implements jitter buffer for smooth playback
- Handles barge-in (stops immediately on speech detected)
- Crossfades at chunk boundaries to prevent clicks

### Session Manager
- Coordinates all components
- Manages conversation state (idle/listening/processing/speaking)
- Persists configuration
- Provides UI feedback (status, errors)

---

## Data Flow

### Happy Path: User Speaks → Agent Responds

```
1. User speaks into microphone
   └─▶ Audio Capture outputs PCM chunks (16kHz mono)

2. VAD processes each chunk
   └─▶ Detects "speech started" → begin buffering
   └─▶ Detects "speech ended" → stop buffering, emit audio segment

3. STT transcribes audio segment
   └─▶ whisper.cpp processes WAV → text
   └─▶ If empty/garbage → discard, show "Didn't catch that"

4. OpenClaw Client sends transcript
   └─▶ POST to localhost:18789 with user message
   └─▶ Receive agent text response
   └─▶ If error/timeout → show error, do not synthesize

5. TTS synthesizes response (streaming)
   └─▶ Split response into sentences
   └─▶ Synthesize sentence 1 → feed to jitter buffer → start playback
   └─▶ Synthesize sentence 2 → feed to buffer (while sentence 1 plays)
   └─▶ Continue until all sentences done

6. Audio Playback plays response
   └─▶ Jitter buffer smooths timing across sentence boundaries
   └─▶ Speaker outputs audio continuously
   └─▶ On completion → return to step 1 (listening)
```

### Barge-In: User Interrupts Agent

```
1. Agent is speaking (Audio Playback active)

2. VAD detects "speech started" from microphone
   └─▶ Emit interrupt signal

3. Session Manager handles interrupt
   └─▶ Stop Audio Playback immediately
   └─▶ Cancel any pending TTS synthesis
   └─▶ Switch state to "listening"

4. Continue from step 2 of happy path
   └─▶ Buffer new speech, transcribe, send to OpenClaw
```

### Error: OpenClaw Unreachable

```
1. User speaks, VAD detects, STT transcribes

2. OpenClaw Client attempts connection
   └─▶ Connection refused / timeout

3. Session Manager shows error
   └─▶ Display "Cannot reach OpenClaw"
   └─▶ Do NOT synthesize any response
   └─▶ Retry connection periodically

4. When OpenClaw returns
   └─▶ Clear error state
   └─▶ Resume normal operation
```

---

## Trust Boundaries

| Boundary | Trusted | Untrusted | Validation Required |
|----------|---------|-----------|---------------------|
| Microphone input | - | Audio data | VAD filters non-speech |
| STT output | - | Transcribed text | Check for empty/garbage |
| OpenClaw response | Agent text | - | Verify response came from OpenClaw |
| TTS output | Audio data | - | (internal) |
| Config file | - | User input | Validate gateway URL format |

**Key trust rule:** Only play audio synthesized from OpenClaw responses. Never generate or synthesize fallback text.

---

## Error Handling Strategy

| Failure | User Experience | Recovery |
|---------|-----------------|----------|
| OpenClaw unreachable | "Cannot reach OpenClaw" displayed | Retry every 5s; auto-reconnect |
| OpenClaw error response | Error message displayed | Return to listening state |
| STT returns empty | "Didn't catch that" displayed | Return to listening state |
| TTS synthesis fails | Show text response as fallback | Display agent text on screen |
| Audio playback fails | Error logged | Attempt restart; show error |
| VAD model fails to load | Fatal error on startup | Exit with clear message |
| Config file missing | First-run wizard triggered | Guide user through setup |

---

## State and Storage

### Runtime State (in memory)
- Current conversation state: `idle | listening | processing | speaking`
- Audio buffers: capture buffer, playback jitter buffer
- Session ID (if OpenClaw uses sessions)

### Persistent State (files)
- `config.json`: gateway URL, model paths, audio settings, preferences
- Logs: debug output to file (optional)

### No Persistent Conversation History
Scout does not store conversation history. OpenClaw owns all memory and history.

---

## Interfaces

### Audio Capture → VAD
- **Data**: PCM chunks (30ms frames, 16kHz, mono, 16-bit signed)
- **Events**: chunk available

### VAD → STT
- **Data**: complete audio segment (PCM buffer)
- **Events**: speech_ended

### VAD → Session Manager
- **Events**: speech_started, speech_ended

### STT → OpenClaw Client
- **Data**: transcribed text string

### OpenClaw Client → TTS
- **Data**: agent response text

### OpenClaw Client → Session Manager
- **Events**: response_received, error, connection_status

### TTS → Audio Playback
- **Data**: PCM audio chunks (streaming)
- **Events**: synthesis_started, synthesis_complete

### Audio Playback → Session Manager
- **Events**: playback_started, playback_complete, playback_interrupted

### Session Manager → UI
- **Data**: current state, error messages, transcript (if enabled)

---

## ASCII Diagram: Data Flow

```
                    ┌─────────────────┐
                    │   Microphone    │
                    └────────┬────────┘
                             │ PCM 16kHz
                             ▼
                    ┌─────────────────┐
                    │   VAD (Silero)  │
                    └────────┬────────┘
                             │ speech segment
                             ▼
                    ┌─────────────────┐
                    │ STT (whisper)   │
                    └────────┬────────┘
                             │ text
                             ▼
                    ┌─────────────────┐
                    │ OpenClaw Client │───────▶ localhost:18789
                    └────────┬────────┘◀───────  (OpenClaw)
                             │ agent text
                             ▼
                    ┌─────────────────┐
                    │  TTS (Piper)    │
                    └────────┬────────┘
                             │ PCM audio
                             ▼
                    ┌─────────────────┐
                    │ Jitter Buffer   │
                    └────────┬────────┘
                             │ smoothed audio
                             ▼
                    ┌─────────────────┐
                    │    Speaker      │
                    └─────────────────┘
```

---

## Deep Modules (Stable Interfaces)

Each module has a simple interface that hides internal complexity:

| Module | Interface | Why Stable |
|--------|-----------|------------|
| AudioCapture | `start()`, `stop()`, `onChunk(callback)` | Standard audio APIs |
| VAD | `process(chunk)` → events | Well-defined problem |
| STT | `transcribe(audio)` → text | Swappable models |
| OpenClawClient | `send(text)` → response | API contract |
| TTS | `synthesize(text)` → audio stream | Swappable voices |
| AudioPlayback | `play(stream)`, `stop()` | Standard audio APIs |
| JitterBuffer | `write(chunk)`, `read()` | Algorithm is encapsulated |

Modules can be tested in isolation. Swapping STT or TTS model doesn't affect other modules.
