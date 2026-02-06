/**
 * Claude Web — Main Application
 * Session management, SSE streaming, chat interaction.
 */

const App = {
    /** @type {string|null} Current session ID */
    currentSession: null,

    /** @type {EventSource|null} Current SSE connection */
    sse: null,

    /** @type {string} Accumulated streaming text for current assistant message */
    streamBuffer: '',

    /** @type {string|null} Current streaming message element ID */
    streamMsgId: null,

    /** @type {Map<string, {tool: string, input: string}>} Tool calls being accumulated */
    activeTools: new Map(),

    /** @type {number|null} Thinking sayings rotation timer */
    _thinkTimer: null,

    /** Thinking sayings — same vibe as the CLI */
    thinkingSayings: [
        'Thinking...', 'Pondering...', 'Contemplating...', 'Ruminating...',
        'Cogitating...', 'Mulling it over...', 'Noodling on it...',
        'Deliberating...', 'Chewing on that...', 'Processing...',
        'Working through it...', 'Reasoning...', 'Connecting dots...',
        'Assembling thoughts...', 'Warming up neurons...', 'Parsing intent...',
        'Consulting the oracle...', 'Channeling the machine spirit...',
        'Summoning the answer...', 'Interrogating reality...',
        'Crunching tokens...', 'Traversing the latent space...',
        'Spinning up inference...', 'Loading context...',
        'Engaging hyperdrive...', 'Consulting Cybertron archives...',
        'Running diagnostics...', 'Deploying minions...',
        'Charging fusion cannon...', 'Executing with prejudice...',
    ],

    // ─── DOM References ───────────────────────────────────────────

    els: {
        sessionList: null,
        messages: null,
        emptyState: null,
        promptInput: null,
        btnSend: null,
        btnStop: null,
        btnNewSession: null,
        btnToggleSidebar: null,
        headerSessionName: null,
        headerCwd: null,
        modelSelect: null,
        connDot: null,
        connText: null,
        costSummary: null,
        inputStatus: null,
        modalOverlay: null,
    },

    // ─── Init ─────────────────────────────────────────────────────

    init() {
        // Cache DOM refs
        this.els.sessionList = document.getElementById('session-list');
        this.els.messages = document.getElementById('messages');
        this.els.emptyState = document.getElementById('empty-state');
        this.els.promptInput = document.getElementById('prompt-input');
        this.els.btnSend = document.getElementById('btn-send');
        this.els.btnStop = document.getElementById('btn-stop');
        this.els.btnNewSession = document.getElementById('btn-new-session');
        this.els.btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
        this.els.headerSessionName = document.getElementById('header-session-name');
        this.els.headerCwd = document.getElementById('header-cwd');
        this.els.modelSelect = document.getElementById('model-select');
        this.els.connDot = document.getElementById('conn-dot');
        this.els.connText = document.getElementById('conn-text');
        this.els.costSummary = document.getElementById('cost-summary');
        this.els.inputStatus = document.getElementById('input-status');
        this.els.modalOverlay = document.getElementById('modal-overlay');

        // Event listeners
        this.els.btnSend.addEventListener('click', () => this.sendMessage());
        this.els.btnStop.addEventListener('click', () => this.stopMessage());
        this.els.btnNewSession.addEventListener('click', () => this.showModal());
        this.els.btnToggleSidebar.addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });

        // Keyboard shortcuts
        this.els.promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                this.sendMessage();
            }
            if (e.key === 'Escape') {
                this.stopMessage();
            }
        });

        // Auto-resize textarea
        this.els.promptInput.addEventListener('input', () => {
            const el = this.els.promptInput;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 200) + 'px';
        });

        // Modal listeners
        document.getElementById('modal-cancel').addEventListener('click', () => this.hideModal());
        document.getElementById('modal-create').addEventListener('click', () => this.createSession());
        this.els.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.els.modalOverlay) this.hideModal();
        });

        // Model selector change
        this.els.modelSelect.addEventListener('change', () => {
            // Model is read at send time, no action needed
        });

        // Load config then sessions
        this.loadConfig().then(() => this.loadSessions());
    },

    // ─── Config ───────────────────────────────────────────────────

    async loadConfig() {
        try {
            const res = await fetch('/api/config');
            const cfg = await res.json();
            this.applyBranding(cfg);
        } catch {}
    },

    applyBranding(cfg) {
        // Sidebar title
        const sidebarH1 = document.querySelector('.cw-sidebar-header h1');
        if (sidebarH1) sidebarH1.innerHTML = `<span class="cb-logo">//</span> ${CbUtils.escapeHtml(cfg.name || 'Claude Web')}`;

        // Page title
        document.title = `${cfg.name || 'Claude Web'} — Cybertron`;

        // Empty state
        const emptyH3 = document.querySelector('.cw-empty-state h3');
        if (emptyH3) emptyH3.textContent = cfg.name || 'Claude Web';

        const emptyDesc = document.querySelector('.cw-empty-state p');
        if (emptyDesc && cfg.tagline) emptyDesc.textContent = cfg.tagline;

        // Store defaults for new session modal
        this._defaultCwd = cfg.defaultCwd || '';
        this._defaultModel = cfg.defaultModel || 'claude-sonnet-4-5-20250929';
    },

    // ─── Sessions ─────────────────────────────────────────────────

    async loadSessions() {
        try {
            const res = await fetch('/api/sessions');
            const sessions = await res.json();
            this.renderSessionList(sessions);
        } catch (err) {
            console.error('Failed to load sessions:', err);
        }
    },

    renderSessionList(sessions) {
        // Sort by lastActiveAt descending
        sessions.sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));

        this.els.sessionList.innerHTML = sessions.map(s => {
            const active = s.id === this.currentSession ? 'active' : '';
            const dotClass = s.status === 'running' ? 'cb-dot-info cb-dot-pulse'
                : s.status === 'error' ? 'cb-dot-error'
                : 'cb-dot-muted';
            const timeAgo = CbUtils.formatTimeAgo(new Date(s.lastActiveAt));
            const model = s.model?.includes('opus') ? 'Opus'
                : s.model?.includes('haiku') ? 'Haiku' : 'Sonnet';

            return `<div class="cw-session-item ${active}" data-id="${s.id}" onclick="App.selectSession('${s.id}')">
                <div class="cw-session-item-header">
                    <div class="cb-dot cb-dot-sm ${dotClass}"></div>
                    <span class="cw-session-item-name">${CbUtils.escapeHtml(s.name)}</span>
                    <button class="cw-session-item-delete" onclick="event.stopPropagation(); App.deleteSession('${s.id}')" title="Delete">&times;</button>
                </div>
                <div class="cw-session-item-meta">
                    <span>${model}</span>
                    <span>${s.messageCount || 0} msgs</span>
                    <span>${timeAgo}</span>
                </div>
            </div>`;
        }).join('');
    },

    async selectSession(id) {
        // Disconnect from old session
        this.disconnectSSE();

        this.currentSession = id;

        // Load session data
        try {
            const [sessionsRes, historyRes] = await Promise.all([
                fetch('/api/sessions'),
                fetch(`/api/sessions/${id}/history`)
            ]);

            const sessions = await sessionsRes.json();
            const history = await historyRes.json();

            // Find this session
            const session = sessions.find(s => s.id === id);
            if (!session) return;

            // Update UI
            this.renderSessionList(sessions);
            this.els.headerSessionName.textContent = session.name;
            this.els.headerCwd.textContent = session.cwd;
            this.els.headerCwd.title = session.cwd;
            this.els.modelSelect.value = session.model;
            this.els.promptInput.disabled = false;
            this.els.btnSend.disabled = false;
            this.updateCost(session);

            // Render history
            this.els.emptyState.style.display = 'none';
            this.els.messages.classList.add('active');
            this.els.messages.innerHTML = '';

            for (const msg of history) {
                if (msg.role === 'user') {
                    this.appendUserMessage(msg.content);
                } else if (msg.role === 'assistant') {
                    this.appendAssistantMessage(msg);
                }
            }

            this.scrollToBottom();

            // Connect SSE
            this.connectSSE(id);

            // Update running state UI
            this.setRunningState(session.status === 'running');

        } catch (err) {
            console.error('Failed to select session:', err);
        }
    },

    showModal() {
        this.els.modalOverlay.style.display = 'flex';
        document.getElementById('modal-name').value = '';
        document.getElementById('modal-cwd').value = this._defaultCwd || '';
        document.getElementById('modal-model').value = this._defaultModel || 'claude-sonnet-4-5-20250929';
        document.getElementById('modal-cwd').focus();
    },

    hideModal() {
        this.els.modalOverlay.style.display = 'none';
    },

    async createSession() {
        const name = document.getElementById('modal-name').value.trim() || 'New Session';
        const cwd = document.getElementById('modal-cwd').value.trim();
        const model = document.getElementById('modal-model').value;

        if (!cwd) {
            document.getElementById('modal-cwd').focus();
            return;
        }

        try {
            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, cwd, model })
            });

            if (!res.ok) {
                const err = await res.json();
                alert(err.error || 'Failed to create session');
                return;
            }

            const session = await res.json();
            this.hideModal();
            await this.loadSessions();
            this.selectSession(session.id);
        } catch (err) {
            console.error('Failed to create session:', err);
        }
    },

    async deleteSession(id) {
        if (!confirm('Delete this session?')) return;

        try {
            await fetch(`/api/sessions/${id}`, { method: 'DELETE' });

            if (this.currentSession === id) {
                this.currentSession = null;
                this.disconnectSSE();
                this.els.messages.classList.remove('active');
                this.els.emptyState.style.display = '';
                this.els.headerSessionName.textContent = 'No session selected';
                this.els.headerCwd.textContent = '';
                this.els.promptInput.disabled = true;
                this.els.btnSend.disabled = true;
            }

            this.loadSessions();
        } catch (err) {
            console.error('Failed to delete session:', err);
        }
    },

    // ─── SSE ──────────────────────────────────────────────────────

    connectSSE(sessionId) {
        this.disconnectSSE();

        const es = new EventSource(`/api/chat/${sessionId}/sse`);
        this.sse = es;

        es.addEventListener('connected', () => {
            this.setConnectionStatus(true);
        });

        es.addEventListener('status', (e) => {
            const data = JSON.parse(e.data);
            this.setRunningState(data.status === 'running');
            if (data.status === 'idle' || data.status === 'error' || data.status === 'interrupted') {
                this.finalizeStream();
            }
        });

        es.addEventListener('user_message', (e) => {
            const data = JSON.parse(e.data);
            // Only append if not already shown (we add locally on send)
        });

        es.addEventListener('text_delta', (e) => {
            const data = JSON.parse(e.data);
            this.handleTextDelta(data);
        });

        es.addEventListener('tool_start', (e) => {
            const data = JSON.parse(e.data);
            this.handleToolStart(data);
        });

        es.addEventListener('tool_input_delta', (e) => {
            const data = JSON.parse(e.data);
            this.handleToolInputDelta(data);
        });

        es.addEventListener('tool_complete', (e) => {
            const data = JSON.parse(e.data);
            this.handleToolComplete(data);
        });

        es.addEventListener('assistant_message', (e) => {
            // Complete message — finalize current stream
            const data = JSON.parse(e.data);
            this.handleAssistantMessage(data);
        });

        es.addEventListener('result', (e) => {
            const data = JSON.parse(e.data);
            this.handleResult(data);
        });

        es.addEventListener('error', (e) => {
            try {
                const data = JSON.parse(e.data);
                this.appendSystemMessage('Error: ' + (data.message || 'Unknown error'));
            } catch {
                // SSE connection error
            }
        });

        es.onerror = () => {
            this.setConnectionStatus(false);
        };

        es.onopen = () => {
            this.setConnectionStatus(true);
        };
    },

    disconnectSSE() {
        if (this.sse) {
            this.sse.close();
            this.sse = null;
        }
        this.setConnectionStatus(false);
    },

    // ─── Message Sending ──────────────────────────────────────────

    async sendMessage() {
        const prompt = this.els.promptInput.value.trim();
        if (!prompt || !this.currentSession) return;

        // Clear input
        this.els.promptInput.value = '';
        this.els.promptInput.style.height = 'auto';

        // Show user message locally
        this.appendUserMessage(prompt);
        this.showThinking();

        // Reset stream state
        this.streamBuffer = '';
        this.streamMsgId = null;
        this.activeTools.clear();

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.currentSession,
                    prompt
                })
            });

            if (!res.ok) {
                const err = await res.json();
                this.appendSystemMessage('Error: ' + (err.error || 'Failed to send'));
            }
        } catch (err) {
            this.appendSystemMessage('Error: ' + err.message);
        }
    },

    async stopMessage() {
        if (!this.currentSession) return;
        try {
            await fetch(`/api/chat/${this.currentSession}/stop`, { method: 'POST' });
        } catch (err) {
            console.error('Failed to stop:', err);
        }
    },

    // ─── Stream Handlers ──────────────────────────────────────────

    handleTextDelta(data) {
        this.hideThinking();
        this.streamBuffer += data.text;

        // Create or update the streaming message element
        let el = document.getElementById('stream-msg');
        if (!el) {
            el = document.createElement('div');
            el.id = 'stream-msg';
            el.className = 'cw-msg cw-msg-assistant cw-msg-streaming';
            el.innerHTML = `<div class="cw-msg-label">Claude</div><div class="cw-msg-content"></div>`;
            this.els.messages.appendChild(el);
        }

        // Re-render accumulated markdown
        const contentEl = el.querySelector('.cw-msg-content');
        contentEl.innerHTML = ChatRenderer.renderMarkdown(this.streamBuffer);
        this.scrollToBottom();
    },

    handleToolStart(data) {
        this.hideThinking();
        this.activeTools.set(data.toolCallId, { tool: data.tool, input: '' });

        // Insert tool card into the current stream message or create one
        let el = document.getElementById('stream-msg');
        if (!el) {
            el = document.createElement('div');
            el.id = 'stream-msg';
            el.className = 'cw-msg cw-msg-assistant cw-msg-streaming';
            el.innerHTML = `<div class="cw-msg-label">Claude</div><div class="cw-msg-content"></div>`;
            this.els.messages.appendChild(el);
        }

        const toolHtml = ChatRenderer.renderToolCard({
            id: data.toolCallId,
            tool: data.tool,
            running: true
        });

        // Append after the content div
        el.insertAdjacentHTML('beforeend', toolHtml);
        this.scrollToBottom();
    },

    handleToolInputDelta(data) {
        const entry = this.activeTools.get(data.toolCallId);
        if (entry) {
            entry.input += data.partial_json;
        }
    },

    handleToolComplete(data) {
        const toolEl = document.getElementById(`tool-${data.toolCallId}`);
        if (!toolEl) return;

        const entry = this.activeTools.get(data.toolCallId);
        let inputObj = null;
        if (entry && entry.input) {
            try { inputObj = JSON.parse(entry.input); } catch {}
        }

        // Re-render the tool card with complete info
        const newHtml = ChatRenderer.renderToolCard({
            id: data.toolCallId,
            tool: entry?.tool || 'Tool',
            input: inputObj,
            output: data.output,
            running: false,
            isError: data.is_error
        });

        toolEl.outerHTML = newHtml;
        this.activeTools.delete(data.toolCallId);
    },

    handleAssistantMessage(data) {
        // The complete message has arrived — the stream is finalized for this turn
        // Keep the stream element but remove streaming class
        const el = document.getElementById('stream-msg');
        if (el) {
            el.classList.remove('cw-msg-streaming');
            el.removeAttribute('id');
        }

        // Reset for next turn
        this.streamBuffer = '';
    },

    handleResult(data) {
        this.hideThinking();
        this.finalizeStream();

        // Append result banner
        const resultHtml = ChatRenderer.renderResult(data);
        this.els.messages.insertAdjacentHTML('beforeend', resultHtml);

        // Update session cost
        if (data.sessionTotals) {
            this.els.costSummary.innerHTML = `<span class="cb-dim">Session: $${data.sessionTotals.cost.toFixed(4)}</span>`;
        }

        this.scrollToBottom();
        this.loadSessions(); // Refresh sidebar
    },

    finalizeStream() {
        const el = document.getElementById('stream-msg');
        if (el) {
            el.classList.remove('cw-msg-streaming');
            el.removeAttribute('id');
        }
        this.streamBuffer = '';
        this.streamMsgId = null;
    },

    // ─── Thinking Indicator ──────────────────────────────────────

    showThinking() {
        this.hideThinking(); // clear any existing

        const div = document.createElement('div');
        div.id = 'cw-thinking';
        div.className = 'cw-thinking';

        const saying = this.thinkingSayings[Math.floor(Math.random() * this.thinkingSayings.length)];
        div.innerHTML = `<span class="cw-thinking-star">&#10038;</span><span class="cw-thinking-text">${CbUtils.escapeHtml(saying)}</span>`;
        this.els.messages.appendChild(div);
        this.scrollToBottom();

        // Rotate sayings every 3s
        this._thinkTimer = setInterval(() => {
            const el = document.getElementById('cw-thinking');
            if (!el) { clearInterval(this._thinkTimer); return; }
            const textEl = el.querySelector('.cw-thinking-text');
            if (textEl) {
                const next = this.thinkingSayings[Math.floor(Math.random() * this.thinkingSayings.length)];
                textEl.textContent = next;
            }
        }, 3000);
    },

    hideThinking() {
        if (this._thinkTimer) {
            clearInterval(this._thinkTimer);
            this._thinkTimer = null;
        }
        const el = document.getElementById('cw-thinking');
        if (el) el.remove();
    },

    // ─── DOM Helpers ──────────────────────────────────────────────

    appendUserMessage(text) {
        const div = document.createElement('div');
        div.className = 'cw-msg cw-msg-user';
        div.innerHTML = `<div class="cw-msg-label">You</div><div class="cw-msg-content">${ChatRenderer.renderMarkdown(text)}</div>`;
        this.els.messages.appendChild(div);
    },

    appendAssistantMessage(msg) {
        const div = document.createElement('div');
        div.className = 'cw-msg cw-msg-assistant';

        let html = '<div class="cw-msg-label">Claude</div>';

        // Text content
        const textParts = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
        if (textParts) {
            html += `<div class="cw-msg-content">${ChatRenderer.renderMarkdown(textParts)}</div>`;
        }

        // Tool calls
        for (const tc of (msg.toolCalls || [])) {
            html += ChatRenderer.renderToolCard({
                id: tc.id,
                tool: tc.tool,
                input: tc.input,
                running: false
            });
        }

        div.innerHTML = html;
        this.els.messages.appendChild(div);
    },

    appendSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'cw-result error';
        div.innerHTML = `<span>${CbUtils.escapeHtml(text)}</span>`;
        this.els.messages.appendChild(div);
        this.scrollToBottom();
    },

    scrollToBottom() {
        const chat = document.getElementById('chat-area');
        requestAnimationFrame(() => {
            chat.scrollTop = chat.scrollHeight;
        });
    },

    setConnectionStatus(connected) {
        this.els.connDot.className = `cb-dot cb-dot-sm ${connected ? 'cb-dot-success cb-dot-pulse' : 'cb-dot-muted'}`;
        this.els.connText.textContent = connected ? 'Connected' : 'Disconnected';
    },

    setRunningState(running) {
        this.els.btnSend.style.display = running ? 'none' : '';
        this.els.btnStop.style.display = running ? '' : 'none';
        this.els.promptInput.disabled = running;
        this.els.inputStatus.textContent = running ? 'Claude is working...' : '';
    },

    updateCost(session) {
        const cost = session.totalCost || 0;
        this.els.costSummary.innerHTML = `<span class="cb-dim">Session: $${cost.toFixed(4)}</span>`;
    }
};

// ─── Boot ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => App.init());
