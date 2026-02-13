#!/usr/bin/env node
/**
 * Scout Voice v2 - MY brain, ElevenLabs voice
 * 
 * Discord mic → STT → OpenClaw (Scout/Claude) → ElevenLabs TTS → Discord speaker
 */

import { Client, GatewayIntentBits } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  EndBehaviorType,
  StreamType,
  VoiceConnectionStatus
} from '@discordjs/voice';
import WebSocket from 'ws';
import { PassThrough } from 'stream';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');

// Config
const config = JSON.parse(readFileSync('/data/data/com.termux/files/home/.openclaw/openclaw.json', 'utf8'));
const BOT_TOKEN = config.channels.discord.token;
const XI_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // "Adam" male voice
const GUILD_ID = '1470437674681630913';
const VOICE_CHANNEL_ID = '1470437675172499652';
const OPENCLAW_URL = 'http://localhost:18789';
const OPENCLAW_TOKEN = config.token;

const opusDecoder = new OpusScript(48000, 2, OpusScript.Application.VOIP);
const opusEncoder = new OpusScript(48000, 2, OpusScript.Application.VOIP);

let audioPlayer = null;
let connection = null;
let isProcessing = false;

// --- STT: Collect user speech, transcribe via ElevenLabs ---
async function transcribe(pcmChunks) {
  // Convert PCM chunks to WAV for the ElevenLabs STT API
  const pcmBuffer = Buffer.concat(pcmChunks);
  if (pcmBuffer.length < 3200) return null; // too short
  
  // Create WAV header for 16kHz mono s16le
  const wavHeader = createWavHeader(pcmBuffer.length, 16000, 1, 16);
  const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
  
  // Use ElevenLabs speech-to-text
  const formData = new FormData();
  formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
  formData.append('model_id', 'scribe_v1');
  
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': XI_KEY },
      body: formData
    });
    const data = await res.json();
    return data.text?.trim() || null;
  } catch (e) {
    console.error('❌ STT error:', e.message);
    return null;
  }
}

function createWavHeader(dataSize, sampleRate, channels, bitsPerSample) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}

// --- LLM: Call Claude directly via Anthropic API ---
async function askScout(text) {
  const anthropicKey = config.providers?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error('❌ No Anthropic API key found');
    return "I can't think right now, my API key is missing.";
  }
  
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: `You are Scout, an AI agent living on an Android phone in a Discord voice channel. You're talking to Tom. Be concise (1-3 sentences), natural, witty, opinionated. Light swearing fine. No emoji, no markdown — this will be spoken aloud. Just say the words.`,
        messages: [{ role: 'user', content: text }]
      })
    });
    const data = await res.json();
    const reply = data.content?.[0]?.text;
    return reply || "Hmm, I got nothing.";
  } catch (e) {
    console.error('❌ LLM error:', e.message);
    return "Sorry, something went wrong with my brain.";
  }
}

// --- TTS: ElevenLabs streaming text-to-speech ---
async function speak(text, connection) {
  console.log(`🗣️  Speaking: "${text}"`);
  
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': XI_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
        },
        output_format: 'pcm_16000'
      })
    });
    
    if (!res.ok) {
      console.error('❌ TTS error:', res.status, await res.text());
      return;
    }
    
    // Collect PCM audio
    const arrayBuf = await res.arrayBuffer();
    const pcm16k = Buffer.from(arrayBuf);
    
    if (pcm16k.length < 100) {
      console.error('❌ TTS returned empty audio');
      return;
    }
    
    // Upsample to 48kHz stereo for Discord
    const pcm48k = upsample16to48stereo(pcm16k);
    
    // Play in Discord
    const stream = new PassThrough();
    stream.end(pcm48k);
    
    const resource = createAudioResource(stream, {
      inputType: StreamType.Raw
    });
    
    audioPlayer.play(resource);
    
    // Wait for playback to finish
    await new Promise((resolve) => {
      audioPlayer.once(AudioPlayerStatus.Idle, resolve);
      setTimeout(resolve, 30000); // safety timeout
    });
    
  } catch (e) {
    console.error('❌ TTS/playback error:', e.message);
  }
}

// Upsample 16kHz mono → 48kHz stereo
function upsample16to48stereo(buf) {
  // Ensure even number of bytes
  const validLen = buf.length - (buf.length % 2);
  const samples = validLen / 2;
  const out = Buffer.alloc(samples * 12); // 3x samples * 2 channels * 2 bytes
  for (let i = 0; i < samples; i++) {
    const s = buf.readInt16LE(i * 2);
    for (let r = 0; r < 3; r++) {
      const idx = (i * 3 + r) * 4;
      if (idx + 3 < out.length) {
        out.writeInt16LE(s, idx);
        out.writeInt16LE(s, idx + 2);
      }
    }
  }
  return out;
}

// Downsample 48kHz stereo → 16kHz mono
function downsample48to16mono(buf) {
  const frames = buf.length / 4;
  const outSamples = Math.floor(frames / 3);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    out.writeInt16LE(buf.readInt16LE(i * 3 * 4), i * 2);
  }
  return out;
}

// --- Discord Bot ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

client.once('ready', async () => {
  console.log(`🤖 Bot ready: ${client.user.tag}`);
  
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) { console.error('❌ Guild not found'); process.exit(1); }
  
  audioPlayer = createAudioPlayer();
  
  console.log('🔊 Joining voice...');
  connection = joinVoiceChannel({
    channelId: VOICE_CHANNEL_ID,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false
  });
  
  connection.on(VoiceConnectionStatus.Ready, async () => {
    console.log('✅ In voice channel!');
    connection.subscribe(audioPlayer);
    
    // Greet
    await speak("Hey Tom, Scout here. What's up?", connection);
    
    // Listen for speech
    const receiver = connection.receiver;
    
    receiver.speaking.on('start', (userId) => {
      if (isProcessing) return; // don't capture while we're responding
      
      const stream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1500 }
      });
      
      const pcmChunks = [];
      
      stream.on('data', (opusPacket) => {
        try {
          const pcm48k = Buffer.from(opusDecoder.decode(opusPacket).buffer);
          const pcm16k = downsample48to16mono(pcm48k);
          pcmChunks.push(pcm16k);
        } catch (e) {}
      });
      
      stream.on('end', async () => {
        if (pcmChunks.length < 3 || isProcessing) return; // too short or busy
        
        isProcessing = true;
        console.log(`\n👂 Captured ${pcmChunks.length} audio frames`);
        
        try {
          // 1. Transcribe
          const text = await transcribe(pcmChunks);
          if (!text || text.length < 2) {
            console.log('   (empty transcription, skipping)');
            isProcessing = false;
            return;
          }
          console.log(`🧑 Tom: "${text}"`);
          
          // 2. Think (ask Scout/Claude)
          const reply = await askScout(text);
          console.log(`🐾 Scout: "${reply}"`);
          
          // 3. Speak
          await speak(reply, connection);
        } catch (e) {
          console.error('❌ Pipeline error:', e.message);
        }
        
        isProcessing = false;
      });
    });
  });
  
  connection.on('error', (e) => console.error('❌ Voice error:', e.message));
});

client.login(BOT_TOKEN);

process.on('SIGINT', () => {
  console.log('\n👋 Bye!');
  if (connection) connection.destroy();
  client.destroy();
  process.exit(0);
});

console.log('');
console.log('  🐾 Scout Voice v2');
console.log('  ─────────────────');
console.log('  My brain. ElevenLabs voice.');
console.log('');
