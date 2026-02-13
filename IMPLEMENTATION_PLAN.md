# Scout Implementation Plan

## Executive Summary

This document defines the complete implementation roadmap for Scout Phase 0 - a Termux-based local voice pipeline for Android that connects to OpenClaw. The plan addresses all gaps between the current state (no Scout implementation exists) and the comprehensive specifications.

### Current State Analysis (Updated 2026-02-13)

**Project Status:** Planning phase COMPLETE. Implementation phase NOT STARTED.

**What Exists:**
- Discord voice bots (`voice/discord-voice-v6.mjs`) using CLOUD ElevenLabs STT/TTS and direct Anthropic API calls
- Comprehensive specification documents in `specs/` (12 files, ~50KB)
- Reusable utilities identified from existing code:
  - `upsample16to48stereo()` / `downsample48to16mono()` - sample rate conversion
  - `pcmToWav()` - WAV file creation for STT
  - Silence detection pattern (1.2s timeout)
  - Conversation history management
  - Stream lifecycle management patterns
  - Process spawn/cleanup patterns (voice-client.mjs)
- No Phase 0 Scout implementation code
- No testing infrastructure

**What's Missing (Everything for Phase 0):**
- Testing infrastructure (backpressure.md requirement) - **HIGHEST PRIORITY**
- Core data structures (AudioBuffer, VADState, Config)
- Audio I/O via PulseAudio (parecord/pacat)
- Local VAD (Silero VAD v4)
- Local STT (whisper.cpp)
- OpenClaw integration (CLI-based, NOT direct Anthropic API)
- Local TTS (Piper)
- Jitter buffer for smooth playback
- Session manager and state machine
- Barge-in support
- First-run setup wizard
- Error handling and config persistence

### Spec Gap Analysis (Updated 2026-02-13)

**Newly Created Specifications:**
- `specs/stt_whisper.md` - whisper.cpp STT integration details (created to fill gap)
- `specs/vad_silero.md` - Silero VAD integration details (created to fill gap)

**Remaining Minor Gaps (do not block implementation):**

| Gap | Status | Recommendation |
|-----|--------|----------------|
| Gateway token secure storage | Partially documented | Token validation exists; secure storage can use standard Node.js practices |
| Retry policy parameters | Mentioned but not detailed | Use standard exponential backoff (1s, 2s, 4s, max 30s, 5 retries) |
| Thermal throttling strategy | Mentioned in NFR | Defer to Phase 1; Phase 0 can log warnings |
| Wake word implementation | Documented in T042 | STT-based keyword spotting sufficient for Phase 0 |

### Priority Order Confirmation

Per `specs/backpressure.md`, testing infrastructure MUST come first:
1. **M0 (P0):** Testing Infrastructure - Creates feedback loop for quality
2. **M1 (P0):** Core Data Structures - Foundation for all components
3. **M2-M5 (P1):** Core Pipeline - VAD, STT, OpenClaw, TTS, Session
4. **M6 (P2):** Features - Setup wizard, error handling, wake word
5. **M7 (P3):** Documentation - Can start in parallel once code stabilizes

### GitHub Issues

**Status:** GitHub API unavailable during planning. Complete issue specifications documented in `GITHUB_ISSUES.md`.

When GitHub connectivity is restored, run the commands in `GITHUB_ISSUES.md` to create:
- 8 milestones (M0-M7)
- 8 milestone issues with full acceptance criteria
- Priority labels (priority/p0, priority/p1, priority/p2, priority/p3)

Each issue includes:
- Detailed task descriptions with interfaces
- Acceptance criteria mapped to FRs
- Test requirements (unit, integration, acceptance)
- Definition of done

---

## Milestone Overview

| Milestone | Description | Tasks | Priority |
|-----------|-------------|-------|----------|
| M0 | Testing Infrastructure & Scaffolding | T001-T004 | P0 (Foundation) |
| M1 | Core Data Structures & Audio I/O | T005-T011, T049 | P0 (Foundation) |
| M2 | Speech Processing (VAD, STT) | T012-T017 | P1 (Core) |
| M3 | OpenClaw Integration | T018-T021, T050 | P1 (Core) |
| M4 | Speech Synthesis (TTS, Jitter Buffer) | T022-T028 | P1 (Core) |
| M5 | Session Management & Barge-in | T029-T034 | P1 (Core) |
| M6 | First-Run Setup, Error Handling & Features | T035-T044, T051 | P2 (Features) |
| M7 | Documentation & README | T045-T048 | P3 (Polish) |

---

## M0: Testing Infrastructure & Scaffolding

**Rationale:** Per `backpressure.md`, testing infrastructure MUST come first. This creates the feedback loop needed for quality implementation.

### T001: Project Scaffolding
**Priority:** P0
**Dependencies:** None
**Description:** Create the Scout project structure in `~/.openclaw/workspace/scout/` with Node.js setup.

**Deliverables:**
- `package.json` with project metadata and scripts
- `.gitignore` for Node.js project
- `src/` directory structure
- `tests/` directory structure
- ESLint configuration (`.eslintrc.json`)
- TypeScript configuration (`tsconfig.json`) if using TypeScript

**Directory Structure:**
```
~/.openclaw/workspace/scout/
├── package.json
├── .eslintrc.json
├── .gitignore
├── src/
│   ├── index.mjs          # Entry point
│   ├── audio/             # Audio capture/playback
│   ├── vad/               # Voice activity detection
│   ├── stt/               # Speech-to-text
│   ├── tts/               # Text-to-speech
│   ├── openclaw/          # OpenClaw client
│   ├── session/           # Session manager
│   ├── config/            # Configuration
│   └── utils/             # Shared utilities
├── tests/
│   ├── unit/
│   ├── integration/
│   └── acceptance/
└── config.json.example
```

**Acceptance Criteria:**
- [ ] `npm install` succeeds
- [ ] `npm run lint` executes (even if no source files yet)
- [ ] Directory structure matches specification

**Test Requirements:**
- Verify project initializes correctly
- Verify npm scripts work

---

### T002: Unit Test Framework Setup
**Priority:** P0
**Dependencies:** T001
**Description:** Configure unit testing framework per `backpressure.md` requirement.

**Deliverables:**
- Test runner configuration (Node.js built-in test runner or vitest)
- Test utility helpers
- Example test demonstrating patterns
- `npm test` script

**Acceptance Criteria:**
- [ ] `npm test` runs and reports results
- [ ] Test coverage reporting available
- [ ] Tests can import source modules

**Test Requirements:**
- At least one passing example test
- Test for test utilities themselves

---

