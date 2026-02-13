#!/usr/bin/env node
/**
 * Scout Discord Voice v6 — The Real Scout
 * 
 * Pipeline: Discord Voice → ElevenLabs STT → Claude (real Scout) → ElevenLabs TTS → Discord Voice
 * Auto-joins when Tom enters voice, leaves when he leaves.
 */

import { Client, GatewayIntentBits } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, EndBehaviorType, StreamType, VoiceConnectionStatus,
  NoSubscriberBehavior, getVoiceConnection
} from '@discordjs/voice';
import WebSocket from 'ws';
import { PassThrough } from 'stream';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import https from 'https';

const require = createRequire(import.meta.url);
const OpusScript = require('opusscript');

// --- Config ---
const config = JSON.parse(readFileSync('/data/data/com.termux/files/home/.openclaw/openclaw.json', 'utf8'));
const authProfiles = JSON.parse(readFileSync('/data/data/com.termux/files/home/.openclaw/agents/main/agent/auth-profiles.json', 'utf8'));
const BOT_TOKEN = config.channels.discord.token;
const ANTHROPIC_KEY = Object.values(authProfiles.profiles).find(p => p.provider === 'anthropic')?.token;
const XI_KEY = process.env.ELEVENLABS_API_KEY;
const GUILD_ID = '1470437674681630913';
const VC_ID = '1470437675172499652';
const TOM_ID = '399230520950521856';
const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel
const WORKSPACE = '/data/data/com.termux/files/home/.openclaw/workspace';

// --- Load Scout's personality ---
function loadScoutPersonality() {
  const files = ['SOUL.md', 'USER.md', 'IDENTITY.md', 'MEMORY.md'];
  let personality = `You are Scout, an AI agent in a Discord voice conversation. You're talking out loud — keep responses concise, conversational, and natural for speech. No markdown, no bullet points, no long lists. Talk like a real person.\n\n`;
  
  for (const file of files) {
    const path = `${WORKSPACE}/${file}`;
    if (existsSync(path)) {
      personality += `--- ${file} ---\n${readFileSync(path, 'utf8')}\n\n`;
    }
  }
  
  // Today's memory
  const today = new Date().toISOString().split('T')[0];
  const memPath = `${WORKSPACE}/memory/${today}.md`;
  if (existsSync(memPath)) {
    personality += `--- Today's Notes ---\n${readFileSync(memPath, 'utf8')}\n\n`;
  }
  
  personality += `IMPORTANT: You're in a voice call. Keep answers SHORT (1-3 sentences usually). Be natural, warm, witty. Swear when it fits. Don't narrate actions like [laughs] or [excited].`;
  return personality;
}

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
let voiceConnection = null;
let conversationHistory = [];
let isProcessing = false;
const activeSubscriptions = new Set();

// --- Playback ---
let playStream = null;
let endTimeout = null;

function feedAudioPCM(pcm48kStereo) {
  if (!playStream || playStream.destroyed) {
    playStream = new PassThrough({ highWaterMark: 48000 * 4 });
    const resource = createAudioResource(playStream, { inputType: StreamType.Raw });
    audioPlayer.play(resource);
  }
  playStream.write(pcm48kStereo);
  
  if (endTimeout) clearTimeout(endTimeout);
  endTimeout = setTimeout(() => {
    if (playStream && !playStream.destroyed) {
      playStream.end();
      playStream = null;
    }
  }, 2000);
}

function stopPlayback() {
  if (endTimeout) clearTimeout(endTimeout);
  if (playStream && !playStream.destroyed) {
    playStream.end();
    playStream = null;
  }
  audioPlayer?.stop(true);
}

