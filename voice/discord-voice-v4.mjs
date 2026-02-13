#!/usr/bin/env node
/**
 * Scout Discord Voice v4 — Single-process Discord ↔ ElevenLabs bridge
 * 
 * Architecture:
 *   Discord Voice (opus 48kHz stereo) → decode → downsample 16kHz mono → ElevenLabs WS
 *   ElevenLabs WS (PCM 16kHz mono) → upsample 48kHz stereo → opus encode → Discord Voice
 * 
 * No PulseAudio. No child processes. Everything in one Node.js process.
 */

import { Client, GatewayIntentBits } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, EndBehaviorType, StreamType, VoiceConnectionStatus,
  NoSubscriberBehavior, entersState
} from '@discordjs/voice';
import WebSocket from 'ws';
import { PassThrough, Readable } from 'stream';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');

// --- Config ---
const config = JSON.parse(readFileSync('/data/data/com.termux/files/home/.openclaw/openclaw.json', 'utf8'));
const BOT_TOKEN = config.channels.discord.token;
const XI_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_3701kh95btt4e5p850zy2dntsevf';
const GUILD_ID = '1470437674681630913';
const VC_ID = '1470437675172499652';

// --- Opus codec ---
// Discord: 48kHz stereo. ElevenLabs: 16kHz mono.
const opusDecoder = new OpusScript(48000, 2, OpusScript.Application.VOIP);
const opusEncoder = new OpusScript(48000, 2, OpusScript.Application.VOIP);

// --- Audio conversion ---

// 16kHz mono s16le → 48kHz stereo s16le (3x upsample, duplicate channels)
function upsample16to48stereo(buf) {
  const inSamples = buf.length / 2;
  const out = Buffer.alloc(inSamples * 3 * 4); // 3x samples, 2 channels, 2 bytes each
  for (let i = 0; i < inSamples; i++) {
    const s = buf.readInt16LE(i * 2);
    for (let r = 0; r < 3; r++) {
      const o = (i * 3 + r) * 4;
      out.writeInt16LE(s, o);     // left
      out.writeInt16LE(s, o + 2); // right
    }
  }
  return out;
}

// 48kHz stereo s16le → 16kHz mono s16le (take every 3rd frame, left channel only)
function downsample48to16mono(buf) {
  const frames = Math.floor(buf.length / 4); // 4 bytes per frame (stereo s16le)
  const outSamples = Math.floor(frames / 3);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const srcOffset = i * 3 * 4; // every 3rd frame
    out.writeInt16LE(buf.readInt16LE(srcOffset), i * 2);
  }
  return out;
}

// --- State ---
let audioPlayer = null;
let elWs = null;
let voiceConnection = null;

// --- Streaming audio playback ---
// Instead of debouncing/buffering, we use a continuous PCM stream that Discord reads from.
// ElevenLabs audio chunks get written into it as they arrive.

// Debounce-based approach: collect chunks, play after silence
let audioChunks = [];
let playTimeout = null;

function feedAudio(base64) {
  const pcm16k = Buffer.from(base64, 'base64');
  const pcm48k = upsample16to48stereo(pcm16k);
  audioChunks.push(pcm48k);
  
  // Debounce: flush after 200ms of no new chunks
  if (playTimeout) clearTimeout(playTimeout);
  playTimeout = setTimeout(flushAudio, 200);
}

function flushAudio() {
  if (audioChunks.length === 0) return;
  
  const fullBuffer = Buffer.concat(audioChunks);
  audioChunks = [];
  
  console.log(`🔊 Playing ${(fullBuffer.length / 1024).toFixed(0)}KB audio (${(fullBuffer.length / (48000 * 4) * 1000).toFixed(0)}ms)`);
  
  const stream = new PassThrough();
  stream.end(fullBuffer);
  
  const resource = createAudioResource(stream, {
    inputType: StreamType.Raw,
  });
  audioPlayer.play(resource);
}

function stopPlayback() {
  audioChunks = [];
  if (playTimeout) clearTimeout(playTimeout);
  audioPlayer.stop(true);
}

