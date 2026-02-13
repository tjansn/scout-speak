#!/usr/bin/env node
/**
 * Scout Voice Client - Real-time voice conversation via ElevenLabs
 * 
 * Audio I/O:
 *   Mic:     parecord (PulseAudio) → s16le 16kHz mono → base64 chunks → WebSocket
 *   Speaker: WebSocket → base64 chunks → PCM → pacat (PulseAudio)
 */

import WebSocket from 'ws';
import { spawn } from 'child_process';

// Config
const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

if (!API_KEY || !AGENT_ID) {
  console.error('❌ Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID');
  process.exit(1);
}

// --- Audio Playback via pacat ---
let pacat = null;

function ensurePlayback() {
  if (pacat && !pacat.killed) return;
  pacat = spawn('pacat', [
    '--playback',
    '--format=s16le',
    '--rate=16000',
    '--channels=1',
    '--latency-msec=50'
  ], { stdio: ['pipe', 'ignore', 'ignore'] });
  
  pacat.on('error', (e) => console.error('🔊 Playback error:', e.message));
  pacat.on('close', () => { pacat = null; });
}

function playAudio(base64) {
  ensurePlayback();
  if (pacat?.stdin?.writable) {
    pacat.stdin.write(Buffer.from(base64, 'base64'));
  }
}

function flushPlayback() {
  if (pacat) {
    pacat.kill();
    pacat = null;
  }
}

// --- Microphone Capture via parecord ---
let mic = null;

function startMic(ws) {
  console.log('🎙️  Microphone active');
  
  mic = spawn('parecord', [
    '--format=s16le',
    '--rate=16000',
    '--channels=1',
    '--latency-msec=100'
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  
  const CHUNK_MS = 100; // send 100ms chunks
  const CHUNK_BYTES = 16000 * 2 * 1 * (CHUNK_MS / 1000); // 3200 bytes per chunk
  let buf = Buffer.alloc(0);
  
  mic.stdout.on('data', (data) => {
    buf = Buffer.concat([buf, data]);
    
    while (buf.length >= CHUNK_BYTES) {
      const chunk = buf.subarray(0, CHUNK_BYTES);
      buf = buf.subarray(CHUNK_BYTES);
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          user_audio_chunk: chunk.toString('base64')
        }));
      }
    }
  });
  
  mic.on('error', (e) => console.error('🎙️ Mic error:', e.message));
  mic.on('close', () => { mic = null; });
}

function stopMic() {
  if (mic) { mic.kill(); mic = null; }
}

// --- WebSocket ---
function connect() {
  const url = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
  console.log('🔌 Connecting to ElevenLabs...');
  
  const ws = new WebSocket(url, {
    headers: { 'xi-api-key': API_KEY }
  });
  
  ws.on('open', () => {
    console.log('✅ Connected!\n');
    
    // Override agent config for Scout personality
    ws.send(JSON.stringify({
      type: 'conversation_initiation_client_data',
      conversation_initiation_client_data: {
        conversation_config_override: {
          agent: {
            prompt: {
              prompt: `You are Scout 🐾, an AI assistant living on an Android phone. You talk to Tom, your human partner who's building a business teaching people about AI agents. Be concise — this is voice, not text. 1-3 sentences unless asked for detail. Be natural, witty, opinionated. Light swearing is fine. You have strong takes and don't hedge.`
            },
            first_message: "Hey Tom, Scout here. What's on your mind?"
          }
        }
      }
    }));
    
    ensurePlayback();
    startMic(ws);
  });
  
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      
      switch (msg.type) {
        case 'conversation_initiation_metadata':
          const fmt = msg.conversation_initiation_metadata_event?.agent_output_audio_format;
          console.log(`📋 Session ready (audio: ${fmt || 'default'})`);
          break;
          
        case 'ping':
          ws.send(JSON.stringify({
            type: 'pong',
            event_id: msg.ping_event?.event_id
          }));
          break;
          
        case 'user_transcript':
          const ut = msg.user_transcription_event?.user_transcript;
          if (ut) console.log(`\n🧑 You: ${ut}`);
          break;
          
        case 'agent_response':
          const ar = msg.agent_response_event?.agent_response;
          if (ar) process.stdout.write(`🐾 Scout: ${ar}\n`);
          break;
          
        case 'audio':
          const audio = msg.audio_event?.audio_base_64;
          if (audio) playAudio(audio);
          break;
          
        case 'interruption':
          console.log('⚡ [interrupted]');
          flushPlayback();
          break;
          
        case 'agent_response_correction':
          break; // ignore corrections in terminal
          
        default:
          break;
      }
    } catch (e) {
      // ignore parse errors
    }
  });
  
  ws.on('close', (code, reason) => {
    console.log(`\n🔌 Disconnected (${code})`);
    cleanup();
  });
  
  ws.on('error', (e) => {
    console.error('❌ Error:', e.message);
  });
  
  return ws;
}

function cleanup() {
  stopMic();
  flushPlayback();
}

// --- Main ---
console.log('');
console.log('  🐾 Scout Voice');
console.log('  ─────────────');
console.log('  Speak naturally. Ctrl+C to quit.');
console.log('');

const ws = connect();

process.on('SIGINT', () => {
  console.log('\n👋 Bye!');
  cleanup();
  ws.close();
  setTimeout(() => process.exit(0), 500);
});
