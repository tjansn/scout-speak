# Product Requirements Document: Scout

## 1. Problem Statement

Tinkerers who run their own AI agents (via OpenClaw) have no good way to talk to them using voice on their phone.

Cloud voice assistants are locked down — you can't point Siri, Google, or Alexa at your own agent. The phone becomes a second-class citizen: you can type to your agent, or use it through Discord, but you can't just talk to it while your hands are busy.

This means: no voice interaction while cooking, driving, walking, or working on something. You have to stop what you're doing, pick up the phone, and type.

---

## 2. Context & Why Now

**Why this matters:**
- OpenClaw already runs on Android (via Termux) — the agent brain exists
- Local STT/TTS models (whisper.cpp, Piper) now run acceptably on phone hardware
- Tinkerers want control over their voice stack, not another black-box service
- Hands-free interaction is increasingly expected but not available for custom agents

**What changes if solved:**
- Your OpenClaw agent becomes accessible anywhere you have your phone
- Voice becomes a natural way to interact, not a luxury feature
- The platform becomes extensible — others can build on top of it

---

## 3. Outcome (Success Definition)

### Observable End-States

1. User speaks to their phone; OpenClaw agent responds with voice
2. Conversation feels natural — no chopped audio, no long pauses
3. Agent personality and memory are consistent (same agent as Discord/web)
4. User can swap STT/TTS components without rebuilding everything
5. Another tinkerer can set it up from the README in an afternoon

### "Done" Means...

- [ ] Non-developer can install OpenClaw + Scout APK on a supported Android phone
- [ ] First-run pairing connects Scout to the running OpenClaw gateway
- [ ] Voice roundtrip works: speak → transcribe → OpenClaw → synthesize → hear response
- [ ] Response audio plays smoothly without chopping or clicking
- [ ] Session history matches OpenClaw identity (same agent across transports)
- [ ] README documents full setup including troubleshooting

---

## 4. Users

Primary user: **The OpenClaw Tinkerer** (see `user_persona.md`)

A developer or power user who:
- Runs their own OpenClaw agent
- Wants hands-free voice interaction
- Expects a hackable, customizable platform
- Is comfortable with terminal commands and sideloading

---

## 5. User Stories

### Onboarding / First Use

1. As a tinkerer, I want to install Scout from an APK so that I don't need Play Store approval or Android Studio.

2. As a tinkerer, I want a first-run wizard that asks for my OpenClaw gateway URL and token so that I can connect without editing config files.

3. As a tinkerer, I want a connection test during setup so that I know Scout can reach my OpenClaw before I start talking.

4. As a tinkerer, I want a microphone/speaker test during setup so that I know audio works before starting a conversation.

### Normal Use (Happy Path)

5. As a tinkerer, I want to start a voice conversation by opening the app so that I can talk to my agent immediately.

6. As a tinkerer, I want to speak naturally and have my words transcribed so that I don't have to type.

7. As a tinkerer, I want my OpenClaw agent to respond with voice so that I can hear the answer hands-free.

8. As a tinkerer, I want the voice response to sound smooth and continuous so that it doesn't feel robotic or broken.

9. As a tinkerer, I want to interrupt the agent mid-sentence (barge-in) so that I can correct or redirect without waiting.

10. As a tinkerer, I want the conversation to use my agent's personality and memory so that it's the same agent I talk to on Discord.

### Customization

11. As a tinkerer, I want to swap the STT model (e.g., tiny.en vs base.en) so that I can trade off speed vs accuracy.

12. As a tinkerer, I want to swap the TTS voice so that I can customize how my agent sounds.

13. As a tinkerer, I want to adjust silence detection sensitivity so that it works for my speaking style.

14. As a tinkerer, I want to see logs of what's happening so that I can debug issues.

### Edge Cases / Stress Path

15. As a tinkerer, I want Scout to tell me if OpenClaw is unreachable so that I know why it's not responding.

16. As a tinkerer, I want Scout to NOT fake a response when OpenClaw is down so that I'm never confused about what's real.

17. As a tinkerer, I want Scout to handle network hiccups gracefully so that a brief disconnection doesn't crash the session.

18. As a tinkerer, I want Scout to work in a noisy environment so that background sounds don't constantly trigger it.

19. As a tinkerer, I want to stop a response that's too long so that I can move on.

