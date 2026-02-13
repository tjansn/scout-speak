# Scout Implementation Plan

## Executive Summary

This document defines the complete implementation roadmap for Scout Phase 0 - a Termux-based local voice pipeline for Android that connects to OpenClaw. The plan addresses all gaps between the current state (no Scout implementation exists) and the comprehensive specifications.

### Current State Analysis (Verified 2026-02-13)

**Project Status:** M6 COMPLETE. M7 PENDING.

**Plan Verification:** All 12 specification files reviewed. All 51 tasks verified against specs. Priority order confirmed correct per backpressure.md. No blocking gaps identified.

### Implementation Progress

**M0: Testing Infrastructure & Scaffolding - COMPLETE (2026-02-13)**
- T001: Project Scaffolding ✓
  - Directory structure created (src/, tests/)
  - package.json with scripts configured
  - ESLint configuration (eslint.config.mjs)
  - TypeScript configuration (tsconfig.json)
  - .gitignore updated

- T002: Unit Test Framework Setup ✓
  - Node.js built-in test runner configured
  - Test utilities created (tests/test-utils.mjs)
  - Example tests demonstrating patterns
  - npm test script working

- T003: Pre-commit Hooks Setup ✓
  - Husky configured for pre-commit
  - Lint, typecheck, and unit tests run on commit
  - Secret detection patterns added

- T004: Acceptance Test Framework (Gherkin) ✓
  - Cucumber.js configured
  - OpenClaw communication feature file created
  - Step definitions and World implemented
  - All acceptance tests passing

**M1: Core Data Structures & Audio I/O - COMPLETE (2026-02-13)**
- T005: AudioBuffer (Ring Buffer) ✓
  - O(1) read/write ring buffer implementation
  - Watermark support for jitter buffer
  - msToSamples/samplesToMs utilities

- T006: Config Schema and Validation ✓
  - Complete config schema with JSDoc types
  - Validation rules for all fields
  - Load/save config functions
  - Localhost-only gateway URL enforcement

- T007: ConversationState Data Structure ✓
  - State machine with valid transitions
  - Events: stateChange, error, connectionChange
  - Methods: startListening, startProcessing, startSpeaking, bargeIn

- T008: VADState Data Structure ✓
  - Speech probability threshold handling
  - Silence duration tracking
  - Minimum speech duration filtering
  - Barge-in mode with elevated threshold

- T009: PulseAudio Availability Check ✓
  - isPulseAudioRunning check
  - startPulseAudio function
  - ensurePulseAudio with error handling
  - Tool availability checks

- T010: Audio Capture Module (parecord) ✓
  - parecord process spawning
  - Chunk-based audio streaming
  - Event-based interface

- T011: Audio Playback Module (pacat) ✓
  - pacat process spawning
  - Write with backpressure handling
  - Immediate stop for barge-in

**M2: Speech Processing (VAD, STT) - COMPLETE (2026-02-13)**
- T012: Silero VAD Model Loading ✓
  - src/vad/silero-vad.mjs implementation
  - ONNX model loading via onnxruntime-node
  - Speech probability inference per frame

- T013: VAD Processing Pipeline ✓
  - src/vad/vad-processor.mjs implementation
  - Speech start/end detection with configurable thresholds
  - Silence duration tracking and minimum speech filtering

- T014: whisper.cpp Build and Setup ✓
  - Documentation and specs provided
  - Build process documented for aarch64/Termux
  - Model download automation

- T015: STT Module (whisper.cpp wrapper) ✓
  - src/stt/stt.mjs implementation
  - WAV file creation and CLI invocation
  - Output parsing and error handling

- T016: STT Empty/Garbage Detection ✓
  - isGarbageTranscript function in stt.mjs
  - Empty string and noise pattern detection
  - "Didn't catch that" fallback handling

- T017: Audio Capture to STT Integration ✓
  - src/stt/speech-pipeline.mjs implementation
  - Complete AudioCapture -> VAD -> STT pipeline
  - Event-based interface with proper state management

**M3: OpenClaw Integration - COMPLETE (2026-02-13)**
- T018: OpenClaw CLI Wrapper ✓
  - src/openclaw/openclaw-client.mjs implementation
  - CLI command construction via spawn
  - Response parsing with error handling
  - Gateway token via environment variable
  - Events: sending, received, error, session_reset

- T019: OpenClaw Health Check ✓
  - Health check via `openclaw gateway health` command
  - Boolean health status return
  - Timeout handling

- T020: Connection Status Monitoring ✓
  - src/openclaw/connection-monitor.mjs implementation
  - Periodic health check polling (configurable interval)
  - ConversationState.openclaw_connected updates
  - Events: connected, disconnected, error

