#!/usr/bin/env node
/**
 * Scout Discord Voice v3 - ElevenLabs ConvAI in Discord voice channel
 */

import { Client, GatewayIntentBits } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, EndBehaviorType, StreamType, VoiceConnectionStatus
} from '@discordjs/voice';
import WebSocket from 'ws';
import { PassThrough } from 'stream';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');

const config = JSON.parse(readFileSync('/data/data/com.termux/files/home/.openclaw/openclaw.json', 'utf8'));
const BOT_TOKEN = config.channels.discord.token;
const XI_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_3701kh95btt4e5p850zy2dntsevf';
const GUILD_ID = '1470437674681630913';
const VC_ID = '1470437675172499652';

const opusDecoder = new OpusScript(48000, 2, OpusScript.Application.VOIP);
let audioPlayer = null;
let elWs = null;
let currentStream = null;

// --- Upsample 16kHz mono → 48kHz stereo s16le ---
function upsample(buf) {
  const len = buf.length - (buf.length % 2);
  const samples = len / 2;
  const out = Buffer.alloc(samples * 12);
  for (let i = 0; i < samples; i++) {
    const s = buf.readInt16LE(i * 2);
    for (let r = 0; r < 3; r++) {
      const o = (i * 3 + r) * 4;
      if (o + 3 < out.length) {
        out.writeInt16LE(s, o);
        out.writeInt16LE(s, o + 2);
      }
    }
  }
  return out;
}

// Downsample 48kHz stereo → 16kHz mono
function downsample(buf) {
  const frames = Math.floor(buf.length / 4);
  const outSamples = Math.floor(frames / 3);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const srcIdx = i * 3 * 4;
    if (srcIdx + 1 < buf.length) {
      out.writeInt16LE(buf.readInt16LE(srcIdx), i * 2);
    }
  }
  return out;
}

// --- Play audio: collect all chunks per response, then play ---
let audioChunks = [];
let playTimeout = null;

function queueAudio(base64) {
  const pcm16k = Buffer.from(base64, 'base64');
  const pcm48k = upsample(pcm16k);
  audioChunks.push(pcm48k);
  
  // Debounce: play after 150ms of no new chunks (= end of response audio)
  if (playTimeout) clearTimeout(playTimeout);
  playTimeout = setTimeout(flushAudio, 150);
}

function flushAudio() {
  if (audioChunks.length === 0) return;
  
  const fullBuffer = Buffer.concat(audioChunks);
  audioChunks = [];
  
  console.log(`🔊 Playing ${(fullBuffer.length / 1024).toFixed(0)}KB audio`);
  
  const stream = new PassThrough();
  stream.end(fullBuffer);
  
  const resource = createAudioResource(stream, { inputType: StreamType.Raw });
  audioPlayer.play(resource);
}

function stopAudio() {
  audioChunks = [];
  if (playTimeout) clearTimeout(playTimeout);
  audioPlayer.stop();
}

// --- ElevenLabs ConvAI ---
function connectEL(connection) {
  const url = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
  console.log('🔌 Connecting to ElevenLabs...');

  elWs = new WebSocket(url, { headers: { 'xi-api-key': XI_KEY } });

  elWs.on('open', () => {
    console.log('✅ ElevenLabs connected');
    elWs.send(JSON.stringify({
      type: 'conversation_initiation_client_data',
      conversation_initiation_client_data: {}
    }));
  });

  elWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'conversation_initiation_metadata':
          console.log('📋 Session ready');
          connection.subscribe(audioPlayer);
          break;
        case 'ping':
          elWs.send(JSON.stringify({ type: 'pong', event_id: msg.ping_event?.event_id }));
          break;
        case 'user_transcript':
          const ut = msg.user_transcription_event?.user_transcript;
          if (ut) console.log(`🧑 User: ${ut}`);
          break;
        case 'agent_response':
          const ar = msg.agent_response_event?.agent_response;
          if (ar) console.log(`🐾 Scout: ${ar}`);
          break;
        case 'audio':
          const audio = msg.audio_event?.audio_base_64;
          if (audio) queueAudio(audio);
          break;
        case 'interruption':
          console.log('⚡ [interrupted]');
          stopAudio();
          break;
      }
    } catch (e) {}
  });

  elWs.on('close', (code) => console.log(`🔌 EL disconnected (${code})`));
  elWs.on('error', (e) => console.error('❌ EL error:', e.message));
}

// --- Discord ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

client.once('ready', async () => {
  console.log(`🤖 ${client.user.tag} ready`);
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) { console.error('❌ No guild'); process.exit(1); }

  audioPlayer = createAudioPlayer();
  
  // Log player state changes for debugging
  audioPlayer.on('stateChange', (old, cur) => {
    if (old.status !== cur.status) {
      console.log(`🎵 Player: ${old.status} → ${cur.status}`);
    }
  });

  const conn = joinVoiceChannel({
    channelId: VC_ID, guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false, selfMute: false
  });

  conn.on(VoiceConnectionStatus.Ready, () => {
    console.log('✅ In voice channel');
    connectEL(conn);

    const receiver = conn.receiver;
    receiver.speaking.on('start', (userId) => {
      const stream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 }
      });

      stream.on('data', (opusPacket) => {
        try {
          const pcm48k = Buffer.from(opusDecoder.decode(opusPacket).buffer);
          const pcm16k = downsample(pcm48k);
          if (elWs?.readyState === WebSocket.OPEN) {
            elWs.send(JSON.stringify({ user_audio_chunk: pcm16k.toString('base64') }));
          }
        } catch (e) {}
      });
    });
  });

  conn.on('error', (e) => console.error('❌ Voice error:', e.message));
});

client.login(BOT_TOKEN);
process.on('SIGINT', () => { client.destroy(); process.exit(0); });

console.log('\n  🐾 Scout Voice v3\n');
