# GitHub Issues Specification

This document defines the GitHub milestones and issues to be created for the Scout project. These issues were prepared when GitHub API was unavailable and should be created when connectivity is restored.

**Last Updated:** 2026-02-13

## Commands to Create Milestones

```bash
# Create milestones M0-M7
gh milestone create --title "M0: Testing Infrastructure & Scaffolding" --description "Foundation - testing infrastructure must come first per backpressure.md requirements"
gh milestone create --title "M1: Core Data Structures & Audio I/O" --description "Foundation - data structures and audio I/O components"
gh milestone create --title "M2: Speech Processing (VAD, STT)" --description "Core pipeline - voice activity detection and speech-to-text"
gh milestone create --title "M3: OpenClaw Integration" --description "Core pipeline - OpenClaw gateway communication"
gh milestone create --title "M4: Speech Synthesis (TTS, Jitter Buffer)" --description "Core pipeline - text-to-speech and smooth audio playback"
gh milestone create --title "M5: Session Management & Barge-in" --description "Core pipeline - session state machine and interrupt handling"
gh milestone create --title "M6: First-Run Setup, Error Handling & Features" --description "Features - setup wizard, error handling, wake word, display modes"
gh milestone create --title "M7: Documentation & README" --description "Polish - documentation and installation guides"
```

---

## Issue #1: M0 - Testing Infrastructure & Scaffolding

**Title:** M0: Testing Infrastructure & Scaffolding (T001-T004)

**Labels:** `priority/p0`, `milestone/m0`

**Milestone:** M0: Testing Infrastructure & Scaffolding

**Body:**
```markdown
## Overview

Per `specs/backpressure.md`, testing infrastructure MUST come first. This creates the feedback loop needed for quality implementation.

## Tasks

### T001: Project Scaffolding
**Priority:** P0 | **Dependencies:** None

Create the Scout project structure with Node.js setup.

**Deliverables:**
- `package.json` with project metadata and scripts
- `.gitignore` for Node.js project
- `src/` directory structure (audio/, vad/, stt/, tts/, openclaw/, session/, config/, utils/)
- `tests/` directory structure (unit/, integration/, acceptance/)
- ESLint configuration (`.eslintrc.json`)
- TypeScript configuration (`tsconfig.json`) if using TypeScript
- `config.json.example`

**Acceptance Criteria:**
- [ ] `npm install` succeeds
- [ ] `npm run lint` executes
- [ ] Directory structure matches specification

---

### T002: Unit Test Framework Setup
**Priority:** P0 | **Dependencies:** T001

Configure unit testing framework.

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
**Priority:** P0 | **Dependencies:** T001, T002

Configure pre-commit hooks for linter, typechecks, and secret detection.

**Deliverables:**
- husky or similar pre-commit hook tool
- Pre-commit script running ESLint, TypeScript/JSDoc validation, gitleaks
- Documentation of bypass procedure for emergencies

**Acceptance Criteria:**
- [ ] Commits blocked if lint fails
- [ ] Commits blocked if secret patterns detected
- [ ] `npm run precommit` runs all checks manually

**Test Requirements:**
- Verify lint failure blocks commit
- Verify secret pattern detection works

---

### T004: Acceptance Test Framework (Gherkin)
**Priority:** P0 | **Dependencies:** T001

Set up Gherkin-style acceptance testing.

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

## FR Coverage
None directly (infrastructure)

## Definition of Done
- All acceptance criteria checked
- All tests passing
- Pre-commit hooks working
```

---

## Issue #2: M1 - Core Data Structures & Audio I/O

**Title:** M1: Core Data Structures & Audio I/O (T005-T011, T049)

**Labels:** `priority/p0`, `milestone/m1`

**Milestone:** M1: Core Data Structures & Audio I/O

