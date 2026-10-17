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
			high: '#374151',
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
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			font-size: 12px;
			line-height: 1.4;
			box-sizing: border-box;
			user-select: none;
			-webkit-font-smoothing: antialiased;
			z-index: 2147483647;
			position: fixed;
		}

		*, *::before, *::after {
			box-sizing: border-box;
		}

		/* Main Panel Card */
		.cc-panel {
			position: fixed;
			background: var(--cc-bg, rgba(30, 29, 28, 0.92));
			border: 1px solid var(--cc-border, rgba(255, 255, 255, 0.12));
			border-radius: 8px;
			color: var(--cc-text, #f0eee9);
			box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28);
			backdrop-filter: blur(12px);
			-webkit-backdrop-filter: blur(12px);
			transition: box-shadow 200ms ease, opacity 200ms ease;
			font-feature-settings: "tnum";
			font-variant-numeric: tabular-nums;
			width: 290px;
			max-width: calc(100vw - 20px);
			overflow: hidden;
		}

		.cc-panel--pill {
			width: auto;
			min-width: 130px;
			border-radius: 9999px;
			padding: 4px 10px;
			cursor: pointer;
			display: flex;
			align-items: center;
			gap: 6px;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
		}

		.cc-panel--pill:hover {
			border-color: var(--cc-accent, #3b82f6);
		}

		/* Themes */
		.cc-theme-light {
			--cc-bg-default: rgba(255, 255, 255, 0.92);
			--cc-border: rgba(0, 0, 0, 0.1);
			--cc-text: #1f1e1d;
			--cc-text-muted: #6b6966;
			--cc-bar-bg: rgba(0, 0, 0, 0.07);
			--cc-marker: rgba(0, 0, 0, 0.4);
		}

		.cc-theme-dark {
			--cc-bg-default: rgba(30, 29, 28, 0.92);
			--cc-border: rgba(255, 255, 255, 0.12);
			--cc-text: #f0eee9;
			--cc-text-muted: #9c9a95;
			--cc-bar-bg: rgba(255, 255, 255, 0.08);
			--cc-marker: rgba(255, 255, 255, 0.5);
		}

		/* Header & Drag Handle */
		.cc-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 7px 10px;
			cursor: grab;
			border-bottom: 1px solid transparent;
			transition: background-color 150ms ease;
		}

		.cc-header:active {
			cursor: grabbing;
		}

		.cc-header:hover {
			background: rgba(128, 128, 128, 0.06);
		}

		.cc-header-left {
			display: flex;
			align-items: center;
			gap: 6px;
			min-width: 0;
		}

		.cc-title {
			font-size: 11px;
			font-weight: 600;
			letter-spacing: 0.03em;
			text-transform: uppercase;
			color: var(--cc-text-muted);
			pointer-events: none;
		}

		.cc-header-right {
			display: flex;
			align-items: center;
			gap: 3px;
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

		/* Prompt Cache Pill */
		.cc-cache-pill {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			padding: 1px 6px;
			border-radius: 12px;
			font-size: 10px;
			font-weight: 500;
			background: rgba(16, 185, 129, 0.14);
			color: #10b981;
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
			stroke: currentColor;
			stroke-width: 2;
			stroke-linecap: round;
			stroke-dasharray: 37.7;
			stroke-dashoffset: 0;
			transition: stroke-dashoffset 900ms linear;
		}

		/* Content Body */
		.cc-body {
			padding: 4px 10px 10px 10px;
			display: flex;
			flex-direction: column;
			gap: 7px;
		}

		.cc-panel--pill .cc-body,
		.cc-panel--pill .cc-header {
			display: none;
		}

		/* Pill content for compact mode */
		.cc-pill-content {
			display: none;
			align-items: center;
			gap: 6px;
			font-size: 11px;
			font-weight: 500;
			color: var(--cc-text);
			white-space: nowrap;
		}

		.cc-panel--pill .cc-pill-content {
			display: inline-flex;
		}

		/* Metric Rows */
		.cc-row {
			display: flex;
			flex-direction: column;
			gap: 3px;
		}

		.cc-row.cc-hidden {
			display: none;
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

		.cc-bar-track {
			position: relative;
			height: 6px;
			background: var(--cc-bar-bg);
			border-radius: 4px;
			overflow: hidden;
			width: 100%;
		}

		.cc-bar-fill {
			height: 100%;
			width: 0%;
			border-radius: 4px;
			background: var(--cc-color-low, #10b981);
			transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 300ms ease;
		}

		.cc-high-utilization .cc-bar-fill {
			box-shadow: 0 0 8px currentColor;
			animation: cc-pulse 2s infinite ease-in-out;
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
			background: var(--cc-marker);
			pointer-events: none;
			transform: translateX(-50%);
			z-index: 2;
		}

		.cc-bar-marker.cc-hidden {
			display: none;
		}

		/* State: Empty Plan Notice (replaces Session & Weekly rows) */
		.cc-empty-notice {
			display: none;
			align-items: center;
			justify-content: center;
			text-align: center;
			padding: 7px 10px;
			background: rgba(128, 128, 128, 0.08);
			border-radius: 6px;
			font-size: 11px;
			color: var(--cc-text-muted, #9ca3af);
			line-height: 1.35;
		}

		.cc-state-empty .cc-empty-notice {
			display: flex;
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
			padding: 6px 8px;
			background: rgba(239, 68, 68, 0.12);
			border: 1px solid rgba(239, 68, 68, 0.2);
			border-radius: 4px;
			font-size: 11px;
			color: #ef4444;
		}

		.cc-state-error .cc-error-notice {
			display: flex;
		}

		.cc-retry-btn {
			background: none;
			border: 1px solid currentColor;
			border-radius: 3px;
			padding: 1px 6px;
			color: inherit;
			font-size: 10px;
			cursor: pointer;
		}

		.cc-retry-btn:hover {
			background: rgba(239, 68, 68, 0.15);
		}

		/* Settings Drawer */
		.cc-settings-drawer {
			display: none;
			flex-direction: column;
			gap: 8px;
			padding: 8px 10px 10px 10px;
			border-top: 1px solid var(--cc-border);
			background: rgba(0, 0, 0, 0.04);
		}

		.cc-settings-drawer.cc-open {
			display: flex;
		}

		.cc-settings-title {
			font-size: 10px;
			font-weight: 600;
			text-transform: uppercase;
			color: var(--cc-text-muted);
			letter-spacing: 0.04em;
		}

		.cc-presets-grid {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 4px;
		}

		.cc-preset-btn {
			background: rgba(128, 128, 128, 0.1);
			border: 1px solid var(--cc-border);
			border-radius: 4px;
			padding: 3px 4px;
			color: var(--cc-text);
			font-size: 10px;
			cursor: pointer;
			text-align: center;
			transition: background 150ms ease, border-color 150ms ease;
		}

		.cc-preset-btn:hover {
			border-color: var(--cc-accent, #3b82f6);
			background: rgba(128, 128, 128, 0.18);
		}

		.cc-settings-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-size: 11px;
		}

		.cc-settings-row input[type="color"] {
			border: none;
			width: 22px;
			height: 20px;
			border-radius: 3px;
			cursor: pointer;
			background: none;
		}

		.cc-settings-row input[type="range"] {
			width: 110px;
		}

		.cc-contrast-alert {
			display: none;
			padding: 4px 6px;
			border-radius: 4px;
			background: rgba(245, 158, 11, 0.15);
			border: 1px solid rgba(245, 158, 11, 0.3);
			color: #d97706;
			font-size: 10px;
			line-height: 1.3;
		}

		.cc-contrast-alert.cc-show {
			display: block;
		}

		.cc-settings-actions {
			display: flex;
			gap: 6px;
			margin-top: 4px;
		}

		.cc-btn-secondary {
			flex: 1;
			background: rgba(128, 128, 128, 0.1);
			border: 1px solid var(--cc-border);
			border-radius: 4px;
			padding: 4px;
			font-size: 10px;
			color: var(--cc-text);
			cursor: pointer;
			text-align: center;
		}

		.cc-btn-secondary:hover {
			background: rgba(128, 128, 128, 0.2);
		}

		@media (prefers-reduced-motion: reduce) {
			.cc-bar-fill, .cc-cache-ring-fill, .cc-panel {
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

			// Position & State
			this.isPill = localStorage.getItem('cc_pill') === 'true';
			this.settingsOpen = false;
			this.pos = this._loadSavedPos();

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
			this._dragState = null;
		}

		_loadSavedPos() {
			try {
				const saved = localStorage.getItem('cc_panel_pos');
				if (saved) {
					const parsed = JSON.parse(saved);
					if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
						return parsed;
					}
				}
			} catch {
				// ignore
			}
			return null; // default bottom-right
		}

		_savePos(pos) {
			this.pos = pos;
			try {
				localStorage.setItem('cc_panel_pos', JSON.stringify(pos));
			} catch {
				// ignore
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
				showContext: true,
				showSession: true,
				showWeekly: true
			};
			try {
				const saved = localStorage.getItem('cc_settings');
				if (saved) {
					return Object.assign(defaults, JSON.parse(saved));
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
			panel.className = `cc-panel ${this.isPill ? 'cc-panel--pill' : ''}`;
			this.panel = panel;

			panel.innerHTML = `
				<!-- Collapsed Pill View -->
				<div class="cc-pill-content" id="cc-pill-content" title="Click to expand Usage Meter">
					<span style="color: var(--cc-accent, #3b82f6);">⚡</span>
					<span id="cc-pill-summary">Usage</span>
				</div>

				<!-- Standard Header -->
				<div class="cc-header" id="cc-drag-handle" title="Drag to move panel">
					<div class="cc-header-left">
						<span class="cc-title">Usage Meter</span>
						<div class="cc-cache-pill cc-hidden" id="cc-cache-pill" title="Prompt cache window: 5 min remaining">
							<svg class="cc-cache-ring" width="14" height="14" viewBox="0 0 16 16">
								<circle class="cc-cache-ring-bg" cx="8" cy="8" r="6" />
								<circle class="cc-cache-ring-fill" id="cc-cache-fill" cx="8" cy="8" r="6" />
							</svg>
							<span id="cc-cache-text">cached</span>
						</div>
					</div>
					<div class="cc-header-right">
						<button class="cc-btn" id="cc-debug-btn" title="Copy Diagnostic Log" style="display: none;">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
						</button>
						<button class="cc-btn" id="cc-gear-btn" title="Settings & Colors">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
						</button>
						<button class="cc-btn" id="cc-pill-btn" title="Minimize to pill">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
						</button>
					</div>
				</div>

				<!-- Body Content -->
				<div class="cc-body" id="cc-body">
					<!-- State: Error Notice -->
					<div class="cc-error-notice" id="cc-error-notice">
						<span id="cc-error-msg">Usage currently unavailable</span>
						<button class="cc-retry-btn" id="cc-retry-btn">Retry</button>
					</div>

					<!-- Context Row -->
					<div class="cc-row" id="cc-row-context">
						<div class="cc-row-meta">
							<span class="cc-row-label">Context</span>
							<div class="cc-row-stat">
								<span class="cc-val-main" id="cc-ctx-main">— / 200k</span>
								<span class="cc-val-pct" id="cc-ctx-pct">—</span>
							</div>
						</div>
						<div class="cc-bar-track" role="progressbar" aria-label="Context utilization" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
							<div class="cc-bar-fill" id="cc-ctx-bar"></div>
						</div>
					</div>

					<!-- State: Empty Plan Notice (replaces Session & Weekly rows) -->
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
						<span>High (85–100%)</span>
						<input type="color" id="cc-col-high" />
					</div>
					<div class="cc-settings-row">
						<span>Background Opacity</span>
						<input type="range" id="cc-opacity-slider" min="50" max="100" step="2" />
					</div>

					<div class="cc-contrast-alert" id="cc-contrast-alert">
						⚠️ Low contrast (< 4.5:1). Colors may be hard to read.
					</div>

					<div class="cc-settings-title" style="margin-top: 4px;">Rows Visibility</div>
					<div class="cc-settings-row">
						<label><input type="checkbox" id="cc-chk-ctx" /> Context</label>
						<label><input type="checkbox" id="cc-chk-sess" /> Session 5h</label>
						<label><input type="checkbox" id="cc-chk-week" /> Weekly 7d</label>
					</div>

					<div class="cc-settings-actions">
						<button class="cc-btn-secondary" id="cc-reset-pos-btn">Reset Position</button>
						<button class="cc-btn-secondary" id="cc-reset-defaults-btn">Reset Defaults</button>
					</div>
				</div>
			`;

			this.shadowRoot.appendChild(panel);

			// Cache references
			this.dom.panel = panel;
			this.dom.handle = this.shadowRoot.getElementById('cc-drag-handle');
			this.dom.pillContent = this.shadowRoot.getElementById('cc-pill-content');
			this.dom.pillSummary = this.shadowRoot.getElementById('cc-pill-summary');
			this.dom.pillBtn = this.shadowRoot.getElementById('cc-pill-btn');
			this.dom.gearBtn = this.shadowRoot.getElementById('cc-gear-btn');
			this.dom.debugBtn = this.shadowRoot.getElementById('cc-debug-btn');

			this.dom.cachePill = this.shadowRoot.getElementById('cc-cache-pill');
			this.dom.cacheFill = this.shadowRoot.getElementById('cc-cache-fill');
			this.dom.cacheText = this.shadowRoot.getElementById('cc-cache-text');

			this.dom.emptyNotice = this.shadowRoot.getElementById('cc-empty-notice');
			this.dom.errorNotice = this.shadowRoot.getElementById('cc-error-notice');
			this.dom.errorMsg = this.shadowRoot.getElementById('cc-error-msg');
			this.dom.retryBtn = this.shadowRoot.getElementById('cc-retry-btn');

			this.dom.rowCtx = this.shadowRoot.getElementById('cc-row-context');
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
			this.dom.chkCtx = this.shadowRoot.getElementById('cc-chk-ctx');
			this.dom.chkSess = this.shadowRoot.getElementById('cc-chk-sess');
			this.dom.chkWeek = this.shadowRoot.getElementById('cc-chk-week');
			this.dom.resetPosBtn = this.shadowRoot.getElementById('cc-reset-pos-btn');
			this.dom.resetDefaultsBtn = this.shadowRoot.getElementById('cc-reset-defaults-btn');

			this._bindEvents();
			this.applyThemeAndSettings();
			this.applyPosition();
			this.renderAll();
		}

		_bindEvents() {
			// Minimize / Expand Pill toggle
			const togglePill = () => {
				this.isPill = !this.isPill;
				localStorage.setItem('cc_pill', String(this.isPill));
				this.panel.classList.toggle('cc-panel--pill', this.isPill);
				if (this.isPill) {
					this.settingsOpen = false;
					this.dom.settingsDrawer.classList.remove('cc-open');
				}
				this.clampPosition();
			};

			this.dom.pillBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				togglePill();
			});

			this.dom.pillContent.addEventListener('click', (e) => {
				e.stopPropagation();
				togglePill();
			});

			// Settings Drawer toggle
			this.dom.gearBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.settingsOpen = !this.settingsOpen;
				this.dom.settingsDrawer.classList.toggle('cc-open', this.settingsOpen);
				this.clampPosition();
			});

			// Debug export button
			if (localStorage.getItem(CC.CONST.DEBUG_STORAGE_KEY) === 'true' || window.__CC_DEBUG) {
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
			this.dom.chkCtx.addEventListener('change', (e) => {
				this.settings.showContext = e.target.checked;
				this._saveSettings();
			});
			this.dom.chkSess.addEventListener('change', (e) => {
				this.settings.showSession = e.target.checked;
				this._saveSettings();
			});
			this.dom.chkWeek.addEventListener('change', (e) => {
				this.settings.showWeekly = e.target.checked;
				this._saveSettings();
			});

			// Reset buttons
			this.dom.resetPosBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.resetPosition();
			});
			this.dom.resetDefaultsBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.resetDefaults();
			});

			// Draggable mechanics
			this._initDraggable();

			// Window resize listener to keep clamped
			window.addEventListener('resize', () => this.clampPosition());

			// Theme change observer
			const themeObserver = new MutationObserver(() => this.applyThemeAndSettings());
			themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'class'] });
			if (document.body) {
				themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
			}
		}

		_initDraggable() {
			const handle = this.dom.handle;
			let startX = 0;
			let startY = 0;
			let initialLeft = 0;
			let initialTop = 0;
			let hasMoved = false;

			const onPointerDown = (e) => {
				if (e.target.closest('button') || e.target.closest('input')) return;
				handle.setPointerCapture(e.pointerId);
				startX = e.clientX;
				startY = e.clientY;

				const rect = this.panel.getBoundingClientRect();
				initialLeft = rect.left;
				initialTop = rect.top;
				hasMoved = false;

				handle.addEventListener('pointermove', onPointerMove);
				handle.addEventListener('pointerup', onPointerUp);
				handle.addEventListener('pointercancel', onPointerUp);
			};

			const onPointerMove = (e) => {
				const dx = e.clientX - startX;
				const dy = e.clientY - startY;
				if (!hasMoved && Math.hypot(dx, dy) < 4) return;
				hasMoved = true;

				const newX = initialLeft + dx;
				const newY = initialTop + dy;
				this.setPosition(newX, newY);
			};

			const onPointerUp = (e) => {
				handle.removeEventListener('pointermove', onPointerMove);
				handle.removeEventListener('pointerup', onPointerUp);
				handle.removeEventListener('pointercancel', onPointerUp);
				try {
					handle.releasePointerCapture(e.pointerId);
				} catch {
					// ignore
				}
				if (hasMoved) {
					const rect = this.panel.getBoundingClientRect();
					this._savePos({ x: rect.left, y: rect.top });
				}
			};

			handle.addEventListener('pointerdown', onPointerDown);
		}

		setPosition(x, y) {
			const rect = this.panel.getBoundingClientRect();
			const width = rect.width || 290;
			const height = rect.height || 180;
			const maxX = window.innerWidth - width - 10;
			const maxY = window.innerHeight - height - 10;
			const clampedX = Math.max(10, Math.min(maxX, x));
			const clampedY = Math.max(10, Math.min(maxY, y));

			this.panel.style.left = `${clampedX}px`;
			this.panel.style.top = `${clampedY}px`;
			this.panel.style.right = 'auto';
			this.panel.style.bottom = 'auto';
		}

		clampPosition() {
			const rect = this.panel.getBoundingClientRect();
			this.setPosition(rect.left, rect.top);
		}

		applyPosition() {
			if (this.pos && typeof this.pos.x === 'number' && typeof this.pos.y === 'number') {
				this.setPosition(this.pos.x, this.pos.y);
			} else {
				// Default placement: bottom right
				this.panel.style.left = 'auto';
				this.panel.style.top = 'auto';
				this.panel.style.right = '24px';
				this.panel.style.bottom = '24px';
			}
		}

		resetPosition() {
			this._savePos(null);
			this.applyPosition();
		}

		resetDefaults() {
			this.settings = {
				preset: 'default',
				lowColor: PRESETS.default.low,
				midColor: PRESETS.default.mid,
				highColor: PRESETS.default.high,
				accentColor: PRESETS.default.accent,
				opacity: 0.94,
				showContext: true,
				showSession: true,
				showWeekly: true
			};
			this._saveSettings();
			this.resetPosition();
		}

		applyThemeAndSettings() {
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
			const high = this.settings.highColor || PRESETS.default.high;
			const accent = this.settings.accentColor || PRESETS.default.accent;
			const opacity = this.settings.opacity ?? 0.94;

			this.panel.style.setProperty('--cc-color-low', low);
			this.panel.style.setProperty('--cc-color-mid', mid);
			this.panel.style.setProperty('--cc-color-high', high);
			this.panel.style.setProperty('--cc-accent', accent);

			const baseBg = isDark ? `rgba(28, 27, 26, ${opacity})` : `rgba(255, 255, 255, ${opacity})`;
			this.panel.style.setProperty('--cc-bg', baseBg);

			// Inputs in settings drawer
			if (this.dom.colLow) this.dom.colLow.value = low;
			if (this.dom.colMid) this.dom.colMid.value = mid;
			if (this.dom.colHigh) this.dom.colHigh.value = high;
			if (this.dom.opacitySlider) this.dom.opacitySlider.value = Math.round(opacity * 100);

			if (this.dom.chkCtx) this.dom.chkCtx.checked = !!this.settings.showContext;
			if (this.dom.chkSess) this.dom.chkSess.checked = !!this.settings.showSession;
			if (this.dom.chkWeek) this.dom.chkWeek.checked = !!this.settings.showWeekly;

			// Row visibility
			if (this.dom.rowCtx) this.dom.rowCtx.classList.toggle('cc-hidden', !this.settings.showContext || !this.metrics.hasConversation);
			if (this.dom.rowSess) this.dom.rowSess.classList.toggle('cc-hidden', !this.settings.showSession);
			if (this.dom.rowWeek) this.dom.rowWeek.classList.toggle('cc-hidden', !this.settings.showWeekly);

			// Contrast check
			const bgRgb = isDark ? { r: 28, g: 27, b: 26 } : { r: 255, g: 255, b: 255 };
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

			if (this.dom.ctxBar) {
				if (!this.metrics.context.isLoaded) {
					this.dom.ctxBar.style.backgroundColor = this.settings.lowColor;
				} else if (this.metrics.context.tokens > (CC.CONST?.CONTEXT_LIMIT_TOKENS || 200000)) {
					this.dom.ctxBar.style.backgroundColor = this.settings.highColor;
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
			const parent = document.body || document.documentElement;
			if (!parent.contains(this.rootElement)) {
				parent.appendChild(this.rootElement);
			}
		}

		setConversationActive(hasConv) {
			this.metrics.hasConversation = !!hasConv;
			if (this.dom.rowCtx) {
				this.dom.rowCtx.classList.toggle('cc-hidden', !this.settings.showContext || !this.metrics.hasConversation);
			}
			this.updateSummary();
		}

		setPendingCache(pending) {
			this.metrics.isPendingCache = pending;
			if (this.dom.cachePill) {
				if (pending) {
					this.dom.cachePill.classList.remove('cc-hidden');
					this.dom.cacheText.textContent = 'caching...';
				} else if (!this.metrics.cachedUntil || this.metrics.cachedUntil <= Date.now()) {
					this.dom.cachePill.classList.add('cc-hidden');
				}
			}
		}

		setConversationLoading() {
			this.metrics.context = {
				isLoaded: false,
				tokens: null,
				pct: null,
				formatted: '— / 200k'
			};
			this.metrics.cachedUntil = null;

			if (this.dom.ctxMain) {
				this.dom.ctxMain.textContent = '— / 200k';
				this.dom.ctxPct.textContent = '—';
				this.dom.ctxBar.style.width = '0%';
				this.dom.ctxBar.parentElement.setAttribute('aria-valuenow', '0');
				if (this.dom.rowCtx) this.dom.rowCtx.classList.remove('cc-high-utilization');
			}

			this.refreshBarColors();
			this.updateSummary();
		}

		setConversationMetrics({ totalTokens, cachedUntil, isLoaded = true } = {}) {
			if (!isLoaded || typeof totalTokens !== 'number' || isNaN(totalTokens)) {
				this.setConversationLoading();
				return;
			}

			const tokens = Math.max(0, Math.round(totalTokens));
			const limit = CC.CONST?.CONTEXT_LIMIT_TOKENS || 200000;
			this.metrics.cachedUntil = cachedUntil;

			const util = CC.tokens?.formatContextUtilization
				? CC.tokens.formatContextUtilization(tokens, limit)
				: {
					formatted: tokens > limit ? `~${Math.round(tokens / 1000)}k / 200k` : `~${tokens >= 1000 ? Math.round(tokens / 1000) + 'k' : tokens} / 200k`,
					percentText: tokens > limit ? '>100%' : (tokens === 0 ? '0%' : `${((tokens / limit) * 100).toFixed(1)}%`),
					barPercent: Math.max(0, Math.min(100, (tokens / limit) * 100)),
					isOverLimit: tokens > limit
				};

			this.metrics.context = {
				isLoaded: true,
				tokens,
				pct: util.barPercent,
				formatted: util.formatted
			};

			if (this.dom.ctxMain) {
				this.dom.ctxMain.textContent = util.formatted;
				this.dom.ctxPct.textContent = util.percentText;
				this.dom.ctxBar.style.width = `${util.barPercent}%`;
				this.dom.ctxBar.parentElement.setAttribute('aria-valuenow', util.barPercent.toFixed(1));

				const row = this.dom.rowCtx;
				if (row) row.classList.toggle('cc-high-utilization', util.isOverLimit || util.barPercent >= 90);
			}

			this.refreshBarColors();
			this.updateSummary();
			this.tick();
		}

		/**
		 * Apply normalized model output:
		 * { session: { pct, resetsAt }, weekly: { pct, resetsAt }, extras, state, errorReason }
		 */
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
			this.updateSummary();
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
			this.updateSummary();
			this.tick();
		}

		updateSummary() {
			if (!this.dom.pillSummary) return;
			const parts = [];

			if (this.metrics.session.pct !== null) {
				parts.push(`${this.metrics.session.pct.toFixed(0)}% 5h`);
			}
			if (this.metrics.weekly.pct !== null) {
				parts.push(`${this.metrics.weekly.pct.toFixed(0)}% 7d`);
			}
			if (this.metrics.hasConversation && this.metrics.context.isLoaded && typeof this.metrics.context.tokens === 'number') {
				if (this.metrics.context.tokens >= 1000) {
					parts.push(`~${Math.round(this.metrics.context.tokens / 1000)}k`);
				} else {
					parts.push(`~${this.metrics.context.tokens}`);
				}
			}

			if (parts.length === 0) {
				this.dom.pillSummary.textContent = this.metrics.state === 'empty' ? 'Plan: Free' : 'Usage Meter';
			} else {
				this.dom.pillSummary.textContent = parts.join(' · ');
			}
		}

		tick() {
			const now = Date.now();

			// 1. Cache countdown & ring
			if (this.metrics.cachedUntil && this.metrics.cachedUntil > now) {
				const secondsLeft = Math.max(0, Math.ceil((this.metrics.cachedUntil - now) / 1000));
				if (this.dom.cachePill) {
					this.dom.cachePill.classList.remove('cc-hidden');
					this.dom.cacheText.textContent = `cached ${formatSeconds(secondsLeft)}`;

					const totalWindow = CC.CONST.CACHE_WINDOW_MS / 1000;
					const fraction = Math.max(0, Math.min(1, secondsLeft / totalWindow));
					const circumference = 2 * Math.PI * 6;
					const offset = circumference * (1 - fraction);
					if (this.dom.cacheFill) {
						this.dom.cacheFill.style.strokeDashoffset = `${offset}`;
					}
				}
			} else if (this.metrics.cachedUntil && this.metrics.cachedUntil <= now) {
				this.metrics.cachedUntil = null;
				if (!this.metrics.isPendingCache && this.dom.cachePill) {
					this.dom.cachePill.classList.add('cc-hidden');
				}
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
})();