- T021: Never Fake Responses Enforcement ✓
  - OpenClawClient returns null on any error
  - No fallback text generation paths
  - All error cases propagate to error handlers

- T050: Session Strategy & Identity Continuity ✓
  - src/session/session-persistence.mjs implementation
  - Integration with SessionManager to restore session ID on init
  - Auto-save session ID to config on successful OpenClaw response
  - resetSession() method for user-initiated session reset
  - last_session_id config field added
  - Comprehensive unit tests in tests/unit/session/session-persistence.test.mjs

**M4: Speech Synthesis (TTS, Jitter Buffer) - COMPLETE (2026-02-13)**
- T022: Piper TTS Installation ✓
  - Documentation and setup provided in specs/tts_piper.md
  - pip install piper-tts documented
  - Voice model download instructions included

- T023: TTS Module (Piper wrapper) ✓
  - src/tts/tts.mjs implementation
  - Streaming audio synthesis via piper CLI
  - Support for interruption (barge-in)
  - Configurable sample rate

- T024: Sentence Chunking for Streaming TTS ✓
  - src/tts/sentence-chunker.mjs implementation
  - Split text into sentences using punctuation
  - Minimum chunk characters configurable
  - Enables streaming playback

- T025: Jitter Buffer Implementation ✓
  - src/tts/jitter-buffer.mjs implementation
  - Ring buffer with watermarks
  - Silence padding on underrun
  - Clear for barge-in support
  - FR-5: Continuous audio with no cuts/glitches

- Streaming TTS Orchestrator ✓
  - src/tts/streaming-tts.mjs implementation
  - Orchestrates TTS, sentence chunking, and jitter buffer
  - Coordinates streaming pipeline components

- T027: TTS to Playback Pipeline ✓
  - src/tts/tts-playback-pipeline.mjs implementation
  - Orchestrates StreamingTTS + JitterBuffer + AudioPlayback
  - Playback loop reads frames from jitter buffer, writes to pacat
  - Barge-in support via stop() method
  - Events: speaking_started, speaking_complete, speaking_stopped, ready, underrun, error

- T026: Audio Crossfade at Chunk Boundaries ✓
  - src/audio/crossfade.mjs - AudioCrossfader class implementation
  - Linear crossfade algorithm (5-10ms duration)
  - process() method for streaming chunk processing
  - reset() method for barge-in handling
  - applyCrossfadeBetween() utility for one-shot crossfades
  - JitterBuffer integration with crossfadeMs and crossfadeEnabled config
  - Automatic crossfade on write() between consecutive chunks
  - Crossfader reset on clear() and reset() for barge-in support
  - Stats tracking (chunksProcessed, crossfadeEnabled)
  - Full test coverage in tests/unit/audio/crossfade.test.mjs (12 test cases)
  - Additional tests in tests/unit/tts/jitter-buffer.test.mjs (12 test cases for T026)

- T028: TTS Fallback to Text Display ✓
  - src/ui/console-ui.mjs updated with showTtsFallback() method
  - tts_fallback event handler added to ConsoleUI._setupEventHandlers()
  - Shows "[Audio unavailable - showing text]" notice and response text
  - Displays in ALL display modes (since audio is unavailable)
  - Full test coverage in tests/unit/ui/console-ui.test.mjs
  - Integration tests in tests/unit/session/session-manager.test.mjs

**M5: Session Management & Barge-in - COMPLETE (2026-02-13)**
- T029: Session Manager Implementation ✓
  - src/session/session-manager.mjs implementation
  - tests/unit/session/session-manager.test.mjs comprehensive unit tests
  - Central orchestrator for voice conversations
  - Coordinates SpeechPipeline, OpenClawClient, TtsPlaybackPipeline, ConnectionMonitor
  - State machine: idle -> listening -> processing -> speaking -> listening (loop)
  - Barge-in support via speech detection during playback
  - Events: state_changed, transcript, response, speaking_started, speaking_complete, barge_in, error

- T030: Barge-in Detection ✓
  - VADProcessor handles barge-in mode with elevated threshold (0.5 -> 0.7)
  - Requires 3+ consecutive speech frames for barge-in trigger
  - SessionManager._handleBargeIn() coordinates stopping TTS and transitioning state
  - Cooldown/debounce implemented via bargeInCooldownMs config (default 200ms)
  - bargeInEnabled config option to toggle feature on/off
  - Tests: barge-in event emission, TTS stopping, state transition, cooldown behavior

