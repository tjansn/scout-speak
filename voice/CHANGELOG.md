# Scout Discord Voice Bot — Changelog

## Architecture Overview

All versions share the same goal: **let Scout talk in Discord voice channels** by bridging Discord voice audio to AI services and back.

**Core pipeline:** Discord Voice (opus 48kHz stereo) → decode → downsample → AI processing → TTS → upsample → opus encode → Discord Voice

**Stack:** Node.js, discord.js, @discordjs/voice, opusscript (pure JS — native opus won't compile on Android/Termux arm64), ws

---

## v4 — First Working Bridge (`discord-voice-v4.mjs`)

**Architecture:** Discord ↔ ElevenLabs Conversational AI (single WebSocket)

- Single-process Node.js — no PulseAudio, no child processes
- Connects to **ElevenLabs ConvAI WebSocket** which handles STT + LLM + TTS all-in-one
- Opus decode (48kHz stereo) → custom downsample to 16kHz mono → base64 → ElevenLabs WS
- ElevenLabs PCM (16kHz mono) → upsample to 48kHz stereo → opus encode → Discord
- Debounce-based playback: collect audio chunks, flush after 200ms silence
- Auto-joins voice channel on startup
- DAVE protocol decryption errors handled (non-fatal)

**Status:** ElevenLabs→Discord audio works ✅ (greeting plays). Discord→ElevenLabs audio broken ❌ — opus packets decoded and sent but ElevenLabs never produces a transcript. Root cause never fully diagnosed.

**Known issues:**
- Uses ElevenLabs' default agent personality, not Scout's
- No reconnection logic for voice disconnects (added later but didn't help)
- Hard-coded channel/guild IDs and API keys

---

## v5 — Continuous Audio Subscription (`discord-voice-v5.mjs`)

**Architecture:** Same as v4 (ElevenLabs ConvAI WS), with subscription fix

**Key change:** Keep ONE continuous audio subscription per user instead of re-subscribing on every `speaking` event. Hypothesis was that ElevenLabs needs a continuous audio stream, not fragmented bursts.

- Uses `EndBehaviorType.Manual` for persistent subscriptions
- Tracks active subscriptions in a `Set` to avoid duplicates
- Same audio pipeline as v4 (opus decode → downsample → base64 → WS)

**Status:** Incremental improvement attempt. Audio pipeline still didn't produce ElevenLabs transcripts.

---

## v6 — The Real Scout (`discord-voice-v6.mjs`) ✅ CURRENT

**Architecture:** Completely different — **three separate API calls** instead of one ConvAI WebSocket:
1. **ElevenLabs STT** (REST API, `scribe_v1`) — speech-to-text
2. **Anthropic Claude** (`claude-sonnet-4-20250514`) — thinking/response with Scout's full personality
3. **ElevenLabs TTS** (WebSocket streaming, `eleven_turbo_v2_5`, voice "Rachel") — text-to-speech

**Key improvements over v4/v5:**
- **Actually uses Scout's personality** — loads SOUL.md, USER.md, IDENTITY.md, MEMORY.md and today's memory file as Claude system prompt
- **Conversation history** — maintains rolling context (last 40 messages) for natural multi-turn conversation
- **Auto-join/leave** — watches for Tom (`399230520950521856`) joining/leaving the voice channel, follows automatically
- **Silence detection** — 1.2s of silence triggers end-of-utterance processing
- **Noise filtering** — skips utterances shorter than 500ms
- **Persistent audio subscription** — one subscription per user with `EndBehaviorType.Manual`
- **PCM→WAV conversion** for STT (ElevenLabs REST API needs WAV, not raw PCM)
- **Streaming TTS** via WebSocket for lower latency

**Pipeline per utterance:**
```
User speaks → opus decode → downsample 16kHz mono → collect until 1.2s silence
→ PCM to WAV → ElevenLabs STT → transcript
→ Claude API (with Scout personality + history) → response text
→ ElevenLabs TTS WS → PCM chunks → upsample 48kHz stereo → Discord playback
```

**Status:** Bot connects, greets, listens to user audio, receives opus packets. Full pipeline functional.

**Performance target:** STT + LLM + TTS total latency logged per utterance.

---

## Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| `discord.js` | Discord gateway + API | v14 |
| `@discordjs/voice` | Voice connection handling | |
| `opusscript` | Opus encode/decode (pure JS) | `@discordjs/opus` won't compile on arm64 |
| `ws` | WebSocket client | ElevenLabs connections |
| `tweetnacl` | Voice encryption | |
| `libsodium-wrappers` | DAVE protocol encryption | |

## Environment

- **Device:** Solana Mobile Saga, Android 12, aarch64
- **Runtime:** Termux (native), Node.js v25.3.0
- **Memory limit:** `--max-old-space-size=256` (v6)
- **Process protection:** Android phantom process killer disabled via ADB
