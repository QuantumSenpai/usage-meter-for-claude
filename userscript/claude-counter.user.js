// ==UserScript==
// @name         Usage Meter for Claude
// @namespace    https://github.com/she-llac/claude-counter
// @version      0.5.0-userscript
// @description  Shows ~token count, cache timer, and native session/weekly usage bars on claude.ai.
// @match        https://claude.ai/*
// @run-at       document-start
// @grant        none
// @require      https://unpkg.com/gpt-tokenizer@2.9.0/dist/o200k_base.js
// ==/UserScript==

(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	if (CC.__ccUserscriptWrapped) return;
	CC.__ccUserscriptWrapped = true;

	// ==========================================
	// Constants & Selectors
	// ==========================================
	CC.SELECTORS = Object.freeze({
		INPUT_ANCHORS: [
			{ name: 'model-selector-dropdown', selector: '[data-testid="model-selector-dropdown"]' },
			{ name: 'model-selector-aria', selector: 'button[aria-haspopup="menu"][data-testid*="model"], button[aria-label*="model" i]' },
			{ name: 'chat-input-controls', selector: '[data-testid="chat-input-controls"], [data-testid="chat-controls"]' },
			{ name: 'chat-input-form', selector: 'fieldset:has([contenteditable="true"]), form:has([contenteditable="true"])' },
			{ name: 'contenteditable-wrapper', selector: '[contenteditable="true"]' }
		],
		HEADER_ANCHORS: [
			{ name: 'chat-menu-trigger', selector: '[data-testid="chat-menu-trigger"]' },
			{ name: 'chat-title', selector: '[data-testid="chat-title"], header [aria-haspopup="menu"]' },
			{ name: 'header-banner', selector: 'header, [role="banner"]' }
		],
		BRANCH_BUTTONS: 'button[aria-label="Previous"], button[aria-label="Next"], button[aria-label*="previous response" i], button[aria-label*="next response" i]'
	});

	CC.DOM = Object.freeze({
		METER_ROOT_ID: 'cc-usage-meter-root',
		FALLBACK_CONTAINER_ID: 'cc-floating-meter-root'
	});

	CC.CONST = Object.freeze({
		CACHE_WINDOW_MS: 5 * 60 * 1000,
		CONTEXT_LIMIT_TOKENS: 200000,
		SLOW_USAGE_REFRESH_INTERVAL_MS: 5 * 60 * 1000,
		FALLBACK_MOUNT_TIMEOUT_MS: 3000,
		DEBUG_LOG_MAX_ENTRIES: 100,
		DEBUG_STORAGE_KEY: 'cc_debug'
	});

	// ==========================================
	// Interception (Fetch, History, SSE)
	// ==========================================
	CC._ccInternal = CC._ccInternal || {};
	CC._ccInternal.onGenerationStart = CC._ccInternal.onGenerationStart || (() => {});
	CC._ccInternal.onConversationData = CC._ccInternal.onConversationData || (() => {});
	CC._ccInternal.onMessageLimit = CC._ccInternal.onMessageLimit || (() => {});
	CC._ccInternal.onUsageData = CC._ccInternal.onUsageData || (() => {});
	CC._ccInternal.onStreamCompleted = CC._ccInternal.onStreamCompleted || (() => {});
	CC._ccInternal.onUrlChange = CC._ccInternal.onUrlChange || (() => {});

	const originalFetch = window.fetch ? window.fetch.bind(window) : null;
	CC._ccInternal.originalFetch = originalFetch;

	const originalPushState = history.pushState ? history.pushState.bind(history) : null;
	const originalReplaceState = history.replaceState ? history.replaceState.bind(history) : null;

	const dispatchUrlChange = () => {
		try {
			CC._ccInternal.onUrlChange();
		} catch {
			// ignore
		}
	};

	if (originalPushState) {
		history.pushState = function (...args) {
			const result = originalPushState(...args);
			dispatchUrlChange();
			return result;
		};
	}

	if (originalReplaceState) {
		history.replaceState = function (...args) {
			const result = originalReplaceState(...args);
			dispatchUrlChange();
			return result;
		};
	}

	window.addEventListener('popstate', dispatchUrlChange);

	function toAbsoluteUrl(input) {
		try {
			if (typeof input === 'string') {
				if (input.startsWith('/')) return `${window.location.origin}${input}`;
				return input;
			}
			if (input instanceof URL) return input.href;
			if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
		} catch {
			// ignore
		}
		return '';
	}

	function getConversationMeta(url) {
		const match = url.match(/\/api\/organizations\/([^/?#]+)\/chat_conversations\/([^/?#]+)/);
		return match ? { orgId: match[1], conversationId: match[2] } : null;
	}

	function getOrgMeta(url) {
		const match = url.match(/\/api\/organizations\/([^/?#]+)/);
		return match ? match[1] : null;
	}

	if (originalFetch) {
		window.fetch = async (...args) => {
			let url = '';
			let method = 'GET';
			try {
				url = toAbsoluteUrl(args[0]);
				const opts = args[1] || {};
				method = (opts.method || (args[0] instanceof Request ? args[0].method : 'GET') || 'GET').toUpperCase();
			} catch {
				// ignore
			}

			if (url && method === 'POST' && (url.includes('/completion') || url.includes('/retry_completion'))) {
				try {
					CC._ccInternal.onGenerationStart();
				} catch {
					// ignore
				}
			}

			let response;
			try {
				response = await originalFetch(...args);
			} catch (err) {
				throw err;
			}

			try {
				const contentType = response.headers.get('content-type') || '';
				if (contentType.includes('event-stream')) {
					handleEventStream(response);
				} else if (url && response.ok) {
					if (url.includes('/chat_conversations/')) {
						const meta = getConversationMeta(url);
						if (meta) handleConversationResponse(meta, response);
					} else if (url.includes('/usage') && url.includes('/api/organizations/')) {
						const orgId = getOrgMeta(url);
						if (orgId) handleUsageResponse(orgId, response);
					}
				}
			} catch {
				// ignore
			}

			return response;
		};
	}

	async function handleConversationResponse({ orgId, conversationId }, response) {
		try {
			const cloned = response.clone();
			const data = await cloned.json();
			CC._ccInternal.onConversationData({ orgId, conversationId, data });
		} catch {
			// ignore
		}
	}

	async function handleUsageResponse(orgId, response) {
		try {
			const cloned = response.clone();
			const data = await cloned.json();
			CC._ccInternal.onUsageData({ orgId, data });
		} catch {
			// ignore
		}
	}

	async function handleEventStream(response) {
		try {
			const cloned = response.clone();
			const reader = cloned.body?.getReader?.();
			if (!reader) return;
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					CC._ccInternal.onStreamCompleted();
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split(/\r\n|\r|\n/);
				buffer = lines.pop() || '';
				for (const line of lines) {
					if (!line.startsWith('data:')) continue;
					const raw = line.slice(5).trim();
					if (!raw || raw === '[DONE]') continue;
					try {
						const json = JSON.parse(raw);
						if (json?.type === 'message_limit' && json.message_limit) {
							CC._ccInternal.onMessageLimit(json.message_limit);
						} else if (json?.message_limit) {
							CC._ccInternal.onMessageLimit(json.message_limit);
						} else if (json?.windows) {
							CC._ccInternal.onMessageLimit(json);
						}
					} catch {
						// ignore
					}
				}
			}
		} catch {
			// ignore
		}
	}

	// ==========================================
	// Token Counting
	// ==========================================
	const ROOT_MESSAGE_ID = '00000000-0000-4000-8000-000000000000';

	function countTokens(text) {
		if (!text) return 0;
		const tokenizer = globalThis.GPTTokenizer_o200k_base || null;
		if (!tokenizer?.countTokens) return Math.ceil(text.length / 4);
		try {
			return tokenizer.countTokens(text);
		} catch {
			return Math.ceil(text.length / 4);
		}
	}

	function buildTrunk(conversation) {
		const messages = Array.isArray(conversation?.chat_messages) ? conversation.chat_messages : [];
		if (messages.length === 0) return [];

		const byId = new Map();
		for (const msg of messages) {
			if (msg?.uuid) byId.set(msg.uuid, msg);
		}

		const leaf = conversation?.current_leaf_message_uuid;
		if (!leaf) {
			return messages.slice().sort((a, b) => (Date.parse(a?.created_at || 0) || 0) - (Date.parse(b?.created_at || 0) || 0));
		}

		const trunk = [];
		let currentId = leaf;
		const visited = new Set();
		while (currentId && currentId !== ROOT_MESSAGE_ID && !visited.has(currentId)) {
			visited.add(currentId);
			const msg = byId.get(currentId);
			if (!msg) break;
			trunk.push(msg);
			currentId = msg.parent_message_uuid;
		}

		trunk.reverse();
		return trunk;
	}

	function stringifyMessage(message) {
		const parts = [];
		const content = Array.isArray(message?.content) ? message.content : [];
		for (const item of content) {
			if (!item || typeof item !== 'object') continue;
			if (item.type === 'thinking' || item.type === 'redacted_thinking' || item.type === 'image' || item.type === 'document') continue;
			if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text);
			else if (item.text) parts.push(String(item.text));
		}
		if (typeof message?.text === 'string' && message.text) parts.push(message.text);
		const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
		for (const a of attachments) {
			if (typeof a?.extracted_content === 'string' && a.extracted_content) parts.push(a.extracted_content);
		}
		return parts.join('\n');
	}

	async function computeConversationMetrics(conversation) {
		const trunk = buildTrunk(conversation);
		let totalTokens = 0;
		let lastAssistantMs = null;

		for (let i = 0; i < trunk.length; i++) {
			const msg = trunk[i];
			if (i > 0 && i % 10 === 0) {
				await new Promise((r) => setTimeout(r, 0));
			}
			if (msg?.sender === 'assistant' && msg?.created_at) {
				const msgMs = Date.parse(msg.created_at);
				if (!lastAssistantMs || msgMs > lastAssistantMs) lastAssistantMs = msgMs;
			}
			const text = stringifyMessage(msg);
			totalTokens += countTokens(text);
		}

		const cachedUntil = lastAssistantMs ? lastAssistantMs + CC.CONST.CACHE_WINDOW_MS : null;
		return { trunkMessageCount: trunk.length, totalTokens, lastAssistantMs, cachedUntil };
	}

	CC.tokens = { computeConversationMetrics, countTokens };

	// ==========================================
	// UI Component (Shadow DOM)
	// ==========================================
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
			const t = clamped / 60;
			const hue = 168 - t * 13;
			return `hsl(${hue}, 60%, 44%)`;
		}
		if (clamped <= 85) {
			const t = (clamped - 60) / 25;
			const hue = 155 - t * 117;
			const sat = 60 + t * 32;
			return `hsl(${hue}, ${sat}%, 48%)`;
		}
		const t = (clamped - 85) / 15;
		const hue = 38 - t * 44;
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
		*, *::before, *::after { box-sizing: border-box; }
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
		.cc-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
		.cc-header-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
		.cc-title { font-size: 11px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; color: var(--cc-text-muted); }
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
		}
		.cc-cache-pill.cc-hidden { display: none; }
		.cc-cache-ring { display: block; transform: rotate(-90deg); }
		.cc-cache-ring-bg { fill: none; stroke: rgba(16, 185, 129, 0.25); stroke-width: 2; }
		.cc-cache-ring-fill {
			fill: none;
			stroke: #10b981;
			stroke-width: 2;
			stroke-linecap: round;
			stroke-dasharray: 37.7;
			stroke-dashoffset: 0;
			transition: stroke-dashoffset 900ms linear;
		}
		.cc-header-right { display: flex; align-items: center; gap: 6px; }
		.cc-collapsed-summary { display: none; font-size: 11px; color: var(--cc-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.cc-mode-collapsed .cc-collapsed-summary { display: inline-block; }
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
		.cc-icon-btn:hover { background: var(--cc-bar-bg); color: var(--cc-text); }
		.cc-chevron { width: 12px; height: 12px; transition: transform 200ms ease; }
		.cc-mode-collapsed .cc-chevron { transform: rotate(-90deg); }
		.cc-rows { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
		.cc-mode-collapsed .cc-rows { display: none; }
		.cc-row { display: flex; flex-direction: column; gap: 4px; }
		.cc-row-meta { display: flex; align-items: baseline; justify-content: space-between; font-size: 11px; }
		.cc-row-label { font-weight: 500; color: var(--cc-text); }
		.cc-row-stat { display: flex; align-items: baseline; gap: 6px; color: var(--cc-text-muted); }
		.cc-val-main { font-weight: 500; color: var(--cc-text); }
		.cc-val-reset { font-size: 10px; }
		.cc-val-pct { font-weight: 600; min-width: 32px; text-align: right; }
		.cc-bar-track { position: relative; height: 6px; background: var(--cc-bar-bg); border-radius: 3px; overflow: hidden; width: 100%; }
		.cc-bar-fill { height: 100%; width: 0%; border-radius: 3px; background: #10b981; transition: width 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 300ms ease; }
		.cc-high-utilization .cc-bar-fill { box-shadow: 0 0 8px currentColor; animation: cc-pulse 2s infinite ease-in-out; }
		@keyframes cc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.8; } }
		.cc-bar-marker { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--cc-marker); pointer-events: none; transform: translateX(-50%); z-index: 2; }
		.cc-bar-marker.cc-hidden { display: none; }
		.cc-unavailable-banner { display: none; align-items: center; justify-content: space-between; padding: 4px 0; font-size: 11px; color: #e11d48; }
		.cc-state-unavailable .cc-unavailable-banner { display: flex; }
		.cc-retry-btn { background: none; border: 1px solid currentColor; border-radius: 4px; padding: 1px 6px; color: inherit; font-size: 10px; cursor: pointer; }
		.cc-retry-btn:hover { background: rgba(225, 29, 72, 0.1); }
		@media (prefers-reduced-motion: reduce) {
			.cc-bar-fill, .cc-cache-ring-fill, .cc-chevron, .cc-meter-card { transition: none !important; animation: none !important; }
		}
	`;

	class CounterUI {
		constructor({ onUsageRefresh } = {}) {
			this.onUsageRefresh = onUsageRefresh || null;
			this.rootElement = null;
			this.shadowRoot = null;
			this.isFloating = false;
			this.isCollapsed = localStorage.getItem('cc_collapsed') === 'true';
			this.metrics = {
				context: { tokens: 0, pct: 0, formatted: '~0 tokens' },
				session: { pct: 0, resetsAt: null, windowStart: null },
				weekly: { pct: 0, resetsAt: null, windowStart: null },
				cachedUntil: null,
				isPendingCache: false,
				unavailableReason: null
			};
			this.domElements = {};
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

			this.domElements.cachePill = this.shadowRoot.getElementById('cc-cache-pill');
			this.domElements.cacheRingFill = this.shadowRoot.getElementById('cc-cache-fill');
			this.domElements.cacheText = this.shadowRoot.getElementById('cc-cache-text');
			this.domElements.summary = this.shadowRoot.getElementById('cc-summary');
			this.domElements.collapseBtn = this.shadowRoot.getElementById('cc-collapse-btn');
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

			this.domElements.collapseBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.isCollapsed = !this.isCollapsed;
				localStorage.setItem('cc_collapsed', String(this.isCollapsed));
				card.classList.toggle('cc-mode-collapsed', this.isCollapsed);
				card.classList.toggle('cc-mode-expanded', !this.isCollapsed);
			});

			this.domElements.retryBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.onUsageRefresh) this.onUsageRefresh();
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
			if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		}

		setFloating(floating) {
			this.isFloating = floating;
			if (this.domElements.card) this.domElements.card.classList.toggle('cc-meter-card--floating', floating);
		}

		attachTo(anchorElement, asFloating = false) {
			this.initialize();
			this.setFloating(asFloating);

			if (asFloating) {
				if (!document.body.contains(this.rootElement)) document.body.appendChild(this.rootElement);
				return;
			}

			if (!anchorElement) return;
			if (this.rootElement.parentElement !== anchorElement.parentElement || this.rootElement.previousElementSibling !== anchorElement) {
				anchorElement.after(this.rootElement);
			}
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

			this.metrics.context = { tokens, pct, formatted: `~${tokens.toLocaleString()} / 200k` };
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

			if (session && typeof session.utilization === 'number') {
				const pct = Math.max(0, Math.min(100, session.utilization));
				const resetsAt = session.resets_at ? Date.parse(session.resets_at) : null;
				const windowStart = resetsAt ? resetsAt - 5 * 60 * 60 * 1000 : null;

				this.metrics.session = { pct, resetsAt, windowStart };
				if (this.domElements.sessPct) {
					this.domElements.sessPct.textContent = `${pct.toFixed(1)}%`;
					this.domElements.sessBar.style.width = `${pct}%`;
					this.domElements.sessBar.style.backgroundColor = getColorForPct(pct);
					this.domElements.sessBar.parentElement.setAttribute('aria-valuenow', pct.toFixed(1));
					const row = this.shadowRoot.getElementById('cc-row-session');
					if (row) row.classList.toggle('cc-high-utilization', pct >= 90);
				}
			}

			if (weekly && typeof weekly.utilization === 'number') {
				const pct = Math.max(0, Math.min(100, weekly.utilization));
				const resetsAt = weekly.resets_at ? Date.parse(weekly.resets_at) : null;
				const windowStart = resetsAt ? resetsAt - 7 * 24 * 60 * 60 * 1000 : null;

				this.metrics.weekly = { pct, resetsAt, windowStart };
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
			if (this.metrics.cachedUntil && this.metrics.cachedUntil > now) {
				const secondsLeft = Math.max(0, Math.ceil((this.metrics.cachedUntil - now) / 1000));
				if (this.domElements.cachePill) {
					this.domElements.cachePill.classList.remove('cc-hidden');
					this.domElements.cacheText.textContent = `cached ${formatSeconds(secondsLeft)}`;
					const totalWindow = CC.CONST.CACHE_WINDOW_MS / 1000;
					const fraction = Math.max(0, Math.min(1, secondsLeft / totalWindow));
					const circumference = 2 * Math.PI * 6;
					const offset = circumference * (1 - fraction);
					if (this.domElements.cacheRingFill) this.domElements.cacheRingFill.style.strokeDashoffset = `${offset}`;
				}
			} else if (this.metrics.cachedUntil && this.metrics.cachedUntil <= now) {
				this.metrics.cachedUntil = null;
				if (!this.metrics.isPendingCache && this.domElements.cachePill) this.domElements.cachePill.classList.add('cc-hidden');
			}

			if (this.metrics.session.resetsAt && this.domElements.sessReset) {
				this.domElements.sessReset.textContent = `resets in ${formatResetCountdown(this.metrics.session.resetsAt)}`;
				if (this.domElements.sessMarker && this.metrics.session.windowStart) {
					const total = this.metrics.session.resetsAt - this.metrics.session.windowStart;
					const elapsed = Math.max(0, Math.min(total, now - this.metrics.session.windowStart));
					const ratio = total > 0 ? elapsed / total : 0;
					this.domElements.sessMarker.classList.remove('cc-hidden');
					this.domElements.sessMarker.style.left = `${(ratio * 100).toFixed(1)}%`;
				}
			}

			if (this.metrics.weekly.resetsAt && this.domElements.weekReset) {
				this.domElements.weekReset.textContent = `resets in ${formatResetCountdown(this.metrics.weekly.resetsAt)}`;
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

	// ==========================================
	// Main Controller Logic
	// ==========================================
	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?#]+)/);
		return match ? match[1] : null;
	}

	function getOrgIdFromCookie() {
		try {
			const cookies = document.cookie.split(';');
			for (const item of cookies) {
				const trimmed = item.trim();
				if (trimmed.startsWith('lastActiveOrg=')) {
					const val = trimmed.slice('lastActiveOrg='.length);
					return decodeURIComponent(val.replace(/^["']|["']$/g, ''));
				}
			}
		} catch {
			// ignore
		}
		return null;
	}

	function normalizeUtilization(val) {
		if (typeof val !== 'number' || !Number.isFinite(val)) return null;
		const num = val <= 1 && val > 0 ? val * 100 : val;
		return Math.max(0, Math.min(100, num));
	}

	function normalizeResetsAt(val) {
		if (!val) return null;
		if (typeof val === 'string') return val;
		if (typeof val === 'number' && Number.isFinite(val)) {
			const ms = val < 1e11 ? val * 1000 : val;
			return new Date(ms).toISOString();
		}
		return null;
	}

	function normalizeWindow(w, hours) {
		if (!w || typeof w !== 'object') return null;
		const utilization = normalizeUtilization(w.utilization ?? w.percent ?? w.pct ?? w.usage);
		if (utilization === null) return null;
		const resets_at = normalizeResetsAt(w.resets_at ?? w.reset_at ?? w.resetsAt);
		return { utilization, resets_at, window_hours: hours };
	}

	function parseUsagePayload(raw) {
		if (!raw || typeof raw !== 'object') return null;
		const windows = raw.windows || raw;
		const fiveHour =
			normalizeWindow(windows.five_hour, 5) ||
			normalizeWindow(windows['5h'], 5) ||
			normalizeWindow(raw.five_hour, 5) ||
			normalizeWindow(raw['5h'], 5);
		const sevenDay =
			normalizeWindow(windows.seven_day, 24 * 7) ||
			normalizeWindow(windows['7d'], 24 * 7) ||
			normalizeWindow(raw.seven_day, 24 * 7) ||
			normalizeWindow(raw['7d'], 24 * 7);

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay };
	}

	let currentConversationId = null;
	let currentOrgId = null;
	let usageState = null;
	let usageResetMs = { five_hour: null, seven_day: null };
	let lastUsageUpdateMs = 0;
	let usageFetchInFlight = false;

	const ui = new CC.ui.CounterUI({
		onUsageRefresh: async () => {
			await refreshUsage();
		}
	});

	function applyUsageUpdate(parsed) {
		if (!parsed) return;
		usageState = parsed;
		lastUsageUpdateMs = Date.now();
		usageResetMs.five_hour = parsed.five_hour?.resets_at ? Date.parse(parsed.five_hour.resets_at) : null;
		usageResetMs.seven_day = parsed.seven_day?.resets_at ? Date.parse(parsed.seven_day.resets_at) : null;
		ui.setUsage(parsed);
	}

	async function requestUsage(orgId) {
		const fetchFn = CC._ccInternal.originalFetch || window.fetch;
		const res = await fetchFn(`https://claude.ai/api/organizations/${orgId}/usage`, {
			method: 'GET',
			credentials: 'include'
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	}

	async function requestConversation(orgId, conversationId) {
		const fetchFn = CC._ccInternal.originalFetch || window.fetch;
		const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;
		const res = await fetchFn(url, { method: 'GET', credentials: 'include' });
		if (!res.ok) {
			const fallbackUrl = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}`;
			const res2 = await fetchFn(fallbackUrl, { method: 'GET', credentials: 'include' });
			if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
			return await res2.json();
		}
		return await res.json();
	}

	async function refreshUsage() {
		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) {
			ui.setUnavailable('Sign in to view usage');
			return;
		}
		currentOrgId = orgId;

		if (usageFetchInFlight) return;
		usageFetchInFlight = true;

		try {
			const raw = await requestUsage(orgId);
			const parsed = parseUsagePayload(raw);
			if (parsed) applyUsageUpdate(parsed);
			else ui.setUnavailable('Unrecognized usage data');
		} catch {
			ui.setUnavailable('Usage currently unavailable');
		} finally {
			usageFetchInFlight = false;
		}
	}

	async function refreshConversation() {
		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) return;
		currentOrgId = orgId;

		try {
			const data = await requestConversation(orgId, currentConversationId);
			const metrics = await CC.tokens.computeConversationMetrics(data);
			ui.setConversationMetrics({ totalTokens: metrics.totalTokens, cachedUntil: metrics.cachedUntil });
		} catch {
			// ignore
		}
	}

	// Internal Interception Hooks
	CC._ccInternal.onGenerationStart = () => {
		if (!currentConversationId) return;
		ui.setPendingCache(true);
	};

	CC._ccInternal.onStreamCompleted = () => {
		setTimeout(() => refreshUsage(), 1000);
	};

	CC._ccInternal.onMessageLimit = (messageLimit) => {
		const parsed = parseUsagePayload(messageLimit);
		if (parsed) applyUsageUpdate(parsed);
	};

	CC._ccInternal.onUsageData = ({ orgId, data }) => {
		if (orgId) currentOrgId = orgId;
		const parsed = parseUsagePayload(data);
		if (parsed) applyUsageUpdate(parsed);
	};

	CC._ccInternal.onConversationData = async ({ orgId, conversationId, data }) => {
		if (!conversationId || conversationId !== currentConversationId) return;
		if (orgId) currentOrgId = orgId;
		if (!data) return;
		try {
			const metrics = await CC.tokens.computeConversationMetrics(data);
			ui.setConversationMetrics({ totalTokens: metrics.totalTokens, cachedUntil: metrics.cachedUntil });
		} catch {
			// ignore
		}
	};

	// Mounting
	let fallbackTimer = null;

	function findBestAnchor() {
		for (const candidate of CC.SELECTORS.INPUT_ANCHORS) {
			try {
				const el = document.querySelector(candidate.selector);
				if (el && el.isConnected) {
					const container = el.closest('[data-testid="chat-input-controls"]') ||
						el.closest('form') ||
						el.closest('fieldset') ||
						el.parentElement;
					return container || el;
				}
			} catch {
				// ignore
			}
		}
		return null;
	}

	function attemptMount() {
		const anchor = findBestAnchor();
		if (anchor) {
			if (fallbackTimer) {
				clearTimeout(fallbackTimer);
				fallbackTimer = null;
			}
			ui.attachTo(anchor, false);
		} else {
			if (!fallbackTimer && !ui.isFloating) {
				fallbackTimer = setTimeout(() => {
					ui.attachTo(null, true);
					fallbackTimer = null;
				}, CC.CONST.FALLBACK_MOUNT_TIMEOUT_MS);
			}
		}
	}

	let domDebounce = null;
	const observer = new MutationObserver(() => {
		if (domDebounce) clearTimeout(domDebounce);
		domDebounce = setTimeout(() => {
			if (!ui.rootElement || !ui.rootElement.isConnected || (ui.isFloating && findBestAnchor())) {
				attemptMount();
			}
		}, 150);
	});
	observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

	let lastKnownPath = window.location.pathname;

	async function handleUrlChange() {
		currentConversationId = getConversationId();
		const pathChanged = window.location.pathname !== lastKnownPath;
		lastKnownPath = window.location.pathname;

		attemptMount();

		if (!currentConversationId) {
			ui.setConversationMetrics();
		} else {
			await refreshConversation();
		}

		if (!usageState || pathChanged) {
			await refreshUsage();
		}
	}

	CC._ccInternal.onUrlChange = handleUrlChange;

	setInterval(() => {
		if (window.location.pathname !== lastKnownPath) handleUrlChange();
	}, 500);

	document.addEventListener('click', (e) => {
		if (!currentConversationId) return;
		const btn = e.target.closest(CC.SELECTORS.BRANCH_BUTTONS);
		if (!btn) return;
		setTimeout(() => refreshConversation(), 300);
	});

	function tick() {
		ui.tick();
		const now = Date.now();
		if (!document.hidden && now - lastUsageUpdateMs > CC.CONST.SLOW_USAGE_REFRESH_INTERVAL_MS) {
			refreshUsage();
		}
	}

	setInterval(tick, 1000);

	// Start
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', handleUrlChange, { once: true });
	} else {
		handleUrlChange();
	}
})();