### T003: Pre-commit Hooks Setup
**Priority:** P0
**Dependencies:** T001, T002
**Description:** Configure pre-commit hooks per `backpressure.md` for linter, typechecks, and secret detection.

**Deliverables:**
- husky or similar pre-commit hook tool
- Pre-commit script running:
  - ESLint (linter)
  - TypeScript check or JSDoc validation (typechecks)
  - gitleaks or similar (secret detection)
- Documentation of bypass procedure for emergencies

**Acceptance Criteria:**
- [ ] Commits blocked if lint fails
- [ ] Commits blocked if secret patterns detected (e.g., API keys)
- [ ] `npm run precommit` runs all checks manually

**Test Requirements:**
- Verify lint failure blocks commit
- Verify secret pattern detection works

---

### T004: Acceptance Test Framework (Gherkin)
**Priority:** P0
**Dependencies:** T001
**Description:** Set up Gherkin-style acceptance testing per `backpressure.md`.

**Deliverables:**
- Cucumber.js or similar BDD framework
- Feature file structure in `tests/acceptance/`
- Step definition template
- Example feature demonstrating pattern

**Example Feature (FR-3: OpenClaw Communication):**
```gherkin
Feature: OpenClaw Communication
  As a user
  I want Scout to send my transcribed speech to OpenClaw
  So that I get responses from my agent

  Scenario: Successful agent response
    Given OpenClaw gateway is running
    And Scout is connected
    When I send the message "Hello"
    Then I should receive a non-empty response
    And the response should come from OpenClaw (not fake)

  Scenario: Gateway unreachable
    Given OpenClaw gateway is not running
    When I attempt to send a message
    Then I should see error "Cannot reach OpenClaw"
    And no audio response should play
```

**Acceptance Criteria:**
- [ ] Feature files parse correctly
- [ ] Step definitions can be implemented
- [ ] `npm run test:acceptance` executes features

**Test Requirements:**
- Example feature passes with mock implementations

---

## M1: Core Data Structures & Audio I/O

**Rationale:** Data structures must exist before components that use them. Audio I/O is the entry point of the pipeline.

### T005: AudioBuffer (Ring Buffer) Implementation
**Priority:** P0
**Dependencies:** T001, T002
**Description:** Implement the AudioBuffer ring buffer per `algorithm_and_data_structures.md`.

**Specification Reference:**
- O(1) read/write operations
- Configurable capacity
- Watermark support (low/high)
- Methods: `write()`, `read()`, `clear()`, `available()`

**Interface:**
```javascript
class AudioBuffer {
  constructor(capacitySamples: number)
  write(samples: Int16Array): number  // returns samples written
  read(count: number): Int16Array     // returns samples read
  clear(): void
  available(): number                 // current fill level
  capacity(): number
}
```

**Acceptance Criteria:**
- [ ] O(1) complexity for read/write (no array copies on normal ops)
- [ ] Handles wrap-around correctly
- [ ] Supports watermark queries (`available() >= lowWatermark`)
- [ ] Thread-safe for single producer/single consumer pattern

**Test Requirements:**
- Unit test: write then read returns same data
- Unit test: wrap-around behavior
- Unit test: overflow behavior (oldest samples dropped or blocked)
- Unit test: underflow behavior (returns empty/partial)
- Benchmark: verify O(1) performance

---

### T006: Config Schema and Validation
**Priority:** P0
**Dependencies:** T001, T002
**Description:** Implement Config data structure per `algorithm_and_data_structures.md` with validation per spec.

**Configuration Fields (from spec):**
```javascript
{
  // OpenClaw
  gateway_url: "http://localhost:18789",
  gateway_token: "token-from-openclaw-config-or-wizard",

  // Models
  stt_model_path: "/path/to/whisper/tiny.en",
  tts_voice: "en_US-lessac-medium",
  tts_model_path: "/path/to/voice.onnx",
  tts_sample_rate: 22050,
  vad_model_path: "/path/to/silero_vad.onnx",

  // Audio
  sample_rate: 16000,
  vad_threshold: 0.5,
  silence_duration_ms: 1200,
  min_speech_ms: 500,
  buffer_size_ms: 500,
  low_watermark_ms: 100,

  // Features
  wake_word_enabled: false,
  wake_word_phrase: "hey scout",
  display_mode: "minimal",  // "voice_only" | "minimal" | "transcript"
  barge_in_enabled: true,
  barge_in_cooldown_ms: 200,

  // Debug
  log_level: "info",
  log_to_file: false
}
```

**Validation Rules (from spec):**
| Field | Rule |
|-------|------|
| gateway_url | Valid URL, localhost only |
| gateway_token | Non-empty string |
| stt_model_path | File must exist |
| tts_model_path | File must exist |
| vad_threshold | 0.0 to 1.0 |
| silence_duration_ms | 100 to 5000 |

**Acceptance Criteria:**
- [ ] Load config from JSON file
- [ ] Validate all fields per rules
- [ ] Return clear error messages for invalid config
- [ ] Provide defaults for optional fields
- [ ] Enforce localhost-only URL and safe CLI argument handling for gateway inputs
- [ ] FR-10: Config persists across restarts

**Test Requirements:**
- Unit test: valid config loads successfully
- Unit test: each validation rule rejects invalid input
- Unit test: missing/empty gateway token is rejected
- Unit test: missing optional fields use defaults
- Unit test: config persistence (write/read cycle)

---

### T007: ConversationState Data Structure
**Priority:** P0
**Dependencies:** T001, T002, T005
**Description:** Implement ConversationState per `algorithm_and_data_structures.md`.

**Interface:**
```javascript
class ConversationState {
  status: "idle" | "listening" | "processing" | "speaking"
  current_audio_buffer: AudioBuffer | null
  last_transcript: string | null
  last_response: string | null
  error: string | null
  openclaw_connected: boolean
}
```

**State Transitions (from spec):**
```
idle -> listening        (session started or playback complete)
listening -> processing  (speech ended, sending to STT/OpenClaw)
processing -> speaking   (response received, TTS started)
speaking -> listening    (playback complete or barge-in)
any -> idle              (session ended or fatal error)
```

**Acceptance Criteria:**
- [ ] State machine enforces valid transitions
- [ ] Invalid transitions throw/log error
- [ ] State changes emit events for observers

**Test Requirements:**
- Unit test: each valid transition
- Unit test: invalid transitions rejected
- Unit test: event emission on state change

---

### T008: VADState Data Structure
**Priority:** P0
**Dependencies:** T001, T002, T005
**Description:** Implement VADState per `algorithm_and_data_structures.md`.