- T031: Barge-in Stops TTS and Playback ✓
  - TTS.stop() cancels pending synthesis via StreamingTTS.stop()
  - JitterBuffer.clear() discards buffered audio via _stopPlayback()
  - AudioPlayback.stop() stops output immediately
  - State transitions to "listening"
  - Tests: TTS cancellation, state transition

- T032: Barge-in Cooldown (Debounce) ✓ (merged into T030)
  - bargeInCooldownMs config (default 200ms) prevents rapid repeated interrupts
  - _lastBargeInTime tracking in SessionManager
  - Tests: cooldown within period ignored, cooldown expiration allows new barge-in

- T033: Continuous Conversation Loop ✓
  - speaking -> listening on playback complete (playbackComplete event)
  - speaking -> listening on barge-in (bargeIn event)
  - Loop continues until session ended
  - Tests: multi-turn conversation integration test

- T034: Session Start/Stop Controls ✓
  - pause() method for temporary suspension (preserves state/session)
  - resume() method to continue after pause
  - isPaused getter and paused status in getStats()
  - Full test coverage in tests/unit/session/session-manager.test.mjs

**M6: First-Run Setup, Error Handling & Features - COMPLETE (2026-02-13)**
- T035: First-Run Detection ✓
  - src/config/first-run.mjs implementation
  - FirstRunDetector class with check() method
  - Detects missing config, invalid JSON, validation errors
  - Events: first_run_detected, config_valid, config_invalid
  - Helper functions: isFirstRun(), checkFirstRun()
  - Full test coverage (32 tests)

- T036: Setup Wizard - Gateway Configuration ✓
  - src/setup/setup-wizard.mjs implementation
  - SetupWizard class with interactive CLI wizard
  - Prompts for gateway URL (validates localhost-only)
  - Prompts for gateway token
  - Tests connection via OpenClawClient.healthCheck()
  - saveWizardConfig() creates config file with defaults
  - Events: started, step_complete, connection_success, connection_failed, completed, cancelled
  - Full test coverage (18 tests)

- T037: Setup Wizard - Audio Test ✓
  - src/setup/audio-test.mjs implementation
  - AudioTest class for microphone and speaker testing
  - testMicrophone() records audio sample using AudioCapture
  - testSpeaker() plays back recorded audio using AudioPlayback
  - runFullTest() orchestrates complete audio hardware verification
  - generateTestTone() creates test tones for speaker-only testing
  - PulseAudio availability checking via ensurePulseAudio()
  - Events: mic_test_started, mic_test_complete, speaker_test_started, speaker_test_complete, test_started, test_complete
  - Full test coverage (26 tests) in tests/unit/setup/audio-test.test.mjs

- T038: Error Message System ✓
  - src/errors/error-messages.mjs implementation
  - ErrorCode enum with all failure scenario codes
  - ErrorMessageHandler class for centralized error handling
  - User-friendly error messages for all scenarios per PRD FR-9:
    - "Cannot reach OpenClaw" for gateway unreachable
    - "Didn't catch that" for STT empty/garbage
    - "Connection lost" for network drops
    - "Text-to-speech failed" with text fallback suggestion
    - "Microphone access denied" with permission explanation
  - Each error includes actionable suggestions for tinkerers
  - isRecoverable() to distinguish transient vs fatal errors
  - formatErrorForDisplay() for consistent output formatting
  - Error history tracking with getErrorHistory(), getErrorsByType()
  - Full test coverage (55 tests) in tests/unit/errors/error-messages.test.mjs

- T039: Connection Lost Recovery ✓
  - src/openclaw/connection-recovery.mjs implementation
  - ConnectionRecovery class for automatic reconnection with exponential backoff
  - Deterministic retry policy documented:
    - Initial delay: 1000ms
    - Multiplier: 2x (1s, 2s, 4s, 5s max)
    - Maximum delay: 5000ms (per PRD NFR Reliability)
    - Maximum attempts: 10 (~30s total recovery window)
  - calculateBackoffDelay() for exponential backoff calculation
  - getBackoffSchedule() returns full schedule for transparency
  - calculateMaxRecoveryTime() calculates worst-case recovery time
  - Events: recovery_started, attempt, attempt_failed, recovered, recovery_failed, recovery_cancelled
  - Brief disconnections (<5s) do not crash session per PRD NFR Reliability
  - Full test coverage (36 tests) in tests/unit/openclaw/connection-recovery.test.mjs

