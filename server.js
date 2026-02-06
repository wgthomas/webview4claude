/**
 * Claude Web — Express Server
 * Browser GUI for Claude Code via Agent SDK.
 * Port 3456 on Megatron2.
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import store from './lib/session-store.js';
import sse from './lib/sse-manager.js';
import runner from './lib/agent-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3456;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── Config ──────────────────────────────────────────────────────

import { readFileSync } from 'fs';
const configPath = join(__dirname, 'config.json');
let config = { name: 'Claude Web', tagline: 'Claude Code in a browser window.', defaultCwd: '', defaultModel: 'claude-sonnet-4-5-20250929' };
try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}

app.get('/api/config', (req, res) => res.json(config));

// ─── Health ───────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── Sessions CRUD ────────────────────────────────────────────────

app.get('/api/sessions', (req, res) => {
  res.json(store.list());
});

app.post('/api/sessions', (req, res) => {
  const { name, cwd, model } = req.body;
  if (!cwd) return res.status(400).json({ error: 'cwd is required' });
  const session = store.create({ name, cwd, model });
  res.status(201).json(session);
});

app.delete('/api/sessions/:id', (req, res) => {
  if (runner.isRunning(req.params.id)) {
    runner.interrupt(req.params.id);
  }
  const deleted = store.delete(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

app.get('/api/sessions/:id/history', (req, res) => {
  const session = store.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(store.getHistory(req.params.id));
});

// ─── Chat ─────────────────────────────────────────────────────────

app.post('/api/chat', (req, res) => {
  const { sessionId, prompt } = req.body;
  if (!sessionId || !prompt) {
    return res.status(400).json({ error: 'sessionId and prompt are required' });
  }

  const session = store.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'running') {
    return res.status(409).json({ error: 'Session is already running' });
  }

  // Fire and forget — results stream via SSE
  runner.run(sessionId, prompt).catch(err => {
    console.error('[Server] Runner error:', err.message);
  });

  res.status(202).json({ ok: true, sessionId });
});

app.post('/api/chat/:id/stop', (req, res) => {
  const interrupted = runner.interrupt(req.params.id);
  res.json({ ok: true, interrupted });
});

// ─── SSE Stream ───────────────────────────────────────────────────

app.get('/api/chat/:id/sse', (req, res) => {
  const session = store.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // nginx: disable proxy buffering
  });

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ sessionId: req.params.id })}\n\n`);

  // Keep-alive every 30s
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  sse.add(req.params.id, res);

  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

// ─── Start ────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Claude Web running at http://localhost:${PORT}`);
  console.log(`Sessions: ${store.list().length} loaded from disk`);
});