**Interface:**
```javascript
class VADState {
  in_speech: boolean
  speech_buffer: AudioBuffer
  silence_frames: number
  speech_frames: number
  last_probability: number

  reset(): void
  update(probability: number, audioFrame: Int16Array): VADEvent | null
}

type VADEvent = { type: "speech_started" } | { type: "speech_ended", audio: Int16Array }
```

**Acceptance Criteria:**
- [ ] Tracks speech/silence state correctly
- [ ] Buffers audio during speech
- [ ] Emits events at state transitions
- [ ] Configurable thresholds

**Test Requirements:**
- Unit test: speech detection threshold behavior
- Unit test: silence duration tracking
- Unit test: minimum speech duration filter
- Unit test: audio buffering during speech

---

### T009: PulseAudio Availability Check
**Priority:** P0
**Dependencies:** T001
**Description:** Implement PulseAudio startup/check per `audio_io.md`.

**Implementation:**
```javascript
async function ensurePulseAudio() {
  try {
    execSync('pulseaudio --check');
  } catch {
    execSync('pulseaudio --start');
  }
}
```

**Acceptance Criteria:**
- [ ] Detects if PulseAudio is running
- [ ] Starts PulseAudio if not running
- [ ] Fails gracefully with clear error if cannot start

**Test Requirements:**
- Unit test: detection when running
- Unit test: startup when not running
- Integration test: actual PulseAudio interaction (on Termux)

---

### T010: Audio Capture Module (parecord)
**Priority:** P0
**Dependencies:** T001, T002, T005, T009
**Description:** Implement AudioCapture per `audio_io.md` and `system_architecture_and_data_flow.md`.

**Specification:**
- Command: `parecord --raw --format=s16le --rate=16000 --channels=1`
- Output: PCM chunks (16kHz, mono, 16-bit signed little-endian)
- Interface: `start()`, `stop()`, `onChunk(callback)`

**Implementation:**
```javascript
class AudioCapture {
  start(): void        // spawn parecord process
  stop(): void         // kill process
  onChunk(cb: (chunk: Buffer) => void): void
}
```

**Acceptance Criteria:**
- [ ] FR-1: Captures voice ready for transcription
- [ ] Outputs correct format (16kHz, mono, s16le)
- [ ] Handles process errors gracefully
- [ ] Clean shutdown on stop()

**Test Requirements:**
- Unit test: process spawning (mocked)
- Unit test: chunk callback invocation
- Unit test: stop kills process
- Integration test: actual audio capture (on Termux)
- Acceptance test (FR-1): Captured audio can be transcribed

---

### T011: Audio Playback Module (pacat)
**Priority:** P0
**Dependencies:** T001, T002, T009
**Description:** Implement AudioPlayback per `audio_io.md` and `system_architecture_and_data_flow.md`.

**Specification:**
- Command: `pacat --raw --format=s16le --rate=22050 --channels=1`
- Input: PCM audio from TTS
- Interface: `start(sampleRate)`, `write(chunk)`, `stop()`

**Implementation:**
```javascript
class AudioPlayback {
  start(sampleRate: number = 22050): void
  write(chunk: Buffer): void
  stop(): void
  onComplete(cb: () => void): void
}
```

**Acceptance Criteria:**
- [ ] Plays audio at correct sample rate
- [ ] Handles streaming input
- [ ] Stops immediately on stop() call (for barge-in)
- [ ] Signals completion

**Test Requirements:**
- Unit test: process spawning
- Unit test: write pipes to stdin
- Unit test: stop kills process
- Integration test: actual audio playback (on Termux)

---

### T049: Sample Rate Conversion & Compatibility Guards
**Priority:** P1
**Dependencies:** T010, T011, T015, T023
**Description:** Implement explicit sample-rate compatibility handling per `algorithm_and_data_structures.md` and `audio_io.md`.

**Scope:**
- Detect runtime sample-rate mismatches between capture/STT/VAD and TTS/playback
- Provide conversion utilities (linear interpolation/averaging) where mismatch exists
- Fail fast with clear errors when unsupported conversions are requested

**Implementation Notes:**
- Reuse proven conversion logic from existing `voice/` code where applicable
- Prefer no-conversion happy path:
  - Capture -> VAD/STT at 16kHz mono
  - TTS -> Playback at model-native sample rate

**Acceptance Criteria:**
- [ ] Correctly handles 16kHz capture and 22050Hz playback pipeline
- [ ] Conversion path produces valid PCM without audible corruption
- [ ] Mismatch detection emits actionable error messages

**Test Requirements:**
- Unit test: 16kHz -> 48kHz stereo utility behavior (if used)
- Unit test: 48kHz stereo -> 16kHz mono utility behavior (if used)
- Unit test: unsupported sample-rate mismatch handling
- Integration test: end-to-end pipeline with non-default TTS sample rate

---

## M2: Speech Processing (VAD, STT)

### T012: Silero VAD Model Loading
**Priority:** P1
**Dependencies:** T001, T002
**Description:** Load Silero VAD ONNX model using onnxruntime-node.

**Specification Reference:** `techstack_and_frameworks.md`
- Silero VAD v4 ONNX model
- ~2ms inference per 30ms frame

**Acceptance Criteria:**
- [ ] Model loads successfully
- [ ] Returns speech probability (0.0-1.0) per frame
- [ ] Inference time < 5ms per frame

**Test Requirements:**
- Unit test: model loading
- Unit test: inference returns valid probability
- Benchmark: verify inference time

---

### T013: VAD Processing Pipeline
**Priority:** P1
**Dependencies:** T008, T010, T012
**Description:** Implement complete VAD pipeline per `algorithm_and_data_structures.md`.

**Algorithm (from spec):**
```
For each 30ms audio frame:
  1. Run Silero VAD inference -> speech probability
  2. If probability > threshold:
     - If not in speech -> emit "speech_started"
     - Mark as in speech
     - Reset silence counter
  3. If probability <= threshold:
     - Increment silence counter
     - If silence > min_silence_frames:
       - Emit "speech_ended" with buffered audio
       - Reset state
```

**Configuration (from spec):**
- `vad_threshold`: 0.5 default
- `min_silence_ms`: 1200ms default
- `min_speech_ms`: 500ms default

**Acceptance Criteria:**
- [ ] Detects speech start accurately
- [ ] Detects speech end after silence
- [ ] Filters very short utterances (< 500ms)
- [ ] Handles background noise

**Test Requirements:**
- Unit test: speech detection with mock model
- Unit test: silence duration tracking
- Unit test: minimum speech duration filter
- Integration test: with real VAD model
- Acceptance test: VAD in noisy environment (manual)

