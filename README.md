# Scout

Scout is a Termux-based voice interface for OpenClaw agents on Android. It provides local speech-to-text (via whisper.cpp) and text-to-speech (via Piper) to enable hands-free voice conversations with your OpenClaw agent.

## Architecture Overview

Scout is an **I/O layer** around OpenClaw:

```
User speaks → VAD → STT → OpenClaw Gateway → TTS → Audio playback
```

Scout handles audio capture, speech recognition, synthesis, and playback. **OpenClaw handles all agent logic, memory, and identity.**

## Multi-Transport Priority

Scout is a single voice transport. When multiple transports are active (e.g., Scout voice + Discord text), **OpenClaw Gateway handles transport priority**:

- The most recently used transport receives responses
- If you speak via Scout, Scout gets the response
- If you then type in Discord, Discord gets the response
- Scout does not know about or coordinate with other transports

This is by design. OpenClaw maintains a consistent agent identity across all transports, handling priority centrally. See `specs/system_architecture_and_data_flow.md` for details.

## Status

Phase 0 implementation in progress. See `IMPLEMENTATION_PLAN.md` for current status.

## Documentation

- Product requirements: `specs/prd.md`
- System architecture: `specs/system_architecture_and_data_flow.md`
- All specifications: `specs/_index.md`
