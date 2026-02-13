# Tech Stack and Frameworks

## Decision Summary

Scout Phase 0 runs as a **Node.js application in Termux** on Android, using:
- **whisper.cpp** for local speech-to-text
- **Piper TTS** for local text-to-speech
- **Silero VAD** for voice activity detection
- **OpenClaw gateway** on localhost for agent communication
- **termux-api** + **pulseaudio** for audio I/O

This stack prioritizes local operation, hackability, and rapid iteration over SSH.

---

## Selection Criteria

| Criterion | How Stack Meets It | PRD Link |
|-----------|-------------------|----------|
| Local-first | whisper.cpp + Piper run on-device | Non-goal: cloud STT/TTS default |
| Hackable | Node.js + npm; swap models via config | User story #11, #12 |
| Low latency | Native binaries for STT/TTS; VAD ~2ms/frame | NFR: Performance |
| Termux-compatible | All tools available in Termux ecosystem | Phase 0 scope |
| Swappable components | Clean module boundaries; config-driven | FR-2, FR-4, NFR: Maintainability |
| OpenClaw integration | HTTP client to localhost:18789 | FR-3; non-negotiable constraint |

---

## Options Considered

### Speech-to-Text

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **whisper.cpp** | Local, fast aarch64 build, multiple model sizes, battle-tested | Requires C++ compilation | **Chosen** |
| Vosk | Local, Python/JS bindings | Slower, less accurate than Whisper | Rejected |
| ElevenLabs Scribe | Easy API, no local compute | Cloud dependency | Rejected (available as fallback) |
| Google Speech | High accuracy | Cloud, locked ecosystem | Rejected |

### Text-to-Speech

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Piper TTS** | Local ONNX, fast first-chunk (~200ms), multiple voices | Limited voice variety | **Chosen** |
| Coqui TTS | Local, more voices | Heavier, slower | Rejected |
| ElevenLabs | Natural voices | Cloud dependency | Rejected (available as fallback) |
| espeak | Ultra-lightweight | Robotic quality | Rejected |

### Voice Activity Detection

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Silero VAD** | ~2ms/frame, ONNX, proven | Requires ONNX runtime | **Chosen** |
| WebRTC VAD | Built into many libs | Less accurate | Alternative |
| Energy-based | Simple | Too many false triggers | Rejected |

### Runtime Environment

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Termux + Node.js** | SSH iteration, no Android Studio, npm ecosystem | Not native (higher latency) | **Chosen for Phase 0** |
| Native Android (Kotlin) | Best latency, AAudio/Oboe | Requires Android Studio, slower iteration | **Phase 1 if needed** |
| Python | Good ML libs | Slower, heavier on mobile | Rejected |

### Audio I/O (Phase 0)

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **parecord/pacat (PulseAudio)** | Raw PCM support, configurable format | Requires PulseAudio running | **Chosen for Phase 0** |
| termux-microphone-record | Simple API | No raw PCM (only aac/opus/amr) | **Rejected** |
| AAudio/Oboe | Lowest latency | Requires native Android | **Phase 1** |

---

## Decision Log

| Decision | Chosen | Why | Trade-offs | PRD Link |
|----------|--------|-----|------------|----------|
| STT engine | whisper.cpp tiny.en | Best balance of speed/accuracy for local | Must compile for aarch64 | FR-2 |
| TTS engine | Piper TTS | Fast local synthesis, ONNX | Limited voice selection | FR-4 |
| TTS voice | User configurable | Document options, let user choose | Need to list available voices | FR-4, User story #12 |
| TTS mode | Streaming required | Lower latency; sentence chunking if needed | More complex buffering | NFR: Performance |
| VAD | Silero VAD v4 | Proven, fast, accurate | ONNX dependency | FR-6 (barge-in) |
| Runtime | Node.js 25.x | Available in Termux, async I/O | Not native performance | Phase 0 scope |
| Agent API | OpenClaw HTTP | Non-negotiable | None | FR-3 |
| Audio capture | parecord (PulseAudio) | Raw PCM support | Requires PulseAudio daemon | FR-1 |
| Audio playback | pacat (PulseAudio) | Raw PCM support, matches capture | Requires PulseAudio daemon | FR-5 |
| Config format | JSON | Simple, Node.js native | No schema validation | FR-10 |
| Logging | Console + file | Simple, debuggable | No structured logging | User story #14 |

---

## Versioning Notes

**Pin versions when stability matters:**
- whisper.cpp: pin to tested commit (model compatibility)
- Piper: pin to tested release (voice model compatibility)
- Silero VAD: v4 ONNX model (API stable)

**Float versions for rapid updates:**
- Node.js: latest LTS in Termux
- npm dependencies: semver ranges

---

## Operational Simplicity Notes

1. **Single runtime**: Everything runs in Node.js process (except whisper.cpp/Piper binaries)
2. **No containers**: Direct Termux execution; no Docker complexity
3. **File-based config**: Edit JSON, restart; no database
4. **SSH-friendly**: All debugging via terminal; no GUI required
5. **Independent updates**: `npm update` for Scout; `npm update -g openclaw` for agent; `git pull` for voice layer

---

## Dependencies (Phase 0)

### System (Termux)
```bash
pkg install nodejs-lts python cmake clang pulseaudio
pip install piper-tts onnxruntime
```

### whisper.cpp (build from source)
```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make -j8
./models/download-ggml-model.sh tiny.en
```

### Node.js (npm)
```json
{
  "dependencies": {
    "onnxruntime-node": "^1.x",  // Silero VAD
    "ws": "^8.x"                  // WebSocket (if needed)
  }
}
```

### Config Files
- `~/.openclaw/workspace/scout/config.json` — gateway URL, model paths, audio settings
- `~/.openclaw/openclaw.json` — OpenClaw gateway token (existing)
