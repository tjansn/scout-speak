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

---

## Installation

### Prerequisites

- **Android device** with Termux installed
- **Node.js 20+** (install via `pkg install nodejs`)
- **PulseAudio** for audio capture/playback (`pkg install pulseaudio`)
- **OpenClaw** CLI installed and configured
- **Python 3** (for Piper TTS installation)
- **Build tools** for whisper.cpp (`pkg install git cmake clang make`)

### Step 1: Install Scout

```bash
# Clone the repository
git clone https://github.com/your-org/scout-speak.git
cd scout-speak

# Install Node.js dependencies
npm install
```

### Step 2: Set Up OpenClaw Gateway

Scout requires a running OpenClaw gateway on localhost.

```bash
# Start the OpenClaw gateway
openclaw gateway run --port 18789

# Verify the gateway is running
openclaw gateway health
```

Obtain your gateway token from your OpenClaw configuration.

### Step 3: Install whisper.cpp (Speech-to-Text)

```bash
# Clone whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp

# Build with optimizations
make -j8

# Download the tiny.en model (recommended for Termux)
bash ./models/download-ggml-model.sh tiny.en

# Verify installation
./main -m models/ggml-tiny.en.bin -f /dev/null --help
```

The model file will be at `whisper.cpp/models/ggml-tiny.en.bin`.

### Step 4: Install Piper TTS (Text-to-Speech)

```bash
# Install Piper via pip
pip install piper-tts

# Create a directory for voice models
mkdir -p ~/.local/share/piper/voices

# Download a voice model (en_US-lessac-medium recommended)
cd ~/.local/share/piper/voices
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

# Verify installation
echo "Hello world" | piper --model en_US-lessac-medium --output_file test.wav
```

### Step 5: Download Silero VAD Model

```bash
# Create models directory
mkdir -p ~/.openclaw/workspace/scout/models

# Download Silero VAD v4
cd ~/.openclaw/workspace/scout/models
wget https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx
```

### Step 6: Configure Scout

```bash
# Copy the example config
cp config.json.example config.json

# Edit with your paths and settings
nano config.json
```

Update these paths in `config.json`:

```json
{
  "gateway_url": "http://localhost:18789",
  "gateway_token": "YOUR_GATEWAY_TOKEN",
  "stt_model_path": "/path/to/whisper.cpp/models/ggml-tiny.en.bin",
  "tts_model_path": "/path/to/piper/voices/en_US-lessac-medium.onnx",
  "vad_model_path": "/path/to/silero_vad.onnx"
}
```

### Step 7: Start Scout

```bash
# Ensure PulseAudio is running
pulseaudio --start

# Run Scout
npm start
```

On first run, Scout will launch the setup wizard to verify your configuration and test audio hardware.

---

## Configuration

Scout configuration is stored in `config.json`. Copy `config.json.example` as a starting point.

### OpenClaw Gateway

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `gateway_url` | string | Yes | OpenClaw gateway URL. **Must be localhost** (e.g., `http://localhost:18789`) |
| `gateway_token` | string | Yes | Authentication token for the OpenClaw gateway |

### Model Paths

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `stt_model_path` | string | — | Path to whisper.cpp model file (e.g., `ggml-tiny.en.bin`) |
| `tts_model_path` | string | — | Path to Piper voice model (`.onnx` file) |
| `tts_voice` | string | `en_US-lessac-medium` | Piper voice name |
| `tts_sample_rate` | number | `22050` | TTS output sample rate (must match voice model) |
| `vad_model_path` | string | — | Path to Silero VAD model (`silero_vad.onnx`) |

### Audio Settings

| Option | Type | Default | Range | Description |
|--------|------|---------|-------|-------------|
| `sample_rate` | number | `16000` | — | Microphone sample rate (Hz) |
| `vad_threshold` | number | `0.5` | 0.0–1.0 | Speech detection threshold. Higher = less sensitive |
| `silence_duration_ms` | number | `1200` | 100–5000 | Silence duration (ms) to end an utterance |
| `min_speech_ms` | number | `500` | 100–5000 | Minimum speech duration to accept |
| `buffer_size_ms` | number | `500` | — | Jitter buffer capacity for smooth playback |
| `low_watermark_ms` | number | `100` | — | Minimum buffer fill before starting playback |

