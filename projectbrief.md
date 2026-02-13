# Project Brief: Scout Android Companion + OpenClaw Runtime

## 0) Quick Access

```bash
# SSH to Saga (Termux)
ssh -p 8022 192.168.68.70

# Key paths on device
~/.openclaw/workspace/         # Agent workspace
~/.openclaw/workspace/scout/   # Local voice layer (to build)
~/.openclaw/workspace/voice/   # Existing Discord voice code
~/.openclaw/openclaw.json      # OpenClaw config (gateway token here)

# OpenClaw gateway
curl http://localhost:18789/health  # Check if running
```

## 1) Mission

Build an Android app/system that can be installed on any modern Android phone and connect to a running OpenClaw agent for realtime voice + assistant features.

Product goal (non-negotiable):

**GIVEN** an Android phone with an OpenClaw agent running  
**THEN** the user can install our app  
**SO THAT** they can use all app features on their phone with their OpenClaw agent.

The system must support:
- realtime voice conversation with minimal latency
- natural, stable speech output (no chopped voice)
- visual avatar output (lipsynced 3D pixar style comic lobster)
- environmental awareness through phone sensors/camera/mic
- install + first-run setup from a README without custom engineering help

## 2) Non-Negotiable Product Constraint

OpenClaw remains the single source of truth for agent identity, memory, reasoning, and tool use.

This is mandatory:
- we do not replace the OpenClaw agent brain
- we do not fork personality/memory logic into the app
- the Android app is an I/O and realtime media layer around OpenClaw
- OpenClaw and app must be updatable independently

If OpenClaw is unavailable, the app must not impersonate the agent with a fallback LLM response.

## 3) Current State and Key Gap

### 3.1 Device Specifications (Confirmed)

Reference device: OSOM Solana Saga (used for validation)
- CPU: 8 cores (aarch64)
- RAM: 11GB total, ~7GB available
- Storage: 435GB available
- OS: Android 12 (kernel 5.10.198)
- Access: SSH via Termux on port 8022

### 3.1b Compatibility Target (Product Requirement)

Primary support target is not one single phone model. The app must install and run on **modern Android phones** that meet baseline requirements below.

### 3.2 Existing Infrastructure (Confirmed)

OpenClaw is already running on device:
- Installation: `npm install -g openclaw` (version 2026.2.9)
- Gateway: `localhost:18789` with token auth
- Updates: `npm update -g openclaw` (independent of voice layer)
- Workspace: `~/.openclaw/workspace/`

Termux environment:
- Node.js 25.3.0, Python 3.12
- clang, cmake (for building whisper.cpp, llama.cpp)
- termux-api (mic recording, camera, sensors)
- pulseaudio (audio playback)
- Discord bot already configured

### 3.3 Current Voice Pipeline Gap

The current `voice/discord-voice-v6.mjs` pipeline is stable but:
- Uses **cloud** ElevenLabs for STT and TTS (not local)
- Calls Anthropic API directly (bypasses OpenClaw gateway)
- Turn-based: STT -> LLM -> TTS in sequence
- Fixed silence endpointing
- No true duplex streaming
- No robust barge-in control

Result: acceptable functionality, but not local and not minimum-latency.

### 3.4 Minimum Hardware + Software Requirements (README Contract)

The README must define these as baseline requirements for a supported install:

| Category | Minimum | Recommended | Why it matters |
|----------|---------|-------------|----------------|
| Android version | Android 11+ | Android 13+ | Foreground service + media reliability |
| CPU ABI | arm64-v8a | Recent Snapdragon/Dimensity Tensor-class | Local audio/media workloads |
| RAM | 6 GB | 8 GB+ | STT/TTS buffers + app + OpenClaw runtime |
| Free storage | 2 GB | 6 GB+ | Models, logs, and app updates |
| Battery state | >20% while active | charging during long sessions | Prevent throttling/background kills |
| Network | Wi-Fi or stable LTE/5G | Wi-Fi | OpenClaw gateway/API connectivity |
| OpenClaw runtime | Installed and running | Latest stable | Required agent source-of-truth |
| Audio path | Working mic + speaker/BT | Wired/low-latency headset | Realtime UX and feedback control |

## 4) Target Architecture (Final)

### 4.1 Core Principle

Split the system into:
- OpenClaw Agent Runtime (brain)
- Realtime Media Layer (voice + UI + sensors)
- Transport Adapters (Discord and local device)

All roads lead to the same OpenClaw session model.

### 4.2 Components

1. OpenClaw Runtime (existing)
- owns memory, identity, tools, state, decisions
- exposes local realtime/session API