---

### T014: whisper.cpp Build and Setup
**Priority:** P1
**Dependencies:** T001
**Description:** Document and automate whisper.cpp compilation for aarch64.

**Specification Reference:** `techstack_and_frameworks.md`
```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make -j8
./models/download-ggml-model.sh tiny.en
```

**Deliverables:**
- Setup script for whisper.cpp
- Documentation of build process
- Model download automation

**Acceptance Criteria:**
- [ ] whisper.cpp compiles on aarch64/Termux
- [ ] tiny.en model downloads successfully
- [ ] `./main -m models/ggml-tiny.en.bin -f audio.wav` works

**Test Requirements:**
- Integration test: compilation succeeds
- Integration test: model loads
- Integration test: transcription produces output

---

### T015: STT Module (whisper.cpp wrapper)
**Priority:** P1
**Dependencies:** T002, T014
**Description:** Implement STT module per `system_architecture_and_data_flow.md`.

**Interface:**
```javascript
class STT {
  constructor(modelPath: string)
  transcribe(audio: Int16Array): Promise<string>
}
```

**Implementation Notes:**
- Write audio to temp WAV file
- Call whisper.cpp CLI
- Parse output text
- Clean up temp file

**Acceptance Criteria:**
- [ ] FR-2: Transcription within 2 seconds for short utterance (<5s speech)
- [ ] Returns accurate transcript
- [ ] Handles empty/garbage audio gracefully ("Didn't catch that")

**Test Requirements:**
- Unit test: WAV file creation
- Unit test: CLI invocation
- Unit test: output parsing
- Unit test: empty audio handling
- Integration test: actual transcription
- Performance test: <2s for 5s audio

---

### T016: STT Empty/Garbage Detection
**Priority:** P1
**Dependencies:** T015
**Description:** Detect and handle empty or garbage STT output.

**Specification Reference:** `system_architecture_and_data_flow.md`
- If empty/garbage -> discard, show "Didn't catch that"

**Rules:**
- Empty string after trim
- Only punctuation/noise words
- Confidence below threshold (if available)

**Acceptance Criteria:**
- [ ] Empty transcripts detected
- [ ] Garbage patterns filtered
- [ ] "Didn't catch that" message returned

**Test Requirements:**
- Unit test: empty string detection
- Unit test: garbage pattern detection
- Unit test: valid text passes through

---

### T017: Audio Capture to STT Integration
**Priority:** P1
**Dependencies:** T010, T013, T015, T016
**Description:** Wire AudioCapture -> VAD -> STT pipeline.

**Data Flow:**
```
AudioCapture.onChunk(chunk)
  -> VAD.process(chunk)
     -> if speech_ended: STT.transcribe(audio)
        -> return transcript or "Didn't catch that"
```

**Acceptance Criteria:**
- [ ] Complete capture-to-text pipeline works
- [ ] Events flow correctly between components
- [ ] State managed properly

**Test Requirements:**
- Integration test: full pipeline with recorded audio
- Acceptance test (FR-1, FR-2): Voice -> text works end-to-end

---

## M3: OpenClaw Integration

### T018: OpenClaw CLI Wrapper
**Priority:** P1
**Dependencies:** T002, T006
**Description:** Implement OpenClaw client per `openclaw_api.md`.

**Command:**
```bash
openclaw agent --agent main --message "text" --json
```

**Authentication:**
- Read `gateway_token` from Scout config
- Pass token to OpenClaw using supported mechanism for the installed CLI version (env var or CLI flag)
- Never log raw token values

**Response Parsing:**
```javascript
const result = JSON.parse(stdout);
const text = result.result.payloads[0]?.text || '';
```

**Exit Codes:**
- 0: Success
- 1: Error
- 7: Connection refused

**Interface:**
```javascript
class OpenClawClient {
  constructor(config: Config)
  send(message: string): Promise<{ text: string, sessionId: string }>
  healthCheck(): Promise<boolean>
}
```

**Acceptance Criteria:**
- [ ] FR-3: Sends transcript, receives response
- [ ] FR-3: Shows error if unreachable (not fake response)
- [ ] Parses JSON response correctly
- [ ] Handles all exit codes
- [ ] Uses configured gateway token successfully when gateway auth is enabled

**Test Requirements:**
- Unit test: CLI command construction
- Unit test: response parsing
- Unit test: error code handling
- Unit test: token propagation without token leakage in logs
- Integration test: actual OpenClaw call
- Acceptance test (FR-3): Full communication works

---

### T019: OpenClaw Health Check
**Priority:** P1
**Dependencies:** T018
**Description:** Implement gateway health check per `openclaw_api.md`.

**Command:**
```bash
openclaw gateway health
```

**Acceptance Criteria:**
- [ ] FR-8: Detects connection status within 5s
- [ ] Returns boolean health status
- [ ] Handles timeout gracefully

**Test Requirements:**
- Unit test: health check parsing
- Integration test: with running gateway
- Integration test: with stopped gateway

---

### T020: Connection Status Monitoring
**Priority:** P1
**Dependencies:** T019
**Description:** Continuous monitoring of OpenClaw connection status.

**Behavior:**
- Check health every 5 seconds
- Update `ConversationState.openclaw_connected`
- FR-8: Show "disconnected" indicator within 5s of failure

**Acceptance Criteria:**
- [ ] Detects disconnection within 5 seconds
- [ ] Updates state correctly
- [ ] Attempts reconnection

**Test Requirements:**
- Unit test: polling mechanism
- Unit test: state update on disconnect
- Integration test: actual disconnect/reconnect

---

### T021: Never Fake Responses Enforcement
**Priority:** P1
**Dependencies:** T018
**Description:** Ensure Scout NEVER generates fake responses.

**Specification Reference:** `prd.md` FR-3, NFR Privacy & Safety
- If OpenClaw unreachable: show error, do NOT respond
- Only play audio synthesized from OpenClaw responses

**Implementation:**
- OpenClawClient returns `null` on any error
- Session manager shows error state
- No fallback text generation

**Acceptance Criteria:**
- [ ] No response path exists that doesn't go through OpenClaw
- [ ] All error cases show error message
- [ ] No synthesized fallback responses

**Test Requirements:**
- Unit test: error propagation
- Integration test: disconnection shows error
- Acceptance test: verify no fake responses possible

---

### T050: Session Strategy & Identity Continuity
**Priority:** P1
**Dependencies:** T018, T029
**Description:** Define and implement explicit session ID strategy so Scout conversation continuity matches OpenClaw identity/memory expectations.

