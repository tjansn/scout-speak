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

**Status:** ✅ RESOLVED — See `specs/openclaw_api.md`

**Findings:**
- Gateway is WebSocket-based (ws://localhost:18789), not HTTP
- Use CLI: `openclaw agent --agent main --message "text" --json`
- Response: `result.payloads[0].text` contains agent response
- Latency: ~2-3 seconds for short responses
- Must start gateway manually: `openclaw gateway run --port 18789`

---

### I2: termux-microphone-record Format (from A4)

**Status:** ✅ RESOLVED

**Findings:**
- `termux-microphone-record` does NOT support raw PCM — only encoded formats (aac, opus, amr_wb, amr_nb)
- **Use `parecord` (PulseAudio) instead:**
  ```bash
  parecord --raw --format=s16le --rate=16000 --channels=1 output.pcm
  ```
- Tested on device: produces correct 16kHz mono 16-bit PCM
- Playback with: `pacat --raw --format=s16le --rate=16000 --channels=1 output.pcm`
- Requires PulseAudio running: `pulseaudio --start`

---

### I3: Piper TTS Streaming (from A6)

**Status:** ✅ RESOLVED

**Findings:**
- Piper supports streaming with `--output_raw` flag
- Command: `echo "text" | piper -m voice.onnx --output_raw | pacat --raw -r 22050 -c 1 -f S16_LE`
- Streaming is **sentence-by-sentence** (not word-by-word)
- Output format: raw S16_LE PCM at voice model's sample rate (typically 22050Hz)
- **Important:** Keep Piper process alive to avoid 14+ second startup latency
- Not yet installed on device — needs `pip install piper-tts`

**Implementation approach:**
1. Start Piper as long-running process (avoid cold start per utterance)
2. Pipe text in, stream raw PCM out
3. May need sample rate conversion (22050 → device playback rate)
