/**
 * Session Store
 * In-memory session management with debounced JSON persistence.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, '..', 'data', 'sessions.json');

class SessionStore {
  constructor() {
    /** @type {Map<string, object>} */
    this.sessions = new Map();
    this._saveTimer = null;
    this._load();
  }

  _load() {
    try {
      if (existsSync(DATA_FILE)) {
        const raw = readFileSync(DATA_FILE, 'utf-8');
        const arr = JSON.parse(raw);
        for (const s of arr) {
          // Don't persist message bodies to disk — too large.
          // Messages live only in memory for the current server lifetime.
          s.messages = s.messages || [];
          this.sessions.set(s.id, s);
        }
      }
    } catch {
      // Start fresh if file is corrupted
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, 5000);
  }

  _save() {
    try {
      const arr = Array.from(this.sessions.values()).map(s => ({
        ...s,
        messages: [] // Don't persist messages to disk
      }));
      writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
    } catch (err) {
      console.error('[SessionStore] Save error:', err.message);
    }
  }

  /**
   * Create a new session.
   * @param {object} opts
   * @param {string} opts.name
   * @param {string} opts.cwd
   * @param {string} [opts.model]
   * @returns {object} The created session
   */
  create({ name, cwd, model }) {
    const session = {
      id: uuid(),
      name: name || 'New Session',
      cwd: cwd || process.cwd(),
      model: model || 'claude-sonnet-4-5-20250929',
      sdkSessionId: null,
      messages: [],
      status: 'idle', // idle | running | error
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString()
    };
    this.sessions.set(session.id, session);
    this._scheduleSave();
    return session;
  }

  /**
   * Get a session by ID.
   * @param {string} id
   * @returns {object|null}
   */
  get(id) {
    return this.sessions.get(id) || null;
  }

  /**
   * List all sessions (metadata only, no messages).
   * @returns {object[]}
   */
  list() {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      name: s.name,
      cwd: s.cwd,
      model: s.model,
      status: s.status,
      totalCost: s.totalCost,
      totalInputTokens: s.totalInputTokens,
      totalOutputTokens: s.totalOutputTokens,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt
    }));
  }

  /**
   * Update session fields.
   * @param {string} id
   * @param {object} updates
   * @returns {object|null}
   */
  update(id, updates) {
    const session = this.sessions.get(id);
    if (!session) return null;
    Object.assign(session, updates);
    session.lastActiveAt = new Date().toISOString();
    this._scheduleSave();
    return session;
  }

  /**
   * Add a message to a session's history.
   * @param {string} id
   * @param {object} message
   */
  addMessage(id, message) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.messages.push(message);
    session.lastActiveAt = new Date().toISOString();
  }

  /**
   * Get message history for a session.
   * @param {string} id
   * @returns {object[]}
   */
  getHistory(id) {
    const session = this.sessions.get(id);
    return session ? session.messages : [];
  }

  /**
   * Delete a session.
   * @param {string} id
   * @returns {boolean}
   */
  delete(id) {
    const deleted = this.sessions.delete(id);
    if (deleted) this._scheduleSave();
    return deleted;
  }
}

export default new SessionStore();