**Strategy:**
- Capture `sessionId` from OpenClaw responses when provided
- Reuse session ID for subsequent requests in active session
- Persist last successful session ID for reconnect/resume behavior when appropriate
- Reset session ID when user intentionally starts a new session

**Acceptance Criteria:**
- [ ] Multi-turn conversation reuses OpenClaw session context by default
- [ ] Session reset behavior is explicit and user-controlled
- [ ] Session metadata handled without leaking sensitive values

**Test Requirements:**
- Unit test: session ID extraction/parsing
- Unit test: reuse vs reset logic
- Integration test: identity/memory continuity across multiple turns
- Integration test: reconnect resumes expected session behavior

---

## M4: Speech Synthesis (TTS, Jitter Buffer)

### T022: Piper TTS Installation
**Priority:** P1
**Dependencies:** T001
**Description:** Document and automate Piper TTS setup per `tts_piper.md`.

**Installation:**
```bash
pip install piper-tts
```

**Voice Download:**
- `en_US-lessac-medium.onnx` + `.onnx.json`

**Acceptance Criteria:**
- [ ] Piper installs successfully
- [ ] Voice model downloads
- [ ] Test synthesis works

**Test Requirements:**
- Integration test: installation
- Integration test: synthesis produces audio

---

### T023: TTS Module (Piper wrapper)
**Priority:** P1
**Dependencies:** T002, T022
**Description:** Implement TTS module per `tts_piper.md`.

**Command:**
```bash
echo "text" | piper --model voice.onnx --output_raw
```

**Interface:**
```javascript
class TTS {
  constructor(modelPath: string, sampleRate: number)
  synthesize(text: string): AsyncIterable<Buffer>  // streaming
  stop(): void  // cancel synthesis
}
```

**Acceptance Criteria:**
- [ ] FR-4: Audio begins within 500ms of synthesis start
- [ ] Outputs correct format (s16le, configurable sample rate)
- [ ] Supports streaming output
- [ ] Can be interrupted
- [ ] Piper cold-start impact is mitigated using a documented strategy (persistent process or warmed workers)

**Test Requirements:**
- Unit test: process spawning
- Unit test: text input
- Unit test: streaming output
- Unit test: interruption
- Performance test: <500ms to first audio
- Integration test: actual Piper synthesis

---

### T024: Sentence Chunking for Streaming TTS
**Priority:** P1
**Dependencies:** T023
**Description:** Implement sentence chunking per `algorithm_and_data_structures.md`.

**Algorithm:**
```
1. Split text into sentences using punctuation (. ! ?)
2. For each sentence:
   a. Send to Piper TTS
   b. Stream audio chunks to jitter buffer
   c. Start playback after first sentence buffer fills
3. Continue until all sentences done
```

**Configuration:**
- `sentence_delimiters`: `/[.!?]+/`
- `min_chunk_chars`: 20

**Acceptance Criteria:**
- [ ] Text splits into sentences correctly
- [ ] First sentence synthesizes immediately
- [ ] Subsequent sentences pipeline behind playback

**Test Requirements:**
- Unit test: sentence splitting
- Unit test: minimum chunk handling
- Integration test: streaming synthesis

---

### T025: Jitter Buffer Implementation
**Priority:** P1
**Dependencies:** T005
**Description:** Implement jitter buffer per `algorithm_and_data_structures.md`.

**Configuration (from spec):**
- `buffer_size_ms`: 500ms total capacity
- `low_watermark_ms`: 100ms (start playback threshold)
- `frame_duration_ms`: 20ms

**Algorithm:**
```
On audio chunk received:
  1. Write to ring buffer
  2. If not playing and buffer >= low_watermark: start playback

On playback tick:
  1. If buffer >= frame_size: read and output
  2. Else if buffer > 0: output partial + silence (underrun)
  3. Else: output silence

On end-of-stream:
  1. Drain remaining buffer
  2. Signal completion
```

**Acceptance Criteria:**
- [ ] FR-5: Continuous audio with no cuts/glitches
- [ ] Handles irregular chunk arrival
- [ ] Pads with silence on underrun (no clicks)
- [ ] Clears immediately on barge-in

**Test Requirements:**
- Unit test: watermark behavior
- Unit test: underrun handling
- Unit test: overflow handling
- Unit test: clear/barge-in
- Integration test: with actual TTS output
- Acceptance test (FR-5): Smooth playback verification

---

### T026: Audio Crossfade at Chunk Boundaries
**Priority:** P2
**Dependencies:** T025
**Description:** Implement crossfade to prevent clicks at chunk boundaries.

**Specification Reference:** `system_architecture_and_data_flow.md`
- Crossfades at chunk boundaries to prevent clicks

**Implementation:**
- Short (5-10ms) linear fade between chunks
- Only when chunks don't align smoothly

**Acceptance Criteria:**
- [ ] No audible clicks at chunk boundaries
- [ ] Minimal processing overhead

**Test Requirements:**
- Unit test: crossfade algorithm
- Perceptual test: no clicks (manual)

---

### T027: TTS to Playback Pipeline
**Priority:** P1
**Dependencies:** T011, T023, T024, T025
**Description:** Wire TTS -> JitterBuffer -> AudioPlayback pipeline.

**Data Flow:**
```
TTS.synthesize(text)
  -> for each chunk: JitterBuffer.write(chunk)
     -> when watermark reached: AudioPlayback.start()
        -> JitterBuffer.read() -> AudioPlayback.write()
  -> on completion: drain buffer, signal complete
```

**Acceptance Criteria:**
- [ ] Complete text-to-audio pipeline works
- [ ] Streaming reduces latency
- [ ] Smooth playback achieved

**Test Requirements:**
- Integration test: full pipeline
- Performance test: time to first audio
- Acceptance test (FR-4, FR-5): TTS performance criteria

---

### T028: TTS Fallback to Text Display
**Priority:** P2
**Dependencies:** T023, T027
**Description:** Handle TTS failure gracefully.

**Specification Reference:** `system_architecture_and_data_flow.md`
- TTS fails: Show text response as fallback

**Acceptance Criteria:**
- [ ] TTS errors caught
- [ ] Text displayed when TTS fails
- [ ] User informed of fallback

**Test Requirements:**
- Unit test: error handling
- Integration test: fallback behavior

---

## M5: Session Management & Barge-in

### T029: Session Manager Implementation
**Priority:** P1
**Dependencies:** T007, T017, T021, T027
**Description:** Implement central session manager per `system_architecture_and_data_flow.md`.

**Responsibilities:**
- Coordinate all components
- Manage state machine transitions
- Handle events from all modules
- Update UI/console feedback

