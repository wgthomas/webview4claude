/*
 * Cybertron Component Library
 * Reusable JS widgets for Cybertron network UIs.
 *
 * Usage:
 *   <script src="cybertron-components.js"></script>
 *
 * Components:
 *   CbTabs       — Tab navigation with content switching
 *   CbSSE        — Server-Sent Events with auto-reconnect
 *   CbGauge      — SVG arc gauge (0-100%)
 *   CbSparkline  — SVG area sparkline chart
 *   CbHealthBar  — Animated progress bar with status colors
 *   CbUtils      — escapeHtml, formatTimeAgo, statusDot, statusBadge
 */


/* ============================================================
   UTILITIES
   ============================================================ */

const CbUtils = {
    /**
     * Escape HTML to prevent XSS.
     * @param {string} text
     * @returns {string}
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Format a Date as relative time (e.g. "5m ago").
     * @param {Date} date
     * @returns {string}
     */
    formatTimeAgo(date) {
        if (!date || isNaN(date)) return '—';
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 0) return 'just now';
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
        return date.toLocaleDateString();
    },

    /**
     * Return a status dot class name from a semantic status.
     * @param {'success'|'warning'|'error'|'info'|'muted'} status
     * @returns {string} CSS class like "cb-dot-success"
     */
    dotClass(status) {
        const map = {
            success: 'cb-dot-success',
            warning: 'cb-dot-warning',
            error: 'cb-dot-error',
            info: 'cb-dot-info',
            muted: 'cb-dot-muted',
            purple: 'cb-dot-purple',
        };
        return map[status] || 'cb-dot-muted';
    },

    /**
     * Return a badge class name from a semantic status.
     * @param {'success'|'warning'|'error'|'info'|'muted'} status
     * @returns {string} CSS class like "cb-badge-success"
     */
    badgeClass(status) {
        return `cb-badge-${status || 'muted'}`;
    },

    /**
     * Map common project/service statuses to semantic levels.
     * @param {string} status  e.g. "in-progress", "complete", "online", "down"
     * @returns {'success'|'warning'|'error'|'info'|'muted'}
     */
    statusLevel(status) {
        const map = {
            'in-progress': 'info',
            'complete': 'success',
            'planned': 'muted',
            'on-hold': 'warning',
            'blocked': 'error',
            'online': 'success',
            'offline': 'error',
            'operational': 'success',
            'degraded': 'warning',
            'down': 'error',
            'nominal': 'success',
            'critical': 'error',
        };
        return map[(status || '').toLowerCase()] || 'muted';
    },
};


/* ============================================================
   TABS
   ============================================================ */

class CbTabs {
    /**
     * Initialize tab navigation.
     * @param {Object} opts
     * @param {string} opts.tabSelector     CSS selector for tab buttons (default: '.cb-tab')
     * @param {string} opts.contentSelector CSS selector for tab content panels (default: '.cb-tab-content')
     * @param {string} opts.activeClass     Class to toggle (default: 'active')
     * @param {Function} opts.onChange      Callback(tabName) when tab changes
     */
    constructor(opts = {}) {
        this.tabSelector = opts.tabSelector || '.cb-tab';
        this.contentSelector = opts.contentSelector || '.cb-tab-content';
        this.activeClass = opts.activeClass || 'active';
        this.onChange = opts.onChange || null;
        this.current = null;
        this._init();
    }

    _init() {
        document.querySelectorAll(this.tabSelector).forEach(tab => {
            tab.addEventListener('click', () => this.switchTo(tab.dataset.tab));
        });
        // Activate first tab
        const first = document.querySelector(`${this.tabSelector}.${this.activeClass}`);
        if (first) this.current = first.dataset.tab;
    }

    /**
     * Switch to a named tab.
     * @param {string} tabName  Value of data-tab attribute
     */
    switchTo(tabName) {
        if (tabName === this.current) return;
        this.current = tabName;

        document.querySelectorAll(this.tabSelector).forEach(tab => {
            tab.classList.toggle(this.activeClass, tab.dataset.tab === tabName);
        });

        document.querySelectorAll(this.contentSelector).forEach(panel => {
            panel.classList.toggle(this.activeClass, panel.id === `tab-${tabName}`);
        });

        if (this.onChange) this.onChange(tabName);
    }
}


/* ============================================================
   SSE (Server-Sent Events)
   ============================================================ */

class CbSSE {
    /**
     * Connect to an SSE endpoint with auto-reconnect.
     * @param {Object} opts
     * @param {string} opts.url              SSE endpoint URL
     * @param {Function} opts.onData         Callback(parsedJSON) on each message
     * @param {Function} opts.onStatus       Callback(connected: boolean) on connect/disconnect
     * @param {number} opts.reconnectMs      Reconnect delay in ms (default: 5000)
     */
    constructor(opts) {
        this.url = opts.url;
        this.onData = opts.onData;
        this.onStatus = opts.onStatus || (() => {});
        this.reconnectMs = opts.reconnectMs || 5000;
        this._source = null;
        this._stopped = false;
        this.connect();
    }

    connect() {
        if (this._stopped) return;
        if (this._source) this._source.close();

        this._source = new EventSource(this.url);

        this._source.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.onData(data);
                this.onStatus(true);
            } catch (err) {
                console.error('[CbSSE] Parse error:', err);
            }
        };

        this._source.onopen = () => this.onStatus(true);

        this._source.onerror = () => {
            this.onStatus(false);
            this._source.close();
            setTimeout(() => this.connect(), this.reconnectMs);
        };
    }

    /** Permanently close the connection. */
    close() {
        this._stopped = true;
        if (this._source) this._source.close();
    }
}


