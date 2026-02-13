# User Persona: The OpenClaw Tinkerer

**Alex** — A developer who runs their own AI agent and wants to talk to it hands-free on their phone.

---

## Context

Alex is a software developer or power user who enjoys building and customizing their own tools. They already run an OpenClaw agent — their own AI assistant with its own memory, personality, and capabilities. They're comfortable with command lines, config files, and compiling things from source. They might work from home, a workshop, or wherever they have projects going on.

**Tools they use today:**
- OpenClaw running on a device or server
- Terminal/SSH for managing things
- Discord (where their agent might already live)
- Various local AI models they experiment with

**Environment:**
- Personal Android phone (their own device, not locked down by IT)
- Home network or mobile data
- Often doing something else while wanting to interact — cooking, driving, walking, working with their hands

---

## Goals

1. **Extend their OpenClaw agent to work hands-free** — talk to it without picking up the phone or typing
2. **Have a hackable platform** — swap out STT/TTS models, tweak the pipeline, build on top of it
3. **Share it with other tinkerers** — others should be able to set it up from the README without hand-holding

---

## Pains (ranked)

1. **No good way to connect your own AI agent to voice on mobile** — this is the core frustration. Cloud assistants (Google, Alexa, Siri) are locked down. You can't point them at your own agent.

2. **Existing local voice solutions are janky** — either too slow, too choppy, or too fragile to actually use regularly.

3. **Cloud assistants are black boxes** — can't customize behavior, can't see what's happening, can't trust them with certain things.

4. **Mobile AI development is painful** — Android Studio, permissions, native code... high friction for experimentation.

---

## Constraints

- **Time:** Willing to invest time setting things up, but once it works, it should mostly stay working.
- **Attention:** Often using voice because hands/eyes are busy elsewhere.
- **Environment:** Personal device, personal space — privacy from strangers isn't a major concern.
- **Sensitivity:** Conversations might occasionally include personal info, but nothing high-stakes.
- **Risk tolerance:** Crashes and bugs are frustrating but tolerable — it's a dev tool, not life-critical infrastructure.

---

## Quotes

Things Alex would actually say:

> "I just want to talk to my agent while I'm making dinner."

> "Why can't I just point a voice interface at my own AI?"

> "If I can't swap out the TTS model, what's the point?"

> "The latency on this is terrible — I could type faster."

> "I got it working, let me write up how to do it so others don't have to figure this out."

> "It should just work. I don't want to restart it every hour."

---

## What Success Feels Like

Alex picks up their phone, says something to Scout, and their OpenClaw agent responds — naturally, quickly, without choppiness. They didn't have to touch the screen. Later, they swap in a different TTS voice because they wanted to try it. It just works. A friend asks how to set it up, and Alex sends them the README. The friend gets it running in an afternoon.

It feels like: **"I finally have a voice interface to my agent that doesn't suck."**
