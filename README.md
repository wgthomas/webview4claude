# WebView4Claude

A browser-based GUI for [Claude Code](https://claude.com/claude-code). No new AI backend — this is a thin web wrapper around the real Claude Code via the [Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). Same auth, same tools, same MCP servers. Just a better window.

## What It Does

- **Streaming chat UI** — Token-by-token text rendering via SSE
- **Tool call visibility** — Collapsible cards showing tool name, input, output, and status
- **Session management** — Create, switch, delete sessions with different working directories and models
- **Session resume** — Conversations persist across page refreshes via Agent SDK session IDs
- **Cost tracking** — Per-query and cumulative cost/token display
- **Thinking indicator** — Animated spinner with rotating status messages while Claude works
- **Interrupt support** — Stop button to abort mid-response
- **Configurable branding** — Change the app name, tagline, and defaults via `config.json`

## Architecture

```
Browser (vanilla JS, no build step)
  │
  ├── POST /api/chat          → Send prompt, get 202 back
  ├── GET  /api/chat/:id/sse  → SSE stream of Claude's response
  ├── POST /api/chat/:id/stop → Interrupt running query
  ├── GET  /api/sessions      → List sessions
  ├── POST /api/sessions      → Create session
  ├── DELETE /api/sessions/:id → Delete session
  └── GET  /api/sessions/:id/history
                │
Express Server (port 3456)
                │
        Agent SDK query() ← async generator streaming messages
```

The server calls `query()` from `@anthropic-ai/claude-agent-sdk` with `systemPrompt: { type: 'preset', preset: 'claude_code' }` and `bypassPermissions` mode. Claude Code runs server-side with full tool access. The browser just renders what it streams back.

## Requirements

- **Node.js** 18+
- **Claude Code** installed and authenticated (`claude` CLI must work)
- That's it. The Agent SDK uses your existing Claude Code auth.

## Quick Start

```bash
git clone https://github.com/wgthomas/webview4claude.git
cd webview4claude
npm install
npm run dev
```

Open `http://localhost:3456`. Create a session, point it at a project directory, and start chatting.

## Configuration

Edit `config.json` in the project root:

```json
{
  "name": "Claude Web",
  "tagline": "Claude Code in a browser window.",
  "defaultCwd": "D:\\projects\\",
  "defaultModel": "claude-sonnet-4-5-20250929"
}
```

| Field | Description |
|-------|-------------|
| `name` | App name shown in sidebar, page title, and empty state |
| `tagline` | Subtitle on the landing screen |
| `defaultCwd` | Pre-filled working directory when creating new sessions |
| `defaultModel` | Default model for new sessions |

Restart the server after editing.

## Project Structure

```
webview4claude/
├── config.json                  # Branding and defaults
├── package.json
├── server.js                    # Express server, REST + SSE endpoints
├── lib/
│   ├── agent-runner.js          # Agent SDK wrapper, streams to SSE
│   ├── session-store.js         # In-memory sessions + JSON persistence
│   └── sse-manager.js           # SSE connection tracking per session
├── public/
│   ├── index.html               # SPA shell
│   ├── cybertron.css            # Design system (dark theme)
│   ├── cybertron-components.js  # Reusable UI components
│   ├── app.css                  # Chat-specific styles
│   ├── app.js                   # Frontend application logic
│   └── chat-renderer.js         # Markdown + code highlighting + tool cards
└── data/
    └── sessions.json            # Persisted session metadata
```

**3 npm dependencies.** No React, no Tailwind, no build step, no TypeScript compilation.

## Models

The model selector supports:
- **Sonnet 4.5** — `claude-sonnet-4-5-20250929` (default, fast + capable)
- **Opus 4.6** — `claude-opus-4-6` (most capable)
- **Haiku 4.5** — `claude-haiku-4-5-20251001` (fastest, cheapest)

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Enter` | Send message |
| `Escape` | Stop/interrupt current response |

## Reverse Proxy (Optional)

For access via a custom domain (e.g., `https://claude.example.com`), put it behind nginx:

```nginx
server {
    listen 443 ssl;
    server_name claude.example.com;

    location / {
        proxy_pass http://127.0.0.1:3456;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
```

The key settings for SSE: `proxy_buffering off` and a long `proxy_read_timeout`.

## How It Works

1. You type a message in the browser
2. `POST /api/chat` sends the prompt to the server
3. The server calls `query()` from the Agent SDK with your prompt
4. The SDK runs Claude Code with the full system prompt, tools, and MCP servers
5. As Claude streams its response, the server broadcasts events over SSE
6. The browser renders text token-by-token, shows tool calls as collapsible cards
7. When Claude finishes, a result banner shows cost, duration, and token usage
8. The SDK session ID is saved so the next message resumes the conversation

## License

MIT