### Barge-In (Interruption)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `barge_in_enabled` | boolean | `true` | Allow interrupting the agent mid-sentence |
| `barge_in_cooldown_ms` | number | `200` | Debounce period to prevent rapid interrupts |

### Features

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `wake_word_enabled` | boolean | `false` | Enable always-listening wake word mode |
| `wake_word_phrase` | string | `hey scout` | Phrase to activate voice input |
| `display_mode` | string | `minimal` | UI mode: `voice_only`, `minimal`, or `transcript` |

### Logging

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `log_level` | string | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `log_to_file` | boolean | `false` | Write logs to file in addition to console |

### Example Configuration

```json
{
  "gateway_url": "http://localhost:18789",
  "gateway_token": "your-token-here",

  "stt_model_path": "/data/data/com.termux/files/home/whisper.cpp/models/ggml-tiny.en.bin",
  "tts_voice": "en_US-lessac-medium",
  "tts_model_path": "/data/data/com.termux/files/home/.local/share/piper/voices/en_US-lessac-medium.onnx",
  "tts_sample_rate": 22050,
  "vad_model_path": "/data/data/com.termux/files/home/.openclaw/workspace/scout/models/silero_vad.onnx",

  "sample_rate": 16000,
  "vad_threshold": 0.5,
  "silence_duration_ms": 1200,
  "min_speech_ms": 500,
  "buffer_size_ms": 500,
  "low_watermark_ms": 100,

  "wake_word_enabled": false,
  "wake_word_phrase": "hey scout",
  "display_mode": "minimal",
  "barge_in_enabled": true,
  "barge_in_cooldown_ms": 200,

  "log_level": "info",
  "log_to_file": false
}
```

---

## Troubleshooting

### Audio Issues

**No audio capture / microphone not working**

1. Ensure PulseAudio is running:
   ```bash
   pulseaudio --start
   ```

2. Check microphone permissions in Android settings for Termux

3. Verify audio source:
   ```bash
   parecord --device=@DEFAULT_SOURCE@ --file-format=wav test.wav
   # Speak, then Ctrl+C to stop
   paplay test.wav  # Should hear your recording
   ```

**No audio playback / speaker not working**

1. Check PulseAudio status:
   ```bash
   pactl info
   ```

2. Test playback directly:
   ```bash
   echo "Test" | piper --model /path/to/voice.onnx --output_file - | pacat --format=s16le --rate=22050 --channels=1
   ```

3. Check system volume is not muted

**Choppy or glitchy audio**

- Increase `buffer_size_ms` (try 750 or 1000)
- Increase `low_watermark_ms` (try 150 or 200)
- Close other resource-intensive apps

### Connection Issues

**"Cannot reach OpenClaw" error**

1. Verify gateway is running:
   ```bash
   openclaw gateway health
   ```

2. Start the gateway if needed:
   ```bash
   openclaw gateway run --port 18789
   ```

3. Check `gateway_url` in config is `http://localhost:18789`

**"Connection lost" during conversation**

- Scout automatically reconnects with exponential backoff (1s, 2s, 4s, up to 5s max)
- Brief disconnections (<5s) won't crash the session
- Check network stability if issues persist

### Model Loading Issues

**"STT model not found" error**

1. Verify the model path is correct and file exists:
   ```bash
   ls -la /path/to/whisper.cpp/models/ggml-tiny.en.bin
   ```

2. Re-download the model:
   ```bash
   cd whisper.cpp
   bash ./models/download-ggml-model.sh tiny.en
   ```

**"TTS model not found" error**

1. Verify both `.onnx` and `.onnx.json` files exist:
   ```bash
   ls -la /path/to/voices/en_US-lessac-medium.onnx*
   ```

2. Re-download from HuggingFace if missing

**"VAD model not found" error**

1. Download Silero VAD model:
   ```bash
   wget https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx
   ```

### Performance Issues

**Slow transcription (STT takes >2 seconds)**

- Use `tiny.en` model instead of larger models
- Reduce thread count if overloading CPU: edit whisper.cpp command flags
- Close background apps to free resources