**State Machine:**
```
idle -> listening (session started or playback complete)
listening -> processing (speech ended)
processing -> speaking (response received)
speaking -> listening (playback complete or barge-in)
any -> idle (session ended or fatal error)
```

**Interface:**
```javascript
class SessionManager {
  start(): void
  stop(): void
  onStateChange(cb: (state) => void): void
  getState(): ConversationState
}
```

**Acceptance Criteria:**
- [ ] All state transitions work correctly
- [ ] Components coordinated properly
- [ ] UI feedback updated on state changes

**Test Requirements:**
- Unit test: each state transition
- Integration test: full conversation loop
- Acceptance test: multi-turn conversation

---

### T030: Barge-in Detection
**Priority:** P1
**Dependencies:** T013, T029
**Description:** Implement barge-in per `algorithm_and_data_structures.md`.

**Algorithm (from spec):**
```
During playback:
  1. Continue capturing microphone audio
  2. Run VAD on captured audio
  3. If VAD detects speech_started:
     - Emit "barge_in" event
     - Stop TTS synthesis
     - Clear jitter buffer
     - Stop audio playback immediately
     - Transition to "listening" state
     - Begin buffering new utterance
```

**Echo Mitigation (no AEC):**
- Raise VAD threshold during playback (0.5 -> 0.7)
- Require sustained speech (3+ consecutive frames)
- Document "use headphones for best experience"

**Configuration:**
- `barge_in_enabled`: true default
- `barge_in_cooldown_ms`: 200ms

**Acceptance Criteria:**
- [ ] FR-6: Agent audio stops within 200ms of user speech
- [ ] New speech captured after interrupt
- [ ] Echo/feedback filtered during playback

**Test Requirements:**
- Unit test: interrupt detection
- Unit test: threshold adjustment during playback
- Unit test: cooldown behavior
- Performance test: <200ms interrupt latency
- Acceptance test (FR-6): Barge-in works

---

### T031: Barge-in Stops TTS and Playback
**Priority:** P1
**Dependencies:** T023, T025, T030
**Description:** Ensure barge-in stops all output immediately.

**Actions on barge-in:**
1. TTS.stop() - cancel any pending synthesis
2. JitterBuffer.clear() - discard buffered audio
3. AudioPlayback.stop() - stop output immediately
4. State -> "listening"

**Acceptance Criteria:**
- [ ] All output stops within 200ms
- [ ] No audio continues after interrupt
- [ ] State transitions correctly

**Test Requirements:**
- Unit test: TTS cancellation
- Unit test: buffer clearing
- Unit test: playback stop
- Integration test: complete interrupt flow

---

### T032: Barge-in Cooldown (Debounce)
**Priority:** P2
**Dependencies:** T030
**Description:** Prevent rapid repeated interrupts.

**Specification Reference:** `algorithm_and_data_structures.md`
- `barge_in_cooldown_ms`: 200ms

**Acceptance Criteria:**
- [ ] Second interrupt within cooldown ignored
- [ ] Cooldown resets after legitimate interrupt

**Test Requirements:**
- Unit test: cooldown timing
- Unit test: reset behavior

---

### T033: Continuous Conversation Loop
**Priority:** P1
**Dependencies:** T029, T030
**Description:** Implement seamless conversation continuation.

**Flow:**
```
idle -> listening -> processing -> speaking -> listening -> ...
```

**Behavior:**
- After playback complete, return to listening
- After barge-in, capture new speech
- Loop continues until session ended

**Acceptance Criteria:**
- [ ] Multi-turn conversations work seamlessly
- [ ] No manual restart between turns
- [ ] State machine cycles correctly

**Test Requirements:**
- Integration test: multi-turn conversation
- Acceptance test: extended conversation session

---

### T034: Session Start/Stop Controls
**Priority:** P2
**Dependencies:** T029
**Description:** User controls for session management.

**Controls:**
- Start session (begin listening)
- Stop session (return to idle)
- Pause/resume (if needed)

**Acceptance Criteria:**
- [ ] User can start conversation
- [ ] User can end conversation cleanly
- [ ] Resources cleaned up on stop

**Test Requirements:**
- Unit test: start/stop lifecycle
- Integration test: resource cleanup

---

## M6: First-Run Setup & Error Handling

### T035: First-Run Detection
**Priority:** P2
**Dependencies:** T006
**Description:** Detect fresh installation.

**Specification Reference:** `prd.md` FR-7
- If config file missing -> trigger wizard

**Acceptance Criteria:**
- [ ] Detects missing config
- [ ] Triggers setup wizard on first run
- [ ] Skips wizard if config exists

**Test Requirements:**
- Unit test: detection logic
- Integration test: wizard trigger

---

### T036: Setup Wizard - Gateway Configuration
**Priority:** P2
**Dependencies:** T018, T035
**Description:** Guide user through gateway setup.

**Steps:**
1. Prompt for gateway URL (default: localhost:18789)
2. Prompt for gateway token
3. Test authenticated connection
4. Show success/failure

**Acceptance Criteria:**
- [ ] FR-7: Prompts for gateway URL
- [ ] FR-7: Prompts for gateway token
- [ ] FR-7: Tests authenticated connection
- [ ] Clear feedback on success/failure

**Test Requirements:**
- Unit test: input handling
- Unit test: token validation and secure storage behavior
- Integration test: authenticated connection test
- Acceptance test (FR-7): Wizard completes successfully

---

### T037: Setup Wizard - Audio Test
**Priority:** P2
**Dependencies:** T010, T011, T036
**Description:** Microphone and speaker test during setup.

**Steps:**
1. Record short audio sample
2. Play back recording
3. Confirm user can hear

**Acceptance Criteria:**
- [ ] FR-7: Mic test captures audio
- [ ] FR-7: Speaker test plays audio
- [ ] User confirms working audio

**Test Requirements:**
- Integration test: capture and playback
- Manual test: audio quality verification

---

### T038: Error Message System
**Priority:** P2
**Dependencies:** T007, T029
**Description:** Implement clear error messages per `prd.md` FR-9.

**Error Types (from spec):**
| Situation | Message |
|-----------|---------|
| OpenClaw unreachable | "Cannot reach OpenClaw" |
| OpenClaw error | Show error message |
| STT empty | "Didn't catch that" |
| TTS fails | Show text, display error |
| Network drops | "Connection lost" |
| Mic permission | Explain why mic needed |

**Acceptance Criteria:**
- [ ] FR-9: All failure states have clear messages
- [ ] Messages understandable by tinkerer
- [ ] No silent failures

**Test Requirements:**
- Unit test: each error type
- Integration test: error display

---

