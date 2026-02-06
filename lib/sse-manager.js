/**
 * SSE Connection Manager
 * Tracks Express response objects per session and broadcasts events.
 */

class SSEManager {
  constructor() {
    /** @type {Map<string, Set<import('express').Response>>} */
    this.clients = new Map();
  }

  /**
   * Register an SSE client for a session.
   * @param {string} sessionId
   * @param {import('express').Response} res
   */
  add(sessionId, res) {
    if (!this.clients.has(sessionId)) {
      this.clients.set(sessionId, new Set());
    }
    this.clients.get(sessionId).add(res);

    res.on('close', () => {
      const set = this.clients.get(sessionId);
      if (set) {
        set.delete(res);
        if (set.size === 0) this.clients.delete(sessionId);
      }
    });
  }

  /**
   * Broadcast an SSE event to all clients of a session.
   * @param {string} sessionId
   * @param {string} event - Event type name
   * @param {*} data - JSON-serializable payload
   */
  broadcast(sessionId, event, data) {
    const set = this.clients.get(sessionId);
    if (!set || set.size === 0) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
  }

  /**
   * Check if a session has any connected SSE clients.
   * @param {string} sessionId
   * @returns {boolean}
   */
  hasClients(sessionId) {
    const set = this.clients.get(sessionId);
    return set ? set.size > 0 : false;
  }
}

export default new SSEManager();
