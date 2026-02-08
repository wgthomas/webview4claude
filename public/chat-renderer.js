/**
 * Chat Renderer
 * Markdown rendering with syntax highlighting and tool call cards.
 */

const ChatRenderer = {
    /**
     * Configure marked.js with custom renderer.
     */
    init() {
        marked.setOptions({
            breaks: true,
            gfm: true
        });
    },

    /**
     * Render markdown text to HTML.
     * @param {string} text - Raw markdown
     * @returns {string} HTML
     */
    renderMarkdown(text) {
        if (!text) return '';

        // Custom code block handling: wrap with header showing language + copy button
        const renderer = new marked.Renderer();
        const origCode = renderer.code.bind(renderer);

        renderer.code = function(tokenOrCode, infostring) {
            // Handle both marked v12 object API and legacy positional args
            let code, lang;
            if (typeof tokenOrCode === 'object' && tokenOrCode !== null) {
                code = tokenOrCode.text;
                lang = tokenOrCode.lang;
            } else {
                code = tokenOrCode;
                lang = infostring;
            }
            const language = lang || 'plaintext';
            let highlighted;
            try {
                // Only use hljs for known languages — never highlightAuto
                // highlightAuto wraps text in invisible spans for plaintext
                if (lang && hljs.getLanguage(lang)) {
                    highlighted = hljs.highlight(code, { language: lang }).value;
                } else {
                    highlighted = CbUtils.escapeHtml(code);
                }
            } catch {
                highlighted = CbUtils.escapeHtml(code);
            }

            const escapedCode = CbUtils.escapeHtml(code);
            return `<div class="cw-code-header">
                <span>${CbUtils.escapeHtml(language)}</span>
                <button class="cw-code-copy" onclick="ChatRenderer.copyCode(this)" data-code="${escapedCode.replace(/"/g, '&quot;')}">Copy</button>
            </div>
            <pre><code style="display:block;padding:14px;background:#0d0d1a;color:#d4d4d8;border:1px solid #252540;border-radius:6px;overflow-x:auto;font-size:0.82rem;line-height:1.5;border-top-left-radius:0;border-top-right-radius:0;">${highlighted}</code></pre>`;
        };

        return marked.parse(text, { renderer });
    },

    /**
     * Copy code to clipboard.
     * @param {HTMLElement} btn
     */
    copyCode(btn) {
        const code = btn.dataset.code
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        navigator.clipboard.writeText(code).then(() => {
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = orig, 1500);
        });
    },

    /**
     * Get a one-line summary for a tool call.
     * @param {string} toolName
     * @param {object} input
     * @returns {string}
     */
    toolSummary(toolName, input) {
        if (!input) return '';
        switch (toolName) {
            case 'Read':
                return input.file_path || '';
            case 'Write':
                return input.file_path || '';
            case 'Edit':
                return input.file_path || '';
            case 'Glob':
                return input.pattern || '';
            case 'Grep':
                return `"${input.pattern || ''}"` + (input.path ? ` in ${input.path}` : '');
            case 'Bash':
                return (input.command || '').slice(0, 80);
            case 'WebSearch':
                return input.query || '';
            case 'WebFetch':
                return input.url || '';
            case 'Task':
                return input.description || '';
            default:
                // Try to find a meaningful field
                const first = Object.values(input)[0];
                return typeof first === 'string' ? first.slice(0, 80) : '';
        }
    },

    /**
     * Render a tool call card.
     * @param {object} opts
     * @param {string} opts.id - Tool call ID
     * @param {string} opts.tool - Tool name
     * @param {object} [opts.input] - Tool input
     * @param {string} [opts.output] - Tool output
     * @param {boolean} [opts.running] - Is the tool still running
     * @param {boolean} [opts.isError] - Did the tool error
     * @returns {string} HTML
     */
    renderToolCard({ id, tool, input, output, running, isError }) {
        const summary = this.toolSummary(tool, input);
        const statusHtml = running
            ? '<span class="cw-tool-spinner"></span>'
            : isError
                ? '<span class="cb-dot cb-dot-sm cb-dot-error"></span>'
                : '<span class="cb-dot cb-dot-sm cb-dot-success"></span>';

        let bodyHtml = '';
        if (input) {
            const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
            bodyHtml += `<div class="cw-tool-section">
                <div class="cw-tool-section-label">Input</div>
                <pre>${CbUtils.escapeHtml(inputStr)}</pre>
            </div>`;
        }
        if (output != null) {
            bodyHtml += `<div class="cw-tool-section">
                <div class="cw-tool-section-label">Output</div>
                <pre>${CbUtils.escapeHtml(String(output))}</pre>
            </div>`;
        }

        return `<div class="cw-tool-card" id="tool-${CbUtils.escapeHtml(id)}" onclick="ChatRenderer.toggleTool(this, event)">
            <div class="cw-tool-header">
                <span class="cw-tool-arrow">&#9654;</span>
                <span class="cw-tool-name">${CbUtils.escapeHtml(tool)}</span>
                <span class="cw-tool-summary">${CbUtils.escapeHtml(summary)}</span>
                <span class="cw-tool-status">${statusHtml}</span>
            </div>
            <div class="cw-tool-body">${bodyHtml}</div>
        </div>`;
    },

    /**
     * Toggle tool card expansion.
     * @param {HTMLElement} card
     * @param {Event} event
     */
    toggleTool(card, event) {
        // Don't toggle if clicking inside the body
        if (event.target.closest('.cw-tool-body')) return;
        card.classList.toggle('expanded');
    },

    /**
     * Render a result banner.
     * @param {object} result
     * @returns {string}
     */
    renderResult(result) {
        const cls = result.isError ? 'cw-result error' : 'cw-result';
        const costStr = '$' + (result.cost || 0).toFixed(4);
        const durationStr = ((result.duration || 0) / 1000).toFixed(1) + 's';
        const inputTok = (result.usage?.input || 0).toLocaleString();
        const outputTok = (result.usage?.output || 0).toLocaleString();
        const cacheRead = result.usage?.cache_read || 0;

        let html = `<div class="${cls}">`;
        html += `<div class="cw-result-item"><span class="cw-result-label">Cost:</span> <span class="cw-result-value">${costStr}</span></div>`;
        html += `<div class="cw-result-item"><span class="cw-result-label">Duration:</span> <span class="cw-result-value">${durationStr}</span></div>`;
        html += `<div class="cw-result-item"><span class="cw-result-label">In:</span> <span class="cw-result-value">${inputTok}</span></div>`;
        html += `<div class="cw-result-item"><span class="cw-result-label">Out:</span> <span class="cw-result-value">${outputTok}</span></div>`;
        if (cacheRead > 0) {
            html += `<div class="cw-result-item"><span class="cw-result-label">Cache:</span> <span class="cw-result-value">${cacheRead.toLocaleString()}</span></div>`;
        }
        html += `<div class="cw-result-item"><span class="cw-result-label">Turns:</span> <span class="cw-result-value">${result.numTurns || 0}</span></div>`;
        html += `</div>`;
        return html;
    }
};

// Init on load
ChatRenderer.init();