### T039: Connection Lost Recovery
**Priority:** P2
**Dependencies:** T020, T029
**Description:** Handle network disconnections gracefully.

**Specification Reference:** `prd.md` NFR Reliability
- Brief disconnections (<5s) should not crash session

**Behavior:**
- Show "Connection lost" message
- Attempt reconnection with bounded exponential backoff (e.g., 1s, 2s, 4s, max 5s)
- Resume if possible
- Fail gracefully if not

**Acceptance Criteria:**
- [ ] Disconnection detected and shown
- [ ] Reconnection attempted
- [ ] Session resumes on reconnect
- [ ] Clean failure if cannot reconnect
- [ ] Retry policy is deterministic and documented

**Test Requirements:**
- Integration test: disconnect/reconnect cycle
- Integration test: permanent disconnection handling
- Unit test: backoff schedule behavior

---

### T040: Config Persistence (FR-10)
**Priority:** P2
**Dependencies:** T006
**Description:** Ensure config survives restarts.

**Acceptance Criteria:**
- [ ] FR-10: Gateway URL preserved after restart
- [ ] FR-10: Gateway token preserved securely after restart
- [ ] All settings preserved
- [ ] Corruption detection

**Test Requirements:**
- Integration test: write, restart, read cycle
- Unit test: corruption handling

---

### T041: Logging System
**Priority:** P2
**Dependencies:** T006
**Description:** Implement debug logging per user story #14.

**Configuration:**
- `log_level`: "debug" | "info" | "warn" | "error"
- `log_to_file`: boolean

**Output:**
- Console logging always
- File logging if enabled

**Acceptance Criteria:**
- [ ] Log levels work correctly
- [ ] File logging creates log file
- [ ] Useful debug information for troubleshooting

**Test Requirements:**
- Unit test: log level filtering
- Unit test: file writing
- Integration test: useful log output

---

### T051: Latency Instrumentation, Benchmarks & Thermal Degradation
**Priority:** P2
**Dependencies:** T015, T023, T030, T039
**Description:** Add explicit instrumentation and benchmark criteria for conversational latency and degraded-operation behavior.

**Instrumentation Points:**
- `stt_start` -> `stt_done` (FR-2)
- `tts_start` -> `first_audio_out` (FR-4)
- `barge_in_detected` -> `playback_stopped` (FR-6)

**Required Metrics:**
- P50/P95 for STT latency on short utterances (<5s speech)
- P50/P95 for time-to-first-audio
- P50/P95 for barge-in stop latency

**Thermal/Load Strategy:**
- Detect sustained slowdowns
- Degrade gracefully by selecting lighter model/profile where configured
- Never degrade into glitching/clicking output silently; surface status in logs/UI

**Acceptance Criteria:**
- [ ] FR-2/FR-4/FR-6 latency metrics are measurable from logs/telemetry
- [ ] Benchmark script produces repeatable summary output
- [ ] Thermal/load degradation strategy is implemented and documented

**Test Requirements:**
- Unit test: timestamp capture and duration computation
- Integration test: benchmark runner against recorded fixtures
- Manual test: simulated high-load behavior and graceful degradation

---

### T042: Wake Word Support (FR-11)
**Priority:** P2
**Dependencies:** T013, T029
**Description:** Implement optional wake word activation per `prd.md` FR-11.

**Specification Reference:** `prd.md` FR-11
- Off by default (to save battery and avoid false triggers)
- When enabled, only starts listening after wake phrase detected

**Configuration:**
- `wake_word_enabled`: boolean (default: false)
- `wake_word_phrase`: string (default: "hey scout")

**Implementation Approach:**
- Reuse VAD pipeline for continuous low-power listening
- Simple keyword spotting (exact phrase match from STT)
- More sophisticated wake word detection (e.g., Porcupine) is out of scope for Phase 0

**Acceptance Criteria:**
- [ ] FR-11: Given wake word enabled, saying wake phrase starts listening
- [ ] FR-11: Given wake word disabled (default), only manual activation works
- [ ] Wake phrase configurable in config
- [ ] False positive rate acceptable (tested manually)

**Test Requirements:**
- Unit test: wake word detection logic
- Integration test: full wake word flow
- Manual test: false positive assessment

---

### T043: Display Mode Configuration (FR-12)
**Priority:** P2
**Dependencies:** T006, T029
**Description:** Implement configurable display modes per `prd.md` FR-12.

**Specification Reference:** `prd.md` FR-12
- Display modes: voice_only, minimal, transcript
- Affects what text appears on screen during conversation

**Display Mode Behaviors:**
| Mode | User Speech | Agent Response | Status |
|------|-------------|----------------|--------|
| voice_only | Hidden | Hidden | Icon only |
| minimal | Hidden | Hidden | Text status (Listening/Processing/Speaking) |
| transcript | Shown | Shown | Full conversation history |

**Configuration:**
- `display_mode`: "voice_only" | "minimal" | "transcript"

**Acceptance Criteria:**
- [ ] FR-12: Settings allow selecting display mode
- [ ] FR-12: Main screen reflects choice
- [ ] Preference persists across restarts
- [ ] Mode changes take effect immediately

**Test Requirements:**
- Unit test: display mode rendering logic
- Integration test: mode persistence
- Manual test: visual verification for each mode

---

### T044: Document Transport Priority (FR-13)
**Priority:** P3
**Dependencies:** None
**Description:** Document that FR-13 (Transport Priority) is handled by OpenClaw, not Scout.

**Specification Reference:** `prd.md` FR-13
- Most recently used transport receives responses
- Scout is a single transport; OpenClaw handles arbitration

**Clarification:**
Scout Phase 0 is a single voice transport. When multiple transports are active (e.g., Scout + Discord), OpenClaw Gateway handles priority based on most recent activity. This is not Scout's responsibility.

**Acceptance Criteria:**
- [ ] README documents that OpenClaw handles multi-transport priority
- [ ] Architecture docs clarify Scout's role as single transport
- [ ] No implementation required in Scout codebase

**Test Requirements:**
- None (documentation only)

---

## M7: Documentation & README

### T045: README - Installation
**Priority:** P3
**Dependencies:** All implementation tasks
**Description:** Document complete installation process.

**Sections:**
- Prerequisites (Termux, Node.js, PulseAudio)
- OpenClaw setup
- Scout installation
- Model downloads (whisper.cpp, Piper voice)

**Acceptance Criteria:**
- [ ] Tinkerer can install from README in <1 hour
- [ ] All steps documented
- [ ] Version requirements clear

**Test Requirements:**
- Manual test: fresh installation following README

---