### Recovery / Maintenance

20. As a tinkerer, I want Scout to recover from crashes without losing my gateway config so that I don't have to re-pair every time.

21. As a tinkerer, I want to update Scout independently from OpenClaw so that voice layer updates don't require agent updates.

22. As a tinkerer, I want a clear error message when something goes wrong so that I can fix it myself.

### Sharing / Community

23. As a tinkerer, I want a README that explains setup completely so that I can send it to friends.

24. As a tinkerer, I want the install to work on most modern Android phones so that I'm not locked to one device.

---

## 6. Scope

### In Scope (This Iteration: Phase 0 + 1)

- Termux-based voice pipeline (Phase 0)
- Local STT via whisper.cpp
- Local TTS via Piper
- Connection to OpenClaw gateway on localhost
- Basic voice conversation loop (speak → transcribe → agent → synthesize → play)
- Jitter buffer and anti-chop audio handling
- Barge-in (interrupt) support
- First-run setup wizard (gateway URL/token, connection test, mic test)
- README with full setup instructions
- Error states visible to user

### Out of Scope (Explicit)

- Play Store distribution
- Non-technical user support
- Cloud STT/TTS as default (local-first)
- Replacing OpenClaw agent logic
- Visual avatar / lobster rendering (Phase 4)
- Camera/sensor integration (Phase 4)
- Multi-user support
- Cross-device OpenClaw connections (future consideration)

### Later / Maybe

- Native Android app with AAudio/Oboe (Phase 1, if Termux latency insufficient)
- Discord adapter sharing same session infrastructure (Phase 3)
- Avatar with lipsync (Phase 4)
- Sensor-driven context (Phase 4)

---

## 7. Functional Requirements + Acceptance Criteria

### FR-1: Voice Capture
The app must capture the user's voice through the phone microphone.

**Acceptance:** Given the user speaks into the phone, when they finish speaking, then their speech is captured as audio data ready for transcription.

### FR-2: Speech-to-Text (Local)
The app must transcribe speech to text using a local STT model.

**Acceptance:** Given captured audio, when processed by STT, then text appears within 2 seconds for a short utterance (under 5 seconds of speech).

### FR-3: OpenClaw Communication
The app must send transcribed text to OpenClaw and receive the agent's response.

**Acceptance:** Given transcribed text, when sent to OpenClaw gateway, then the agent's text response is received. If OpenClaw is unreachable, an error is shown (not a fake response).

### FR-4: Text-to-Speech (Local)
The app must synthesize the agent's response into audio using a local TTS model.

**Acceptance:** Given agent text, when processed by TTS, then audio begins playing within 500ms of synthesis start.

### FR-5: Smooth Audio Playback
The app must play synthesized audio without chopping, clicking, or gaps.

**Acceptance:** Given a multi-sentence response, when played back, then audio is continuous with no audible cuts or glitches.

### FR-6: Barge-In Support
The user must be able to interrupt the agent mid-response.

**Acceptance:** Given the agent is speaking, when the user starts speaking, then agent audio stops within 200ms and user speech is captured.

### FR-7: First-Run Setup
The app must guide the user through initial configuration.

**Acceptance:** Given a fresh install, when the user opens the app, then they are prompted for gateway URL/token, can test the connection, and can test microphone/speaker before starting.

### FR-8: Connection Status
The app must show whether it's connected to OpenClaw.

**Acceptance:** Given the app is running, when OpenClaw becomes unreachable, then the user sees a clear "disconnected" indicator within 5 seconds.

### FR-9: Error Visibility
The app must show clear error messages when something fails.

**Acceptance:** Given any failure (STT, TTS, network, OpenClaw), when it occurs, then an understandable error message is visible to the user.

### FR-10: Config Persistence
The app must remember gateway configuration across restarts.

**Acceptance:** Given the user has completed setup, when they restart the app, then their gateway URL/token is preserved.

---

## 8. Non-Functional Requirements

### Performance

- **First response latency:** Audio should start playing as soon as feasible after the user stops speaking
- **Barge-in latency:** Agent audio should stop within 200ms of user speech detected
- **Feels like:** A responsive conversation, not a walkie-talkie

### Reliability