**Body:**
```markdown
## Overview

Data structures must exist before components that use them. Audio I/O is the entry point of the pipeline.

## Tasks

### T005: AudioBuffer (Ring Buffer) Implementation
**Priority:** P0 | **Dependencies:** T001, T002

Implement the AudioBuffer ring buffer per `algorithm_and_data_structures.md`.

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
- [ ] Supports watermark queries
- [ ] Thread-safe for single producer/single consumer pattern

**Test Requirements:**
- Unit test: write then read returns same data
- Unit test: wrap-around behavior
- Unit test: overflow behavior
- Unit test: underflow behavior
- Benchmark: verify O(1) performance

---

### T006: Config Schema and Validation
**Priority:** P0 | **Dependencies:** T001, T002

Implement Config data structure with validation.

**Configuration Fields:**
- gateway_url, gateway_token (OpenClaw)
- stt_model_path, tts_voice, tts_model_path, tts_sample_rate, vad_model_path (Models)
- sample_rate, vad_threshold, silence_duration_ms, min_speech_ms, buffer_size_ms, low_watermark_ms (Audio)
- wake_word_enabled, wake_word_phrase, display_mode, barge_in_enabled, barge_in_cooldown_ms (Features)
- log_level, log_to_file (Debug)

**Validation Rules:**
- gateway_url: Valid URL, localhost only
- gateway_token: Non-empty string
- stt_model_path: File must exist
- tts_model_path: File must exist
- vad_threshold: 0.0 to 1.0
- silence_duration_ms: 100 to 5000

**Acceptance Criteria:**
- [ ] Load config from JSON file
- [ ] Validate all fields per rules
- [ ] Return clear error messages for invalid config
- [ ] Provide defaults for optional fields
- [ ] Enforce localhost-only URL
- [ ] FR-10: Config persists across restarts

**Test Requirements:**
- Unit test: valid config loads successfully
- Unit test: each validation rule rejects invalid input
- Unit test: missing optional fields use defaults
- Unit test: config persistence (write/read cycle)

---

### T007: ConversationState Data Structure
**Priority:** P0 | **Dependencies:** T001, T002, T005

Implement ConversationState per `algorithm_and_data_structures.md`.

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

**State Transitions:**
- idle -> listening (session started or playback complete)
- listening -> processing (speech ended)
- processing -> speaking (response received)
- speaking -> listening (playback complete or barge-in)
- any -> idle (session ended or fatal error)

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
**Priority:** P0 | **Dependencies:** T001, T002, T005

Implement VADState per `algorithm_and_data_structures.md`.

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
**Priority:** P0 | **Dependencies:** T001

Implement PulseAudio startup/check per `audio_io.md`.

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
**Priority:** P0 | **Dependencies:** T001, T002, T005, T009

Implement AudioCapture per `audio_io.md`.

**Command:** `parecord --raw --format=s16le --rate=16000 --channels=1`

**Interface:**
```javascript
class AudioCapture {
  start(): void
  stop(): void
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
**Priority:** P0 | **Dependencies:** T001, T002, T009

Implement AudioPlayback per `audio_io.md`.

**Command:** `pacat --raw --format=s16le --rate=22050 --channels=1`

**Interface:**
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
**Priority:** P1 | **Dependencies:** T010, T011, T015, T023

Implement explicit sample-rate compatibility handling.

**Scope:**
- Detect runtime sample-rate mismatches
- Provide conversion utilities where mismatch exists
- Fail fast with clear errors when unsupported conversions requested

**Acceptance Criteria:**
- [ ] Correctly handles 16kHz capture and 22050Hz playback pipeline
- [ ] Conversion path produces valid PCM without audible corruption
- [ ] Mismatch detection emits actionable error messages

**Test Requirements:**
- Unit test: conversion utility behavior
- Unit test: unsupported sample-rate mismatch handling
- Integration test: end-to-end pipeline with non-default TTS sample rate

## FR Coverage
- FR-1: Voice Capture (T010)
- FR-10: Config Persistence (T006)

## Definition of Done
- All acceptance criteria checked
- All unit tests passing
- Integration tests passing on Termux
```

---

## Issue #3: M2 - Speech Processing (VAD, STT)

**Title:** M2: Speech Processing - VAD & STT (T012-T017)

**Labels:** `priority/p1`, `milestone/m2`

**Milestone:** M2: Speech Processing (VAD, STT)

**Body:**
```markdown
## Overview

Implement voice activity detection using Silero VAD and speech-to-text using whisper.cpp.

## Tasks

### T012: Silero VAD Model Loading
**Priority:** P1 | **Dependencies:** T001, T002

Load Silero VAD ONNX model using onnxruntime-node.

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
**Priority:** P1 | **Dependencies:** T008, T010, T012

Implement complete VAD pipeline per `algorithm_and_data_structures.md`.

**Algorithm:**
For each 30ms audio frame:
1. Run Silero VAD inference -> speech probability
2. If probability > threshold: mark speech, reset silence counter
3. If probability <= threshold: increment silence counter, emit speech_ended if threshold exceeded

**Configuration:**
- vad_threshold: 0.5 default
- min_silence_ms: 1200ms default
- min_speech_ms: 500ms default

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
**Priority:** P1 | **Dependencies:** T001

Document and automate whisper.cpp compilation for aarch64.

**Commands:**
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
**Priority:** P1 | **Dependencies:** T002, T014

Implement STT module per `system_architecture_and_data_flow.md`.

**Interface:**
```javascript
class STT {
  constructor(modelPath: string)
  transcribe(audio: Int16Array): Promise<string>
}
```

**Acceptance Criteria:**
- [ ] FR-2: Transcription within 2 seconds for short utterance (<5s speech)
- [ ] Returns accurate transcript
- [ ] Handles empty/garbage audio gracefully

**Test Requirements:**
- Unit test: WAV file creation
- Unit test: CLI invocation
- Unit test: output parsing
- Unit test: empty audio handling
- Integration test: actual transcription
- Performance test: <2s for 5s audio

---

### T016: STT Empty/Garbage Detection
**Priority:** P1 | **Dependencies:** T015

Detect and handle empty or garbage STT output.

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
**Priority:** P1 | **Dependencies:** T010, T013, T015, T016

Wire AudioCapture -> VAD -> STT pipeline.

**Data Flow:**
AudioCapture.onChunk -> VAD.process -> if speech_ended: STT.transcribe -> transcript

**Acceptance Criteria:**
- [ ] Complete capture-to-text pipeline works
- [ ] Events flow correctly between components
- [ ] State managed properly

**Test Requirements:**
- Integration test: full pipeline with recorded audio
- Acceptance test (FR-1, FR-2): Voice -> text works end-to-end

## FR Coverage
- FR-1: Voice Capture (integration)
- FR-2: Speech-to-Text (T015, T017)

## Definition of Done
- All acceptance criteria checked
- All tests passing
- FR-2 latency requirement verified (<2s for <5s speech)
```

---

## Issue #4: M3 - OpenClaw Integration

**Title:** M3: OpenClaw Integration (T018-T021, T050)

**Labels:** `priority/p1`, `milestone/m3`

**Milestone:** M3: OpenClaw Integration

**Body:**
```markdown
## Overview

Implement OpenClaw gateway communication via CLI wrapper. CRITICAL: Never generate fake responses.

## Tasks

### T018: OpenClaw CLI Wrapper
**Priority:** P1 | **Dependencies:** T002, T006

Implement OpenClaw client per `openclaw_api.md`.

**Command:** `openclaw agent --agent main --message "text" --json`

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
- [ ] Uses configured gateway token successfully

**Test Requirements:**
- Unit test: CLI command construction
- Unit test: response parsing
- Unit test: error code handling
- Unit test: token propagation without leakage
- Integration test: actual OpenClaw call
- Acceptance test (FR-3): Full communication works

---

### T019: OpenClaw Health Check
**Priority:** P1 | **Dependencies:** T018

Implement gateway health check per `openclaw_api.md`.

**Command:** `openclaw gateway health`

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
**Priority:** P1 | **Dependencies:** T019

Continuous monitoring of OpenClaw connection status.

**Behavior:**
- Check health every 5 seconds
- Update ConversationState.openclaw_connected
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
**Priority:** P1 | **Dependencies:** T018

Ensure Scout NEVER generates fake responses.

**Implementation:**
- OpenClawClient returns null on any error
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
**Priority:** P1 | **Dependencies:** T018, T029

Define and implement session ID strategy for conversation continuity.

**Strategy:**
- Capture sessionId from OpenClaw responses
- Reuse session ID for subsequent requests
- Persist last successful session ID for reconnect
- Reset session ID when user starts new session

**Acceptance Criteria:**
- [ ] Multi-turn conversation reuses OpenClaw session context
- [ ] Session reset behavior is explicit and user-controlled
- [ ] Session metadata handled without leaking sensitive values

**Test Requirements:**
- Unit test: session ID extraction/parsing
- Unit test: reuse vs reset logic
- Integration test: identity/memory continuity across turns
- Integration test: reconnect resumes expected session

## FR Coverage
- FR-3: OpenClaw Communication (T018, T021)
- FR-8: Connection Status (T019, T020)
- NFR Privacy & Safety: No fake responses (T021)

## Definition of Done
- All acceptance criteria checked
- All tests passing
- Verified no code path generates fake responses
```

---

## Issue #5: M4 - Speech Synthesis (TTS, Jitter Buffer)

**Title:** M4: Speech Synthesis - TTS & Jitter Buffer (T022-T028)

**Labels:** `priority/p1`, `milestone/m4`

**Milestone:** M4: Speech Synthesis (TTS, Jitter Buffer)

**Body:**
```markdown
## Overview

Implement text-to-speech using Piper TTS with jitter buffer for smooth playback.

## Tasks

### T022: Piper TTS Installation
**Priority:** P1 | **Dependencies:** T001

Document and automate Piper TTS setup per `tts_piper.md`.

**Installation:** `pip install piper-tts`

**Voice Download:** en_US-lessac-medium.onnx + .onnx.json

**Acceptance Criteria:**
- [ ] Piper installs successfully
- [ ] Voice model downloads
- [ ] Test synthesis works

**Test Requirements:**
- Integration test: installation
- Integration test: synthesis produces audio

---

### T023: TTS Module (Piper wrapper)
**Priority:** P1 | **Dependencies:** T002, T022

Implement TTS module per `tts_piper.md`.

**Command:** `echo "text" | piper --model voice.onnx --output_raw`

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
- [ ] Piper cold-start mitigated (persistent process or warmed workers)

**Test Requirements:**
- Unit test: process spawning
- Unit test: text input
- Unit test: streaming output
- Unit test: interruption
- Performance test: <500ms to first audio
- Integration test: actual Piper synthesis

---

### T024: Sentence Chunking for Streaming TTS
**Priority:** P1 | **Dependencies:** T023

Implement sentence chunking per `algorithm_and_data_structures.md`.

**Algorithm:**
1. Split text into sentences using punctuation
2. For each sentence: send to Piper, stream audio to jitter buffer
3. Start playback after first sentence buffer fills

**Configuration:**
- sentence_delimiters: /[.!?]+/
- min_chunk_chars: 20

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
**Priority:** P1 | **Dependencies:** T005

Implement jitter buffer per `algorithm_and_data_structures.md`.

**Configuration:**
- buffer_size_ms: 500ms total capacity
- low_watermark_ms: 100ms (start playback threshold)
- frame_duration_ms: 20ms

**Algorithm:**
- On chunk received: write to ring buffer, start playback if >= low_watermark
- On playback tick: read frame, output; pad with silence on underrun
- On end-of-stream: drain remaining buffer

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
**Priority:** P2 | **Dependencies:** T025

Implement crossfade to prevent clicks at chunk boundaries.

**Implementation:** Short (5-10ms) linear fade between chunks when needed

**Acceptance Criteria:**
- [ ] No audible clicks at chunk boundaries
- [ ] Minimal processing overhead

**Test Requirements:**
- Unit test: crossfade algorithm
- Perceptual test: no clicks (manual)

---

### T027: TTS to Playback Pipeline
**Priority:** P1 | **Dependencies:** T011, T023, T024, T025

Wire TTS -> JitterBuffer -> AudioPlayback pipeline.

**Data Flow:**
TTS.synthesize -> JitterBuffer.write -> AudioPlayback.write

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
**Priority:** P2 | **Dependencies:** T023, T027

Handle TTS failure gracefully.

**Acceptance Criteria:**
- [ ] TTS errors caught
- [ ] Text displayed when TTS fails
- [ ] User informed of fallback

**Test Requirements:**
- Unit test: error handling
- Integration test: fallback behavior

## FR Coverage
- FR-4: Text-to-Speech (T023, T027)
- FR-5: Smooth Audio Playback (T025, T027)

## Definition of Done
- All acceptance criteria checked
- All tests passing
- FR-4 latency (<500ms) verified
- FR-5 smooth playback verified (no audible glitches)
```

---

## Issue #6: M5 - Session Management & Barge-in

**Title:** M5: Session Management & Barge-in (T029-T034)

**Labels:** `priority/p1`, `milestone/m5`

**Milestone:** M5: Session Management & Barge-in

**Body:**
```markdown
## Overview

Implement central session manager and barge-in (interrupt) support.

## Tasks

### T029: Session Manager Implementation
**Priority:** P1 | **Dependencies:** T007, T017, T021, T027

Implement central session manager per `system_architecture_and_data_flow.md`.

**Responsibilities:**
- Coordinate all components
- Manage state machine transitions
- Handle events from all modules
- Update UI/console feedback

**State Machine:**
- idle -> listening (session started or playback complete)
- listening -> processing (speech ended)
- processing -> speaking (response received)
- speaking -> listening (playback complete or barge-in)
- any -> idle (session ended or fatal error)

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
**Priority:** P1 | **Dependencies:** T013, T029

Implement barge-in per `algorithm_and_data_structures.md`.

**Algorithm:**
During playback:
1. Continue capturing microphone audio
2. Run VAD on captured audio
3. If speech_started: emit barge_in, stop TTS, clear buffer, stop playback, transition to listening

**Echo Mitigation (no AEC):**
- Raise VAD threshold during playback (0.5 -> 0.7)
- Require sustained speech (3+ consecutive frames)
- Document "use headphones for best experience"

**Configuration:**
- barge_in_enabled: true default
- barge_in_cooldown_ms: 200ms

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
**Priority:** P1 | **Dependencies:** T023, T025, T030

Ensure barge-in stops all output immediately.

**Actions on barge-in:**
1. TTS.stop() - cancel pending synthesis
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
**Priority:** P2 | **Dependencies:** T030

Prevent rapid repeated interrupts.

**Configuration:** barge_in_cooldown_ms: 200ms

**Acceptance Criteria:**
- [ ] Second interrupt within cooldown ignored
- [ ] Cooldown resets after legitimate interrupt

**Test Requirements:**
- Unit test: cooldown timing
- Unit test: reset behavior

---

### T033: Continuous Conversation Loop
**Priority:** P1 | **Dependencies:** T029, T030

Implement seamless conversation continuation.

**Flow:** idle -> listening -> processing -> speaking -> listening -> ...

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
**Priority:** P2 | **Dependencies:** T029

User controls for session management.

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

## FR Coverage
- FR-6: Barge-In Support (T030, T031)

## Definition of Done
- All acceptance criteria checked
- All tests passing
- FR-6 latency (<200ms) verified
- Multi-turn conversation working
```

---

## Issue #7: M6 - First-Run Setup, Error Handling & Features

**Title:** M6: First-Run Setup, Error Handling & Features (T035-T044, T051)

**Labels:** `priority/p2`, `milestone/m6`

**Milestone:** M6: First-Run Setup, Error Handling & Features

**Body:**
```markdown
## Overview

Implement first-run setup wizard, error handling, wake word, display modes, and latency instrumentation.

## Tasks

### T035: First-Run Detection
**Priority:** P2 | **Dependencies:** T006

Detect fresh installation. If config file missing -> trigger wizard.

**Acceptance Criteria:**
- [ ] Detects missing config
- [ ] Triggers setup wizard on first run
- [ ] Skips wizard if config exists

**Test Requirements:**
- Unit test: detection logic
- Integration test: wizard trigger

---

### T036: Setup Wizard - Gateway Configuration
**Priority:** P2 | **Dependencies:** T018, T035

Guide user through gateway setup.

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
- Unit test: token validation
- Integration test: authenticated connection test
- Acceptance test (FR-7): Wizard completes successfully

---

### T037: Setup Wizard - Audio Test
**Priority:** P2 | **Dependencies:** T010, T011, T036

Microphone and speaker test during setup.

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
**Priority:** P2 | **Dependencies:** T007, T029

Implement clear error messages per `prd.md` FR-9.

**Error Types:**
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
**Priority:** P2 | **Dependencies:** T020, T029

Handle network disconnections gracefully.

**Behavior:**
- Show "Connection lost" message
- Attempt reconnection with bounded exponential backoff (1s, 2s, 4s, max 5s)
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
**Priority:** P2 | **Dependencies:** T006

Ensure config survives restarts.

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
**Priority:** P2 | **Dependencies:** T006

Implement debug logging per user story #14.

**Configuration:**
- log_level: "debug" | "info" | "warn" | "error"
- log_to_file: boolean

**Acceptance Criteria:**
- [ ] Log levels work correctly
- [ ] File logging creates log file
- [ ] Useful debug information for troubleshooting

**Test Requirements:**
- Unit test: log level filtering
- Unit test: file writing
- Integration test: useful log output

---

### T042: Wake Word Support (FR-11)
**Priority:** P2 | **Dependencies:** T013, T029

Implement optional wake word activation per `prd.md` FR-11.

**Configuration:**
- wake_word_enabled: boolean (default: false)
- wake_word_phrase: string (default: "hey scout")

**Implementation:**
- Reuse VAD pipeline for continuous listening
- Simple keyword spotting (exact phrase match from STT)

**Acceptance Criteria:**
- [ ] FR-11: Wake phrase starts listening (when enabled)
- [ ] FR-11: Only manual activation when disabled (default)
- [ ] Wake phrase configurable
- [ ] False positive rate acceptable (manual test)

**Test Requirements:**
- Unit test: wake word detection logic
- Integration test: full wake word flow
- Manual test: false positive assessment

---

### T043: Display Mode Configuration (FR-12)
**Priority:** P2 | **Dependencies:** T006, T029

Implement configurable display modes per `prd.md` FR-12.

**Display Mode Behaviors:**
| Mode | User Speech | Agent Response | Status |
|------|-------------|----------------|--------|
| voice_only | Hidden | Hidden | Icon only |
| minimal | Hidden | Hidden | Text status |
| transcript | Shown | Shown | Full history |

**Configuration:** display_mode: "voice_only" | "minimal" | "transcript"

**Acceptance Criteria:**
- [ ] FR-12: Settings allow selecting display mode
- [ ] FR-12: Main screen reflects choice
- [ ] Preference persists across restarts
- [ ] Mode changes take effect immediately

**Test Requirements:**
- Unit test: display mode rendering logic
- Integration test: mode persistence
- Manual test: visual verification

---

### T044: Document Transport Priority (FR-13)
**Priority:** P3 | **Dependencies:** None

Document that FR-13 is handled by OpenClaw, not Scout.

**Clarification:**
Scout is a single voice transport. Multi-transport priority is OpenClaw's responsibility.

**Acceptance Criteria:**
- [ ] README documents OpenClaw handles multi-transport priority
- [ ] Architecture docs clarify Scout's role
- [ ] No implementation required

**Test Requirements:** None (documentation only)

---

### T051: Latency Instrumentation, Benchmarks & Thermal Degradation
**Priority:** P2 | **Dependencies:** T015, T023, T030, T039

Add explicit instrumentation and benchmark criteria for latency and thermal behavior.

**Instrumentation Points:**
- stt_start -> stt_done (FR-2)
- tts_start -> first_audio_out (FR-4)
- barge_in_detected -> playback_stopped (FR-6)

**Required Metrics:**
- P50/P95 for STT latency on short utterances
- P50/P95 for time-to-first-audio
- P50/P95 for barge-in stop latency

**Thermal/Load Strategy:**
- Detect sustained slowdowns
- Degrade gracefully (lighter model) where configured
- Never glitch silently; surface status in logs/UI

**Acceptance Criteria:**
- [ ] FR-2/FR-4/FR-6 latency metrics measurable
- [ ] Benchmark script produces repeatable output
- [ ] Thermal/load degradation strategy implemented

**Test Requirements:**
- Unit test: timestamp capture and duration computation
- Integration test: benchmark runner against recorded fixtures
- Manual test: simulated high-load behavior

## FR Coverage
- FR-7: First-Run Setup (T035, T036, T037)
- FR-8: Connection Status (T039)
- FR-9: Error Visibility (T038)
- FR-10: Config Persistence (T040)
- FR-11: Optional Wake Word (T042)
- FR-12: Configurable Display Mode (T043)
- FR-13: Transport Priority (T044)
- NFR Performance (T051)
- NFR Reliability (T039, T051)

## Definition of Done
- All acceptance criteria checked
- All tests passing
- Setup wizard tested manually
- All FRs in scope verified
```

---

## Issue #8: M7 - Documentation & README

**Title:** M7: Documentation & README (T045-T048)

**Labels:** `priority/p3`, `milestone/m7`

**Milestone:** M7: Documentation & README

**Body:**
```markdown
## Overview

Create comprehensive documentation for installation, configuration, troubleshooting, and customization.

## Tasks

### T045: README - Installation
**Priority:** P3 | **Dependencies:** All implementation tasks

Document complete installation process.

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
**Priority:** P3 | **Dependencies:** T045

Document configuration options.

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
**Priority:** P3 | **Dependencies:** T045

Document common issues and solutions.

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
**Priority:** P3 | **Dependencies:** T045

Document how to swap models.

**Sections:**
- Changing STT model (whisper sizes)
- Changing TTS voice (Piper voices)
- Adjusting VAD sensitivity

**Acceptance Criteria:**
- [ ] User stories #11, #12, #13 addressed
- [ ] Clear instructions for swapping components

## FR Coverage
- All FRs documented

## Definition of Done
- All acceptance criteria checked
- Manual test: fresh install following README succeeds
- Documentation reviewed by someone unfamiliar with project
```

---

## Commands to Create All Issues

```bash
# Note: Replace milestone numbers with actual IDs after creating milestones

# Issue #1 - M0
gh issue create --title "M0: Testing Infrastructure & Scaffolding (T001-T004)" \
  --label "priority/p0" \
  --milestone "M0: Testing Infrastructure & Scaffolding" \
  --body-file issue-m0.md

# Issue #2 - M1
gh issue create --title "M1: Core Data Structures & Audio I/O (T005-T011, T049)" \
  --label "priority/p0" \
  --milestone "M1: Core Data Structures & Audio I/O" \
  --body-file issue-m1.md

# Issue #3 - M2
gh issue create --title "M2: Speech Processing - VAD & STT (T012-T017)" \
  --label "priority/p1" \
  --milestone "M2: Speech Processing (VAD, STT)" \
  --body-file issue-m2.md

# Issue #4 - M3
gh issue create --title "M3: OpenClaw Integration (T018-T021, T050)" \
  --label "priority/p1" \
  --milestone "M3: OpenClaw Integration" \
  --body-file issue-m3.md

# Issue #5 - M4
gh issue create --title "M4: Speech Synthesis - TTS & Jitter Buffer (T022-T028)" \
  --label "priority/p1" \
  --milestone "M4: Speech Synthesis (TTS, Jitter Buffer)" \
  --body-file issue-m4.md

# Issue #6 - M5
gh issue create --title "M5: Session Management & Barge-in (T029-T034)" \
  --label "priority/p1" \
  --milestone "M5: Session Management & Barge-in" \
  --body-file issue-m5.md

# Issue #7 - M6
gh issue create --title "M6: First-Run Setup, Error Handling & Features (T035-T044, T051)" \
  --label "priority/p2" \
  --milestone "M6: First-Run Setup, Error Handling & Features" \
  --body-file issue-m6.md

# Issue #8 - M7
gh issue create --title "M7: Documentation & README (T045-T048)" \
  --label "priority/p3" \
  --milestone "M7: Documentation & README" \
  --body-file issue-m7.md
```

---

## Priority Labels

Create these labels before creating issues:

```bash
gh label create "priority/p0" --description "Critical - must be done first" --color "d73a4a"
gh label create "priority/p1" --description "High - core pipeline" --color "fbca04"
gh label create "priority/p2" --description "Medium - features" --color "0e8a16"
gh label create "priority/p3" --description "Low - polish/docs" --color "c5def5"
```

---

## Summary

| Issue | Milestone | Priority | Tasks | FR Coverage |
|-------|-----------|----------|-------|-------------|
| #1 | M0 | P0 | T001-T004 | Infrastructure |
| #2 | M1 | P0 | T005-T011, T049 | FR-1, FR-10 |
| #3 | M2 | P1 | T012-T017 | FR-1, FR-2 |
| #4 | M3 | P1 | T018-T021, T050 | FR-3, FR-8, NFR Privacy |
| #5 | M4 | P1 | T022-T028 | FR-4, FR-5 |
| #6 | M5 | P1 | T029-T034 | FR-6 |
| #7 | M6 | P2 | T035-T044, T051 | FR-7, FR-9-13, NFR |
| #8 | M7 | P3 | T045-T048 | Documentation |

**Total Tasks:** 51
**Critical Path:** M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7
