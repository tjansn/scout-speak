# Assumptions

## Resolved

| # | Question | Decision | Action |
|---|----------|----------|--------|
| A1 | OpenClaw API protocol | Inspect running gateway | Need to SSH to device and test actual API |
| A2 | Echo cancellation | Tune VAD threshold | No AEC; adjust sensitivity to avoid self-trigger |
| A3 | Wake word | Defer to later phase | Phase 0 requires manual activation |
| A4 | Audio capture format | Test on device | Verify termux-microphone-record output before finalizing |
| A5 | TTS voice | User configurable | Document available voices; let user choose in config |
| A6 | TTS streaming | Required from start | Must stream audio chunks, not batch synthesize |
| A7 | Setup UI | CLI prompts | Terminal-based setup wizard for Phase 0 |

---

## Pending Investigation

### I1: OpenClaw Gateway API (from A1)

**Status:** Needs device testing

**To do:**
1. SSH to Saga device
2. Check OpenClaw docs or source if available
3. Test actual gateway endpoints:
   ```bash
   curl http://localhost:18789/health
   curl -X POST http://localhost:18789/...
   ```
4. Document actual request/response format

**Blocks:** OpenClaw Client implementation

---

### I2: termux-microphone-record Format (from A4)

**Status:** Needs device testing

**To do:**
1. SSH to Saga device
2. Test `termux-microphone-record` flags:
   ```bash
   termux-microphone-record -h
   termux-microphone-record -f wav -l 3 test.wav
   file test.wav
   ```
3. If no raw PCM support, test `parecord` as alternative
4. Document working command and format

**Blocks:** Audio Capture implementation

---

### I3: Piper TTS Streaming (from A6)

**Status:** Needs verification

**To do:**
1. Check Piper documentation for streaming output
2. Test if `piper` CLI can pipe output incrementally
3. If not native streaming, implement sentence-chunking:
   - Split response into sentences
   - Synthesize each sentence
   - Start playback after first sentence ready

**Blocks:** TTS implementation, latency targets
