// ==UserScript==
// @name         Usage Meter for Claude
// @namespace    https://github.com/she-llac/claude-counter
// @version      0.5.2-userscript
// @description  Shows ~token count, cache timer, and native session/weekly usage bars on claude.ai in a draggable fixed panel.
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

	const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	function isValidOrgId(id) {
		return typeof id === 'string' && UUID_REGEX.test(id) && id.toLowerCase() !== 'discoverable';
	}

	function normalizeUtilization(val) {
		if (typeof val !== 'number' || !Number.isFinite(val)) return null;
		const num = (val > 0 && val <= 1) ? val * 100 : val;
		return Math.max(0, Math.min(100, Math.round(num * 10) / 10));
	}

	function normalizeResetsAt(val) {
		if (!val) return null;
		if (typeof val === 'string') {
			const parsed = Date.parse(val);
			return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
		}
		if (typeof val === 'number' && Number.isFinite(val)) {
			const ms = val < 1e11 ? val * 1000 : val;
			return new Date(ms).toISOString();
		}
		return null;
	}

	function extractWindow(w) {
		if (!w || typeof w !== 'object') return null;
		const pct = normalizeUtilization(w.utilization ?? w.percent ?? w.pct ?? w.usage);
		const resetsAt = normalizeResetsAt(w.resets_at ?? w.reset_at ?? w.resetsAt);
		if (pct === null && resetsAt === null) return null;
		return { pct, resetsAt };
	}

	function normalizeUsagePayload(payload, sseFallback = null, errorContext = null) {
		if (errorContext) {
			const status = errorContext.status || 0;
			let reason = 'Usage currently unavailable';
			if (status === 401 || status === 403) reason = 'Session expired';
			else if (status === 429) reason = 'Rate limited (backing off)';
			else if (status >= 500) reason = 'Claude service error';
			else if (errorContext.message) reason = errorContext.message;
			return {
				session: { pct: null, resetsAt: null },
				weekly: { pct: null, resetsAt: null },
				extras: [],
				state: 'error',
				errorReason: reason
			};
		}

		if (payload === null || payload === undefined || typeof payload !== 'object') {
			return {
				session: { pct: null, resetsAt: null },
				weekly: { pct: null, resetsAt: null },
				extras: [],
				state: 'error',
				errorReason: 'Malformed usage response'
			};
		}

		const rawWindows = payload.windows || payload;
		let session = extractWindow(rawWindows.five_hour || rawWindows['5h'] || payload.five_hour || payload['5h']);
		let weekly = extractWindow(rawWindows.seven_day || rawWindows['7d'] || payload.seven_day || payload['7d']);

		const extras = [];
		if (Array.isArray(payload.limits)) {
			for (const item of payload.limits) {
				const w = extractWindow(item);
				if (w && (w.pct !== null || w.resetsAt !== null)) {
					extras.push({ label: item.name || item.label || 'Limit', pct: w.pct, resetsAt: w.resetsAt });
				}
			}
		}

		if (!session && !weekly && sseFallback && typeof sseFallback === 'object') {
			const sseWindows = sseFallback.windows || sseFallback;
			session = extractWindow(sseWindows['5h'] || sseWindows.five_hour);
			weekly = extractWindow(sseWindows['7d'] || sseWindows.seven_day);
		}

		const hasSessionData = session && typeof session.pct === 'number';
		const hasWeeklyData = weekly && typeof weekly.pct === 'number';
		const hasExtrasData = extras.some((e) => typeof e.pct === 'number');

		const state = (hasSessionData || hasWeeklyData || hasExtrasData) ? 'ok' : 'empty';

		return {
			session: session || { pct: null, resetsAt: null },
			weekly: weekly || { pct: null, resetsAt: null },
			extras,
			state,
			errorReason: null
		};
	}

	CC.normalize = { isValidOrgId, normalizeUsagePayload };

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
		const match = url.match(/\/api\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/chat_conversations\/([^/?#]+)/i);
		return match ? { orgId: match[1], conversationId: match[2] } : null;
	}

	function getOrgMeta(url) {
		const match = url.match(/\/api\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
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

			if (url) {
				const detectedOrg = getOrgMeta(url);
				if (detectedOrg && isValidOrgId(detectedOrg)) {
					CC._ccInternal.onOrgDetected?.(detectedOrg);
				}
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
					if (method === 'GET' && url.includes('/chat_conversations/')) {
						const meta = getConversationMeta(url);
						if (meta) handleConversationResponse(meta, response, url);
					} else if (url.includes('/usage') && url.includes('/api/organizations/')) {
						const orgId = getOrgMeta(url);
						if (orgId && isValidOrgId(orgId)) handleUsageResponse(orgId, response);
					}
				}
			} catch {
				// ignore
			}

			return response;
		};
	}

	async function handleConversationResponse({ orgId, conversationId }, response, requestUrl = '') {
		try {
			const cloned = response.clone();
			const data = await cloned.json();
			if (!data || typeof data !== 'object') return;
			if (!Array.isArray(data.chat_messages)) return;
			if (data.chat_messages.length === 0 && !requestUrl.includes('tree=') && !data.current_leaf_message_uuid) {
				return;
			}
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
		if (!conversation || typeof conversation !== 'object' || !Array.isArray(conversation.chat_messages)) {
			return {
				trunkMessageCount: 0,
				totalTokens: null,
				lastAssistantMs: null,
				cachedUntil: null,
				isLoaded: false
			};
		}

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

		const cachedUntil = lastAssistantMs ? lastAssistantMs + (5 * 60 * 1000) : null;
		return { trunkMessageCount: trunk.length, totalTokens, lastAssistantMs, cachedUntil, isLoaded: true };
	}

	function formatTokens(tokens) {
		if (typeof tokens !== 'number' || isNaN(tokens) || tokens < 0) return '—';
		if (tokens >= 1000) {
			return `~${Math.round(tokens / 1000)}k`;
		}
		return `~${tokens}`;
	}

	function formatContextUtilization(tokens, limit = 200000) {
		if (typeof tokens !== 'number' || isNaN(tokens) || tokens < 0) {
			return {
				formatted: '— / 200k',
				percentText: '—',
				barPercent: 0,
				isOverLimit: false
			};
		}

		const formattedTokens = formatTokens(tokens);
		const formatted = `${formattedTokens} / 200k`;

		if (tokens > limit) {
			return {
				formatted,
				percentText: '>100%',
				barPercent: 100,
				isOverLimit: true
			};
		}

		const rawPct = (tokens / limit) * 100;
		const barPercent = Math.max(0, Math.min(100, rawPct));
		const percentText = tokens === 0 ? '0%' : `${rawPct.toFixed(1)}%`;

		return {
			formatted,
			percentText,
			barPercent,
			isOverLimit: false
		};
	}

	CC.tokens = { computeConversationMetrics, countTokens, formatTokens, formatContextUtilization };

	// ==========================================
	// UI Component (Fixed Draggable Shadow DOM Panel)
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

	const PRESETS = {
		default: { name: 'Default', low: '#10b981', mid: '#f59e0b', high: '#ef4444', accent: '#3b82f6' },
		ocean: { name: 'Ocean', low: '#06b6d4', mid: '#3b82f6', high: '#6366f1', accent: '#0284c7' },
		sunset: { name: 'Sunset', low: '#f43f5e', mid: '#d946ef', high: '#8b5cf6', accent: '#ec4899' },
		mono: { name: 'Mono', low: '#9ca3af', mid: '#6b7280', high: '#374151', accent: '#4b5563' },
		highContrast: { name: 'High-contrast', low: '#00e676', mid: '#ffea00', high: '#ff1744', accent: '#00e5ff' }
	};

	function parseHexColor(hex) {
		if (!hex || typeof hex !== 'string') return null;
		let clean = hex.replace('#', '').trim();
		if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
		if (clean.length !== 6) return null;
		return { r: parseInt(clean.slice(0, 2), 16), g: parseInt(clean.slice(2, 4), 16), b: parseInt(clean.slice(4, 6), 16) };
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
		:host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px; line-height: 1.4; box-sizing: border-box; user-select: none; z-index: 2147483647; position: fixed; }
		*, *::before, *::after { box-sizing: border-box; }
		.cc-panel { position: fixed; background: var(--cc-bg, rgba(30, 29, 28, 0.92)); border: 1px solid var(--cc-border, rgba(255, 255, 255, 0.12)); border-radius: 8px; color: var(--cc-text, #f0eee9); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); font-feature-settings: "tnum"; font-variant-numeric: tabular-nums; width: 290px; max-width: calc(100vw - 20px); overflow: hidden; }
		.cc-panel--pill { width: auto; min-width: 130px; border-radius: 9999px; padding: 4px 10px; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2); }
		.cc-theme-light { --cc-border: rgba(0, 0, 0, 0.1); --cc-text: #1f1e1d; --cc-text-muted: #6b6966; --cc-bar-bg: rgba(0, 0, 0, 0.07); --cc-marker: rgba(0, 0, 0, 0.4); }
		.cc-theme-dark { --cc-border: rgba(255, 255, 255, 0.12); --cc-text: #f0eee9; --cc-text-muted: #9c9a95; --cc-bar-bg: rgba(255, 255, 255, 0.08); --cc-marker: rgba(255, 255, 255, 0.5); }
		.cc-header { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; cursor: grab; }
		.cc-header:active { cursor: grabbing; }
		.cc-header:hover { background: rgba(128, 128, 128, 0.06); }
		.cc-header-left { display: flex; align-items: center; gap: 6px; }
		.cc-title { font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--cc-text-muted); }
		.cc-header-right { display: flex; align-items: center; gap: 3px; }
		.cc-btn { background: none; border: none; padding: 3px; color: var(--cc-text-muted); cursor: pointer; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; }
		.cc-btn:hover { background: rgba(128, 128, 128, 0.14); color: var(--cc-text); }
		.cc-cache-pill { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 12px; font-size: 10px; font-weight: 500; background: rgba(16, 185, 129, 0.14); color: #10b981; }
		.cc-cache-pill.cc-hidden { display: none; }
		.cc-cache-ring { display: block; transform: rotate(-90deg); }
		.cc-cache-ring-bg { fill: none; stroke: rgba(16, 185, 129, 0.25); stroke-width: 2; }
		.cc-cache-ring-fill { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 37.7; stroke-dashoffset: 0; }
		.cc-body { padding: 4px 10px 10px 10px; display: flex; flex-direction: column; gap: 7px; }
		.cc-panel--pill .cc-body, .cc-panel--pill .cc-header { display: none; }
		.cc-pill-content { display: none; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; color: var(--cc-text); white-space: nowrap; }
		.cc-panel--pill .cc-pill-content { display: inline-flex; }
		.cc-row { display: flex; flex-direction: column; gap: 3px; }
		.cc-row.cc-hidden { display: none; }
		.cc-row-meta { display: flex; align-items: baseline; justify-content: space-between; font-size: 11px; }
		.cc-row-label { font-weight: 500; color: var(--cc-text); }
		.cc-row-stat { display: flex; align-items: baseline; gap: 6px; color: var(--cc-text-muted); }
		.cc-val-main { font-weight: 500; color: var(--cc-text); }
		.cc-val-pct { font-weight: 600; min-width: 32px; text-align: right; }
		.cc-bar-track { position: relative; height: 6px; background: var(--cc-bar-bg); border-radius: 4px; overflow: hidden; width: 100%; }
		.cc-bar-fill { height: 100%; width: 0%; border-radius: 4px; background: var(--cc-color-low, #10b981); transition: width 300ms ease, background-color 300ms ease; }
		.cc-bar-marker { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--cc-marker); transform: translateX(-50%); z-index: 2; }
		.cc-bar-marker.cc-hidden { display: none; }
		.cc-empty-notice { display: none; align-items: center; justify-content: center; text-align: center; padding: 7px 10px; background: rgba(128, 128, 128, 0.08); border-radius: 6px; font-size: 11px; color: var(--cc-text-muted, #9ca3af); line-height: 1.35; }
		.cc-state-empty .cc-empty-notice { display: flex; }
		.cc-state-empty #cc-row-session, .cc-state-empty #cc-row-weekly { display: none !important; }
		.cc-error-notice { display: none; align-items: center; justify-content: space-between; padding: 6px 8px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 4px; font-size: 11px; color: #ef4444; }
		.cc-state-error .cc-error-notice { display: flex; }
		.cc-retry-btn { background: none; border: 1px solid currentColor; border-radius: 3px; padding: 1px 6px; color: inherit; font-size: 10px; cursor: pointer; }
	`;

	class CounterUI {
		constructor({ onUsageRefresh } = {}) {
			this.onUsageRefresh = onUsageRefresh || null;
			this.rootElement = null;
			this.shadowRoot = null;
			this.panel = null;
			this.isPill = localStorage.getItem('cc_pill') === 'true';
			this.pos = null;
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

		initialize() {
			if (this.rootElement) return;
			this.rootElement = document.createElement('div');
			this.rootElement.id = 'cc-usage-meter-root';
			this.shadowRoot = this.rootElement.attachShadow({ mode: 'open' });

			const styleTag = document.createElement('style');
			styleTag.textContent = UI_STYLES;
			this.shadowRoot.appendChild(styleTag);

			const panel = document.createElement('div');
			panel.className = `cc-panel ${this.isPill ? 'cc-panel--pill' : ''}`;
			this.panel = panel;

			panel.innerHTML = `
				<div class="cc-pill-content" id="cc-pill-content" title="Click to expand">
					<span style="color: var(--cc-accent, #3b82f6);">⚡</span>
					<span id="cc-pill-summary">Usage</span>
				</div>
				<div class="cc-header" id="cc-drag-handle">
					<div class="cc-header-left">
						<span class="cc-title">Usage Meter</span>
						<div class="cc-cache-pill cc-hidden" id="cc-cache-pill">
							<svg class="cc-cache-ring" width="14" height="14" viewBox="0 0 16 16">
								<circle class="cc-cache-ring-bg" cx="8" cy="8" r="6" />
								<circle class="cc-cache-ring-fill" id="cc-cache-fill" cx="8" cy="8" r="6" />
							</svg>
							<span id="cc-cache-text">cached</span>
						</div>
					</div>
					<div class="cc-header-right">
						<button class="cc-btn" id="cc-pill-btn" title="Minimize">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
						</button>
					</div>
				</div>
				<div class="cc-body">
					<div class="cc-error-notice" id="cc-error-notice">
						<span id="cc-error-msg">Usage currently unavailable</span>
						<button class="cc-retry-btn" id="cc-retry-btn">Retry</button>
					</div>
					<div class="cc-row" id="cc-row-context">
						<div class="cc-row-meta">
							<span class="cc-row-label">Context</span>
							<div class="cc-row-stat">
								<span class="cc-val-main" id="cc-ctx-main">— / 200k</span>
								<span class="cc-val-pct" id="cc-ctx-pct">—</span>
							</div>
						</div>
						<div class="cc-bar-track" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
							<div class="cc-bar-fill" id="cc-ctx-bar"></div>
						</div>
					</div>
					<div class="cc-empty-notice" id="cc-empty-notice">
						<span>Session &amp; weekly limits not provided on this plan</span>
					</div>
					<div class="cc-row" id="cc-row-session">
						<div class="cc-row-meta">
							<span class="cc-row-label">Session 5h</span>
							<div class="cc-row-stat">
								<span class="cc-val-reset" id="cc-sess-reset"></span>
								<span class="cc-val-pct" id="cc-sess-pct">n/a</span>
							</div>
						</div>
						<div class="cc-bar-track" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
							<div class="cc-bar-fill" id="cc-sess-bar"></div>
							<div class="cc-bar-marker cc-hidden" id="cc-sess-marker"></div>
						</div>
					</div>
					<div class="cc-row" id="cc-row-weekly">
						<div class="cc-row-meta">
							<span class="cc-row-label">Weekly 7d</span>
							<div class="cc-row-stat">
								<span class="cc-val-reset" id="cc-week-reset"></span>
								<span class="cc-val-pct" id="cc-week-pct">n/a</span>
							</div>
						</div>
						<div class="cc-bar-track" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
							<div class="cc-bar-fill" id="cc-week-bar"></div>
							<div class="cc-bar-marker cc-hidden" id="cc-week-marker"></div>
						</div>
					</div>
				</div>
			`;

			this.shadowRoot.appendChild(panel);

			this.dom.pillContent = this.shadowRoot.getElementById('cc-pill-content');
			this.dom.pillSummary = this.shadowRoot.getElementById('cc-pill-summary');
			this.dom.pillBtn = this.shadowRoot.getElementById('cc-pill-btn');
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

			const togglePill = () => {
				this.isPill = !this.isPill;
				localStorage.setItem('cc_pill', String(this.isPill));
				this.panel.classList.toggle('cc-panel--pill', this.isPill);
			};

			this.dom.pillBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePill(); });
			this.dom.pillContent.addEventListener('click', (e) => { e.stopPropagation(); togglePill(); });
			this.dom.retryBtn.addEventListener('click', (e) => { e.stopPropagation(); if (this.onUsageRefresh) this.onUsageRefresh(); });

			// Default position bottom-right
			this.panel.style.right = '24px';
			this.panel.style.bottom = '24px';

			this.updateTheme();
			this.renderAll();
		}

		updateTheme() {
			const root = document.documentElement;
			const isDark = root.dataset?.mode === 'dark' || root.classList.contains('dark') || document.body?.classList.contains('dark');
			if (this.panel) {
				this.panel.classList.toggle('cc-theme-dark', isDark);
				this.panel.classList.toggle('cc-theme-light', !isDark);
			}
		}

		attach() {
			this.initialize();
			const target = document.body || document.documentElement;
			if (target && !target.contains(this.rootElement)) {
				target.appendChild(this.rootElement);
			}
		}

		setConversationActive(hasConv) {
			this.metrics.hasConversation = !!hasConv;
			if (this.dom.rowCtx) {
				this.dom.rowCtx.classList.toggle('cc-hidden', !this.metrics.hasConversation);
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
				this.dom.ctxBar.style.backgroundColor = 'var(--cc-color-low, #10b981)';
			}
			this.updateSummary();
		}

		setConversationMetrics({ totalTokens, cachedUntil, isLoaded = true } = {}) {
			if (!isLoaded || typeof totalTokens !== 'number' || isNaN(totalTokens)) {
				this.setConversationLoading();
				return;
			}

			const tokens = Math.max(0, Math.round(totalTokens));
			const util = CC.tokens?.formatContextUtilization
				? CC.tokens.formatContextUtilization(tokens, 200000)
				: {
					formatted: tokens > 200000 ? `~${Math.round(tokens / 1000)}k / 200k` : `~${tokens >= 1000 ? Math.round(tokens / 1000) + 'k' : tokens} / 200k`,
					percentText: tokens > 200000 ? '>100%' : (tokens === 0 ? '0%' : `${((tokens / 200000) * 100).toFixed(1)}%`),
					barPercent: Math.max(0, Math.min(100, (tokens / 200000) * 100)),
					isOverLimit: tokens > 200000
				};

			this.metrics.context = {
				isLoaded: true,
				tokens,
				pct: util.barPercent,
				formatted: util.formatted
			};
			this.metrics.cachedUntil = cachedUntil;

			if (this.dom.ctxMain) {
				this.dom.ctxMain.textContent = util.formatted;
				this.dom.ctxPct.textContent = util.percentText;
				this.dom.ctxBar.style.width = `${util.barPercent}%`;
				this.dom.ctxBar.style.backgroundColor = util.isOverLimit ? '#ef4444' : 'var(--cc-color-low, #10b981)';
			}
			this.updateSummary();
			this.tick();
		}

		setNormalizedUsage(norm) {
			this.currentNormalizedState = norm;
			this.metrics.state = norm.state;
			this.metrics.errorReason = norm.errorReason;

			this.panel.classList.toggle('cc-state-empty', norm.state === 'empty');
			this.panel.classList.toggle('cc-state-error', norm.state === 'error');

			if (norm.state === 'error' && this.dom.errorMsg) {
				this.dom.errorMsg.textContent = norm.errorReason || 'Usage currently unavailable';
			}

			if (norm.session && typeof norm.session.pct === 'number') {
				this.metrics.session = {
					pct: norm.session.pct,
					resetsAt: norm.session.resetsAt ? Date.parse(norm.session.resetsAt) : null,
					windowStart: norm.session.resetsAt ? Date.parse(norm.session.resetsAt) - 5 * 3600000 : null
				};
				if (this.dom.sessPct) {
					this.dom.sessPct.textContent = `${norm.session.pct.toFixed(1)}%`;
					this.dom.sessBar.style.width = `${norm.session.pct}%`;
				}
			} else {
				this.metrics.session = { pct: null, resetsAt: null, windowStart: null };
				if (this.dom.sessPct) {
					this.dom.sessPct.textContent = 'n/a';
					this.dom.sessBar.style.width = '0%';
				}
				if (this.dom.sessReset) this.dom.sessReset.textContent = '';
			}

			if (norm.weekly && typeof norm.weekly.pct === 'number') {
				this.metrics.weekly = {
					pct: norm.weekly.pct,
					resetsAt: norm.weekly.resetsAt ? Date.parse(norm.weekly.resetsAt) : null,
					windowStart: norm.weekly.resetsAt ? Date.parse(norm.weekly.resetsAt) - 7 * 86400000 : null
				};
				if (this.dom.weekPct) {
					this.dom.weekPct.textContent = `${norm.weekly.pct.toFixed(1)}%`;
					this.dom.weekBar.style.width = `${norm.weekly.pct}%`;
				}
			} else {
				this.metrics.weekly = { pct: null, resetsAt: null, windowStart: null };
				if (this.dom.weekPct) {
					this.dom.weekPct.textContent = 'n/a';
					this.dom.weekBar.style.width = '0%';
				}
				if (this.dom.weekReset) this.dom.weekReset.textContent = '';
			}

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
			if (this.metrics.session.pct !== null) parts.push(`${this.metrics.session.pct.toFixed(0)}% 5h`);
			if (this.metrics.weekly.pct !== null) parts.push(`${this.metrics.weekly.pct.toFixed(0)}% 7d`);
			if (this.metrics.hasConversation && this.metrics.context.isLoaded && typeof this.metrics.context.tokens === 'number') {
				if (this.metrics.context.tokens >= 1000) {
					parts.push(`~${Math.round(this.metrics.context.tokens / 1000)}k`);
				} else {
					parts.push(`~${this.metrics.context.tokens}`);
				}
			}
			this.dom.pillSummary.textContent = parts.length > 0 ? parts.join(' · ') : (this.metrics.state === 'empty' ? 'Plan: Free' : 'Usage');
		}

		tick() {
			const now = Date.now();
			if (this.metrics.cachedUntil && this.metrics.cachedUntil > now) {
				const secondsLeft = Math.max(0, Math.ceil((this.metrics.cachedUntil - now) / 1000));
				if (this.dom.cachePill) {
					this.dom.cachePill.classList.remove('cc-hidden');
					this.dom.cacheText.textContent = `cached ${formatSeconds(secondsLeft)}`;
				}
			} else if (this.metrics.cachedUntil && this.metrics.cachedUntil <= now) {
				this.metrics.cachedUntil = null;
				if (!this.metrics.isPendingCache && this.dom.cachePill) this.dom.cachePill.classList.add('cc-hidden');
			}

			if (this.metrics.session.resetsAt && this.dom.sessReset) {
				this.dom.sessReset.textContent = `resets in ${formatResetCountdown(this.metrics.session.resetsAt)}`;
			}
			if (this.metrics.weekly.resetsAt && this.dom.weekReset) {
				this.dom.weekReset.textContent = `resets in ${formatResetCountdown(this.metrics.weekly.resetsAt)}`;
			}
		}
	}

	CC.ui = { CounterUI };

	// ==========================================
	// Main Controller Logic with Request Discipline
	// ==========================================
	let currentOrgId = null;
	let currentConversationId = null;
	let lastUsageFetchTime = 0;
	let usageInFlightPromise = null;
	let consecutiveErrors = 0;
	let lastRawPayload = null;
	let lastSseLimit = null;

	function getOrgIdFromCookie() {
		try {
			const cookies = document.cookie.split(';');
			for (const item of cookies) {
				const trimmed = item.trim();
				if (trimmed.startsWith('lastActiveOrg=')) {
					const val = decodeURIComponent(trimmed.slice('lastActiveOrg='.length).replace(/^["']|["']$/g, ''));
					if (isValidOrgId(val)) return val;
				}
			}
		} catch {
			// ignore
		}
		return null;
	}

	function resolveOrgId(candidate = null) {
		const cookieOrg = getOrgIdFromCookie();
		if (cookieOrg) {
			currentOrgId = cookieOrg;
			return currentOrgId;
		}
		if (candidate && isValidOrgId(candidate)) {
			currentOrgId = candidate;
			return currentOrgId;
		}
		return currentOrgId;
	}

	const ui = new CounterUI({
		onUsageRefresh: async () => {
			consecutiveErrors = 0;
			await refreshUsage({ force: true });
		}
	});

	async function refreshUsage({ force = false } = {}) {
		const orgId = resolveOrgId();
		if (!orgId) return;

		const now = Date.now();
		if (!force && (now - lastUsageFetchTime < 30000)) return;
		if (consecutiveErrors >= 3 && !force) return;

		if (usageInFlightPromise) return await usageInFlightPromise;

		usageInFlightPromise = (async () => {
			lastUsageFetchTime = Date.now();
			try {
				const res = await (CC._ccInternal.originalFetch || window.fetch)(`https://claude.ai/api/organizations/${orgId}/usage`, {
					method: 'GET',
					credentials: 'include'
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const raw = await res.json();
				lastRawPayload = raw;
				consecutiveErrors = 0;
				const norm = normalizeUsagePayload(raw, lastSseLimit);
				ui.setNormalizedUsage(norm);
			} catch (err) {
				consecutiveErrors++;
				const norm = normalizeUsagePayload(null, null, { message: err?.message });
				ui.setNormalizedUsage(norm);
			} finally {
				usageInFlightPromise = null;
			}
		})();

		return await usageInFlightPromise;
	}

	async function refreshConversation() {
		if (!currentConversationId) {
			ui.setConversationLoading();
			return;
		}
		const orgId = resolveOrgId();
		if (!orgId) return;

		try {
			const res = await (CC._ccInternal.originalFetch || window.fetch)(
				`https://claude.ai/api/organizations/${orgId}/chat_conversations/${currentConversationId}?tree=true&rendering_mode=messages&render_all_tools=true`,
				{ method: 'GET', credentials: 'include' }
			);
			if (res.ok) {
				const data = await res.json();
				if (data && typeof data === 'object' && Array.isArray(data.chat_messages)) {
					const metrics = await CC.tokens.computeConversationMetrics(data);
					ui.setConversationMetrics({
						totalTokens: metrics.totalTokens,
						cachedUntil: metrics.cachedUntil,
						isLoaded: metrics.isLoaded
					});
				}
			}
		} catch {
			// ignore
		}
	}

	CC._ccInternal.onOrgDetected = (orgId) => {
		if (isValidOrgId(orgId)) {
			resolveOrgId(orgId);
			if (currentConversationId && !ui.metrics.context.isLoaded) {
				refreshConversation();
			}
		}
	};

	CC._ccInternal.onGenerationStart = () => {
		if (!currentConversationId) return;
		ui.setPendingCache(true);
	};

	CC._ccInternal.onStreamCompleted = () => {
		setTimeout(() => {
			consecutiveErrors = 0;
			refreshUsage({ force: true });
			if (currentConversationId) {
				refreshConversation();
			}
		}, 1000);
	};

	CC._ccInternal.onMessageLimit = (messageLimit) => {
		lastSseLimit = messageLimit;
		const norm = normalizeUsagePayload(lastRawPayload, lastSseLimit);
		ui.setNormalizedUsage(norm);
	};

	CC._ccInternal.onUsageData = ({ orgId, data }) => {
		if (isValidOrgId(orgId)) resolveOrgId(orgId);
		lastRawPayload = data;
		const norm = normalizeUsagePayload(data, lastSseLimit);
		ui.setNormalizedUsage(norm);
	};

	CC._ccInternal.onConversationData = async ({ orgId, conversationId, data }) => {
		if (!conversationId || conversationId !== currentConversationId) return;
		if (isValidOrgId(orgId)) resolveOrgId(orgId);
		if (!data || typeof data !== 'object' || !Array.isArray(data.chat_messages)) return;
		try {
			const metrics = await CC.tokens.computeConversationMetrics(data);
			ui.setConversationMetrics({
				totalTokens: metrics.totalTokens,
				cachedUntil: metrics.cachedUntil,
				isLoaded: metrics.isLoaded
			});
		} catch {
			// ignore
		}
	};

	function ensureAttached() {
		const target = document.body || document.documentElement;
		if (target && !target.contains(ui.rootElement)) {
			ui.attach();
		}
	}

	ensureAttached();
	setInterval(ensureAttached, 1000);

	let lastPath = window.location.pathname;
	async function handleUrlChange() {
		const match = window.location.pathname.match(/\/chat\/([^/?#]+)/);
		const newConvId = match ? match[1] : null;
		const convChanged = newConvId !== currentConversationId;
		currentConversationId = newConvId;
		lastPath = window.location.pathname;

		ui.setConversationActive(!!currentConversationId);

		if (!currentConversationId) {
			ui.setConversationLoading();
		} else {
			if (convChanged) {
				ui.setConversationLoading();
			}
			await refreshConversation();
		}
		await refreshUsage();
	}

	CC._ccInternal.onUrlChange = handleUrlChange;
	setInterval(() => {
		if (window.location.pathname !== lastPath) handleUrlChange();
	}, 500);

	setInterval(() => {
		ui.tick();
		if (!document.hidden && Date.now() - lastUsageFetchTime > 300000) {
			refreshUsage();
		}
	}, 1000);

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', handleUrlChange, { once: true });
	} else {
		handleUrlChange();
	}
})();
