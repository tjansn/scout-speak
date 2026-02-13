# Goal of This Software

## Purpose

Scout lets you talk to your OpenClaw agent using your voice, hands-free, on your Android phone.

It exists because there's no good way to connect your own AI agent to voice on mobile. Cloud assistants (Google, Alexa, Siri) are locked down — you can't point them at your own agent. Scout fills that gap: a voice layer you control, connected to the brain you control.

---

## Success Definition

Scout is successful when:

1. **It works hands-free** — you can have a conversation with your agent while cooking, driving, or walking without touching the screen
2. **The voice is smooth** — no chopped audio, no jarring pauses, no robotic stuttering
3. **It connects to OpenClaw** — your agent's personality, memory, and tools come through, not some generic assistant
4. **It's hackable** — you can swap STT/TTS models, tweak the pipeline, build on top of it
5. **Others can set it up** — a tinkerer friend can install it from the README in an afternoon

---

## Non-Goals (Explicitly Out of Scope)

- **Replacing OpenClaw** — Scout is an I/O layer, not a brain. It does not generate agent responses.
- **Working without OpenClaw** — if OpenClaw is down, Scout waits. It does not fake responses.
- **Play Store distribution** — sideloading is fine for this audience.
- **Supporting non-technical users** — this is for tinkerers who are comfortable with setup.
- **Maximum naturalness over locality** — local-first, even if cloud would sound better.

---

## Guardrails (What Must Not Happen)

- **No impersonation** — if OpenClaw is unavailable, Scout must not respond as if it were the agent
- **No identity drift** — the agent's personality and memory must come from OpenClaw, not local state
- **No chopped voice** — continuous speech must play continuously, without audible cuts
- **No silent failures** — if something breaks, make it visible (error state, notification, log)

---

## Assumptions (Required to Proceed)

1. The user already has OpenClaw installed and running on the device or reachable on local network
2. The user has a modern Android phone (Android 11+, 6GB+ RAM, arm64)
3. The user is comfortable with sideloading APKs and basic terminal commands
4. Local STT/TTS (whisper.cpp, Piper) can run acceptably on target hardware

---

## Open Questions

1. **Should Scout work when OpenClaw is on a different device?** (e.g., agent runs on a server, Scout runs on phone)
   - Current assumption: OpenClaw runs on the same device or localhost-accessible
   - This affects network/auth complexity

2. **How should Scout handle multiple transports active at once?** (e.g., Discord + phone both connected)
   - Current assumption: OpenClaw handles session arbitration
   - May need explicit priority rules later
