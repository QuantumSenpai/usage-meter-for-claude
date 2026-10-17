(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	function formatSeconds(totalSeconds) {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	}

	function formatResetCountdown(timestampMs) {
		const diffMs = timestampMs - Date.now();
		if (diffMs <= 0) return '0s';

		const totalSeconds = Math.floor(diffMs / 1000);
		if (totalSeconds < 60) return `${totalSeconds}s`;

		const totalMinutes = Math.round(totalSeconds / 60);
		if (totalMinutes < 60) return `${totalMinutes}m`;

		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours < 24) return `${hours}h ${minutes}m`;

		const days = Math.floor(hours / 24);
		const remHours = hours % 24;
		return `${days}d ${remHours}h`;
	}

	function getColorForPct(pct) {
		const clamped = Math.max(0, Math.min(100, pct));
		if (clamped <= 60) {
			// Teal/Green: 0% -> hue 168, 60% -> hue 155
			const t = clamped / 60;
			const hue = 168 - t * 13;
			return `hsl(${hue}, 60%, 44%)`;
		}
		if (clamped <= 85) {
			// Amber ramp: 60% -> hue 155, 85% -> hue 38
			const t = (clamped - 60) / 25;
			const hue = 155 - t * 117;
			const sat = 60 + t * 32;
			return `hsl(${hue}, ${sat}%, 48%)`;
		}
		// Red ramp: 85% -> hue 38, 100% -> hue 354
		const t = (clamped - 85) / 15;
		const hue = 38 - t * 44; // to ~-6 deg which is ~354
		const normalHue = hue < 0 ? hue + 360 : hue;
		return `hsl(${normalHue}, 80%, 52%)`;
	}

	const UI_STYLES = `
		:host {
			display: block;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			font-size: 12px;
			line-height: 1.4;
			box-sizing: border-box;
			user-select: none;
			-webkit-font-smoothing: antialiased;
			--cc-bg-light: rgba(255, 255, 255, 0.92);
			--cc-border-light: rgba(0, 0, 0, 0.08);
			--cc-text-light: #1f1e1d;
			--cc-text-muted-light: #706e6b;
			--cc-bar-bg-light: rgba(0, 0, 0, 0.06);
			--cc-marker-light: rgba(0, 0, 0, 0.35);

			--cc-bg-dark: rgba(30, 29, 28, 0.92);
			--cc-border-dark: rgba(255, 255, 255, 0.1);
			--cc-text-dark: #f0eee9;
			--cc-text-muted-dark: #989692;
			--cc-bar-bg-dark: rgba(255, 255, 255, 0.08);
			--cc-marker-dark: rgba(255, 255, 255, 0.45);
		}

		*, *::before, *::after {
			box-sizing: border-box;
		}

		.cc-meter-card {
			background: var(--cc-bg);
			border: 1px solid var(--cc-border);
			border-radius: 8px;
			padding: 8px 12px;
			margin: 6px 0;
			color: var(--cc-text);
			backdrop-filter: blur(10px);
			-webkit-backdrop-filter: blur(10px);
			transition: all 200ms ease;
			font-feature-settings: "tnum";
			font-variant-numeric: tabular-nums;
		}

		/* Floating Fallback Placement */
		.cc-meter-card--floating {
			position: fixed;
			bottom: 18px;
			right: 18px;
			width: 290px;
			max-width: calc(100vw - 36px);
			z-index: 99999;
			box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
			margin: 0;
		}

		/* Theme classes applied to card */
		.cc-theme-light {
			--cc-bg: var(--cc-bg-light);
			--cc-border: var(--cc-border-light);
			--cc-text: var(--cc-text-light);
			--cc-text-muted: var(--cc-text-muted-light);
			--cc-bar-bg: var(--cc-bar-bg-light);
			--cc-marker: var(--cc-marker-light);
		}

		.cc-theme-dark {
			--cc-bg: var(--cc-bg-dark);
			--cc-border: var(--cc-border-dark);
			--cc-text: var(--cc-text-dark);
			--cc-text-muted: var(--cc-text-muted-dark);
			--cc-bar-bg: var(--cc-bar-bg-dark);
			--cc-marker: var(--cc-marker-dark);
		}

		/* Header */
		.cc-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
		}

		.cc-header-left {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 0;
		}

		.cc-title {
			font-size: 11px;
			font-weight: 600;
			letter-spacing: 0.02em;
			text-transform: uppercase;
			color: var(--cc-text-muted);
		}

		.cc-cache-pill {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			padding: 2px 6px;
			border-radius: 12px;
			font-size: 10px;
			font-weight: 500;
			background: rgba(16, 185, 129, 0.12);
			color: #10b981;
			transition: opacity 200ms ease;
		}

		.cc-cache-pill.cc-hidden {
			display: none;
		}

		.cc-cache-ring {
			display: block;
			transform: rotate(-90deg);
		}

		.cc-cache-ring-bg {
			fill: none;
			stroke: rgba(16, 185, 129, 0.25);
			stroke-width: 2;
		}

		.cc-cache-ring-fill {
			fill: none;
			stroke: #10b981;
			stroke-width: 2;
			stroke-linecap: round;
			stroke-dasharray: 37.7;
			stroke-dashoffset: 0;
			transition: stroke-dashoffset 900ms linear;
		}

		.cc-header-right {
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.cc-collapsed-summary {
			display: none;
			font-size: 11px;
			color: var(--cc-text-muted);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.cc-mode-collapsed .cc-collapsed-summary {
			display: inline-block;
		}

		.cc-icon-btn {
			background: none;
			border: none;
			padding: 2px 4px;
			color: var(--cc-text-muted);
			cursor: pointer;
			border-radius: 4px;
			display: flex;
			align-items: center;
			justify-content: center;
			transition: background 150ms ease, color 150ms ease;
		}

		.cc-icon-btn:hover {
			background: var(--cc-bar-bg);
			color: var(--cc-text);
		}

		.cc-chevron {
			width: 12px;
			height: 12px;
			transition: transform 200ms ease;
		}

		.cc-mode-collapsed .cc-chevron {
			transform: rotate(-90deg);
		}

		/* Rows Container */
		.cc-rows {
			display: flex;
			flex-direction: column;
			gap: 8px;
			margin-top: 8px;
		}

		.cc-mode-collapsed .cc-rows {
			display: none;
		}

		/* Metric Row */
		.cc-row {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.cc-row-meta {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			font-size: 11px;
		}

		.cc-row-label {
			font-weight: 500;
			color: var(--cc-text);
		}

		.cc-row-stat {
			display: flex;
			align-items: baseline;
			gap: 6px;
			color: var(--cc-text-muted);
		}

		.cc-val-main {
			font-weight: 500;
			color: var(--cc-text);
		}

		.cc-val-reset {
			font-size: 10px;
		}

		.cc-val-pct {
			font-weight: 600;
			min-width: 32px;
			text-align: right;
		}

		/* Thin progress bar */
		.cc-bar-track {
			position: relative;
			height: 6px;
			background: var(--cc-bar-bg);
			border-radius: 3px;
			overflow: hidden;
			width: 100%;
		}

		.cc-bar-fill {
			height: 100%;
			width: 0%;
			border-radius: 3px;
			background: #10b981;
			transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 300ms ease;
		}

		.cc-high-utilization .cc-bar-fill {
			box-shadow: 0 0 8px currentColor;
			animation: cc-pulse 2s infinite ease-in-out;
		}

		@keyframes cc-pulse {
			0%, 100% { opacity: 1; }
			50% { opacity: 0.8; }
		}

		.cc-bar-marker {
			position: absolute;
			top: 0;
			bottom: 0;
			width: 2px;
			background: var(--cc-marker);
			pointer-events: none;
			transform: translateX(-50%);
			z-index: 2;
		}

		.cc-bar-marker.cc-hidden {
			display: none;
		}

		/* Unavailable state */
		.cc-unavailable-banner {
			display: none;
			align-items: center;
			justify-content: space-between;
			padding: 4px 0;
			font-size: 11px;
			color: #e11d48;
		}

		.cc-state-unavailable .cc-unavailable-banner {
			display: flex;
		}

		.cc-retry-btn {
			background: none;
			border: 1px solid currentColor;
			border-radius: 4px;
			padding: 1px 6px;
			color: inherit;
			font-size: 10px;
			cursor: pointer;
		}

		.cc-retry-btn:hover {
			background: rgba(225, 29, 72, 0.1);
		}

		/* Loading shimmer state */
		.cc-state-loading .cc-bar-fill {
			width: 100% !important;
			background: linear-gradient(90deg, var(--cc-bar-bg) 25%, rgba(128,128,128,0.2) 50%, var(--cc-bar-bg) 75%);
			background-size: 200% 100%;
			animation: cc-shimmer 1.5s infinite;
		}

		@keyframes cc-shimmer {
			0% { background-position: 200% 0; }
			100% { background-position: -200% 0; }
		}

		/* Hover Tooltip */
		.cc-tooltip {
			position: absolute;
			z-index: 100000;
			background: rgba(18, 18, 18, 0.95);
			color: #fff;
			padding: 6px 10px;
			border-radius: 6px;
			font-size: 11px;
			line-height: 1.4;
			pointer-events: none;
			white-space: pre-line;
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
			opacity: 0;
			transition: opacity 150ms ease;
		}

		.cc-theme-light .cc-tooltip {
			background: rgba(30, 30, 30, 0.95);
		}

		@media (prefers-reduced-motion: reduce) {
			.cc-bar-fill, .cc-cache-ring-fill, .cc-chevron, .cc-meter-card {
				transition: none !important;
				animation: none !important;
			}
		}
	`;

	class CounterUI {
		constructor({ onUsageRefresh, onCopyDebug } = {}) {
			this.onUsageRefresh = onUsageRefresh || null;
			this.onCopyDebug = onCopyDebug || null;

			this.rootElement = null;
			this.shadowRoot = null;
			this.isFloating = false;
			this.isCollapsed = localStorage.getItem('cc_collapsed') === 'true';

			// State values
			this.metrics = {
				context: { tokens: 0, pct: 0, formatted: '~0 tokens' },
				session: { pct: 0, resetsAt: null, windowStart: null, raw: null },
				weekly: { pct: 0, resetsAt: null, windowStart: null, raw: null },
				cachedUntil: null,
				isPendingCache: false,
				unavailableReason: null
			};

			this.domElements = {};
			this.currentAnchor = null;
		}

		initialize() {
			if (this.rootElement) return;

			this.rootElement = document.createElement('div');
			this.rootElement.id = CC.DOM.METER_ROOT_ID;
			this.shadowRoot = this.rootElement.attachShadow({ mode: 'open' });

			const styleTag = document.createElement('style');
			styleTag.textContent = UI_STYLES;
			this.shadowRoot.appendChild(styleTag);

			const card = document.createElement('div');
			card.className = `cc-meter-card ${this.isCollapsed ? 'cc-mode-collapsed' : 'cc-mode-expanded'}`;
			this.domElements.card = card;

			card.innerHTML = `
				<div class="cc-header">
					<div class="cc-header-left">
						<span class="cc-title">Usage</span>
						<div class="cc-cache-pill cc-hidden" id="cc-cache-pill" title="Conversation prompt cache timer">
							<svg class="cc-cache-ring" width="14" height="14" viewBox="0 0 16 16">
								<circle class="cc-cache-ring-bg" cx="8" cy="8" r="6" />
								<circle class="cc-cache-ring-fill" id="cc-cache-fill" cx="8" cy="8" r="6" />
							</svg>
							<span id="cc-cache-text">cached</span>
						</div>
					</div>
					<div class="cc-header-right">
						<span class="cc-collapsed-summary" id="cc-summary"></span>
						<button class="cc-icon-btn" id="cc-debug-btn" title="Copy Debug Log" style="display: none;">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
						</button>
						<button class="cc-icon-btn" id="cc-collapse-btn" title="Toggle view">
							<svg class="cc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
						</button>
					</div>
				</div>

				<div class="cc-unavailable-banner" id="cc-unavailable">
					<span id="cc-unavailable-msg">Usage unavailable</span>
					<button class="cc-retry-btn" id="cc-retry-btn">Retry</button>
				</div>

				<div class="cc-rows" id="cc-rows">
					<!-- Context Row -->
					<div class="cc-row" id="cc-row-context">
						<div class="cc-row-meta">
							<span class="cc-row-label">Context</span>
							<div class="cc-row-stat">
								<span class="cc-val-main" id="cc-ctx-main">~0 / 200k</span>
								<span class="cc-val-pct" id="cc-ctx-pct">0%</span>
							</div>
						</div>
						<div class="cc-bar-track" role="progressbar" aria-label="Context utilization" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
							<div class="cc-bar-fill" id="cc-ctx-bar"></div>
						</div>
					</div>

					<!-- Session 5h Row -->
					<div class="cc-row" id="cc-row-session">
						<div class="cc-row-meta">
							<span class="cc-row-label">Session 5h</span>
							<div class="cc-row-stat">
								<span class="cc-val-reset" id="cc-sess-reset"></span>
								<span class="cc-val-pct" id="cc-sess-pct">0%</span>
							</div>
						</div>
						<div class="cc-bar-track" role="progressbar" aria-label="5-hour session utilization" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
							<div class="cc-bar-fill" id="cc-sess-bar"></div>
							<div class="cc-bar-marker cc-hidden" id="cc-sess-marker" title="Current window progress"></div>
						</div>
					</div>

					<!-- Weekly 7d Row -->
					<div class="cc-row" id="cc-row-weekly">
						<div class="cc-row-meta">
							<span class="cc-row-label">Weekly 7d</span>
							<div class="cc-row-stat">
								<span class="cc-val-reset" id="cc-week-reset"></span>
								<span class="cc-val-pct" id="cc-week-pct">0%</span>
							</div>
						</div>
						<div class="cc-bar-track" role="progressbar" aria-label="7-day weekly utilization" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
							<div class="cc-bar-fill" id="cc-week-bar"></div>
							<div class="cc-bar-marker cc-hidden" id="cc-week-marker" title="Current window progress"></div>
						</div>
					</div>
				</div>
			`;

			this.shadowRoot.appendChild(card);

			// Cache references to dynamic elements
			this.domElements.cachePill = this.shadowRoot.getElementById('cc-cache-pill');
			this.domElements.cacheRingFill = this.shadowRoot.getElementById('cc-cache-fill');
			this.domElements.cacheText = this.shadowRoot.getElementById('cc-cache-text');
			this.domElements.summary = this.shadowRoot.getElementById('cc-summary');
			this.domElements.collapseBtn = this.shadowRoot.getElementById('cc-collapse-btn');
			this.domElements.debugBtn = this.shadowRoot.getElementById('cc-debug-btn');
			this.domElements.unavailable = this.shadowRoot.getElementById('cc-unavailable');
			this.domElements.unavailableMsg = this.shadowRoot.getElementById('cc-unavailable-msg');
			this.domElements.retryBtn = this.shadowRoot.getElementById('cc-retry-btn');

			this.domElements.ctxMain = this.shadowRoot.getElementById('cc-ctx-main');
			this.domElements.ctxPct = this.shadowRoot.getElementById('cc-ctx-pct');
			this.domElements.ctxBar = this.shadowRoot.getElementById('cc-ctx-bar');

			this.domElements.sessReset = this.shadowRoot.getElementById('cc-sess-reset');
			this.domElements.sessPct = this.shadowRoot.getElementById('cc-sess-pct');
			this.domElements.sessBar = this.shadowRoot.getElementById('cc-sess-bar');
			this.domElements.sessMarker = this.shadowRoot.getElementById('cc-sess-marker');

			this.domElements.weekReset = this.shadowRoot.getElementById('cc-week-reset');
			this.domElements.weekPct = this.shadowRoot.getElementById('cc-week-pct');
			this.domElements.weekBar = this.shadowRoot.getElementById('cc-week-bar');
			this.domElements.weekMarker = this.shadowRoot.getElementById('cc-week-marker');

			// Collapse toggle listener
			this.domElements.collapseBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.isCollapsed = !this.isCollapsed;
				localStorage.setItem('cc_collapsed', String(this.isCollapsed));
				card.classList.toggle('cc-mode-collapsed', this.isCollapsed);
				card.classList.toggle('cc-mode-expanded', !this.isCollapsed);
			});

			// Retry listener
			this.domElements.retryBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.onUsageRefresh) this.onUsageRefresh();
			});

			// Debug copy button
			if (localStorage.getItem(CC.CONST.DEBUG_STORAGE_KEY) === 'true' || window.__CC_DEBUG) {
				this.domElements.debugBtn.style.display = 'inline-flex';
			}
			this.domElements.debugBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.onCopyDebug) this.onCopyDebug();
			});

			this.updateTheme();
			this._observeTheme();
		}

		updateTheme() {
			const root = document.documentElement;
			const isDarkAttr = root.dataset?.mode === 'dark' || root.classList.contains('dark') || document.body?.classList.contains('dark');
			const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
			const isDark = isDarkAttr || (!root.dataset?.mode && !root.classList.contains('light') && prefersDark);

			if (this.domElements.card) {
				this.domElements.card.classList.toggle('cc-theme-dark', isDark);
				this.domElements.card.classList.toggle('cc-theme-light', !isDark);
			}
		}

		_observeTheme() {
			const observer = new MutationObserver(() => this.updateTheme());
			observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'class'] });
			if (document.body) {
				observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
			}
			if (window.matchMedia) {
				window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.updateTheme());
			}
		}

		setFloating(floating) {
			this.isFloating = floating;
			if (this.domElements.card) {
				this.domElements.card.classList.toggle('cc-meter-card--floating', floating);
			}
		}

		attachTo(anchorElement, asFloating = false) {
			this.initialize();
			this.setFloating(asFloating);

			if (asFloating) {
				if (!document.body.contains(this.rootElement)) {
					document.body.appendChild(this.rootElement);
				}
				this.currentAnchor = null;
				return;
			}

			if (!anchorElement) return;

			// Idempotent insertion
			if (this.rootElement.parentElement !== anchorElement.parentElement || this.rootElement.previousElementSibling !== anchorElement) {
				anchorElement.after(this.rootElement);
			}
			this.currentAnchor = anchorElement;
		}

		setUnavailable(reason) {
			this.metrics.unavailableReason = reason;
			if (this.domElements.card) {
				this.domElements.card.classList.toggle('cc-state-unavailable', !!reason);
				if (this.domElements.unavailableMsg && reason) {
					this.domElements.unavailableMsg.textContent = reason;
				}
			}
		}

		setPendingCache(pending) {
			this.metrics.isPendingCache = pending;
			if (this.domElements.cachePill) {
				if (pending) {
					this.domElements.cachePill.classList.remove('cc-hidden');
					this.domElements.cacheText.textContent = 'caching...';
				} else if (!this.metrics.cachedUntil || this.metrics.cachedUntil <= Date.now()) {
					this.domElements.cachePill.classList.add('cc-hidden');
				}
			}
		}

		setConversationMetrics({ totalTokens, cachedUntil } = {}) {
			const tokens = typeof totalTokens === 'number' ? totalTokens : 0;
			const pct = Math.max(0, Math.min(100, (tokens / CC.CONST.CONTEXT_LIMIT_TOKENS) * 100));

			this.metrics.context = {
				tokens,
				pct,
				formatted: `~${tokens.toLocaleString()} / 200k`
			};
			this.metrics.cachedUntil = cachedUntil;

			if (this.domElements.ctxMain) {
				this.domElements.ctxMain.textContent = this.metrics.context.formatted;
				this.domElements.ctxPct.textContent = `${pct.toFixed(1)}%`;
				this.domElements.ctxBar.style.width = `${pct}%`;
				this.domElements.ctxBar.style.backgroundColor = getColorForPct(pct);
				this.domElements.ctxBar.parentElement.setAttribute('aria-valuenow', pct.toFixed(1));

				const row = this.shadowRoot.getElementById('cc-row-context');
				if (row) row.classList.toggle('cc-high-utilization', pct >= 90);
			}

			this.updateSummary();
			this.tick();
		}

		setUsage(usage) {
			this.setUnavailable(null);

			const session = usage?.five_hour || null;
			const weekly = usage?.seven_day || null;

			// Session
			if (session && typeof session.utilization === 'number') {
				const pct = Math.max(0, Math.min(100, session.utilization));
				const resetsAt = session.resets_at ? Date.parse(session.resets_at) : null;
				const windowStart = resetsAt ? resetsAt - 5 * 60 * 60 * 1000 : null;

				this.metrics.session = { pct, resetsAt, windowStart, raw: session };
				if (this.domElements.sessPct) {
					this.domElements.sessPct.textContent = `${pct.toFixed(1)}%`;
					this.domElements.sessBar.style.width = `${pct}%`;
					this.domElements.sessBar.style.backgroundColor = getColorForPct(pct);
					this.domElements.sessBar.parentElement.setAttribute('aria-valuenow', pct.toFixed(1));

					const row = this.shadowRoot.getElementById('cc-row-session');
					if (row) row.classList.toggle('cc-high-utilization', pct >= 90);
				}
			}

			// Weekly
			if (weekly && typeof weekly.utilization === 'number') {
				const pct = Math.max(0, Math.min(100, weekly.utilization));
				const resetsAt = weekly.resets_at ? Date.parse(weekly.resets_at) : null;
				const windowStart = resetsAt ? resetsAt - 7 * 24 * 60 * 60 * 1000 : null;

				this.metrics.weekly = { pct, resetsAt, windowStart, raw: weekly };
				if (this.domElements.weekPct) {
					this.domElements.weekPct.textContent = `${pct.toFixed(1)}%`;
					this.domElements.weekBar.style.width = `${pct}%`;
					this.domElements.weekBar.style.backgroundColor = getColorForPct(pct);
					this.domElements.weekBar.parentElement.setAttribute('aria-valuenow', pct.toFixed(1));

					const row = this.shadowRoot.getElementById('cc-row-weekly');
					if (row) row.classList.toggle('cc-high-utilization', pct >= 90);
				}
			}

			this.updateSummary();
			this.tick();
		}

		updateSummary() {
			if (!this.domElements.summary) return;
			const ctxStr = `~${Math.round(this.metrics.context.tokens / 1000)}k ctx`;
			const sessStr = `${this.metrics.session.pct.toFixed(0)}% 5h`;
			const weekStr = `${this.metrics.weekly.pct.toFixed(0)}% 7d`;
			this.domElements.summary.textContent = `${ctxStr} · ${sessStr} · ${weekStr}`;
		}

		tick() {
			const now = Date.now();

			// 1. Cache countdown & ring
			if (this.metrics.cachedUntil && this.metrics.cachedUntil > now) {
				const secondsLeft = Math.max(0, Math.ceil((this.metrics.cachedUntil - now) / 1000));
				if (this.domElements.cachePill) {
					this.domElements.cachePill.classList.remove('cc-hidden');
					this.domElements.cacheText.textContent = `cached ${formatSeconds(secondsLeft)}`;

					const totalWindow = CC.CONST.CACHE_WINDOW_MS / 1000;
					const fractionRemaining = Math.max(0, Math.min(1, secondsLeft / totalWindow));
					const circumference = 2 * Math.PI * 6; // r=6 -> ~37.7
					const offset = circumference * (1 - fractionRemaining);
					if (this.domElements.cacheRingFill) {
						this.domElements.cacheRingFill.style.strokeDashoffset = `${offset}`;
					}
				}
			} else if (this.metrics.cachedUntil && this.metrics.cachedUntil <= now) {
				this.metrics.cachedUntil = null;
				if (!this.metrics.isPendingCache && this.domElements.cachePill) {
					this.domElements.cachePill.classList.add('cc-hidden');
				}
			}

			// 2. Session countdown & marker
			if (this.metrics.session.resetsAt) {
				if (this.domElements.sessReset) {
					this.domElements.sessReset.textContent = `resets in ${formatResetCountdown(this.metrics.session.resetsAt)}`;
				}
				if (this.domElements.sessMarker && this.metrics.session.windowStart) {
					const total = this.metrics.session.resetsAt - this.metrics.session.windowStart;
					const elapsed = Math.max(0, Math.min(total, now - this.metrics.session.windowStart));
					const ratio = total > 0 ? elapsed / total : 0;
					this.domElements.sessMarker.classList.remove('cc-hidden');
					this.domElements.sessMarker.style.left = `${(ratio * 100).toFixed(1)}%`;
				}
			}

			// 3. Weekly countdown & marker
			if (this.metrics.weekly.resetsAt) {
				if (this.domElements.weekReset) {
					this.domElements.weekReset.textContent = `resets in ${formatResetCountdown(this.metrics.weekly.resetsAt)}`;
				}
				if (this.domElements.weekMarker && this.metrics.weekly.windowStart) {
					const total = this.metrics.weekly.resetsAt - this.metrics.weekly.windowStart;
					const elapsed = Math.max(0, Math.min(total, now - this.metrics.weekly.windowStart));
					const ratio = total > 0 ? elapsed / total : 0;
					this.domElements.weekMarker.classList.remove('cc-hidden');
					this.domElements.weekMarker.style.left = `${(ratio * 100).toFixed(1)}%`;
				}
			}
		}
	}

	CC.ui = { CounterUI };
})();