2. Android Foreground Companion App (new)
- captures mic/camera/sensors with Android-native APIs
- runs low-latency audio scheduling and playback
- performs local STT/TTS/media processing
- renders lobster avatar and lipsync
- streams user intent/events to OpenClaw and renders OpenClaw responses

3. Discord Voice Adapter (existing/new)
- joins Discord voice channels
- streams audio to the same realtime pipeline
- outputs OpenClaw responses to Discord

### 4.3 Single Agent Contract

The app and Discord adapter are clients of OpenClaw.
They cannot generate agent reasoning independently.

## 5) Why Native Foreground App Is Required

For low jitter and robust realtime behavior on Android, the media path must not depend on Node event-loop timing.

The native app should:
- run as foreground service
- keep wake locks appropriately
- use low-latency audio APIs (AAudio/Oboe)
- isolate capture, inference, and playback threads
- maintain strict frame timing (20ms pipeline cadence)

No Play Store approval is required for initial deployment if sideloaded.
Only standard runtime permissions are needed (mic/camera/notifications/foreground service).

### 5.1 Installability Definition of Done

This project is only "done" when a non-developer can:
1. start from a stock supported Android phone,
2. install OpenClaw runtime (or connect to an already running local OpenClaw),
3. install the Scout APK,
4. complete first-run pairing,
5. place a realtime voice request and receive a valid OpenClaw response.

If any step requires editing source code, the installability goal is not met.

## 6) Fully Local Priority (Over Maximum Naturalness)

Priority order:
1. fully local
2. lowest latency
3. highest naturalness within local constraints

### 6.1 Confirmed Local Stack for Saga

| Component | Tool | Model/Config | Notes |
|-----------|------|--------------|-------|
| VAD | Silero VAD | ONNX v4 | ~2ms per frame, Node/Python |
| STT | whisper.cpp | tiny.en or base.en | Build for aarch64, ~1-2s for short utterance |
| LLM | OpenClaw gateway | Claude via API | Not local, but required for agent brain |
| TTS | Piper TTS | en_US-lessac-medium | ONNX, ~200ms first chunk |

Note: LLM runs through OpenClaw (cloud) per section 2 constraints. Local llama.cpp only if OpenClaw adds local model support.

### 6.2 Build Requirements

```bash
# On device (via SSH)
pkg install cmake clang

# whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make -j8
./models/download-ggml-model.sh tiny.en

# Piper TTS
pip install piper-tts
```

Cloud voices/services can remain optional fallback profiles, not default.

### 6.3 README Setup + Installation Flow (Must Exist in Repo)

The repo README must include these exact install sections:

1. **Prerequisites**
   - Supported Android versions and hardware baseline (from section 3.4)
   - Required tools: Termux, Node.js, OpenClaw, optional Python/pip for local TTS
   - Permission list and why each permission is needed

2. **OpenClaw Setup**
   - Install/update OpenClaw
   - Start gateway and verify with `curl http://localhost:18789/health`
   - Confirm token/auth configuration location

3. **App Installation**
   - Sideload APK (`adb install` and on-device APK install path)
   - Enable unknown app installs where needed
   - Confirm ABI compatibility (`arm64-v8a`)

4. **First-Run Pairing**
   - Enter gateway URL/token
   - Run connection test
   - Run microphone/speaker test
   - Save and start session

5. **Verification Checklist**
   - "Connected to OpenClaw" status visible
   - Voice roundtrip works
   - Tool/event path works (at least one tool-backed reply)
   - Session history persists and matches OpenClaw identity

6. **Troubleshooting**
   - Gateway unreachable
   - Permission denied (mic/camera/background)
   - Audio stutter/chopped playback
   - Thermal throttling/performance fallback behavior

## 7) Chopped Voice Mitigation Plan (Critical)

This is a first-class engineering objective.

Required mitigations:
- jitter buffer with start/stop watermarks
- fixed-size frame clock for decode/synthesis/playback
- never terminate playback stream by arbitrary timeout mid-utterance
- explicit end-of-speech and end-of-stream signaling
- small crossfades at chunk boundaries to remove clicks
- preallocated ring buffers (avoid GC/memory churn)
- dedicated realtime-priority processing threads
- immediate barge-in cancel path with graceful buffer drain
- AEC/NS/AGC to prevent feedback and retriggers

Success criterion: continuous speech with no audible chopping under normal network/device load and during interruptions.

## 8) OpenClaw Integration Contract (Versioned API)

Define a strict local API boundary (example event model):

Inbound to OpenClaw:
- `session.start`
- `user.transcript.partial`
- `user.transcript.final`
- `sensor.update`
- `vision.summary` (or frame-derived descriptors)