- **Crash recovery:** App should restart cleanly without losing config
- **Network resilience:** Brief disconnections (under 5 seconds) should not crash the session
- **Graceful degradation:** Under thermal throttling, quality may degrade but should not glitch

### Privacy & Safety

- **No fake responses:** If OpenClaw is unavailable, Scout must not generate AI responses
- **Local processing:** STT and TTS happen on-device by default
- **No cloud requirement:** Core functionality works without internet (except OpenClaw API)

### Maintainability

- **Independent updates:** Scout and OpenClaw can be updated separately
- **Modular components:** STT, TTS, and audio handling are swappable
- **Logs available:** Debug logging can be enabled to troubleshoot issues

---

## 9. Edge Cases & Error Handling

| Situation | Expected Behavior |
|-----------|-------------------|
| OpenClaw gateway unreachable | Show "Cannot reach OpenClaw" message; do not respond |
| OpenClaw returns error | Show error message; do not fake response |
| User speaks during TTS playback | Stop playback, capture new speech (barge-in) |
| Very long agent response | Play continuously; user can interrupt |
| Noisy environment triggers VAD | Tune VAD sensitivity; show "listening" indicator |
| Network drops mid-conversation | Show "Connection lost"; attempt reconnect; resume if possible |
| Microphone permission denied | Show clear message explaining why mic is needed |
| Device thermal throttling | Degrade quality (e.g., simpler model) rather than glitch |
| STT returns empty/garbage | Do not send empty requests to OpenClaw; show "Didn't catch that" |
| TTS fails to synthesize | Show error; display text response as fallback |

---

## 10. Metrics & Guardrails

### Success Metrics

- **Voice roundtrip works:** User can complete a multi-turn conversation
- **Audio smooth:** No audible chopping in 95%+ of responses
- **Setup success:** Tinkerer can install and pair within 1 hour from README
- **Interrupt works:** Barge-in stops agent audio within 200ms

### Guardrails

- **Identity integrity:** If agent response doesn't come from OpenClaw, don't play it
- **No silent failures:** Every failure state has a visible indicator
- **Config preserved:** User never has to re-enter gateway URL after successful setup

---

## 11. Deep Modules (Conceptual)

### Audio Capture
**Responsible for:** Recording user speech from microphone
**Input:** Microphone audio stream
**Output:** Audio chunks ready for VAD/STT
**Why stable:** Standard Android/Termux audio APIs; rarely needs changes

### Voice Activity Detection (VAD)
**Responsible for:** Detecting when user is speaking vs silence
**Input:** Audio chunks
**Output:** "Speech started" / "Speech ended" events
**Why stable:** Well-defined problem; Silero VAD is mature

### Speech-to-Text (STT)
**Responsible for:** Converting audio to text
**Input:** Audio chunk (speech segment)
**Output:** Transcribed text
**Why stable:** Swappable models (whisper.cpp); clean interface

### OpenClaw Client
**Responsible for:** Sending user input to agent, receiving responses
**Input:** User text (transcript)
**Output:** Agent text response
**Why stable:** API contract with OpenClaw; versioned protocol

### Text-to-Speech (TTS)
**Responsible for:** Converting agent text to audio
**Input:** Agent text
**Output:** Audio stream/chunks
**Why stable:** Swappable voices (Piper); clean interface

### Audio Playback
**Responsible for:** Playing synthesized audio smoothly
**Input:** Audio chunks from TTS
**Output:** Sound from speaker
**Why stable:** Jitter buffer handles timing; standard playback APIs

### Session Manager
**Responsible for:** Coordinating the conversation loop
**Input:** Events from all modules
**Output:** State transitions, UI updates
**Why stable:** Central orchestrator; other modules are independent

---

## 12. Implementation Decisions (Already Decided)

| Decision | Chosen | Why | Source |
|----------|--------|-----|--------|
| Primary STT | whisper.cpp (tiny.en or base.en) | Local, fast on aarch64, well-maintained | projectBrief |
| Primary TTS | Piper TTS | Local, ONNX, fast first-chunk latency | projectBrief |
| VAD | Silero VAD | ~2ms per frame, proven | projectBrief |
| Agent runtime | OpenClaw gateway | Non-negotiable constraint | projectBrief |
| Phase 0 platform | Termux (Node.js) | Rapid iteration, no Android Studio | projectBrief |
| Audio I/O (Phase 0) | termux-microphone-record + pulseaudio | Available in Termux environment | projectBrief |