// --- ElevenLabs STT ---
async function transcribeAudio(pcmBuffer) {
  // Convert PCM 16kHz mono s16le to WAV
  const wavBuffer = pcmToWav(pcmBuffer, 16000, 1, 16);
  
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    
    const parts = [];
    // model_id field
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v1`);
    // file field
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
    
    const header = Buffer.from(parts.join('\r\n') + '\r\n', 'utf8');
    // Fix: need the boundary before file content
    const preFile = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v1\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
    const postFile = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([preFile, wavBuffer, postFile]);
    
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: '/v1/speech-to-text',
      method: 'POST',
      headers: {
        'xi-api-key': XI_KEY,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result.text || '');
        } catch (e) {
          reject(new Error(`STT parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function pcmToWav(pcmData, sampleRate, channels, bitsPerSample) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);
  
  return Buffer.concat([header, pcmData]);
}

// --- Claude API ---
async function askClaude(userMessage) {
  conversationHistory.push({ role: 'user', content: userMessage });
  
  // Keep history manageable (last 20 exchanges)
  if (conversationHistory.length > 40) {
    conversationHistory = conversationHistory.slice(-40);
  }
  
  const systemPrompt = loadScoutPersonality();
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300, // Keep voice responses short
      system: systemPrompt,
      messages: conversationHistory
    });
    
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const text = result.content?.[0]?.text || '';
          conversationHistory.push({ role: 'assistant', content: text });
          resolve(text);
        } catch (e) {
          reject(new Error(`Claude parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- ElevenLabs TTS Streaming ---
async function streamTTS(text) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=eleven_turbo_v2_5&output_format=pcm_16000`, {
      headers: { 'xi-api-key': XI_KEY }
    });
    
    ws.on('open', () => {
      // Send BOS (beginning of stream)
      ws.send(JSON.stringify({
        text: ' ',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        generation_config: { chunk_length_schedule: [120, 160, 250, 290] }
      }));
      
      // Send the full text
      ws.send(JSON.stringify({ text: text }));
      
      // Send EOS (end of stream)  
      ws.send(JSON.stringify({ text: '' }));
    });
    
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.audio) {
          const pcm16k = Buffer.from(msg.audio, 'base64');
          const pcm48k = upsample16to48stereo(pcm16k);
          feedAudioPCM(pcm48k);
        }
        if (msg.isFinal) {
          ws.close();
          resolve();
        }
      } catch (e) {}
    });
    
    ws.on('error', (e) => {
      console.error('❌ TTS:', e.message);
      reject(e);
    });
    ws.on('close', () => resolve());
  });
}

// --- Process user utterance ---
async function processUtterance(pcmBuffers) {
  if (isProcessing) return;
  isProcessing = true;
  
  const fullPCM = Buffer.concat(pcmBuffers);
  const durationMs = (fullPCM.length / (16000 * 2)) * 1000;
  
  // Skip very short utterances (< 500ms — probably noise)
  if (durationMs < 500) {
    isProcessing = false;
    return;
  }
  
  console.log(`🎤 Processing ${(durationMs / 1000).toFixed(1)}s of audio...`);
  
  try {
    // 1. STT
    const t0 = Date.now();
    const transcript = await transcribeAudio(fullPCM);
    const sttMs = Date.now() - t0;
    
    if (!transcript || transcript.trim().length === 0) {
      console.log(`🔇 No speech detected (STT: ${sttMs}ms)`);
      isProcessing = false;
      return;
    }
    console.log(`🧑 Tom: "${transcript}" (STT: ${sttMs}ms)`);
    
    // 2. Claude
    const t1 = Date.now();
    const response = await askClaude(transcript);
    const llmMs = Date.now() - t1;
    console.log(`🐾 Scout: "${response}" (LLM: ${llmMs}ms)`);
    
    // 3. TTS
    const t2 = Date.now();
    console.log(`🔊 Speaking...`);
    await streamTTS(response);
    const ttsMs = Date.now() - t2;
    console.log(`✅ Total: STT ${sttMs}ms + LLM ${llmMs}ms + TTS ${ttsMs}ms = ${sttMs + llmMs + ttsMs}ms`);
    
  } catch (e) {
    console.error('❌ Pipeline error:', e.message);
  }
  
  isProcessing = false;
}

// --- Discord ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