**High latency before agent responds**

- Check OpenClaw gateway performance
- Network latency to AI provider may be the bottleneck
- Consider shorter utterances for faster round-trips

**Device gets hot / thermal throttling**

- Scout adapts automatically when thermal degradation is detected
- Take breaks between long conversations
- Avoid direct sunlight / hot environments

### Getting Help

- Check specifications in `specs/` for detailed technical documentation
- Report issues at: https://github.com/anthropics/claude-code/issues

---

## Customization

Scout's components are designed to be swappable. You can customize STT, TTS, and VAD behavior to suit your needs.

### Changing the STT Model

whisper.cpp supports multiple model sizes. Trade-offs:

| Model | Size | Speed (5s audio) | Accuracy | Recommended For |
|-------|------|------------------|----------|-----------------|
| `tiny.en` | 75 MB | ~0.8s | Good | **Default for Termux** |
| `base.en` | 142 MB | ~1.5s | Better | Higher accuracy needs |
| `small.en` | 466 MB | ~4s | High | Desktop/powerful devices |

To change models:

```bash
# Download a different model
cd whisper.cpp
bash ./models/download-ggml-model.sh base.en

# Update config.json
"stt_model_path": "/path/to/whisper.cpp/models/ggml-base.en.bin"
```

**Note:** Larger models (`medium.en`, `large`) are not recommended for Phase 0 due to resource constraints on mobile devices.

### Changing the TTS Voice

Piper offers many voice options. Browse available voices at:
https://huggingface.co/rhasspy/piper-voices

Popular English voices:

| Voice | Quality | Speed | Sample Rate |
|-------|---------|-------|-------------|
| `en_US-lessac-medium` | Good | Medium | 22050 Hz |
| `en_US-amy-low` | Lower | Fast | 16000 Hz |
| `en_US-ryan-high` | High | Slow | 22050 Hz |
| `en_GB-alan-medium` | Good | Medium | 22050 Hz |

To change voices:

```bash
# Download new voice files
cd ~/.local/share/piper/voices
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json

# Update config.json
"tts_voice": "en_GB-alan-medium",
"tts_model_path": "/path/to/voices/en_GB-alan-medium.onnx",
"tts_sample_rate": 22050
```

**Important:** The `tts_sample_rate` must match the voice model's native sample rate (check the `.onnx.json` file).

### Adjusting VAD Sensitivity

Tune voice activity detection for your environment:

**For noisy environments** (coffee shop, outdoors):
```json
{
  "vad_threshold": 0.65,
  "min_speech_ms": 700
}
```

**For quiet environments** (home office):
```json
{
  "vad_threshold": 0.4,
  "min_speech_ms": 400
}
```

**For soft-spoken users**:
```json
{
  "vad_threshold": 0.35
}
```

### Adjusting Response Timing

**Faster end-of-utterance detection** (quicker responses, may cut off speech):
```json
{
  "silence_duration_ms": 800
}
```

**Slower end-of-utterance detection** (allows longer pauses):
```json
{
  "silence_duration_ms": 1500
}
```

### Display Modes

Scout supports three display modes:

- **`voice_only`**: No text output, audio only
- **`minimal`**: Shows connection status and basic info
- **`transcript`**: Shows full conversation transcript

```json
{
  "display_mode": "transcript"
}
```

### Wake Word Mode

Enable hands-free activation with a wake phrase:

```json
{
  "wake_word_enabled": true,
  "wake_word_phrase": "hey scout"
}
```

With wake word enabled, Scout listens continuously for the phrase before activating full voice input.

### Disabling Barge-In

If you don't want to interrupt the agent mid-sentence:

```json
{
  "barge_in_enabled": false
}
```

### Headphone Recommendations

For best results with barge-in (interruption), use headphones. Without acoustic echo cancellation (AEC), the speaker output may trigger false barge-in detections. Headphones prevent this by isolating the microphone from speaker output.

---

## Documentation

- Product requirements: `specs/prd.md`
- System architecture: `specs/system_architecture_and_data_flow.md`
- All specifications: `specs/_index.md`
- Implementation status: `IMPLEMENTATION_PLAN.md`