Outbound from OpenClaw:
- `assistant.text.partial`
- `assistant.text.final`
- `assistant.style` (optional prosody/emotion hints)
- `tool.intent`
- `session.state`

Rules:
- OpenClaw is authoritative for assistant text/content
- media layer is authoritative for waveform rendering/playback/lipsync
- protocol versioning enables independent updates

## 9) Discord + Device Coexistence

Both channels must share the same OpenClaw agent state.

Design:
- one OpenClaw-backed conversation state model
- Discord and phone treated as transport endpoints
- optional handoff rules (for example, prioritize local session if both active)

Outcome:
- same identity, same memory, same behavior across Discord and on-device voice

## 10) Avatar and Sensor Roadmap

Phase A:
- basic local voice loop with stable playback
- simple mouth-open/mouth-closed based on audio energy

Phase B:
- viseme timing from TTS/alignment for better lipsync
- expressive lobster states (idle/listening/speaking/thinking)

Phase C:
- camera/sensor context integration into OpenClaw events
- richer persona behaviors tied to environment

## 11) Delivery Phases

### Phase 0: Termux-Based Local Voice MVP (Current Priority)

Build in `~/.openclaw/workspace/scout/` — pure I/O layer, no AGENTS.md changes.

Components:
- `local-voice.mjs` — main orchestrator
- `stt.mjs` — whisper.cpp wrapper (build for aarch64)
- `tts.mjs` — Piper TTS wrapper (ONNX, fast)
- `openclaw-client.mjs` — connects to existing gateway on :18789
- `audio-buffer.mjs` — jitter buffer, crossfade (anti-chop)

Audio I/O:
- Input: `termux-microphone-record` (opus/aac)
- Output: pulseaudio playback

Why Termux first:
- Rapid iteration over SSH (no Android Studio)
- Test full pipeline before native optimization
- Validates OpenClaw API contract
- Independent updates preserved (npm for OpenClaw, git for scout)

### Phase 1: Realtime Foundation (Native)

If Termux latency is insufficient:
- Native foreground service (Kotlin)
- AAudio/Oboe for low-latency audio
- JNI bindings to whisper.cpp/llama.cpp
- Chopped-voice mitigation primitives
- install wizard + diagnostics screen for non-technical setup

### Phase 2: Full Local Intelligence Loop
- Local VAD/STT/LLM/TTS wired end-to-end
- OpenClaw API contract fully implemented
- Fallback: graceful "OpenClaw unavailable" state (no fake responses)
- release-ready README install flow validated on at least 3 Android models

### Phase 3: Multi-Transport Unification
- Discord adapter uses same OpenClaw session infrastructure
- Handoff between local and Discord when both active

### Phase 4: Avatar + Sensor Intelligence
- Lobster rendering, lipsync, sensor-driven context

## 12) Performance Targets

Primary UX targets:
- first audible response starts as early as feasible after end-of-user-turn
- interruption response is immediate and clean
- no audible stream chopping/clicking in continuous speech
- stable operation under mobile thermal and battery constraints

Operational targets:
- graceful degradation under load (quality scales down before glitching)
- deterministic buffering behavior
- no identity drift from OpenClaw source-of-truth model

## 13) Risks and Controls

Risk: thermal throttling on prolonged local inference
- control: dynamic quality tiers, model-size fallback, frame budget monitoring

Risk: audio glitches from buffer underruns
- control: strict jitter policy, watermark tuning, profiling on device

Risk: architecture drift away from OpenClaw authority
- control: hard API contract, validation tests, "no local agent text generation" rule

Risk: Discord and local session desynchronization
- control: centralized OpenClaw session IDs and transport arbitration

## 14) Decision Summary

We will build a local voice layer in phases:

1. **Phase 0 (now):** Termux-based pipeline in `~/.openclaw/workspace/scout/`
   - Local STT (whisper.cpp) + Local TTS (Piper)
   - Connects to OpenClaw gateway on localhost:18789
   - Rapid iteration over SSH, no Android Studio needed

2. **Phase 1+ (if needed):** Native Android app for lower latency
   - Only if Termux audio latency is insufficient
   - AAudio/Oboe for sub-20ms audio

OpenClaw remains the non-negotiable agent brain.
The system is optimized first for fully local operation, then latency, then naturalness.
Discord remains supported via the same OpenClaw-backed architecture.

Installability across modern Android devices is a first-class product requirement, not a "nice to have."

### Independent Update Paths (Confirmed)

```
OpenClaw:  npm update -g openclaw     # updates agent brain
Scout:     git pull (workspace/scout) # updates voice layer
```

No coupling. API contract is the boundary.

Reference models for local experimentation:
- TTS: Piper (piper-tts), or https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice
- STT: whisper.cpp tiny.en / base.en
