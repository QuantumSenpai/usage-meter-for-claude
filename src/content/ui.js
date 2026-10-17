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

	// Preset color palettes
	const PRESETS = {
		default: {
			name: 'Default',
			low: '#10b981',
			mid: '#f59e0b',
			high: '#ef4444',
			accent: '#3b82f6'
		},
		ocean: {
			name: 'Ocean',
			low: '#06b6d4',
			mid: '#3b82f6',
			high: '#6366f1',
			accent: '#0284c7'
		},
		sunset: {
			name: 'Sunset',
			low: '#f43f5e',
			mid: '#d946ef',
			high: '#8b5cf6',
			accent: '#ec4899'
		},
		mono: {
			name: 'Mono',
			low: '#9ca3af',
			mid: '#6b7280',
			high: '#ef4444', // Over-limit/warning is distinctly visible in mono
			accent: '#4b5563'
		},
		highContrast: {
			name: 'High-contrast',
			low: '#00e676',
			mid: '#ffea00',
			high: '#ff1744',
			accent: '#00e5ff'
		}
	};

	function parseHexColor(hex) {
		if (!hex || typeof hex !== 'string') return null;
		let clean = hex.replace('#', '').trim();
		if (clean.length === 3) {
			clean = clean.split('').map((c) => c + c).join('');
		}
		if (clean.length !== 6) return null;
		const r = parseInt(clean.slice(0, 2), 16);
		const g = parseInt(clean.slice(2, 4), 16);
		const b = parseInt(clean.slice(4, 6), 16);
		return { r, g, b };
	}

	function getRelativeLuminance({ r, g, b }) {
		const normalize = (c) => {
			const s = c / 255;
			return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
		};
		return 0.2126 * normalize(r) + 0.7152 * normalize(g) + 0.0722 * normalize(b);
	}

	function getContrastRatio(rgb1, rgb2) {
		if (!rgb1 || !rgb2) return 21;
		const l1 = getRelativeLuminance(rgb1);
		const l2 = getRelativeLuminance(rgb2);
		const lighter = Math.max(l1, l2);
		const darker = Math.min(l1, l2);
		return (lighter + 0.05) / (darker + 0.05);
	}

	function interpolateColor(color1, color2, factor) {
		const c1 = parseHexColor(color1) || { r: 16, g: 185, b: 129 };
		const c2 = parseHexColor(color2) || { r: 239, g: 68, b: 68 };
		const f = Math.max(0, Math.min(1, factor));
		const r = Math.round(c1.r + (c2.r - c1.r) * f);
		const g = Math.round(c1.g + (c2.g - c1.g) * f);
		const b = Math.round(c1.b + (c2.b - c1.b) * f);
		return `rgb(${r}, ${g}, ${b})`;
	}

	const UI_STYLES = `
		:host {
			all: initial;
			display: block;
			width: 100%;
			box-sizing: border-box;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			font-size: 11px;
			line-height: 1.4;
			user-select: none;
			-webkit-font-smoothing: antialiased;
			--cc-color-low: #10b981;
			--cc-color-mid: #f59e0b;
			--cc-color-high: #ef4444;
			--cc-accent: #3b82f6;
		}

		*, *::before, *::after {
			box-sizing: border-box;
		}

		/* Main Inline Panel Card (fits directly above composer card) */
		.cc-panel {
			display: block;
			width: 100%;
			background: var(--cc-bg, rgba(30, 29, 28, 0.95));
			border: 1px solid var(--cc-border, rgba(255, 255, 255, 0.08));
			border-radius: 8px;
			color: var(--cc-text, #f0eee9);
			box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
			transition: background-color 150ms ease, border-color 150ms ease;
			font-feature-settings: "tnum";
			font-variant-numeric: tabular-nums;
			overflow: hidden;
		}

		/* Theme variants matching Claude aesthetic */
		.cc-theme-light {
			--cc-bg-default: rgba(255, 255, 255, 0.95);
			--cc-border: rgba(0, 0, 0, 0.08);
			--cc-text: #1f1e1d;
			--cc-text-muted: #6b6966;
			--cc-bar-bg: rgba(0, 0, 0, 0.07);
			--cc-marker: rgba(0, 0, 0, 0.4);
		}

		.cc-theme-dark {
			--cc-bg-default: rgba(30, 29, 28, 0.95);
			--cc-border: rgba(255, 255, 255, 0.08);
			--cc-text: #f0eee9;
			--cc-text-muted: #9c9a95;
			--cc-bar-bg: rgba(255, 255, 255, 0.08);
			--cc-marker: rgba(255, 255, 255, 0.5);
		}

		/* Thin summary line (Default View: always visible) */
		.cc-summary-line {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 4px 10px;
			min-height: 26px;
			cursor: pointer;
			gap: 8px;
			transition: background-color 120ms ease;
		}

		.cc-summary-line:hover {
			background: rgba(128, 128, 128, 0.06);
		}

		.cc-summary-left {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 0;
			flex: 1;
		}

		.cc-label {
			font-size: 11px;
			font-weight: 500;
			color: var(--cc-text);
			white-space: nowrap;
			flex-shrink: 0;
		}

		.cc-bar-track--mini {
			width: 80px;
			max-width: 25%;
			height: 5px;
			flex-shrink: 0;
		}

		.cc-summary-right {
			display: flex;
			align-items: center;
			gap: 2px;
			flex-shrink: 0;
		}

		.cc-btn {
			background: none;
			border: none;
			padding: 3px;
			color: var(--cc-text-muted);
			cursor: pointer;
			border-radius: 4px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			transition: background 150ms ease, color 150ms ease;
		}

		.cc-btn:hover {
			background: rgba(128, 128, 128, 0.14);
			color: var(--cc-text);
		}

		.cc-expand-btn {
			cursor: pointer;
		}

		.cc-chevron {
			transition: transform 180ms ease;
		}

		.cc-panel.cc-expanded .cc-chevron {
			transform: rotate(180deg);
		}

		/* Collapsible Details View */
		.cc-details {
			display: none;
			padding: 4px 10px 8px 10px;
			border-top: 1px solid var(--cc-border, rgba(255, 255, 255, 0.06));
		}

		.cc-panel.cc-expanded .cc-details {
			display: block;
		}

		/* Standard row */
		.cc-row {
			display: flex;
			flex-direction: column;
			gap: 3px;
			padding: 3px 0;
		}

		.cc-row--cache {
			padding-bottom: 2px;
		}

		.cc-row-meta {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			font-size: 11px;
		}

		.cc-cache-meta-left {
			display: flex;
			align-items: center;
			gap: 6px;
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

		.cc-val-pct {
			font-weight: 600;
			min-width: 32px;
			text-align: right;
		}

		.cc-val-reset {
			font-size: 10px;
		}

		.cc-bar-track {
			position: relative;
			height: 5px;
			background: var(--cc-bar-bg);
			border-radius: 3px;
			overflow: hidden;
			width: 100%;
		}

		.cc-bar-fill {
			height: 100%;
			width: 0%;
			border-radius: 3px;
			background-color: var(--cc-color-low, #10b981);
			transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 300ms ease;
		}

		/* Over-limit (Orange / Mid warning) */
		.cc-over-limit .cc-bar-fill {
			background-color: var(--cc-color-mid, #f59e0b) !important;
		}

		.cc-over-limit .cc-val-pct {
			color: var(--cc-color-mid, #f59e0b) !important;
			font-weight: 600;
		}

		/* Over-limit > 10% (Red / High warning) */
		.cc-over-limit-10pct .cc-bar-fill {
			background-color: var(--cc-color-high, #ef4444) !important;
			animation: cc-pulse 2s infinite ease-in-out;
		}

		.cc-over-limit-10pct .cc-val-pct {
			color: var(--cc-color-high, #ef4444) !important;
			font-weight: 700;
		}

		@keyframes cc-pulse {
			0%, 100% { opacity: 1; }
			50% { opacity: 0.78; }
		}

		.cc-bar-marker {
			position: absolute;
			top: 0;
			bottom: 0;
			width: 2px;
			background: var(--cc-marker, rgba(255, 255, 255, 0.7));
			transform: translateX(-50%);
			pointer-events: none;
			border-radius: 1px;
		}

		/* Cache Ring */
		.cc-cache-ring {
			transform: rotate(-90deg);
			display: inline-block;
			vertical-align: middle;
		}

		.cc-cache-ring-bg {
			fill: none;
			stroke: var(--cc-bar-bg, rgba(128, 128, 128, 0.2));
			stroke-width: 2.5;
		}

		.cc-cache-ring-fill {
			fill: none;
			stroke: var(--cc-color-low, #10b981);
			stroke-width: 2.5;
			stroke-linecap: round;
			stroke-dasharray: 37.7;
			stroke-dashoffset: 37.7;
			transition: stroke-dashoffset 500ms linear;
		}

		/* State: Empty Plan Notice */
		.cc-empty-notice {
			display: none;
			font-size: 10px;
			color: var(--cc-text-muted);
			padding: 4px 0;
			text-align: left;
			user-select: text;
		}

		.cc-state-empty .cc-empty-notice {
			display: block;
		}

		.cc-state-empty #cc-row-session,
		.cc-state-empty #cc-row-weekly {
			display: none !important;
		}

		/* State: Error */
		.cc-error-notice {
			display: none;
			align-items: center;
			justify-content: space-between;
			background: rgba(239, 68, 68, 0.12);
			border: 1px solid rgba(239, 68, 68, 0.25);
			border-radius: 6px;
			padding: 4px 8px;
			margin: 4px 0;
			font-size: 10px;
			color: #ef4444;
		}

		.cc-state-error .cc-error-notice {
			display: flex;
		}

		.cc-retry-btn {
			background: rgba(239, 68, 68, 0.2);
			border: none;
			color: #ef4444;
			font-size: 10px;
			padding: 2px 6px;
			border-radius: 4px;
			cursor: pointer;
		}

		.cc-retry-btn:hover {
			background: rgba(239, 68, 68, 0.35);
		}

		/* Settings Drawer */
		.cc-settings-drawer {
			display: none;
			margin-top: 6px;
			padding-top: 6px;
			border-top: 1px solid var(--cc-border, rgba(255, 255, 255, 0.08));
			font-size: 10px;
		}

		.cc-settings-drawer.cc-open {
			display: block;
		}

		.cc-settings-title {
			font-weight: 600;
			color: var(--cc-text);
			margin-bottom: 4px;
			text-transform: uppercase;
			letter-spacing: 0.04em;
			font-size: 9px;
		}

		.cc-presets-grid {
			display: grid;
			grid-template-columns: repeat(5, 1fr);
			gap: 3px;
			margin-bottom: 6px;
		}

		.cc-preset-btn {
			background: rgba(128, 128, 128, 0.12);
			border: 1px solid var(--cc-border, rgba(255, 255, 255, 0.08));
			color: var(--cc-text);
			border-radius: 4px;
			padding: 3px 2px;
			font-size: 9px;
			cursor: pointer;
			text-align: center;
			transition: background 120ms ease;
		}

		.cc-preset-btn:hover {
			background: rgba(128, 128, 128, 0.22);
		}

		.cc-settings-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-bottom: 4px;
			color: var(--cc-text-muted);
		}

		.cc-settings-row input[type="color"] {
			border: none;
			width: 20px;
			height: 18px;
			border-radius: 3px;
			cursor: pointer;
			background: none;
			padding: 0;
		}

		.cc-settings-row input[type="range"] {
			width: 90px;
			cursor: pointer;
		}

		.cc-settings-row input[type="number"] {
			width: 75px;
			background: rgba(128, 128, 128, 0.14);
			border: 1px solid var(--cc-border, rgba(255, 255, 255, 0.08));
			color: var(--cc-text);
			border-radius: 4px;
			padding: 2px 4px;
			font-size: 9px;
			font-family: inherit;
			text-align: right;
		}

		.cc-settings-row input[type="number"]:focus {
			outline: 1px solid var(--cc-accent, #d97706);
		}

		.cc-contrast-alert {
			display: none;
			padding: 3px 6px;
			border-radius: 4px;
			background: rgba(245, 158, 11, 0.15);
			color: #f59e0b;
			font-size: 9px;
			margin-top: 4px;
		}

		.cc-contrast-alert.cc-show {
			display: block;
		}

		.cc-settings-actions {
			display: flex;
			gap: 4px;
			margin-top: 6px;
		}

		.cc-btn-secondary {
			background: rgba(128, 128, 128, 0.14);
			border: 1px solid var(--cc-border, rgba(255, 255, 255, 0.08));
			color: var(--cc-text);
			border-radius: 4px;
			padding: 3px 6px;
			font-size: 9px;
			cursor: pointer;
			flex: 1;
		}

		.cc-btn-secondary:hover {
			background: rgba(128, 128, 128, 0.24);
		}

		.cc-hidden {
			display: none !important;
		}

		@media (prefers-reduced-motion: reduce) {
			*, *::before, *::after {
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
			this.panel = null;

			// Expand / Collapse state
			this.isExpanded = this._loadSavedExpanded();
			this.settingsOpen = false;

			// Settings
			this.settings = this._loadSavedSettings();

			// Metrics
			this.metrics = {
				hasConversation: false,
				context: { isLoaded: false, tokens: null, pct: null, formatted: '— / 200k' },
				session: { pct: null, resetsAt: null, windowStart: null },
				weekly: { pct: null, resetsAt: null, windowStart: null },
				cachedUntil: null,
				isPendingCache: false,
				state: 'empty',
				errorReason: null
			};

			this.dom = {};
		}

		_loadSavedExpanded() {
			try {
				return localStorage.getItem('cc_expanded') === 'true';
			} catch {
				return false;
			}
		}

		_saveExpanded(val) {
			this.isExpanded = !!val;
			try {
				localStorage.setItem('cc_expanded', String(this.isExpanded));
			} catch {
				// ignore
			}
			this.applyExpandedState();
		}

		applyExpandedState() {
			if (!this.panel) return;
			this.panel.classList.toggle('cc-expanded', this.isExpanded);
			if (this.dom.expandBtn) {
				this.dom.expandBtn.setAttribute('aria-expanded', String(this.isExpanded));
			}
		}

		_loadSavedSettings() {
			const defaults = {
				preset: 'default',
				lowColor: PRESETS.default.low,
				midColor: PRESETS.default.mid,
				highColor: PRESETS.default.high,
				accentColor: PRESETS.default.accent,
				opacity: 0.94,
				showSession: true,
				showWeekly: true,
				contextWindow: CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000
			};
			try {
				const saved = localStorage.getItem('cc_settings');
				if (saved) {
					const parsed = JSON.parse(saved);
					if (parsed && typeof parsed.contextWindow === 'number' && !isNaN(parsed.contextWindow) && parsed.contextWindow > 0) {
						// valid number
					} else if (parsed && parsed.contextWindow) {
						const num = parseInt(parsed.contextWindow, 10);
						if (!isNaN(num) && num > 0) parsed.contextWindow = num;
						else delete parsed.contextWindow;
					}
					return Object.assign(defaults, parsed);
				}
			} catch {
				// ignore
			}
			return defaults;
		}

		_saveSettings() {
			try {
				localStorage.setItem('cc_settings', JSON.stringify(this.settings));
			} catch {
				// ignore
			}
			this.applyThemeAndSettings();
		}

		initialize() {
			if (this.rootElement) return;

			this.rootElement = document.createElement('div');
			this.rootElement.id = CC.DOM.METER_ROOT_ID;
			this.shadowRoot = this.rootElement.attachShadow({ mode: 'open' });

			const styleTag = document.createElement('style');
			styleTag.textContent = UI_STYLES;
			this.shadowRoot.appendChild(styleTag);

			const panel = document.createElement('div');
			panel.className = `cc-panel ${this.isExpanded ? 'cc-expanded' : ''}`;
			this.panel = panel;

			panel.innerHTML = `
				<!-- Thin summary line (Default View: always visible) -->
				<div class="cc-summary-line" id="cc-summary-line" title="Click to expand/collapse Usage Meter">
					<div class="cc-summary-left">
						<span class="cc-label" title="Size of this chat vs. context window. Not your usage limit.">Context</span>
						<div class="cc-bar-track cc-bar-track--mini" role="progressbar" aria-label="Context utilization" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
							<div class="cc-bar-fill" id="cc-ctx-bar"></div>
						</div>
						<span class="cc-val-main" id="cc-ctx-main">— / 200k</span>
						<span class="cc-val-pct" id="cc-ctx-pct">—</span>
					</div>
					<div class="cc-summary-right">
						<button class="cc-btn" id="cc-debug-btn" title="Copy Diagnostic Log" style="display: none;">
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
						</button>
						<button class="cc-btn" id="cc-gear-btn" title="Settings &amp; Colors">
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
						</button>
						<button class="cc-btn cc-expand-btn" id="cc-expand-btn" title="Expand / collapse details" aria-expanded="${this.isExpanded}">
							<svg class="cc-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
						</button>
					</div>
				</div>

				<!-- Collapsible Details Container -->
				<div class="cc-details" id="cc-details">
					<!-- State: Error Notice -->
					<div class="cc-error-notice" id="cc-error-notice">
						<span id="cc-error-msg">Usage currently unavailable</span>
						<button class="cc-retry-btn" id="cc-retry-btn">Retry</button>
					</div>

					<!-- Cache Row (Always present in details; shows "—" when no active cache) -->
					<div class="cc-row cc-row--cache" id="cc-row-cache">
						<div class="cc-row-meta">
							<div class="cc-cache-meta-left">
								<svg class="cc-cache-ring" width="12" height="12" viewBox="0 0 16 16">
									<circle class="cc-cache-ring-bg" cx="8" cy="8" r="6" />
									<circle class="cc-cache-ring-fill" id="cc-cache-fill" cx="8" cy="8" r="6" />
								</svg>
								<span class="cc-row-label">Cache</span>
							</div>
							<div class="cc-row-stat">
								<span class="cc-val-main" id="cc-cache-text">—</span>
							</div>
						</div>
					</div>

					<!-- State: Empty Plan Notice (replaces Session & Weekly on free plan) -->
					<div class="cc-empty-notice" id="cc-empty-notice">
						<span>Session &amp; weekly limits not provided on this plan</span>
					</div>

					<!-- Session 5h Row -->
					<div class="cc-row" id="cc-row-session">
						<div class="cc-row-meta">
							<span class="cc-row-label">Session 5h</span>
							<div class="cc-row-stat">
								<span class="cc-val-reset" id="cc-sess-reset"></span>
								<span class="cc-val-pct" id="cc-sess-pct">n/a</span>
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
								<span class="cc-val-pct" id="cc-week-pct">n/a</span>
							</div>
						</div>
						<div class="cc-bar-track" role="progressbar" aria-label="7-day weekly utilization" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
							<div class="cc-bar-fill" id="cc-week-bar"></div>
							<div class="cc-bar-marker cc-hidden" id="cc-week-marker" title="Current window progress"></div>
						</div>
					</div>

					<!-- Settings Drawer -->
					<div class="cc-settings-drawer" id="cc-settings-drawer">
						<div class="cc-settings-title">Color Themes</div>
						<div class="cc-presets-grid">
							<button class="cc-preset-btn" data-preset="default">Default</button>
							<button class="cc-preset-btn" data-preset="ocean">Ocean</button>
							<button class="cc-preset-btn" data-preset="sunset">Sunset</button>
							<button class="cc-preset-btn" data-preset="mono">Mono</button>
							<button class="cc-preset-btn" data-preset="highContrast">High-contrast</button>
						</div>

						<div class="cc-settings-title" style="margin-top: 4px;">Custom Colors</div>
						<div class="cc-settings-row">
							<span>Low (0–60%)</span>
							<input type="color" id="cc-col-low" />
						</div>
						<div class="cc-settings-row">
							<span>Mid (60–85%)</span>
							<input type="color" id="cc-col-mid" />
						</div>
						<div class="cc-settings-row">
							<span>High / Warning</span>
							<input type="color" id="cc-col-high" />
						</div>
						<div class="cc-settings-row">
							<span>Background Opacity</span>
							<input type="range" id="cc-opacity-slider" min="50" max="100" step="2" />
						</div>

						<div class="cc-contrast-alert" id="cc-contrast-alert">
							⚠️ Low contrast (&lt; 4.5:1). Colors may be hard to read.
						</div>

						<div class="cc-settings-title" style="margin-top: 4px;">Context Window Override</div>
						<div class="cc-settings-row">
							<span title="Override the estimated context window limit (default: 200000)">Context Window</span>
							<input type="number" id="cc-context-window-input" min="1000" max="10000000" step="10000" placeholder="200000" />
						</div>

						<div class="cc-settings-title" style="margin-top: 4px;">Rows Visibility</div>
						<div class="cc-settings-row">
							<label><input type="checkbox" id="cc-chk-sess" /> Session 5h</label>
							<label><input type="checkbox" id="cc-chk-week" /> Weekly 7d</label>
						</div>

						<div class="cc-settings-actions">
							<button class="cc-btn-secondary" id="cc-reset-defaults-btn">Reset Defaults</button>
						</div>
					</div>
				</div>
			`;

			this.shadowRoot.appendChild(panel);

			// Cache references
			this.dom.panel = panel;
			this.dom.summaryLine = this.shadowRoot.getElementById('cc-summary-line');
			this.dom.expandBtn = this.shadowRoot.getElementById('cc-expand-btn');
			this.dom.gearBtn = this.shadowRoot.getElementById('cc-gear-btn');
			this.dom.debugBtn = this.shadowRoot.getElementById('cc-debug-btn');

			this.dom.details = this.shadowRoot.getElementById('cc-details');
			this.dom.rowCache = this.shadowRoot.getElementById('cc-row-cache');
			this.dom.cacheFill = this.shadowRoot.getElementById('cc-cache-fill');
			this.dom.cacheText = this.shadowRoot.getElementById('cc-cache-text');

			this.dom.emptyNotice = this.shadowRoot.getElementById('cc-empty-notice');
			this.dom.errorNotice = this.shadowRoot.getElementById('cc-error-notice');
			this.dom.errorMsg = this.shadowRoot.getElementById('cc-error-msg');
			this.dom.retryBtn = this.shadowRoot.getElementById('cc-retry-btn');

			this.dom.ctxMain = this.shadowRoot.getElementById('cc-ctx-main');
			this.dom.ctxPct = this.shadowRoot.getElementById('cc-ctx-pct');
			this.dom.ctxBar = this.shadowRoot.getElementById('cc-ctx-bar');

			this.dom.rowSess = this.shadowRoot.getElementById('cc-row-session');
			this.dom.sessReset = this.shadowRoot.getElementById('cc-sess-reset');
			this.dom.sessPct = this.shadowRoot.getElementById('cc-sess-pct');
			this.dom.sessBar = this.shadowRoot.getElementById('cc-sess-bar');
			this.dom.sessMarker = this.shadowRoot.getElementById('cc-sess-marker');

			this.dom.rowWeek = this.shadowRoot.getElementById('cc-row-weekly');
			this.dom.weekReset = this.shadowRoot.getElementById('cc-week-reset');
			this.dom.weekPct = this.shadowRoot.getElementById('cc-week-pct');
			this.dom.weekBar = this.shadowRoot.getElementById('cc-week-bar');
			this.dom.weekMarker = this.shadowRoot.getElementById('cc-week-marker');

			// Settings elements
			this.dom.settingsDrawer = this.shadowRoot.getElementById('cc-settings-drawer');
			this.dom.colLow = this.shadowRoot.getElementById('cc-col-low');
			this.dom.colMid = this.shadowRoot.getElementById('cc-col-mid');
			this.dom.colHigh = this.shadowRoot.getElementById('cc-col-high');
			this.dom.opacitySlider = this.shadowRoot.getElementById('cc-opacity-slider');
			this.dom.contrastAlert = this.shadowRoot.getElementById('cc-contrast-alert');
			this.dom.contextWindowInput = this.shadowRoot.getElementById('cc-context-window-input');
			this.dom.chkSess = this.shadowRoot.getElementById('cc-chk-sess');
			this.dom.chkWeek = this.shadowRoot.getElementById('cc-chk-week');
			this.dom.resetDefaultsBtn = this.shadowRoot.getElementById('cc-reset-defaults-btn');

			this._bindEvents();
			this.applyThemeAndSettings();
			this.applyExpandedState();
			this.renderAll();
		}

		_bindEvents() {
			// Click thin summary line to toggle expand/collapse
			this.dom.summaryLine.addEventListener('click', (e) => {
				if (e.target.closest('#cc-gear-btn') || e.target.closest('#cc-debug-btn')) {
					return;
				}
				this._saveExpanded(!this.isExpanded);
			});

			this.dom.expandBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this._saveExpanded(!this.isExpanded);
			});

			// Settings Drawer toggle
			this.dom.gearBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.settingsOpen = !this.settingsOpen;
				// If opening settings while collapsed, expand the panel so it's visible
				if (this.settingsOpen && !this.isExpanded) {
					this._saveExpanded(true);
				}
				this.dom.settingsDrawer.classList.toggle('cc-open', this.settingsOpen);
			});

			// Debug export button
			if (localStorage.getItem(CC.CONST?.DEBUG_STORAGE_KEY || 'cc_debug') === 'true' || window.__CC_DEBUG) {
				this.dom.debugBtn.style.display = 'inline-flex';
			}
			this.dom.debugBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.onCopyDebug) this.onCopyDebug();
			});

			// Retry button
			this.dom.retryBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.onUsageRefresh) this.onUsageRefresh();
			});

			// Presets buttons
			this.shadowRoot.querySelectorAll('.cc-preset-btn').forEach((btn) => {
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					const presetKey = btn.dataset.preset;
					const p = PRESETS[presetKey];
					if (p) {
						this.settings.preset = presetKey;
						this.settings.lowColor = p.low;
						this.settings.midColor = p.mid;
						this.settings.highColor = p.high;
						this.settings.accentColor = p.accent;
						this._saveSettings();
					}
				});
			});

			// Color & Opacity inputs
			this.dom.colLow.addEventListener('input', (e) => {
				this.settings.lowColor = e.target.value;
				this._saveSettings();
			});
			this.dom.colMid.addEventListener('input', (e) => {
				this.settings.midColor = e.target.value;
				this._saveSettings();
			});
			this.dom.colHigh.addEventListener('input', (e) => {
				this.settings.highColor = e.target.value;
				this._saveSettings();
			});
			this.dom.opacitySlider.addEventListener('input', (e) => {
				this.settings.opacity = parseInt(e.target.value, 10) / 100;
				this._saveSettings();
			});

			// Row Visibility checkboxes
			this.dom.chkSess.addEventListener('change', (e) => {
				this.settings.showSession = e.target.checked;
				this._saveSettings();
			});
			this.dom.chkWeek.addEventListener('change', (e) => {
				this.settings.showWeekly = e.target.checked;
				this._saveSettings();
			});

			// Context Window Override input
			if (this.dom.contextWindowInput) {
				const handleContextWindowChange = (val) => {
					const num = parseInt(val, 10);
					if (!isNaN(num) && num > 0) {
						this.settings.contextWindow = num;
					} else {
						this.settings.contextWindow = CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000;
					}
					this._saveSettings();
					if (this.lastConversationData) {
						this.setConversationMetrics(this.lastConversationData);
					}
				};

				this.dom.contextWindowInput.addEventListener('change', (e) => {
					handleContextWindowChange(e.target.value);
					e.target.value = this.settings.contextWindow;
				});
				this.dom.contextWindowInput.addEventListener('input', (e) => {
					handleContextWindowChange(e.target.value);
				});
			}

			// Reset buttons
			this.dom.resetDefaultsBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.resetDefaults();
			});

			// Theme change observer
			const themeObserver = new MutationObserver(() => this.applyThemeAndSettings());
			themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'class'] });
			if (document.body) {
				themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
			}
		}

		resetDefaults() {
			this.settings = {
				preset: 'default',
				lowColor: PRESETS.default.low,
				midColor: PRESETS.default.mid,
				highColor: PRESETS.default.high,
				accentColor: PRESETS.default.accent,
				opacity: 0.94,
				showSession: true,
				showWeekly: true,
				contextWindow: CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000
			};
			this._saveSettings();
			if (this.lastConversationData) {
				this.setConversationMetrics(this.lastConversationData);
			}
		}

		applyThemeAndSettings() {
			if (!this.panel) return;

			const root = document.documentElement;
			const isDark = root.dataset?.mode === 'dark' ||
				root.classList.contains('dark') ||
				document.body?.classList.contains('dark') ||
				(!root.dataset?.mode && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

			this.panel.classList.toggle('cc-theme-dark', isDark);
			this.panel.classList.toggle('cc-theme-light', !isDark);

			// Apply color vars
			const low = this.settings.lowColor || PRESETS.default.low;
			const mid = this.settings.midColor || PRESETS.default.mid;
			const high = this.settings.highColor || PRESETS.default.high || '#ef4444';
			const accent = this.settings.accentColor || PRESETS.default.accent;
			const opacity = this.settings.opacity ?? 0.94;

			this.panel.style.setProperty('--cc-color-low', low);
			this.panel.style.setProperty('--cc-color-mid', mid);
			this.panel.style.setProperty('--cc-color-high', high);
			this.panel.style.setProperty('--cc-accent', accent);

			const baseBg = isDark ? `rgba(30, 29, 28, ${opacity})` : `rgba(255, 255, 255, ${opacity})`;
			this.panel.style.setProperty('--cc-bg', baseBg);

			// Inputs in settings drawer
			if (this.dom.colLow) this.dom.colLow.value = low;
			if (this.dom.colMid) this.dom.colMid.value = mid;
			if (this.dom.colHigh) this.dom.colHigh.value = high;
			if (this.dom.opacitySlider) this.dom.opacitySlider.value = Math.round(opacity * 100);
			if (this.dom.contextWindowInput) this.dom.contextWindowInput.value = this.settings.contextWindow || (CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000);

			if (this.dom.chkSess) this.dom.chkSess.checked = !!this.settings.showSession;
			if (this.dom.chkWeek) this.dom.chkWeek.checked = !!this.settings.showWeekly;

			// Row visibility
			if (this.dom.rowSess) this.dom.rowSess.classList.toggle('cc-hidden', !this.settings.showSession);
			if (this.dom.rowWeek) this.dom.rowWeek.classList.toggle('cc-hidden', !this.settings.showWeekly);

			// Contrast check
			const bgRgb = isDark ? { r: 30, g: 29, b: 28 } : { r: 255, g: 255, b: 255 };
			const textRgb = isDark ? { r: 240, g: 238, b: 233 } : { r: 31, g: 30, b: 29 };
			const cr = getContrastRatio(bgRgb, textRgb);
			if (this.dom.contrastAlert) {
				this.dom.contrastAlert.classList.toggle('cc-show', cr < 4.5);
			}

			this.refreshBarColors();
		}

		refreshBarColors() {
			const getColor = (pct) => {
				if (typeof pct !== 'number') return this.settings.lowColor;
				if (pct <= 60) return interpolateColor(this.settings.lowColor, this.settings.midColor, pct / 60);
				return interpolateColor(this.settings.midColor, this.settings.highColor, (pct - 60) / 40);
			};

			const limit = this.settings?.contextWindow || CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000;
			const midColor = this.settings.midColor || PRESETS.default.mid || '#f59e0b';
			const warningColor = this.settings.highColor || PRESETS.default.high || '#ef4444';

			if (this.dom.ctxBar) {
				if (!this.metrics.context.isLoaded) {
					this.dom.ctxBar.style.backgroundColor = this.settings.lowColor;
				} else if (this.metrics.context.tokens > limit * 1.1) {
					// Red only if user-set override is exceeded by >10%
					this.dom.ctxBar.style.backgroundColor = warningColor;
				} else if (this.metrics.context.tokens > limit) {
					// Over-limit (<= 10% over): Mid/warning (orange) color
					this.dom.ctxBar.style.backgroundColor = midColor;
				} else if (typeof this.metrics.context.pct === 'number') {
					this.dom.ctxBar.style.backgroundColor = getColor(this.metrics.context.pct);
				}
			}
			if (this.dom.sessBar && typeof this.metrics.session.pct === 'number') {
				this.dom.sessBar.style.backgroundColor = getColor(this.metrics.session.pct);
			}
			if (this.dom.weekBar && typeof this.metrics.weekly.pct === 'number') {
				this.dom.weekBar.style.backgroundColor = getColor(this.metrics.weekly.pct);
			}
		}

		attach() {
			this.initialize();
		}

		setConversationActive(hasConv) {
			this.metrics.hasConversation = !!hasConv;
		}

		setPendingCache(pending) {
			this.metrics.isPendingCache = pending;
			if (this.dom.cacheText) {
				if (pending) {
					this.dom.cacheText.textContent = 'caching...';
					if (this.dom.cacheFill) this.dom.cacheFill.style.strokeDashoffset = '0';
				} else if (!this.metrics.cachedUntil || this.metrics.cachedUntil <= Date.now()) {
					this.dom.cacheText.textContent = '—';
					if (this.dom.cacheFill) this.dom.cacheFill.style.strokeDashoffset = '37.7';
				}
			}
		}

		setConversationLoading() {
			const limit = this.settings?.contextWindow || CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000;
			const limitStr = limit >= 1000 ? `${Math.round(limit / 1000)}k` : String(limit);
			this.metrics.context = {
				isLoaded: false,
				tokens: null,
				pct: null,
				formatted: `— / ${limitStr}`
			};
			this.metrics.cachedUntil = null;

			if (this.dom.ctxMain) {
				this.dom.ctxMain.textContent = `— / ${limitStr}`;
				this.dom.ctxPct.textContent = '—';
				this.dom.ctxPct.title = '';
				this.dom.ctxBar.style.width = '0%';
				this.dom.ctxBar.title = '';
				if (this.dom.ctxBar.parentElement) {
					this.dom.ctxBar.parentElement.setAttribute('aria-valuenow', '0');
					this.dom.ctxBar.parentElement.title = '';
				}
				this.panel.classList.remove('cc-over-limit');
				this.panel.classList.remove('cc-over-limit-10pct');
				this.panel.classList.remove('cc-high-utilization');
			}

			if (this.dom.cacheText) {
				this.dom.cacheText.textContent = '—';
				if (this.dom.cacheFill) this.dom.cacheFill.style.strokeDashoffset = '37.7';
			}

			this.refreshBarColors();
		}

		setConversationMetrics({ totalTokens, cachedUntil, isLoaded = true } = {}) {
			this.lastConversationData = { totalTokens, cachedUntil, isLoaded };

			if (!isLoaded || typeof totalTokens !== 'number' || isNaN(totalTokens)) {
				this.setConversationLoading();
				return;
			}

			const tokens = Math.max(0, Math.round(totalTokens));
			const limit = this.settings?.contextWindow || CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000;
			this.metrics.cachedUntil = cachedUntil;

			const util = CC.tokens?.formatContextUtilization
				? CC.tokens.formatContextUtilization(tokens, limit)
				: (() => {
					const limitNum = (typeof limit === 'number' && limit > 0) ? limit : 200000;
					const limitStr = limitNum >= 1000 ? `${Math.round(limitNum / 1000)}k` : String(limitNum);
					const fTok = CC.tokens?.formatTokens ? CC.tokens.formatTokens(tokens) : (tokens >= 1000 ? `~${Math.round(tokens / 1000)}k` : `~${tokens}`);
					const isOver = tokens > limitNum;
					const is10Pct = tokens > (limitNum * 1.1);
					const rawPct = (tokens / limitNum) * 100;
					return {
						formatted: `${fTok} est. / ${limitStr}`,
						percentText: isOver ? 'long chat' : (tokens === 0 ? '0%' : `${rawPct.toFixed(1)}%`),
						barPercent: Math.max(0, Math.min(100, rawPct)),
						isOverLimit: isOver,
						isExceeded10Pct: is10Pct,
						tooltip: isOver ? 'Estimated size; limit may differ by model. This is not your plan usage limit.' : ''
					};
				})();

			const cappedBarPercent = Math.max(0, Math.min(100, util.barPercent));
			const isOverLimit = !!util.isOverLimit;
			const isExceeded10Pct = !!util.isExceeded10Pct || (tokens > limit * 1.1);

			this.metrics.context = {
				isLoaded: true,
				tokens,
				pct: cappedBarPercent,
				formatted: util.formatted
			};

			if (this.dom.ctxMain) {
				this.dom.ctxMain.textContent = util.formatted;
				this.dom.ctxPct.textContent = util.percentText;
				this.dom.ctxPct.title = util.tooltip || '';
				// Bar width is strictly capped at 100%
				this.dom.ctxBar.style.width = `${cappedBarPercent}%`;
				this.dom.ctxBar.title = util.tooltip || '';
				if (this.dom.ctxBar.parentElement) {
					this.dom.ctxBar.parentElement.setAttribute('aria-valuenow', cappedBarPercent.toFixed(1));
					this.dom.ctxBar.parentElement.title = util.tooltip || '';
				}

				this.panel.classList.toggle('cc-over-limit', isOverLimit);
				this.panel.classList.toggle('cc-over-limit-10pct', isExceeded10Pct);
				this.panel.classList.toggle('cc-high-utilization', isExceeded10Pct);
			}

			this.refreshBarColors();
			this.tick();
		}

		setNormalizedUsage(norm) {
			this.currentNormalizedState = norm;
			this.metrics.state = norm.state;
			this.metrics.errorReason = norm.errorReason;

			// Handle overall panel states (empty / error / ok)
			this.panel.classList.toggle('cc-state-empty', norm.state === 'empty');
			this.panel.classList.toggle('cc-state-error', norm.state === 'error');

			if (norm.state === 'error') {
				if (this.dom.errorMsg) this.dom.errorMsg.textContent = norm.errorReason || 'Usage currently unavailable';
			}

			// Session window
			const sess = norm.session;
			if (sess && typeof sess.pct === 'number') {
				const pct = sess.pct;
				const resetsAt = sess.resetsAt ? Date.parse(sess.resetsAt) : null;
				const windowStart = resetsAt ? resetsAt - 5 * 60 * 60 * 1000 : null;
				this.metrics.session = { pct, resetsAt, windowStart };

				if (this.dom.sessPct) {
					this.dom.sessPct.textContent = `${pct.toFixed(1)}%`;
					this.dom.sessBar.style.width = `${pct}%`;
					this.dom.sessBar.parentElement.setAttribute('aria-valuenow', pct.toFixed(1));
					if (this.dom.rowSess) this.dom.rowSess.classList.toggle('cc-high-utilization', pct >= 90);
				}
			} else {
				// No session window data
				this.metrics.session = { pct: null, resetsAt: null, windowStart: null };
				if (this.dom.sessPct) {
					this.dom.sessPct.textContent = 'n/a';
					this.dom.sessBar.style.width = '0%';
					this.dom.sessBar.parentElement.setAttribute('aria-valuenow', '0');
					if (this.dom.rowSess) this.dom.rowSess.classList.remove('cc-high-utilization');
				}
				if (this.dom.sessReset) this.dom.sessReset.textContent = '';
				if (this.dom.sessMarker) this.dom.sessMarker.classList.add('cc-hidden');
			}

			// Weekly window
			const week = norm.weekly;
			if (week && typeof week.pct === 'number') {
				const pct = week.pct;
				const resetsAt = week.resetsAt ? Date.parse(week.resetsAt) : null;
				const windowStart = resetsAt ? resetsAt - 7 * 24 * 60 * 60 * 1000 : null;
				this.metrics.weekly = { pct, resetsAt, windowStart };

				if (this.dom.weekPct) {
					this.dom.weekPct.textContent = `${pct.toFixed(1)}%`;
					this.dom.weekBar.style.width = `${pct}%`;
					this.dom.weekBar.parentElement.setAttribute('aria-valuenow', pct.toFixed(1));
					if (this.dom.rowWeek) this.dom.rowWeek.classList.toggle('cc-high-utilization', pct >= 90);
				}
			} else {
				// No weekly window data
				this.metrics.weekly = { pct: null, resetsAt: null, windowStart: null };
				if (this.dom.weekPct) {
					this.dom.weekPct.textContent = 'n/a';
					this.dom.weekBar.style.width = '0%';
					this.dom.weekBar.parentElement.setAttribute('aria-valuenow', '0');
					if (this.dom.rowWeek) this.dom.rowWeek.classList.remove('cc-high-utilization');
				}
				if (this.dom.weekReset) this.dom.weekReset.textContent = '';
				if (this.dom.weekMarker) this.dom.weekMarker.classList.add('cc-hidden');
			}

			this.refreshBarColors();
			this.tick();
		}

		renderAll() {
			if (!this.panel) return;

			if (this.metrics.context.isLoaded && typeof this.metrics.context.tokens === 'number') {
				this.setConversationMetrics({
					totalTokens: this.metrics.context.tokens,
					cachedUntil: this.metrics.cachedUntil,
					isLoaded: true
				});
			} else {
				this.setConversationLoading();
			}

			if (this.currentNormalizedState) {
				this.setNormalizedUsage(this.currentNormalizedState);
			} else {
				this.panel.classList.toggle('cc-state-empty', this.metrics.state === 'empty');
				this.panel.classList.toggle('cc-state-error', this.metrics.state === 'error');
			}

			this.setConversationActive(this.metrics.hasConversation);
			this.setPendingCache(this.metrics.isPendingCache);
			this.tick();
		}

		tick() {
			const now = Date.now();

			// 1. Cache countdown & ring (Shows "—" when inactive, countdown when active)
			if (this.metrics.cachedUntil && this.metrics.cachedUntil > now) {
				const secondsLeft = Math.max(0, Math.ceil((this.metrics.cachedUntil - now) / 1000));
				if (this.dom.cacheText) {
					this.dom.cacheText.textContent = `${formatSeconds(secondsLeft)} remaining`;
				}
				if (this.dom.cacheFill) {
					const totalWindow = (CC.CONST?.CACHE_WINDOW_MS || 300000) / 1000;
					const fraction = Math.max(0, Math.min(1, secondsLeft / totalWindow));
					const circumference = 2 * Math.PI * 6; // ~37.7
					const offset = circumference * (1 - fraction);
					this.dom.cacheFill.style.strokeDashoffset = `${offset}`;
				}
			} else if (this.metrics.cachedUntil && this.metrics.cachedUntil <= now) {
				this.metrics.cachedUntil = null;
				if (!this.metrics.isPendingCache && this.dom.cacheText) {
					this.dom.cacheText.textContent = '—';
					if (this.dom.cacheFill) this.dom.cacheFill.style.strokeDashoffset = '37.7';
				}
			} else if (!this.metrics.isPendingCache && this.dom.cacheText) {
				this.dom.cacheText.textContent = '—';
				if (this.dom.cacheFill) this.dom.cacheFill.style.strokeDashoffset = '37.7';
			}

			// 2. Session countdown & temporal marker
			if (this.metrics.session.resetsAt && this.dom.sessReset) {
				this.dom.sessReset.textContent = `resets in ${formatResetCountdown(this.metrics.session.resetsAt)}`;
				if (this.dom.sessMarker && this.metrics.session.windowStart) {
					const total = this.metrics.session.resetsAt - this.metrics.session.windowStart;
					const elapsed = Math.max(0, Math.min(total, now - this.metrics.session.windowStart));
					const ratio = total > 0 ? elapsed / total : 0;
					this.dom.sessMarker.classList.remove('cc-hidden');
					this.dom.sessMarker.style.left = `${(ratio * 100).toFixed(1)}%`;
				}
			}

			// 3. Weekly countdown & temporal marker
			if (this.metrics.weekly.resetsAt && this.dom.weekReset) {
				this.dom.weekReset.textContent = `resets in ${formatResetCountdown(this.metrics.weekly.resetsAt)}`;
				if (this.dom.weekMarker && this.metrics.weekly.windowStart) {
					const total = this.metrics.weekly.resetsAt - this.metrics.weekly.windowStart;
					const elapsed = Math.max(0, Math.min(total, now - this.metrics.weekly.windowStart));
					const ratio = total > 0 ? elapsed / total : 0;
					this.dom.weekMarker.classList.remove('cc-hidden');
					this.dom.weekMarker.style.left = `${(ratio * 100).toFixed(1)}%`;
				}
			}
		}
	}

	CC.ui = { CounterUI, PRESETS };

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { CounterUI, PRESETS };
	}
})();
