# OpenClaw Gateway API Documentation

Investigation conducted on device (Saga) with OpenClaw 2026.2.9.

## Overview

OpenClaw provides a **WebSocket gateway** (not HTTP REST) for agent communication. For Scout, the recommended integration path is using the **CLI `openclaw agent` command** which handles WebSocket protocol details internally.

## Gateway Details

- **Protocol:** WebSocket
- **Default URL:** `ws://localhost:18789`
- **Auth:** Token-based (optional, configured in openclaw.json)

## Starting the Gateway

On Android/Termux, the gateway must be started manually (no systemd service):

```bash
# Start gateway (foreground)
openclaw gateway run --port 18789

# Start gateway (background)
nohup openclaw gateway run --port 18789 > ~/tmp/gw.log 2>&1 &
```

## Health Check

```bash
# CLI health check
openclaw gateway health

# JSON output
openclaw gateway call health --json
```

Response:
```json
{
  "ok": true,
  "ts": 1770990177615,
  "durationMs": 657,
  "channels": { ... },
  "defaultAgentId": "main",
  "agents": [ ... ]
}
```

## Sending Messages to Agent

### CLI Method (Recommended for Scout)

```bash
openclaw agent --agent main --message "Your message here" --json
```

### Request Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--agent <id>` | Yes* | Agent ID (typically "main") |
| `--message <text>` | Yes | User message |
| `--json` | Recommended | JSON output format |
| `--session-id <id>` | Optional | Explicit session ID |
| `--local` | Optional | Run embedded agent (not via gateway) |

*Either `--agent`, `--to`, or `--session-id` required.

### Response Format

```json
{
  "runId": "bc22aa36-62c2-4b6f-aa13-7ad7813e1795",
  "status": "ok",
  "summary": "completed",
  "result": {
    "payloads": [
      {
        "text": "Agent response text here",
        "mediaUrl": null
      }
    ],
    "meta": {
      "durationMs": 2707,
      "agentMeta": {
        "sessionId": "2eb6ddc0-8842-4984-9fa1-5e743bcfd3fa",
        "provider": "anthropic",
        "model": "claude-opus-4-6",
        "usage": {
          "input": 3,
          "output": 15,
          "cacheWrite": 16194,
          "total": 16212
        }
      }
    }
  }
}
```

### Key Response Fields

| Field | Description |
|-------|-------------|
| `status` | "ok" or error status |
| `result.payloads[].text` | Agent response text (what to synthesize with TTS) |
| `result.payloads[].mediaUrl` | Optional media attachment |
| `result.meta.durationMs` | Processing time |
| `result.meta.agentMeta.sessionId` | Session identifier |
| `result.meta.agentMeta.model` | Model used |

## Scout Integration

### Recommended Approach

Use Node.js `child_process.spawn` to call the CLI:

```javascript
import { spawn } from 'child_process';

async function sendToOpenClaw(message) {
  return new Promise((resolve, reject) => {
    const proc = spawn('openclaw', [
      'agent',
      '--agent', 'main',
      '--message', message,
      '--json'
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => stdout += data);
    proc.stderr.on('data', (data) => stderr += data);

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result.result.payloads[0]?.text || '');
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      } else {
        reject(new Error(`OpenClaw error: ${stderr}`));
      }
    });
  });
}
```

### Alternative: Direct WebSocket

For lower latency or streaming responses, connect directly to WebSocket:

```javascript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:18789');

ws.on('open', () => {
  ws.send(JSON.stringify({
    method: 'agent.run',
    params: {
      agentId: 'main',
      message: 'Hello'
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  // Handle response...
});
```

**Note:** WebSocket protocol details not fully documented here. CLI approach is simpler and recommended for Phase 0.

## Session Management

OpenClaw manages sessions automatically:
- Sessions persist conversation history
- Session ID is auto-generated or can be specified
- Use `--agent main` for consistent session routing

Check sessions:
```bash
openclaw gateway call status --json
```

## Error Handling

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success |
| 1 | Error (check stderr) |
| 7 | Connection refused (gateway not running) |

Common errors:
- "Gateway not running" → Start with `openclaw gateway run`
- "Pass --to, --session-id, or --agent" → Specify target
- Timeout → Gateway may be overloaded; retry

## Environment

Ensure PATH includes OpenClaw:
```bash
export PATH=$PATH:/data/data/com.termux/files/usr/lib/node_modules/.bin
```

Or use full path:
```bash
/data/data/com.termux/files/usr/lib/node_modules/.bin/openclaw agent ...
```

## Configuration

Gateway config in `~/.openclaw/openclaw.json`:
- Agent workspace: `~/.openclaw/workspace/`
- Sessions: `~/.openclaw/agents/main/sessions/`
- Logs: `/data/data/com.termux/files/usr/tmp/openclaw/openclaw.log`

## ACP (Agent Control Protocol)

For interactive/streaming use cases, OpenClaw provides ACP:

```bash
openclaw acp client
```

This creates a bidirectional session. May be useful for future streaming voice implementations.

---

## Summary for Scout Implementation

1. **Start gateway:** `openclaw gateway run --port 18789` (must be running)
2. **Health check:** `openclaw gateway health` (verify connection)
3. **Send message:** `openclaw agent --agent main --message "text" --json`
4. **Parse response:** Extract `result.payloads[0].text`
5. **Handle errors:** Check exit code, parse stderr

Typical latency: 2-3 seconds for short responses (depends on Claude model).
