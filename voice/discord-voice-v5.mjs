#!/usr/bin/env node
/**
 * Scout Discord Voice v5 — Single-process Discord ↔ ElevenLabs Bridge
 * 
 * Key fix from v4: Keep ONE continuous audio subscription per user.
 * Don't re-subscribe on every speaking event. ElevenLabs needs a continuous
 * audio stream, not fragmented bursts.
 */

import { Client, GatewayIntentBits } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, EndBehaviorType, StreamType, VoiceConnectionStatus,
  NoSubscriberBehavior
} from '@discordjs/voice';
import WebSocket from 'ws';
import { PassThrough } from 'stream';
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

// --- Opus ---
const opusDecoder = new OpusScript(48000, 2, OpusScript.Application.VOIP);

// --- Audio conversion ---
function upsample16to48stereo(buf) {
  const inSamples = buf.length / 2;
  const out = Buffer.alloc(inSamples * 3 * 4);
  for (let i = 0; i < inSamples; i++) {
    const s = buf.readInt16LE(i * 2);
    for (let r = 0; r < 3; r++) {
      const o = (i * 3 + r) * 4;
      out.writeInt16LE(s, o);
      out.writeInt16LE(s, o + 2);
    }
  }
  return out;
}

function downsample48to16mono(buf) {
  const frames = Math.floor(buf.length / 4);
  const outSamples = Math.floor(frames / 3);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    out.writeInt16LE(buf.readInt16LE(i * 3 * 4), i * 2);
  }
  return out;
}

// --- State ---
let audioPlayer = null;
let elWs = null;
let voiceConnection = null;
const activeSubscriptions = new Set(); // track which users we're subscribed to

// --- Streaming Playback ---
// Single persistent stream approach: create ONE stream when first audio arrives,
// keep it alive with silence padding during gaps, only end on explicit stop/interruption.
let playStream = null;
let endTimeout = null;
let totalBytes = 0;
let isAgentSpeaking = false;

// 48kHz stereo s16le silence: 20ms frame = 3840 bytes
const SILENCE_20MS = Buffer.alloc(3840);

function feedAudio(base64) {
  const pcm16k = Buffer.from(base64, 'base64');
  const pcm48k = upsample16to48stereo(pcm16k);
  
  if (!playStream || playStream.destroyed) {
    playStream = new PassThrough({ highWaterMark: 48000 * 4 }); // 1s buffer
    totalBytes = 0;
    isAgentSpeaking = true;
    const resource = createAudioResource(playStream, { inputType: StreamType.Raw });
    audioPlayer.play(resource);
    console.log('🔊 Streaming...');
  }
  
  playStream.write(pcm48k);
  totalBytes += pcm48k.length;
  
  // Only end stream after 2s of no audio — ElevenLabs can have gaps up to ~1s between chunks
  if (endTimeout) clearTimeout(endTimeout);
  endTimeout = setTimeout(endStream, 2000);
}

function endStream() {
  if (playStream && !playStream.destroyed) {
    const durationMs = (totalBytes / (48000 * 4) * 1000).toFixed(0);
    console.log(`🔊 Done: ${(totalBytes / 1024).toFixed(0)}KB (${durationMs}ms)`);
    playStream.end();
    playStream = null;
    isAgentSpeaking = false;
  }
}

function stopPlayback() {
  if (endTimeout) clearTimeout(endTimeout);
  if (playStream && !playStream.destroyed) {
    playStream.end();
    playStream = null;
  }
  isAgentSpeaking = false;
  audioPlayer.stop(true);
}

// --- ElevenLabs ---
function sendUserAudio(pcm16kMono) {
  if (elWs?.readyState === WebSocket.OPEN) {
    elWs.send(JSON.stringify({ user_audio_chunk: pcm16kMono.toString('base64') }));
  }
}