// --- ElevenLabs Conversational AI ---
function connectElevenLabs() {
  const url = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
  console.log('🔌 Connecting to ElevenLabs ConvAI...');

  elWs = new WebSocket(url, { headers: { 'xi-api-key': XI_KEY } });

  elWs.on('open', () => {
    console.log('✅ ElevenLabs WebSocket connected');
    // Send init — request PCM 16kHz output
    elWs.send(JSON.stringify({
      type: 'conversation_initiation_client_data',
      conversation_initiation_client_data: {
        conversation_config_override: {
          agent: {
            prompt: {
              prompt: "You are Scout, an AI agent running on a phone. You're sharp, witty, and helpful. Keep responses concise for voice conversation. You're talking to people in a Discord voice channel."
            },
            first_message: "Hey! Scout here. What's up?"
          },
          tts: {
            voice_id: "21m00Tcm4TlvDq8ikWAM" // Rachel - clear female voice
          }
        }
      }
    }));
  });

  elWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'conversation_initiation_metadata': {
          const meta = msg.conversation_initiation_metadata_event;
          const fmt = meta?.agent_output_audio_format || 'unknown';
          console.log(`📋 EL session ready — audio format: ${fmt}`);
          console.log(`   Conv ID: ${meta?.conversation_id || 'n/a'}`);
          break;
        }
        case 'ping':
          if (elWs.readyState === WebSocket.OPEN) {
            elWs.send(JSON.stringify({ type: 'pong', event_id: msg.ping_event?.event_id }));
          }
          break;
        case 'user_transcript': {
          const ut = msg.user_transcription_event?.user_transcript;
          if (ut) console.log(`🧑 User: ${ut}`);
          break;
        }
        case 'agent_response': {
          const ar = msg.agent_response_event?.agent_response;
          if (ar) console.log(`🐾 Scout: ${ar}`);
          break;
        }
        case 'audio': {
          const audio = msg.audio_event?.audio_base_64;
          if (audio) feedAudio(audio);
          break;
        }
        case 'interruption':
          console.log('⚡ [interrupted]');
          stopPlayback();
          break;
        case 'agent_response_correction':
          console.log(`📝 [correction]: ${msg.agent_response_correction_event?.corrected_response || ''}`);
          break;
        case 'internal_tentative_agent_response':
          // ignore — just EL thinking
          break;
        default:
          if (msg.type !== 'internal_vad_score' && msg.type !== 'internal_turn_probability') {
            console.log(`📦 [${msg.type}]`);
          }
      }
    } catch (e) {
      console.error('❌ Parse error:', e.message);
    }
  });

  elWs.on('close', (code, reason) => {
    console.log(`🔌 EL disconnected (code: ${code}, reason: ${reason || 'none'})`);
    elWs = null;
    // Reconnect after a bit
    setTimeout(() => {
      if (voiceConnection) connectElevenLabs();
    }, 3000);
  });

  elWs.on('error', (e) => console.error('❌ EL error:', e.message));
}

// --- Send user audio to ElevenLabs ---
function sendUserAudio(pcm16kMono) {
  if (elWs?.readyState === WebSocket.OPEN) {
    elWs.send(JSON.stringify({
      user_audio_chunk: pcm16kMono.toString('base64')
    }));
  }
}

// --- Discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.error('❌ Guild not found');
    process.exit(1);
  }

  // Audio player with "play" behavior even when nobody's subscribed yet
  audioPlayer = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play }
  });

  audioPlayer.on('stateChange', (old, cur) => {
    if (old.status !== cur.status) {
      console.log(`🎵 Player: ${old.status} → ${cur.status}`);
    }
  });

  audioPlayer.on('error', (err) => {
    console.error('❌ Player error:', err.message);
  });

  // Join voice channel
  console.log(`🎤 Joining voice channel ${VC_ID}...`);
  voiceConnection = joinVoiceChannel({
    channelId: VC_ID,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false
  });

  voiceConnection.on(VoiceConnectionStatus.Ready, () => {
    console.log('✅ Connected to voice channel!');
    
    // Subscribe the player so Discord sends our audio
    voiceConnection.subscribe(audioPlayer);
    
    // Connect to ElevenLabs
    connectElevenLabs();

    // Listen for users speaking
    const receiver = voiceConnection.receiver;
    
    receiver.speaking.on('start', (userId) => {
      if (userId === client.user.id) return; // ignore ourselves
      
      console.log(`🎙️ User ${userId} started speaking`);
      
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 800 }
      });

      let packetCount = 0;
      opusStream.on('data', (opusPacket) => {
        try {
          // Decode opus → 48kHz stereo PCM
          const decoded = opusDecoder.decode(opusPacket);
          const pcm48k = Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength);
          
          // Downsample → 16kHz mono PCM
          const pcm16k = downsample48to16mono(pcm48k);
          
          packetCount++;
          if (packetCount === 1) {
            console.log(`📦 First packet: opus=${opusPacket.length}B → pcm48k=${pcm48k.length}B → pcm16k=${pcm16k.length}B`);
          }
          
          // Send to ElevenLabs
          sendUserAudio(pcm16k);
        } catch (e) {
          if (packetCount < 3) console.error('⚠️ Opus decode error:', e.message);
        }
      });

      opusStream.on('end', () => {
        console.log(`🎙️ User ${userId} stopped speaking (${packetCount} packets sent)`);
      });
    });
  });

  voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.log('⚠️ Voice disconnected — attempting rejoin...');
    try {
      // Wait up to 5s for the connection to recover (e.g. server switch)
      await entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5_000);
      console.log('🔄 Reconnecting...');
    } catch {
      // If it doesn't recover, try to rejoin
      try {
        voiceConnection.rejoin();
        console.log('🔄 Rejoin requested');
      } catch (e2) {
        console.error('❌ Rejoin failed:', e2.message);
      }
    }
  });

  voiceConnection.on('error', (e) => {
    console.error('❌ Voice connection error:', e.message);
  });
});

client.on('error', (e) => console.error('❌ Client error:', e.message));

// --- Startup ---
console.log('\n  🐾 Scout Voice v4 — Discord ↔ ElevenLabs Bridge\n');
client.login(BOT_TOKEN);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  if (elWs) elWs.close();
  if (voiceConnection) voiceConnection.destroy();
  client.destroy();
  process.exit(0);
});

process.on('uncaughtException', (e) => {
  // DAVE decryption errors are non-fatal — just skip the packet
  if (e.message?.includes('decrypt') || e.message?.includes('Decryption')) {
    console.error('⚠️ Decryption error (skipping):', e.message);
    return;
  }
  console.error('💥 Uncaught:', e.message);
});

process.on('unhandledRejection', (e) => {
  console.error('💥 Unhandled rejection:', e);
});