/* ============================================================
   GAUGE — SVG arc gauge (0-100%)
   ============================================================ */

const CbGauge = {
    /**
     * Render an SVG arc gauge.
     * @param {number} pct       0-100
     * @param {Object} opts
     * @param {'nominal'|'warning'|'critical'} opts.level  Status level (default: auto from pct)
     * @param {number} opts.warnAt   Threshold for warning (default: 70)
     * @param {number} opts.critAt   Threshold for critical (default: 85)
     * @returns {string} SVG markup
     */
    render(pct, opts = {}) {
        const warnAt = opts.warnAt ?? 70;
        const critAt = opts.critAt ?? 85;
        const level = opts.level || (pct >= critAt ? 'critical' : pct >= warnAt ? 'warning' : 'nominal');

        const colorMap = { critical: '#f54242', warning: '#f5c842', nominal: '#2dd4a0' };
        const color = colorMap[level] || colorMap.nominal;

        const r = 80, cx = 100, cy = 100;
        const startAngle = -180;
        const sweep = (Math.min(pct, 100) / 100) * 180;
        const endAngle = startAngle + sweep;

        const toXY = (angle) => {
            const rad = (angle * Math.PI) / 180;
            return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
        };

        const start = toXY(startAngle);
        const end = toXY(endAngle);
        const arcEnd = toXY(0);
        const large = sweep > 180 ? 1 : 0;

        // Tick marks at warn/crit thresholds
        const warnAngle = startAngle + (warnAt / 100) * 180;
        const critAngle = startAngle + (critAt / 100) * 180;
        const tick = (angle, c) => {
            const outer = toXY(angle);
            const inner = {
                x: cx + (r - 10) * Math.cos((angle * Math.PI) / 180),
                y: cy + (r - 10) * Math.sin((angle * Math.PI) / 180),
            };
            return `<line x1="${outer.x}" y1="${outer.y}" x2="${inner.x}" y2="${inner.y}" stroke="${c}" stroke-width="2" opacity="0.5"/>`;
        };

        return `<svg viewBox="0 0 200 110" class="cb-gauge-svg">
            <path d="M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${arcEnd.x} ${arcEnd.y}"
                  fill="none" stroke="var(--cb-border, #1a1a2e)" stroke-width="12" stroke-linecap="round"/>
            ${pct > 0.5 ? `<path d="M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}"
                  fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
                  style="filter: drop-shadow(0 0 6px ${color})"/>` : ''}
            ${tick(warnAngle, '#f5c842')}
            ${tick(critAngle, '#f54242')}
        </svg>`;
    },
};


/* ============================================================
   SPARKLINE — SVG area chart
   ============================================================ */

const CbSparkline = {
    /**
     * Render an SVG sparkline area chart.
     * @param {number[]} values        Array of numeric values
     * @param {Object} opts
     * @param {string} opts.color      Line/fill color (default: '#7c5bf5')
     * @param {number} opts.width      SVG viewbox width (default: 100)
     * @param {number} opts.height     SVG viewbox height (default: 40)
     * @param {string} opts.emptyText  Text when < 2 values (default: 'Collecting data...')
     * @returns {string} SVG markup or placeholder
     */
    render(values, opts = {}) {
        const color = opts.color || '#7c5bf5';
        const w = opts.width || 100;
        const h = opts.height || 40;
        const emptyText = opts.emptyText || 'Collecting data...';

        if (!values || values.length < 2) {
            return `<div class="cb-dim cb-center" style="padding:10px;">${CbUtils.escapeHtml(emptyText)}</div>`;
        }

        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        const points = values.map((v, i) => {
            const x = (i / (values.length - 1)) * w;
            const y = h - ((v - min) / range) * (h - 6) - 3;
            return `${x},${y}`;
        });

        const lastPt = points[points.length - 1].split(',');
        const gradId = `cbSparkGrad_${Math.random().toString(36).slice(2, 8)}`;

        return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:50px;">
            <defs>
                <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
                    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <polygon points="${points.join(' ')} ${w},${h} 0,${h}" fill="url(#${gradId})"/>
            <polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>
            <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="2.5" fill="${color}"/>
        </svg>`;
    },
};


/* ============================================================
   HEALTH BAR — animated progress bar
   ============================================================ */

const CbHealthBar = {
    /**
     * Render a health bar with label.
     * @param {number} pct    0-100
     * @param {Object} opts
     * @param {string} opts.label   Left label (default: 'Health')
     * @param {'success'|'warning'|'error'} opts.status  Color (default: auto)
     * @returns {string} HTML markup
     */
    render(pct, opts = {}) {
        const label = opts.label || 'Health';
        const status = opts.status || (pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'error');

        return `<div class="cb-health-bar">
            <div class="cb-health-bar-label">
                <span>${CbUtils.escapeHtml(label)}</span>
                <span>${Math.round(pct)}%</span>
            </div>
            <div class="cb-health-bar-track">
                <div class="cb-health-bar-fill ${status}" style="width: ${Math.min(pct, 100)}%"></div>
            </div>
        </div>`;
    },
};


/* ============================================================
   EXPORT — attach to window for non-module usage
   ============================================================ */

if (typeof window !== 'undefined') {
    window.CbUtils = CbUtils;
    window.CbTabs = CbTabs;
    window.CbSSE = CbSSE;
    window.CbGauge = CbGauge;
    window.CbSparkline = CbSparkline;
    window.CbHealthBar = CbHealthBar;
}