---

## 13. Testing Decisions

### Demo Script (Step-by-Step)

1. Start OpenClaw gateway, verify with `curl http://localhost:18789/health`
2. Open Scout app
3. Complete first-run setup (enter localhost:18789, test connection, test mic)
4. Say "Hello, can you hear me?"
5. Verify: Agent responds with voice; audio is smooth
6. While agent is speaking, interrupt with "Stop"
7. Verify: Agent audio stops; new input is captured
8. Ask "What's my name?" or similar memory-dependent question
9. Verify: Agent response matches OpenClaw identity/memory

### Acceptance Checklist

- [ ] Fresh install prompts for setup
- [ ] Connection test passes when OpenClaw is running
- [ ] Connection test fails clearly when OpenClaw is not running
- [ ] Mic test captures and plays back audio
- [ ] Voice roundtrip completes successfully
- [ ] Response audio has no audible chopping
- [ ] Barge-in stops playback and captures new speech
- [ ] "Disconnected" state shows when OpenClaw stops
- [ ] Config persists after app restart

### Example Scenarios

| Input | Expected Output |
|-------|-----------------|
| "Hello" | Agent greeting (smooth audio) |
| "What's the weather?" | Agent attempts to answer (may use tools) |
| [interrupt mid-response] | Audio stops, listening resumes |
| [OpenClaw stopped] | "Cannot reach OpenClaw" message |
| [speak in noisy room] | VAD filters background; captures speech |

---

## 14. Repo Findings

### What Exists Today

- `projectbrief.md` — comprehensive brief covering architecture, constraints, phases
- `user_persona.md` — target user defined (The OpenClaw Tinkerer)
- `voice/` — existing Discord voice code (v6.mjs is stable but uses cloud services)
- `specs/` — structure exists but files mostly empty
- `loop.sh` — workflow automation for agent prompts

### What Doesn't Exist Yet

- Scout voice layer code (`~/.openclaw/workspace/scout/`)
- Local STT wrapper (whisper.cpp integration)
- Local TTS wrapper (Piper integration)
- Jitter buffer / anti-chop audio handling
- First-run setup wizard
- README with install instructions

### Mismatches / Notes

- `specs/user_persona.md` is empty; `user_persona.md` exists in root — should consolidate
- `goal.md` was empty; now populated as `goal of this software.md`

---

## 15. Open Questions

### OQ-1: Remote OpenClaw Support
Should Scout support connecting to OpenClaw running on a different device (e.g., home server)?

**Options:**
- (A) Localhost only — simplest, most secure
- (B) LAN discovery — find OpenClaw on local network
- (C) Manual IP/URL entry — flexible but more setup
- (D) Defer to later phase

**Current assumption:** Localhost only (A) for Phase 0.

### OQ-2: Multiple Active Transports
If Discord and Scout are both connected to the same OpenClaw, how should they coexist?

**Options:**
- (A) Both receive all responses (broadcast)
- (B) Most recent transport gets priority
- (C) OpenClaw decides (session arbitration)
- (D) Defer to later phase

**Current assumption:** Defer to Phase 3 (D).

### OQ-3: Wake Word
Should Scout support hands-free activation with a wake word?

**Options:**
- (A) No wake word — user must open app or tap to start
- (B) Optional wake word — configurable
- (C) Required wake word — always listening

**Current assumption:** No wake word (A) for Phase 0; app must be open.

### OQ-4: Conversation History Display
Should Scout show a text transcript of the conversation?

**Options:**
- (A) Voice only — no text shown
- (B) Minimal text — current turn only
- (C) Full transcript — scrollable history
- (D) Configurable

**Current assumption:** Minimal text (B) — shows what was heard and response.

---

## 16. Further Notes

### Phase Priority
Phase 0 (Termux-based) is the current priority. Native Android app (Phase 1) only happens if Termux latency is insufficient for acceptable UX.

### Independence Principle
Scout and OpenClaw must be updatable independently. Scout is an I/O layer; OpenClaw is the brain. API contract is the boundary.

### Quality Bar
"No chopped voice" is a first-class requirement, not a polish item. The jitter buffer and audio handling must be robust before the product is usable.