### T046: README - Configuration
**Priority:** P3
**Dependencies:** T045
**Description:** Document configuration options.

**Sections:**
- Config file location
- All config options explained
- Example configurations

**Acceptance Criteria:**
- [ ] All config options documented
- [ ] Defaults explained
- [ ] Examples provided

---

### T047: README - Troubleshooting
**Priority:** P3
**Dependencies:** T045
**Description:** Document common issues and solutions.

**Sections:**
- Audio issues
- Connection issues
- Model loading issues
- Performance issues

**Acceptance Criteria:**
- [ ] Common issues covered
- [ ] Solutions provided
- [ ] Where to get help

---

### T048: README - Customization
**Priority:** P3
**Dependencies:** T045
**Description:** Document how to swap models.

**Sections:**
- Changing STT model (whisper sizes)
- Changing TTS voice (Piper voices)
- Adjusting VAD sensitivity

**Acceptance Criteria:**
- [ ] User stories #11, #12, #13 addressed
- [ ] Clear instructions for swapping components

---

## Dependency Graph

```
T001 (Scaffolding)
  ├── T002 (Unit Tests)
  │   ├── T003 (Pre-commit)
  │   ├── T005 (AudioBuffer)
  │   │   ├── T008 (VADState)
  │   │   ├── T010 (AudioCapture)
  │   │   └── T025 (JitterBuffer)
  │   ├── T006 (Config)
  │   │   ├── T018 (OpenClaw Client)
  │   │   └── T035 (First-Run Detection)
  │   ├── T007 (ConversationState)
  │   │   └── T029 (SessionManager)
  │   ├── T012 (VAD Model)
  │   │   └── T013 (VAD Pipeline)
  │   ├── T014 (whisper.cpp)
  │   │   └── T015 (STT Module)
  │   │       └── T016 (Garbage Detection)
  │   ├── T022 (Piper)
  │   │   └── T023 (TTS Module)
  │   │       └── T024 (Sentence Chunking)
  │   └── T009 (PulseAudio)
  │       ├── T010 (AudioCapture)
  │       └── T011 (AudioPlayback)
  └── T004 (Acceptance Tests)

T010 + T013 + T015 + T016 -> T017 (Capture-STT Integration)
T010 + T011 + T015 + T023 -> T049 (Sample Rate Compatibility)
T018 -> T019 (Health Check) -> T020 (Connection Monitor)
T018 -> T021 (No Fake Responses)
T018 + T029 -> T050 (Session Strategy)
T023 + T024 + T025 + T011 -> T027 (TTS-Playback Pipeline)
T025 -> T026 (Crossfade)
T023 -> T028 (TTS Fallback)
T007 + T017 + T021 + T027 -> T029 (Session Manager)
T013 + T029 -> T030 (Barge-in)
T023 + T025 + T030 -> T031 (Barge-in Stops)
T030 -> T032 (Cooldown)
T029 + T030 -> T033 (Conversation Loop)
T029 -> T034 (Start/Stop)
T006 -> T035 (First-Run) -> T036 (Gateway Setup) -> T037 (Audio Test)
T007 + T029 -> T038 (Error Messages)
T020 + T029 -> T039 (Connection Recovery)
T006 -> T040 (Config Persistence)
T006 -> T041 (Logging)
T015 + T023 + T030 + T039 -> T051 (Latency + Thermal Strategy)
T013 + T029 -> T042 (Wake Word)
T006 + T029 -> T043 (Display Mode)
T044 (Transport Priority - docs only, no deps)
All -> T045-T048 (Documentation)
```

---

## Acceptance Test Matrix

| FR | Task | Acceptance Test |
|----|------|-----------------|
| FR-1 | T010, T017 | Voice capture ready for transcription |
| FR-2 | T015, T017 | STT within 2 seconds for short utterance |
| FR-3 | T018, T021 | OpenClaw communication, no fake responses |
| FR-4 | T023, T027 | TTS begins within 500ms |
| FR-5 | T025, T027 | Continuous audio, no cuts/glitches |
| FR-6 | T030, T031 | Barge-in stops agent within 200ms |
| FR-7 | T036, T037 | First-run setup wizard |
| FR-8 | T019, T020 | Connection status visible within 5s |
| FR-9 | T038 | Clear error messages |
| FR-10 | T006, T040 | Config persistence |
| FR-11 | T042 | Wake word activation (optional feature) |
| FR-12 | T043 | Display mode configuration |
| FR-13 | T044 | Transport priority (documented, OpenClaw handles) |
| NFR-Performance | T051 (+ T015, T023, T030) | Instrumented and benchmarked latency for STT/TTS/barge-in |
| NFR-Reliability | T039, T050, T051 | Reconnect policy, session continuity, graceful degradation |

---

## Implementation Notes

### Critical Path
M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7

The critical path runs through testing infrastructure, core data structures, speech processing, OpenClaw integration, TTS pipeline, and session management. Documentation is last but can be started in parallel.

### Parallelization Opportunities
- T012-T014 (VAD/STT model setup) can proceed in parallel with T005-T008 (data structures)
- T022 (Piper setup) can proceed in parallel with M2 tasks
- Documentation tasks can start once corresponding implementation is stable

### Risk Areas
1. **whisper.cpp compilation on aarch64** - May have build issues
2. **Silero VAD ONNX runtime** - Compatibility with Termux
3. **Audio latency** - PulseAudio may introduce latency; may need tuning
4. **Barge-in echo** - Without AEC, may have false triggers

### Testing Strategy
- Unit tests for all data structures and algorithms
- Integration tests for component interactions
- Acceptance tests map 1:1 with functional requirements
- Manual testing for perceptual quality (audio smoothness, latency feel)

---

## Spec Conflict Resolutions (Canonical for This Plan)

These decisions resolve conflicting wording across spec documents and are authoritative for implementation:

1. **Audio capture/playback mechanism (Phase 0):**
   - Use PulseAudio `parecord`/`pacat` as canonical path.
   - Do not use `termux-microphone-record` for the main pipeline because it does not provide raw PCM suitable for direct VAD/STT input.

2. **OpenClaw transport integration (Phase 0):**
   - Use OpenClaw CLI wrapper (`openclaw agent ... --json`) as canonical integration path.
   - Avoid direct WebSocket protocol implementation in Phase 0 unless CLI proves insufficient.

3. **Gateway connectivity model:**
   - Enforce localhost-only gateway URL in Scout config for Phase 0.
   - Require gateway token support in setup/config and runtime calls.

4. **Latency verification contract:**
   - FR-2, FR-4, and FR-6 must be validated via explicit instrumentation (T051), not by subjective manual timing alone.