- T040: Config Persistence (FR-10) ✓
  - src/config/config-persistence.mjs implementation
  - ConfigPersistence class for reliable configuration storage
  - FR-10: Gateway URL preserved after restart ✓
  - FR-10: Gateway token preserved securely after restart ✓
  - All settings preserved across restarts ✓
  - Corruption detection via JSON validation and checksums ✓
  - Automatic backup creation before writes
  - Backup restoration on corruption detection
  - Atomic writes (write to temp, then rename) for crash safety
  - External change detection via checksum comparison
  - Events: loaded, saved, backup_created, backup_restored, corruption_detected, error
  - Full test coverage (37 tests) in tests/unit/config/config-persistence.test.mjs

- T041: Logging System ✓
  - src/utils/logger.mjs implementation
  - Logger class with level filtering (debug, info, warn, error)
  - File logging support with automatic directory creation
  - Colored console output (ANSI codes)
  - Component child loggers for module-specific logging
  - Global singleton pattern with configure/resetGlobal methods
  - createLoggerFromConfig() for Scout config integration
  - getLogger() convenience function for component loggers
  - Full test coverage (21 tests) in tests/unit/utils/logger.test.mjs

- T042: Wake Word Support (FR-11) ✓
  - src/wakeword/wake-word-detector.mjs implementation
  - WakeWordDetector class with STT-based keyword spotting
  - ConversationState updated with waiting_for_wakeword state
  - SessionManager integration with wake word mode (enableWakeWordMode, disableWakeWordMode)
  - Runtime wake word enable/disable/setPhrase methods
  - Continuous low-power listening using VAD pipeline
  - Simple keyword spotting via exact phrase match from STT
  - Configurable wake phrase (default: "hey scout")
  - Events: wake_word_detected, listening_started, error
  - Full test coverage in tests/unit/wakeword/wake-word-detector.test.mjs
  - Integration tests in tests/unit/session/session-manager.test.mjs

- T051: Latency Instrumentation, Benchmarks & Thermal Degradation ✓
  - src/utils/latency-metrics.mjs implementation
  - LatencyMetrics class for tracking STT, TTS, and barge-in latencies
  - P50/P95 percentile calculation with configurable targets
  - Target thresholds: STT <2000ms, TTS <500ms, Barge-in <200ms
  - Events: stt_recorded, tts_recorded, barge_in_recorded, target_exceeded
  - src/utils/performance-monitor.mjs implementation
  - PerformanceMonitor class for thermal/load degradation detection
  - Baseline establishment with automatic level adjustment
  - Levels: normal, degraded, critical with configurable thresholds
  - Events: baseline_established, level_changed, recommendation
  - Graceful degradation recommendations per level
  - scripts/benchmark.mjs for repeatable latency testing
  - CLI args: --iterations, --output (json|text), --verbose
  - Outputs P50/P95 statistics for all latency categories
  - Full test coverage in tests/unit/utils/latency-metrics.test.mjs (52 tests)
  - Full test coverage in tests/unit/utils/performance-monitor.test.mjs (32 tests)

- T044: Document Transport Priority (FR-13) ✓
  - Multi-Transport Priority section added to specs/system_architecture_and_data_flow.md
  - README.md updated with transport priority explanation
  - Scout's role as single voice transport clarified
  - OpenClaw Gateway's responsibility for transport arbitration documented
  - No implementation code needed - documentation only

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
- Pre-commit hooks (T003) with fix for documentation-only commits (added `|| true` to grep pipeline to handle cases where no source files match)

**What Remains:**
- M7 (Documentation) tasks T045-T048

---

## Milestone Overview

| Milestone | Description | Tasks | Priority | Status |
|-----------|-------------|-------|----------|--------|
| M0 | Testing Infrastructure & Scaffolding | T001-T004 | P0 (Foundation) | COMPLETE |
| M1 | Core Data Structures & Audio I/O | T005-T011, T049 | P0 (Foundation) | COMPLETE |
| M2 | Speech Processing (VAD, STT) | T012-T017 | P1 (Core) | COMPLETE |
| M3 | OpenClaw Integration | T018-T021, T050 | P1 (Core) | COMPLETE |
| M4 | Speech Synthesis (TTS, Jitter Buffer) | T022-T028 | P1 (Core) | COMPLETE |
| M5 | Session Management & Barge-in | T029-T034 | P1 (Core) | COMPLETE |
| M6 | First-Run Setup, Error Handling & Features | T035-T044, T051 | P2 (Features) | COMPLETE |
| M7 | Documentation & README | T045-T048 | P3 (Polish) | PENDING |

---

## M7: Documentation & README (PENDING)

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

### Risk Areas
1. **whisper.cpp compilation on aarch64** - May have build issues
2. **Silero VAD ONNX runtime** - Compatibility with Termux
3. **Audio latency** - PulseAudio may introduce latency; may need tuning
4. **Barge-in echo** - Without AEC, may have false triggers

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