function joinVC(guild) {
  if (voiceConnection) return;
  
  audioPlayer = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play }
  });
  audioPlayer.on('error', (e) => console.error('❌ Player:', e.message));

  voiceConnection = joinVoiceChannel({
    channelId: VC_ID, guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false, selfMute: false
  });

  voiceConnection.on(VoiceConnectionStatus.Ready, () => {
    console.log('✅ Joined voice channel');
    voiceConnection.subscribe(audioPlayer);
    
    // Reset conversation for new session
    conversationHistory = [];
    activeSubscriptions.clear();
    
    // Greet
    greet();
    
    // Listen for audio
    const receiver = voiceConnection.receiver;
    receiver.speaking.on('start', (userId) => {
      if (userId === client.user.id) return;
      if (activeSubscriptions.has(userId)) return;
      
      activeSubscriptions.add(userId);
      console.log(`🎙️ Listening to user ${userId}`);
      
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.Manual }
      });
      
      // Collect PCM chunks, detect silence to trigger processing
      let pcmBuffers = [];
      let silenceTimeout = null;
      let speaking = false;
      
      opusStream.on('data', (opusPacket) => {
        try {
          const decoded = opusDecoder.decode(opusPacket);
          const pcm48k = Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength);
          const pcm16k = downsample48to16mono(pcm48k);
          
          // Check if this is actual audio or silence
          // Opus silence frames are typically 3 bytes
          if (opusPacket.length > 10) {
            speaking = true;
            pcmBuffers.push(pcm16k);
            
            // Reset silence timer
            if (silenceTimeout) clearTimeout(silenceTimeout);
            silenceTimeout = setTimeout(() => {
              if (pcmBuffers.length > 0 && speaking) {
                speaking = false;
                const buffers = pcmBuffers;
                pcmBuffers = [];
                processUtterance(buffers);
              }
            }, 1200); // 1.2s silence = end of utterance
          }
        } catch (e) {}
      });
      
      opusStream.on('close', () => {
        activeSubscriptions.delete(userId);
        console.log(`🎙️ User ${userId} stream closed`);
      });
    });
  });

  voiceConnection.on('error', (e) => console.error('❌ Voice:', e.message));
}

function leaveVC() {
  if (voiceConnection) {
    voiceConnection.destroy();
    voiceConnection = null;
    audioPlayer = null;
    activeSubscriptions.clear();
    console.log('👋 Left voice channel');
  }
}

async function greet() {
  try {
    const greeting = await askClaude("*Tom just joined the voice channel. Give a brief, casual greeting. One sentence max.*");
    console.log(`🐾 Greeting: "${greeting}"`);
    await streamTTS(greeting);
  } catch (e) {
    console.error('❌ Greet error:', e.message);
  }
}

// --- Auto-join/leave ---
client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.member.id !== TOM_ID) return;
  
  const joinedVC = newState.channelId === VC_ID && oldState.channelId !== VC_ID;
  const leftVC = oldState.channelId === VC_ID && newState.channelId !== VC_ID;
  
  if (joinedVC) {
    console.log('👤 Tom joined voice — joining...');
    joinVC(newState.guild);
  } else if (leftVC) {
    console.log('👤 Tom left voice — leaving...');
    leaveVC();
  }
});

client.once('ready', () => {
  console.log(`🤖 ${client.user.tag} online — waiting for Tom to join voice`);
  
  // Check if Tom is already in VC
  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    const vc = guild.channels.cache.get(VC_ID);
    if (vc?.members?.has(TOM_ID)) {
      console.log('👤 Tom is already in voice!');
      joinVC(guild);
    }
  }
});

// --- Start ---
console.log('\n  🐾 Scout Voice v6 — The Real Scout\n');

if (!ANTHROPIC_KEY) {
  console.error('❌ No Anthropic API key found!');
  process.exit(1);
}

client.login(BOT_TOKEN);

process.on('SIGINT', () => {
  leaveVC();
  client.destroy();
  process.exit(0);
});

process.on('uncaughtException', (e) => {
  if (e.message?.includes('ecrypt')) return;
  console.error('💥', e.message);
});

process.on('unhandledRejection', (e) => console.error('💥', e));
