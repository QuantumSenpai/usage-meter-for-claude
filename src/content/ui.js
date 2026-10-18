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

	function formatSessionCountdown(diffMs) {
		if (diffMs <= 0) return 'Window reset, send a message to update';
		const totalMinutes = Math.floor(diffMs / 60000);
		if (totalMinutes < 1) return 'resets in <1m';
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours > 0) return `resets in ${hours}h ${minutes}m`;
		return `resets in ${minutes}m`;
	}

	function formatWeeklyCountdown(diffMs) {
		if (diffMs <= 0) return 'Window reset, send a message to update';
		const totalHours = Math.floor(diffMs / (3600 * 1000));
		const days = Math.floor(totalHours / 24);
		const hours = totalHours % 24;
		if (days > 0) return `${days}d ${hours}h`;
		const minutes = Math.floor((diffMs % (3600 * 1000)) / 60000);
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}

	function formatWeeklyLocalClock(resetsAtMs) {
		try {
			const d = new Date(resetsAtMs);
			const fmt = new Intl.DateTimeFormat(undefined, {
				weekday: 'short',
				hour: 'numeric',
				minute: '2-digit'
			});
			return fmt.format(d);
		} catch {
			return '';
		}
	}

	function formatLastMessageTime(capturedAtMs) {
		try {
			const d = new Date(capturedAtMs);
			const fmt = new Intl.DateTimeFormat(undefined, {
				hour: 'numeric',
				minute: '2-digit'
			});
			return `As of your last message at ${fmt.format(d)}`;
		} catch {
			return '';
		}
	}

	function isValidHexColor(val) {
		return typeof val === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(val.trim());
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
			font-size: 12px;
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
			padding: 5px 12px;
			min-height: 32px;
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
			font-size: 12px;
			font-weight: 500;
			color: var(--cc-text);
			white-space: nowrap;
			flex-shrink: 0;
		}

		.cc-bar-track--mini {
			width: 80px;
			max-width: 25%;
			height: 7px;
			flex-shrink: 0;
		}

		.cc-summary-right {
			display: flex;
			align-items: center;
			gap: 4px;
			flex-shrink: 0;
		}

		.cc-btn {
			background: none;
			border: none;
			padding: 4px;
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
			padding: 6px 12px 10px 12px;
			border-top: 1px solid var(--cc-border, rgba(255, 255, 255, 0.06));
		}

		.cc-panel.cc-expanded .cc-details {
			display: block;
		}

		.cc-usage-container {
			display: flex;
			flex-direction: column;
			gap: 6px;
			padding: 7px 12px;
		}

		/* Header bar: title & persistent actions (always visible) */
		.cc-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0 0 3px 0;
			margin-bottom: 2px;
			border-bottom: 1px solid var(--cc-border, rgba(255, 255, 255, 0.06));
		}

		.cc-header-title {
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--cc-text-muted);
			user-select: none;
		}

		.cc-header-actions {
			display: flex;
			align-items: center;
			gap: 4px;
		}

		/* Row layout: clean aligned columns */
		.cc-row {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 24px;
			width: 100%;
		}

		.cc-row-label-col {
			width: 82px;
			flex-shrink: 0;
			display: flex;
			align-items: center;
		}

		.cc-row-label {
			font-size: 12px;
			font-weight: 500;
			color: var(--cc-text);
			white-space: nowrap;
		}

		.cc-bar-col {
			flex: 1 1 120px;
			min-width: 60px;
			display: flex;
			align-items: center;
		}

		.cc-stat-col {
			display: flex;
			align-items: baseline;
			gap: 8px;
			flex-shrink: 0;
			font-size: 12px;
		}

		.cc-actions-col {
			display: flex;
			align-items: center;
			gap: 4px;
			flex-shrink: 0;
			width: 44px;
			justify-content: flex-end;
		}

		.cc-actions-spacer {
			width: 44px;
			flex-shrink: 0;
		}

		@media (max-width: 600px) {
			.cc-row {
				flex-wrap: wrap;
				gap: 4px 8px;
				padding: 2px 0;
			}
			.cc-row-label-col {
				width: auto;
			}
			.cc-actions-col {
				margin-left: auto;
			}
			.cc-actions-spacer {
				display: none;
			}
			.cc-stat-col {
				margin-left: auto;
			}
			.cc-bar-col {
				flex: 1 1 100%;
				order: 4;
				margin-top: 2px;
			}
		}

		.cc-row--cache {
			padding-bottom: 2px;
		}

		.cc-row-meta {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			font-size: 12px;
		}

		.cc-cache-meta-left {
			display: flex;
			align-items: center;
			gap: 6px;
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
			min-width: 110px;
			text-align: right;
			white-space: nowrap;
			color: var(--cc-text);
		}

		/* In collapsed thin line, hide the token estimate count so it shows: Context [bar] 62% used · 38% left */
		.cc-panel:not(.cc-expanded) #cc-ctx-main {
			display: none;
		}

		.cc-val-reset {
			font-size: 11px;
			color: var(--cc-text-muted);
			min-width: 90px;
			text-align: right;
			white-space: nowrap;
		}

		.cc-bar-track {
			position: relative;
			height: 7px;
			background: var(--cc-bar-bg);
			border-radius: 3.5px;
			overflow: hidden;
			width: 100%;
		}

		.cc-bar-fill {
			height: 100%;
			width: 0%;
			border-radius: 3.5px;
			background-color: var(--cc-color-low, #10b981);
			transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 300ms ease;
		}

		@media (prefers-reduced-motion: reduce) {
			.cc-bar-fill {
				transition: none !important;
			}
		}

		/* Context bar & pct colors by utilization tier */
		.cc-ctx-low #cc-ctx-bar {
			background-color: var(--cc-color-low, #10b981) !important;
		}
		.cc-ctx-low #cc-ctx-pct {
			color: var(--cc-text-muted);
		}

		.cc-ctx-mid #cc-ctx-bar {
			background-color: var(--cc-color-mid, #f59e0b) !important;
		}
		.cc-ctx-mid #cc-ctx-pct {
			color: var(--cc-color-mid, #f59e0b) !important;
			font-weight: 600;
		}

		.cc-ctx-high #cc-ctx-bar,
		.cc-over-limit #cc-ctx-bar {
			background-color: var(--cc-color-high, #ef4444) !important;
		}
		.cc-ctx-high #cc-ctx-pct,
		.cc-over-limit #cc-ctx-pct {
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
			font-size: 11px;
			color: var(--cc-text-muted);
			padding: 4px 0;
			text-align: center;
			user-select: text;
		}

		.cc-state-empty .cc-empty-notice {
			display: block;
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
			font-size: 11px;
			color: #ef4444;
		}

		.cc-state-error .cc-error-notice {
			display: flex;
		}

		.cc-retry-btn {
			background: rgba(239, 68, 68, 0.2);
			border: none;
			color: #ef4444;
			font-size: 11px;
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
			font-size: 11px;
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
			font-size: 10px;
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
			font-size: 10px;
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
			font-size: 10px;
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
			font-size: 10px;
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
			font-size: 10px;
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
		constructor({ onUsageRefresh, onCopyDebug, onToggleContextOrCache, onDebugLog } = {}) {
			this.onUsageRefresh = onUsageRefresh || null;
			this.onCopyDebug = onCopyDebug || null;
			this.onToggleContextOrCache = onToggleContextOrCache || null;
			this.onDebugLog = onDebugLog || null;

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
			this._lastPanelRenderState = null;
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

		_wrapSettings(settings) {
			const self = this;
			return new Proxy(settings, {
				set(target, prop, value) {
					if (prop === 'showContext' || prop === 'showCache') {
						const row = prop === 'showContext' ? 'context' : 'cache';
						const boolVal = Boolean(value);
						if (target[prop] !== boolVal) {
							if (self.onDebugLog) {
								let caller = self._currentCaller || 'unknown';
								if (caller === 'unknown') {
									try {
										const stack = (new Error()).stack || '';
										const lines = stack.split('\n').map(l => l.trim()).filter(l => l.startsWith('at '));
										const callerLine = lines[1] || lines[0] || '';
										if (callerLine.includes('chkCtx') || callerLine.includes('chk-ctx')) {
											caller = 'chk_ctx';
										} else if (callerLine.includes('chkCache') || callerLine.includes('chk-cache')) {
											caller = 'chk_cache';
										} else if (callerLine.includes('resetDefaults')) {
											caller = 'reset_defaults';
										} else {
											const match = callerLine.match(/at\s+([^\s]+)/);
											caller = match ? match[1] : callerLine.slice(0, 50);
										}
									} catch {
										// ignore
									}
								}
								self.onDebugLog('row_visibility_changed', {
									row,
									visible: boolVal,
									caller
								});
							}
						}
						target[prop] = boolVal;
						return true;
					}
					target[prop] = value;
					return true;
				}
			});
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
				showContext: false,
				showCache: false,
				contextWindow: CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000,
				v060_migrated: true,
				v061_migrated: true
			};
			try {
				const saved = localStorage.getItem('cc_settings');
				if (saved) {
					let parsed = JSON.parse(saved);
					if (parsed && typeof parsed === 'object') {
						let needsSave = false;

						// Migration 1: v060 migration (legacy marker; never force-hide Context & Cache)
						if (!parsed.v060_migrated) {
							parsed.v060_migrated = true;
							needsSave = true;
						}

						// Migration 2: v061 migration: force showSession and showWeekly visible once
						if (!parsed.v061_migrated) {
							parsed.showSession = true;
							parsed.showWeekly = true;
							parsed.v061_migrated = true;
							needsSave = true;
						}

						// Key validation (a) and fallback per key:
						// 1. preset validation
						if (typeof parsed.preset !== 'string' || !PRESETS[parsed.preset]) {
							parsed.preset = defaults.preset;
						}

						// 2. colors validation (must be valid hex colors)
						if (!isValidHexColor(parsed.lowColor)) {
							parsed.lowColor = defaults.lowColor;
						}
						if (!isValidHexColor(parsed.midColor)) {
							parsed.midColor = defaults.midColor;
						}
						if (!isValidHexColor(parsed.highColor)) {
							parsed.highColor = defaults.highColor;
						}
						if (!isValidHexColor(parsed.accentColor)) {
							parsed.accentColor = defaults.accentColor;
						}

						// 3. opacity (c): clamp to [0.50, 1.00] (slider range: min="50" max="100")
						let op = Number(parsed.opacity);
						if (isNaN(op)) {
							op = defaults.opacity;
						} else {
							op = Math.max(0.50, Math.min(1.0, op));
						}
						parsed.opacity = op;

						// 4. contextWindow validation
						let cw = Number(parsed.contextWindow);
						if (isNaN(cw) || cw < 1000 || cw > 10000000) {
							parsed.contextWindow = defaults.contextWindow;
						} else {
							parsed.contextWindow = Math.round(cw);
						}

						// 5. booleans validation (missing or non-boolean values fall back to defaults)
						if (typeof parsed.showSession !== 'boolean') {
							parsed.showSession = defaults.showSession;
						}
						if (typeof parsed.showWeekly !== 'boolean') {
							parsed.showWeekly = defaults.showWeekly;
						}
						if (typeof parsed.showContext !== 'boolean') {
							parsed.showContext = defaults.showContext;
						}
						if (typeof parsed.showCache !== 'boolean') {
							parsed.showCache = defaults.showCache;
						}

						if (needsSave) {
							try {
								localStorage.setItem('cc_settings', JSON.stringify(Object.assign({}, parsed)));
							} catch {
								// ignore
							}
						}

						return this._wrapSettings(Object.assign(defaults, parsed));
					}
				}
			} catch {
				// ignore corrupt JSON
			}
			return this._wrapSettings(defaults);
		}

		_saveSettings() {
			try {
				localStorage.setItem('cc_settings', JSON.stringify(this.settings));
			} catch {
				// ignore
			}
			this.applyThemeAndSettings();
		}

		logPanelRenderState() {
			if (!this.onDebugLog) return;
			let ccKeys = [];
			try {
				if (typeof localStorage !== 'undefined') {
					for (let i = 0; i < localStorage.length; i++) {
						const k = localStorage.key(i);
						if (k && k.startsWith('cc_')) {
							ccKeys.push(k);
						}
					}
					if (ccKeys.length === 0 && Object.keys(localStorage).length > 0) {
						ccKeys = Object.keys(localStorage).filter(k => typeof k === 'string' && k.startsWith('cc_'));
					}
				}
			} catch {
				// ignore
			}
			ccKeys.sort();

			const nextState = {
				showSession: Boolean(this.settings?.showSession),
				showWeekly: Boolean(this.settings?.showWeekly),
				showContext: Boolean(this.settings?.showContext),
				showCache: Boolean(this.settings?.showCache),
				rowsInDom: Boolean(this.dom?.rowSession && this.dom?.rowWeekly),
				keys: ccKeys
			};

			if (this._lastPanelRenderState) {
				const prev = this._lastPanelRenderState;
				if (
					prev.showSession === nextState.showSession &&
					prev.showWeekly === nextState.showWeekly &&
					prev.showContext === nextState.showContext &&
					prev.showCache === nextState.showCache &&
					prev.rowsInDom === nextState.rowsInDom &&
					prev.keys.length === nextState.keys.length &&
					prev.keys.every((key, idx) => key === nextState.keys[idx])
				) {
					return;
				}
			}

			this._lastPanelRenderState = nextState;
			this.onDebugLog('panel_render_state', {
				showSession: nextState.showSession,
				showWeekly: nextState.showWeekly,
				showContext: nextState.showContext,
				showCache: nextState.showCache,
				rowsInDom: nextState.rowsInDom,
				keys: [...nextState.keys]
			});
		}

		shouldFetchConversation() {
			return Boolean(this.settings.showContext || this.settings.showCache);
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
				<!-- Main Panel Content: Header, Session & Weekly always visible -->
				<div class="cc-usage-container">
					<!-- Header bar: title & persistent action buttons (always visible) -->
					<div class="cc-header" id="cc-header">
						<span class="cc-header-title">Usage Limits</span>
						<div class="cc-header-actions" id="cc-header-actions">
							<button class="cc-btn" id="cc-debug-btn" title="Copy Diagnostic Log" style="display: none;">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
							</button>
							<button class="cc-btn" id="cc-gear-btn" title="Settings &amp; Colors">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
							</button>
						</div>
					</div>

					<!-- Session 5h Row -->
					<div class="cc-row cc-row--session" id="cc-row-session">
						<div class="cc-row-label-col">
							<span class="cc-row-label">Session (5h)</span>
						</div>
						<div class="cc-bar-col">
							<div class="cc-bar-track" role="progressbar" aria-label="5-hour session utilization" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
								<div class="cc-bar-fill" id="cc-sess-bar"></div>
								<div class="cc-bar-marker cc-hidden" id="cc-sess-marker" title="Current window progress"></div>
							</div>
						</div>
						<div class="cc-stat-col">
							<span class="cc-val-pct" id="cc-sess-pct">—</span>
							<span class="cc-val-reset" id="cc-sess-reset">—</span>
						</div>
					</div>

					<!-- Weekly 7d Row -->
					<div class="cc-row cc-row--weekly" id="cc-row-weekly">
						<div class="cc-row-label-col">
							<span class="cc-row-label">Weekly (7d)</span>
						</div>
						<div class="cc-bar-col">
							<div class="cc-bar-track" role="progressbar" aria-label="7-day weekly utilization" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
								<div class="cc-bar-fill" id="cc-week-bar"></div>
								<div class="cc-bar-marker cc-hidden" id="cc-week-marker" title="Current window progress"></div>
							</div>
						</div>
						<div class="cc-stat-col">
							<span class="cc-val-pct" id="cc-week-pct">—</span>
							<span class="cc-val-reset" id="cc-week-reset">—</span>
						</div>
					</div>

					<!-- Context Row (Default hidden) -->
					<div class="cc-row cc-row--context cc-hidden" id="cc-row-context">
						<div class="cc-row-label-col">
							<span class="cc-row-label" id="cc-label-context" title="Estimated size of this chat vs. context window. Not your plan usage limit. The window size may differ by model, adjust it in settings.">Context</span>
						</div>
						<div class="cc-bar-col">
							<div class="cc-bar-track cc-bar-track--mini" role="progressbar" aria-label="Context utilization" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
								<div class="cc-bar-fill" id="cc-ctx-bar"></div>
							</div>
						</div>
						<div class="cc-stat-col">
							<span class="cc-val-pct" id="cc-ctx-pct">—</span>
							<span class="cc-val-reset" id="cc-ctx-main">— / 200k</span>
						</div>
					</div>

					<!-- Cache Row (Default hidden) -->
					<div class="cc-row cc-row--cache cc-hidden" id="cc-row-cache">
						<div class="cc-row-label-col cc-cache-meta-left">
							<svg class="cc-cache-ring" width="12" height="12" viewBox="0 0 16 16">
								<circle class="cc-cache-ring-bg" cx="8" cy="8" r="6" />
								<circle class="cc-cache-ring-fill" id="cc-cache-fill" cx="8" cy="8" r="6" />
							</svg>
							<span class="cc-row-label">Cache</span>
						</div>
						<div class="cc-bar-col"></div>
						<div class="cc-stat-col">
							<span class="cc-val-reset" id="cc-cache-text">—</span>
						</div>
					</div>

					<!-- Empty Plan Notice (Visible in cc-state-empty) -->
					<div class="cc-empty-notice" id="cc-empty-notice">No data yet. Updates after your next message.</div>

					<!-- Error Notice (Visible in cc-state-error) -->
					<div class="cc-error-notice" id="cc-error-notice">
						<span id="cc-error-msg">Usage currently unavailable</span>
						<button class="cc-retry-btn" id="cc-retry-btn">Retry</button>
					</div>
				</div>

				<!-- Hidden compatibility elements for test suite -->
				<div style="display: none;">
					<div id="cc-summary-line"></div>
					<div id="cc-details"></div>
					<button id="cc-expand-btn" aria-expanded="false"></button>
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
						<span>Mid (60–90%)</span>
						<input type="color" id="cc-col-mid" />
					</div>
					<div class="cc-settings-row">
						<span>High (90%+)</span>
						<input type="color" id="cc-col-high" />
					</div>
					<div class="cc-settings-row">
						<span>Background Opacity</span>
						<input type="range" id="cc-opacity-slider" min="50" max="100" step="2" />
					</div>

					<div class="cc-contrast-alert" id="cc-contrast-alert">
						⚠️ Low contrast (&lt; 4.5:1). Colors may be hard to read.
					</div>

					<div class="cc-settings-title" style="margin-top: 4px;">Rows Visibility</div>
					<div class="cc-settings-row">
						<label><input type="checkbox" id="cc-chk-sess" /> Session (5h)</label>
						<label><input type="checkbox" id="cc-chk-week" /> Weekly (7d)</label>
						<label><input type="checkbox" id="cc-chk-ctx" /> Context</label>
						<label><input type="checkbox" id="cc-chk-cache" /> Cache</label>
					</div>

					<div class="cc-settings-row cc-hidden" id="cc-context-window-row">
						<span title="Override the estimated context window limit (default: 200000)">Context Window</span>
						<input type="number" id="cc-context-window-input" min="1000" max="10000000" step="10000" placeholder="200000" />
					</div>

					<div class="cc-settings-actions">
						<button class="cc-btn-secondary" id="cc-reset-defaults-btn">Reset Defaults</button>
					</div>
				</div>
			`;

			this.shadowRoot.appendChild(panel);

			// Cache references
			this.dom.panel = panel;
			this.dom.summaryLine = this.shadowRoot.getElementById('cc-summary-line') || panel;
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

			this.dom.rowContext = this.shadowRoot.getElementById('cc-row-context');
			this.dom.ctxMain = this.shadowRoot.getElementById('cc-ctx-main');
			this.dom.ctxPct = this.shadowRoot.getElementById('cc-ctx-pct');
			this.dom.ctxBar = this.shadowRoot.getElementById('cc-ctx-bar');

			this.dom.rowSess = this.shadowRoot.getElementById('cc-row-session');
			this.dom.rowSession = this.shadowRoot.getElementById('cc-row-session');
			this.dom.sessReset = this.shadowRoot.getElementById('cc-sess-reset');
			this.dom.sessPct = this.shadowRoot.getElementById('cc-sess-pct');
			this.dom.sessBar = this.shadowRoot.getElementById('cc-sess-bar');
			this.dom.sessMarker = this.shadowRoot.getElementById('cc-sess-marker');

			this.dom.rowWeek = this.shadowRoot.getElementById('cc-row-weekly');
			this.dom.rowWeekly = this.shadowRoot.getElementById('cc-row-weekly');
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
			this.dom.chkCtx = this.shadowRoot.getElementById('cc-chk-ctx');
			this.dom.chkCache = this.shadowRoot.getElementById('cc-chk-cache');
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
			let isDebugMode = Boolean(globalThis.__CC_DEBUG);
			try {
				if (typeof localStorage !== 'undefined' && localStorage.getItem(CC.CONST?.DEBUG_STORAGE_KEY || 'cc_debug') === 'true') {
					isDebugMode = true;
				}
			} catch {
				// ignore SecurityError / access denied
			}
			if (isDebugMode) {
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
			if (this.dom.chkSess) {
				this.dom.chkSess.addEventListener('change', (e) => {
					this.settings.showSession = e.target.checked;
					this._saveSettings();
					this.applyThemeAndSettings();
				});
			}
			if (this.dom.chkWeek) {
				this.dom.chkWeek.addEventListener('change', (e) => {
					this.settings.showWeekly = e.target.checked;
					this._saveSettings();
					this.applyThemeAndSettings();
				});
			}
			if (this.dom.chkCtx) {
				this.dom.chkCtx.addEventListener('change', (e) => {
					this._currentCaller = 'chk_ctx';
					this.settings.showContext = e.target.checked;
					this._currentCaller = null;
					this._saveSettings();
					this.applyThemeAndSettings();
					if (this.onToggleContextOrCache) this.onToggleContextOrCache();
				});
			}
			if (this.dom.chkCache) {
				this.dom.chkCache.addEventListener('change', (e) => {
					this._currentCaller = 'chk_cache';
					this.settings.showCache = e.target.checked;
					this._currentCaller = null;
					this._saveSettings();
					this.applyThemeAndSettings();
					if (this.onToggleContextOrCache) this.onToggleContextOrCache();
				});
			}

			// Context Window Override input
			if (this.dom.contextWindowInput) {
				let ctxDebounceTimer = null;

				const applyAndSave = (num) => {
					if (ctxDebounceTimer) {
						clearTimeout(ctxDebounceTimer);
						ctxDebounceTimer = null;
					}
					this.settings.contextWindow = num;
					this._saveSettings();
					if (this.lastConversationData) {
						this.setConversationMetrics(this.lastConversationData);
					}
				};

				// Input keystroke listener: debounce ~600ms, ignore < 1000, do not reset mid-typing
				this.dom.contextWindowInput.addEventListener('input', (e) => {
					if (ctxDebounceTimer) {
						clearTimeout(ctxDebounceTimer);
						ctxDebounceTimer = null;
					}

					const raw = (e.target.value || '').trim();
					// Mid-typing: if empty or < 1000, do NOT save or reset to 200000
					if (raw === '') return;

					const num = parseInt(raw, 10);
					if (isNaN(num) || num < 1000) return;

					// Valid value >= 1000: debounce save and apply by ~600ms
					ctxDebounceTimer = setTimeout(() => {
						ctxDebounceTimer = null;
						applyAndSave(num);
					}, 600);
				});

				// Change / blur listener: apply immediately on Enter/blur or reset to default if invalid
				const handleCommit = (e) => {
					if (ctxDebounceTimer) {
						clearTimeout(ctxDebounceTimer);
						ctxDebounceTimer = null;
					}

					const raw = (e.target.value || '').trim();
					const num = parseInt(raw, 10);

					if (!isNaN(num) && num >= 1000) {
						applyAndSave(num);
						e.target.value = num;
					} else {
						// Reset only on blur/commit with an invalid value (< 1000 or empty)
						const defaultLimit = CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000;
						applyAndSave(defaultLimit);
						e.target.value = defaultLimit;
					}
				};

				this.dom.contextWindowInput.addEventListener('change', handleCommit);
				this.dom.contextWindowInput.addEventListener('blur', handleCommit);
			}

			// Reset buttons
			this.dom.resetDefaultsBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.resetDefaults();
			});

			// Theme change observer
			if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
				const themeObserver = new MutationObserver(() => this.applyThemeAndSettings());
				if (document.documentElement) {
					themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'class'] });
				}
				if (document.body) {
					themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
				}
			}
		}

		resetDefaults() {
			this.settings = this._wrapSettings({
				preset: 'default',
				lowColor: PRESETS.default.low,
				midColor: PRESETS.default.mid,
				highColor: PRESETS.default.high,
				accentColor: PRESETS.default.accent,
				opacity: 0.94,
				showSession: true,
				showWeekly: true,
				showContext: false,
				showCache: false,
				v060_migrated: true,
				v061_migrated: true,
				contextWindow: CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000
			});
			if (this.onDebugLog) {
				this.onDebugLog('row_visibility_changed', { row: 'context', visible: false, caller: 'reset_defaults' });
				this.onDebugLog('row_visibility_changed', { row: 'cache', visible: false, caller: 'reset_defaults' });
			}
			this._saveSettings();
			this.applyThemeAndSettings();
			if (this.lastConversationData) {
				this.setConversationMetrics(this.lastConversationData);
			}
			if (this.onToggleContextOrCache) {
				this.onToggleContextOrCache();
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
			const low = isValidHexColor(this.settings.lowColor) ? this.settings.lowColor : PRESETS.default.low;
			const mid = isValidHexColor(this.settings.midColor) ? this.settings.midColor : PRESETS.default.mid;
			const high = isValidHexColor(this.settings.highColor) ? this.settings.highColor : (PRESETS.default.high || '#ef4444');
			const accent = isValidHexColor(this.settings.accentColor) ? this.settings.accentColor : PRESETS.default.accent;
			const opacity = typeof this.settings.opacity === 'number' && !isNaN(this.settings.opacity)
				? Math.max(0.50, Math.min(1.0, this.settings.opacity))
				: 0.94;

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
			if (this.dom.chkCtx) this.dom.chkCtx.checked = !!this.settings.showContext;
			if (this.dom.chkCache) this.dom.chkCache.checked = !!this.settings.showCache;

			// Row visibility
			if (this.dom.rowSess) this.dom.rowSess.classList.toggle('cc-hidden', !this.settings.showSession);
			if (this.dom.rowWeek) this.dom.rowWeek.classList.toggle('cc-hidden', !this.settings.showWeekly);
			if (this.dom.rowContext) this.dom.rowContext.classList.toggle('cc-hidden', !this.settings.showContext);
			if (this.dom.rowCache) this.dom.rowCache.classList.toggle('cc-hidden', !this.settings.showCache);

			// Context Window input in drawer is only visible if showContext is true
			const ctxWindowRow = this.shadowRoot?.getElementById ? this.shadowRoot.getElementById('cc-context-window-row') : null;
			if (ctxWindowRow) {
				ctxWindowRow.classList.toggle('cc-hidden', !this.settings.showContext);
			}

			// Contrast check
			const bgRgb = isDark ? { r: 30, g: 29, b: 28 } : { r: 255, g: 255, b: 255 };
			const textRgb = isDark ? { r: 240, g: 238, b: 233 } : { r: 31, g: 30, b: 29 };
			const cr = getContrastRatio(bgRgb, textRgb);
			if (this.dom.contrastAlert) {
				this.dom.contrastAlert.classList.toggle('cc-show', cr < 4.5);
			}

			this.refreshBarColors();
			this.logPanelRenderState();
		}

		refreshBarColors() {
			const getColor = (pct) => {
				if (typeof pct !== 'number') return this.settings.lowColor;
				if (pct <= 60) return interpolateColor(this.settings.lowColor, this.settings.midColor, pct / 60);
				return interpolateColor(this.settings.midColor, this.settings.highColor, (pct - 60) / 40);
			};

			const lowColor = this.settings.lowColor || PRESETS.default.low || '#10b981';
			const midColor = this.settings.midColor || PRESETS.default.mid || '#f59e0b';
			const highColor = this.settings.highColor || PRESETS.default.high || '#ef4444';

			if (this.dom.ctxBar) {
				const pctUsed = this.metrics.context.pctUsed;
				if (!this.metrics.context.isLoaded || typeof pctUsed !== 'number') {
					this.dom.ctxBar.style.backgroundColor = lowColor;
				} else if (pctUsed >= 90) {
					this.dom.ctxBar.style.backgroundColor = highColor;
				} else if (pctUsed >= 60) {
					this.dom.ctxBar.style.backgroundColor = midColor;
				} else {
					this.dom.ctxBar.style.backgroundColor = lowColor;
				}
			}
			if (this.dom.ctxPct) {
				const pctUsed = this.metrics.context.pctUsed;
				if (!this.metrics.context.isLoaded || typeof pctUsed !== 'number') {
					this.dom.ctxPct.style.color = '';
				} else if (pctUsed >= 90) {
					this.dom.ctxPct.style.color = highColor;
				} else if (pctUsed >= 60) {
					this.dom.ctxPct.style.color = midColor;
				} else {
					this.dom.ctxPct.style.color = '';
				}
			}
			if (this.dom.sessBar) {
				const normSess = this.currentNormalizedState?.session;
				const used = normSess?.pctUsed ?? this.metrics.session.pct;
				if (typeof used === 'number') {
					if (used >= 90) this.dom.sessBar.style.backgroundColor = highColor;
					else if (used >= 60) this.dom.sessBar.style.backgroundColor = midColor;
					else this.dom.sessBar.style.backgroundColor = lowColor;
				}
			}
			if (this.dom.weekBar) {
				const normWeek = this.currentNormalizedState?.weekly;
				const used = normWeek?.pctUsed ?? this.metrics.weekly.pct;
				if (typeof used === 'number') {
					if (used >= 90) this.dom.weekBar.style.backgroundColor = highColor;
					else if (used >= 60) this.dom.weekBar.style.backgroundColor = midColor;
					else this.dom.weekBar.style.backgroundColor = lowColor;
				}
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

		getEffectiveContextWindow() {
			const fallback = CC.CONST?.CONTEXT_WINDOW_TOKENS || 200000;
			if (CC.tokens?.resolveContextWindow) {
				return CC.tokens.resolveContextWindow(this.settings?.contextWindow, this.detectedContextWindow, fallback);
			}
			return (typeof this.settings?.contextWindow === 'number' && this.settings.contextWindow > 0)
				? this.settings.contextWindow
				: fallback;
		}

		setConversationLoading() {
			const limit = this.getEffectiveContextWindow();
			const limitStr = limit >= 1000 ? `${Math.round(limit / 1000)}k` : String(limit);
			const tooltip = 'Estimated size of this chat vs. context window. Not your plan usage limit. The window size may differ by model, adjust it in settings.';
			this.metrics.context = {
				isLoaded: false,
				tokens: null,
				pctUsed: null,
				pctLeft: null,
				tier: 'low',
				pct: null,
				formatted: `— / ${limitStr}`
			};
			this.metrics.cachedUntil = null;

			if (this.dom.ctxMain) {
				this.dom.ctxMain.textContent = `— / ${limitStr}`;
				this.dom.ctxPct.textContent = '—';
				this.dom.ctxPct.title = tooltip;
				this.dom.ctxBar.style.width = '0%';
				this.dom.ctxBar.title = tooltip;
				if (this.dom.ctxBar.parentElement) {
					this.dom.ctxBar.parentElement.setAttribute('aria-valuenow', '0');
					this.dom.ctxBar.parentElement.title = tooltip;
				}
				this.panel.classList.remove('cc-over-limit');
				this.panel.classList.remove('cc-over-limit-10pct');
				this.panel.classList.remove('cc-high-utilization');
				this.panel.classList.remove('cc-ctx-mid');
				this.panel.classList.remove('cc-ctx-high');
				this.panel.classList.add('cc-ctx-low');
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
				// Stale-while-revalidate: only reset to loading if metrics are not already loaded
				if (!this.metrics.context.isLoaded) {
					this.setConversationLoading();
				}
				return;
			}

			const tokens = Math.max(0, Math.round(totalTokens));
			const limit = this.getEffectiveContextWindow();
			this.metrics.cachedUntil = cachedUntil;

			const util = CC.tokens?.formatContextUtilization
				? CC.tokens.formatContextUtilization(tokens, limit)
				: (() => {
					const limitNum = (typeof limit === 'number' && limit > 0) ? limit : 200000;
					const limitStr = limitNum >= 1000 ? `${Math.round(limitNum / 1000)}k` : String(limitNum);
					const fTok = CC.tokens?.formatTokens ? CC.tokens.formatTokens(tokens) : (tokens >= 1000 ? `~${Math.round(tokens / 1000)}k` : `~${tokens}`);
					const isOver = tokens > limitNum;
					const pctUsed = Math.round((tokens / limitNum) * 100);
					const pctLeft = Math.max(0, 100 - pctUsed);
					let tier = 'low';
					if (pctUsed >= 90) tier = 'high';
					else if (pctUsed >= 60) tier = 'mid';
					return {
						formatted: `${fTok} est. / ${limitStr}`,
						percentText: isOver ? '100%+ used · 0% left' : `${pctUsed}% used · ${pctLeft}% left`,
						barPercent: Math.max(0, Math.min(100, pctUsed)),
						pctUsed,
						pctLeft,
						tier,
						isOverLimit: isOver,
						tooltip: 'Estimated size of this chat vs. context window. Not your plan usage limit. The window size may differ by model, adjust it in settings.'
					};
				})();

			const cappedBarPercent = Math.max(0, Math.min(100, util.barPercent));
			const isOverLimit = !!util.isOverLimit;
			const tier = util.tier || (util.pctUsed >= 90 ? 'high' : (util.pctUsed >= 60 ? 'mid' : 'low'));

			this.metrics.context = {
				isLoaded: true,
				tokens,
				pctUsed: util.pctUsed,
				pctLeft: util.pctLeft,
				tier,
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
					this.dom.ctxBar.parentElement.setAttribute('aria-valuenow', cappedBarPercent.toFixed(0));
					this.dom.ctxBar.parentElement.title = util.tooltip || '';
				}

				this.panel.classList.toggle('cc-over-limit', isOverLimit);
				this.panel.classList.toggle('cc-ctx-low', tier === 'low');
				this.panel.classList.toggle('cc-ctx-mid', tier === 'mid');
				this.panel.classList.toggle('cc-ctx-high', tier === 'high');
				this.panel.classList.remove('cc-over-limit-10pct');
				this.panel.classList.toggle('cc-high-utilization', tier === 'high');
			}

			this.refreshBarColors();
			this.tick();
		}

		_renderFallbackRows() {
			if (this.dom.rowSession) this.dom.rowSession.classList.remove('cc-hidden');
			if (this.dom.rowWeekly) this.dom.rowWeekly.classList.remove('cc-hidden');
			if (this.dom.sessPct) this.dom.sessPct.textContent = '—';
			if (this.dom.sessReset) this.dom.sessReset.textContent = '—';
			if (this.dom.sessBar) this.dom.sessBar.style.width = '0%';
			if (this.dom.weekPct) this.dom.weekPct.textContent = '—';
			if (this.dom.weekReset) this.dom.weekReset.textContent = '—';
			if (this.dom.weekBar) this.dom.weekBar.style.width = '0%';
		}

		renderSessionAndWeekly(now = Date.now()) {
			if (!this.panel) return;
			try {
				const norm = this.currentNormalizedState;
				const sess = norm?.session;
				const week = norm?.weekly;
				const capturedAt = norm?.capturedAt;

				const rowTooltip = capturedAt ? formatLastMessageTime(capturedAt) : '';
				if (this.dom.rowSession) this.dom.rowSession.title = rowTooltip;
				if (this.dom.rowWeekly) this.dom.rowWeekly.title = rowTooltip;

				const lowColor = isValidHexColor(this.settings.lowColor) ? this.settings.lowColor : (PRESETS.default.low || '#10b981');
				const midColor = isValidHexColor(this.settings.midColor) ? this.settings.midColor : (PRESETS.default.mid || '#f59e0b');
				const highColor = isValidHexColor(this.settings.highColor) ? this.settings.highColor : (PRESETS.default.high || '#ef4444');

				const getTierColor = (pct) => {
					if (typeof pct !== 'number') return lowColor;
					if (pct >= 90) return highColor;
					if (pct >= 60) return midColor;
					return lowColor;
				};

				// Render Session (5h)
				const sessResetsAtMs = sess?.resetsAt ? Date.parse(sess.resetsAt) : null;
				const sessHasData = sess && typeof sess.pctUsed === 'number' && !isNaN(sess.pctUsed);
				const sessRolledOver = sessResetsAtMs && now >= sessResetsAtMs;

				if (!sessHasData) {
					// Empty state: no data
					if (this.dom.sessPct) {
						this.dom.sessPct.textContent = '—';
						this.dom.sessPct.title = '';
					}
					if (this.dom.sessReset) {
						this.dom.sessReset.textContent = '—';
						this.dom.sessReset.title = '';
					}
					if (this.dom.sessBar) {
						this.dom.sessBar.style.width = '0%';
						this.dom.sessBar.style.backgroundColor = lowColor;
						if (this.dom.sessBar.parentElement) {
							this.dom.sessBar.parentElement.setAttribute('aria-valuenow', '0');
						}
					}
					if (this.dom.rowSession) this.dom.rowSession.classList.remove('cc-high-utilization');
				} else if (sessRolledOver) {
					// Rolled over: now >= resets_at
					if (this.dom.sessPct) {
						this.dom.sessPct.textContent = '—';
						this.dom.sessPct.title = '';
					}
					if (this.dom.sessReset) {
						this.dom.sessReset.textContent = 'Window reset, send a message to update';
						this.dom.sessReset.title = '';
					}
					if (this.dom.sessBar) {
						this.dom.sessBar.style.width = '0%';
						this.dom.sessBar.style.backgroundColor = lowColor;
						if (this.dom.sessBar.parentElement) {
							this.dom.sessBar.parentElement.setAttribute('aria-valuenow', '0');
						}
					}
					if (this.dom.rowSession) this.dom.rowSession.classList.remove('cc-high-utilization');
				} else {
					// Active session data
					const used = sess.pctUsed;
					const left = typeof sess.pctLeft === 'number' ? sess.pctLeft : Math.max(0, 100 - used);
					const cappedWidth = Math.max(0, Math.min(100, used));
					const tierColor = getTierColor(used);

					if (this.dom.sessPct) {
						this.dom.sessPct.textContent = `${used}% used · ${left}% left`;
						this.dom.sessPct.title = 'Derived: 100% minus used';
					}
					if (this.dom.sessReset) {
						const diffMs = sessResetsAtMs ? sessResetsAtMs - now : 0;
						this.dom.sessReset.textContent = sessResetsAtMs ? formatSessionCountdown(diffMs) : '—';
						this.dom.sessReset.title = '';
					}
					if (this.dom.sessBar) {
						this.dom.sessBar.style.width = `${cappedWidth}%`;
						this.dom.sessBar.style.backgroundColor = tierColor;
						if (this.dom.sessBar.parentElement) {
							this.dom.sessBar.parentElement.setAttribute('aria-valuenow', String(cappedWidth));
						}
					}
					if (this.dom.rowSession) {
						this.dom.rowSession.classList.toggle('cc-high-utilization', used >= 90);
					}
				}

				// Render Weekly (7d)
				const weekResetsAtMs = week?.resetsAt ? Date.parse(week.resetsAt) : null;
				const weekHasData = week && typeof week.pctUsed === 'number' && !isNaN(week.pctUsed);
				const weekRolledOver = weekResetsAtMs && now >= weekResetsAtMs;

				if (!weekHasData) {
					// Empty state: no data
					if (this.dom.weekPct) {
						this.dom.weekPct.textContent = '—';
						this.dom.weekPct.title = '';
					}
					if (this.dom.weekReset) {
						this.dom.weekReset.textContent = '—';
						this.dom.weekReset.title = '';
					}
					if (this.dom.weekBar) {
						this.dom.weekBar.style.width = '0%';
						this.dom.weekBar.style.backgroundColor = lowColor;
						if (this.dom.weekBar.parentElement) {
							this.dom.weekBar.parentElement.setAttribute('aria-valuenow', '0');
						}
					}
					if (this.dom.rowWeekly) this.dom.rowWeekly.classList.remove('cc-high-utilization');
				} else if (weekRolledOver) {
					// Rolled over: now >= resets_at
					if (this.dom.weekPct) {
						this.dom.weekPct.textContent = '—';
						this.dom.weekPct.title = '';
					}
					if (this.dom.weekReset) {
						this.dom.weekReset.textContent = 'Window reset, send a message to update';
						this.dom.weekReset.title = '';
					}
					if (this.dom.weekBar) {
						this.dom.weekBar.style.width = '0%';
						this.dom.weekBar.style.backgroundColor = lowColor;
						if (this.dom.weekBar.parentElement) {
							this.dom.weekBar.parentElement.setAttribute('aria-valuenow', '0');
						}
					}
					if (this.dom.rowWeekly) this.dom.rowWeekly.classList.remove('cc-high-utilization');
				} else {
					// Active weekly data
					const used = week.pctUsed;
					const left = typeof week.pctLeft === 'number' ? week.pctLeft : Math.max(0, 100 - used);
					const cappedWidth = Math.max(0, Math.min(100, used));
					const tierColor = getTierColor(used);

					if (this.dom.weekPct) {
						this.dom.weekPct.textContent = `${used}% used · ${left}% left`;
						this.dom.weekPct.title = 'Derived: 100% minus used';
					}
					if (this.dom.weekReset) {
						const diffMs = weekResetsAtMs ? weekResetsAtMs - now : 0;
						this.dom.weekReset.textContent = weekResetsAtMs ? formatWeeklyCountdown(diffMs) : '—';
						this.dom.weekReset.title = weekResetsAtMs ? formatWeeklyLocalClock(weekResetsAtMs) : '';
					}
					if (this.dom.weekBar) {
						this.dom.weekBar.style.width = `${cappedWidth}%`;
						this.dom.weekBar.style.backgroundColor = tierColor;
						if (this.dom.weekBar.parentElement) {
							this.dom.weekBar.parentElement.setAttribute('aria-valuenow', String(cappedWidth));
						}
					}
					if (this.dom.rowWeekly) {
						this.dom.rowWeekly.classList.toggle('cc-high-utilization', used >= 90);
					}
				}
				this.logPanelRenderState();
			} catch (err) {
				if (this.onDebugLog) {
					this.onDebugLog('render_error', { name: err?.name || 'Error', message: err?.message || 'Render failed' });
				}
				this._renderFallbackRows();
			}
		}

		setNormalizedUsage(norm) {
			this.currentNormalizedState = norm;
			this.metrics.state = norm.state;
			this.metrics.errorReason = norm.errorReason;

			// Handle overall panel states (empty / error / ok)
			if (this.panel) {
				this.panel.classList.toggle('cc-state-empty', norm.state === 'empty');
				this.panel.classList.toggle('cc-state-error', norm.state === 'error');
			}

			if (norm.state === 'error') {
				if (this.dom.errorMsg) this.dom.errorMsg.textContent = norm.errorReason || 'Usage currently unavailable';
			}

			// Store parsed metrics for backwards compatibility
			const sess = norm.session;
			if (sess && typeof sess.pct === 'number') {
				const pct = sess.pct;
				const resetsAt = sess.resetsAt ? Date.parse(sess.resetsAt) : null;
				const windowStart = resetsAt ? resetsAt - 5 * 60 * 60 * 1000 : null;
				this.metrics.session = { pct, resetsAt, windowStart, pctUsed: sess.pctUsed, pctLeft: sess.pctLeft };
			} else {
				this.metrics.session = { pct: null, resetsAt: null, windowStart: null, pctUsed: null, pctLeft: null };
			}

			const week = norm.weekly;
			if (week && typeof week.pct === 'number') {
				const pct = week.pct;
				const resetsAt = week.resetsAt ? Date.parse(week.resetsAt) : null;
				const windowStart = resetsAt ? resetsAt - 7 * 24 * 60 * 60 * 1000 : null;
				this.metrics.weekly = { pct, resetsAt, windowStart, pctUsed: week.pctUsed, pctLeft: week.pctLeft };
			} else {
				this.metrics.weekly = { pct: null, resetsAt: null, windowStart: null, pctUsed: null, pctLeft: null };
			}

			this.renderSessionAndWeekly(Date.now());
			this.refreshBarColors();
		}

		renderAll() {
			if (!this.panel) return;
			try {
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
			} catch (err) {
				if (this.onDebugLog) {
					this.onDebugLog('render_error', { name: err?.name || 'Error', message: err?.message || 'Render failed' });
				}
				this._renderFallbackRows();
			}
		}

		tick() {
			const now = Date.now();

			// 1. Session and Weekly plan usage limits
			this.renderSessionAndWeekly(now);

			// 2. Cache countdown & ring (Shows "—" when inactive, countdown when active)
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
		}
	}

	CounterUI.UI_STYLES = UI_STYLES;
	CC.ui = { CounterUI, PRESETS, UI_STYLES };

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { CounterUI, PRESETS, UI_STYLES };
	}
})();