function connectElevenLabs() {
  const url = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
  console.log('🔌 Connecting to ElevenLabs...');
  elWs = new WebSocket(url, { headers: { 'xi-api-key': XI_KEY } });

  elWs.on('open', () => {
    console.log('✅ ElevenLabs connected');
    elWs.send(JSON.stringify({
      type: 'conversation_initiation_client_data',
      conversation_initiation_client_data: {
        conversation_config_override: {
          agent: {
            prompt: { prompt: "You are Scout, a witty AI agent running on a phone. Keep responses concise for voice. You're talking to people in a Discord voice channel." },
            first_message: "Hey! Scout here. What's up?"
          },
          tts: { voice_id: "21m00Tcm4TlvDq8ikWAM" }
        }
      }
    }));
  });

  elWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'conversation_initiation_metadata':
          console.log(`📋 EL ready — format: ${msg.conversation_initiation_metadata_event?.agent_output_audio_format}`);
          break;
        case 'ping':
          if (elWs.readyState === WebSocket.OPEN)
            elWs.send(JSON.stringify({ type: 'pong', event_id: msg.ping_event?.event_id }));
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
        case 'audio':
          if (msg.audio_event?.audio_base_64) feedAudio(msg.audio_event.audio_base_64);
          break;
        case 'interruption':
          console.log('⚡ interrupted');
          stopPlayback();
          break;
      }
    } catch (e) {}
  });

  elWs.on('close', (code) => {
    console.log(`🔌 EL disconnected (${code})`);
    elWs = null;
    setTimeout(() => { if (voiceConnection) connectElevenLabs(); }, 3000);
  });
  elWs.on('error', (e) => console.error('❌ EL:', e.message));
}

// --- Discord ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

client.once('ready', async () => {
  console.log(`🤖 ${client.user.tag}`);
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) { console.error('❌ No guild'); process.exit(1); }

  audioPlayer = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play }
  });
  audioPlayer.on('stateChange', (o, n) => {
    if (o.status !== n.status) console.log(`🎵 ${o.status} → ${n.status}`);
  });
  audioPlayer.on('error', (e) => console.error('❌ Player:', e.message));

  voiceConnection = joinVoiceChannel({
    channelId: VC_ID, guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false, selfMute: false
  });

  voiceConnection.on(VoiceConnectionStatus.Ready, () => {
    console.log('✅ Voice channel joined');
    voiceConnection.subscribe(audioPlayer);
    connectElevenLabs();

    const receiver = voiceConnection.receiver;
    
    // Subscribe to users when they start speaking — but only ONCE per user.
    // Use EndBehaviorType.Manual so the stream stays open indefinitely.
    receiver.speaking.on('start', (userId) => {
      if (userId === client.user.id) return;
      if (activeSubscriptions.has(userId)) return; // already subscribed
      
      activeSubscriptions.add(userId);
      console.log(`🎙️ Subscribing to user ${userId}`);
      
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.Manual }
      });

      let totalPackets = 0;
      opusStream.on('data', (opusPacket) => {
        try {
          const decoded = opusDecoder.decode(opusPacket);
          const pcm48k = Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength);
          const pcm16k = downsample48to16mono(pcm48k);
          totalPackets++;
          sendUserAudio(pcm16k);
        } catch (e) {}
      });

      opusStream.on('close', () => {
        console.log(`🎙️ Stream closed for ${userId} (${totalPackets} packets)`);
        activeSubscriptions.delete(userId);
      });
    });
  });

  voiceConnection.on(VoiceConnectionStatus.Disconnected, () => console.log('⚠️ Disconnected'));
  voiceConnection.on('error', (e) => console.error('❌ Voice:', e.message));
});

// --- Start ---
console.log('\n  🐾 Scout Voice v5\n');
client.login(BOT_TOKEN);

process.on('SIGINT', () => {
  console.log('👋 Shutting down');
  if (elWs) elWs.close();
  if (voiceConnection) voiceConnection.destroy();
  client.destroy();
  process.exit(0);
});

process.on('uncaughtException', (e) => {
  if (e.message?.includes('ecrypt')) {
    // DAVE decryption errors — non-fatal, skip
    return;
  }
  console.error('💥', e.message);
});

process.on('unhandledRejection', (e) => console.error('💥 Rejection:', e));
