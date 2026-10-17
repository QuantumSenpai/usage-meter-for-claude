(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const ROOT_MESSAGE_ID = '00000000-0000-4000-8000-000000000000';

	function stableStringify(value) {
		const seen = new WeakSet();

		const normalize = (v) => {
			if (v === null || typeof v !== 'object') return v;
			if (seen.has(v)) return '[Circular]';
			seen.add(v);

			if (Array.isArray(v)) return v.map(normalize);

			const out = {};
			for (const key of Object.keys(v).sort()) {
				out[key] = normalize(v[key]);
			}
			return out;
		};

		try {
			return JSON.stringify(normalize(value));
		} catch {
			return '';
		}
	}

	function getTokenizer() {
		return globalThis.GPTTokenizer_o200k_base || null;
	}

	function countTokens(text) {
		if (!text) return 0;
		const tokenizer = getTokenizer();
		if (!tokenizer?.countTokens) {
			// Rough fallback if tokenizer not ready (~4 chars per token)
			return Math.ceil(text.length / 4);
		}
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
			// If no leaf specified, sort messages by created_at or take in order
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

	function isCountableContentItem(item) {
		if (!item || typeof item !== 'object') return false;
		if (typeof item.type !== 'string') return false;
		// Do not count internal thinking or media blobs directly
		if (item.type === 'thinking' || item.type === 'redacted_thinking') return false;
		if (item.type === 'image' || item.type === 'document') return false;
		return true;
	}

	function stringifyCountableContentItem(item) {
		if (!isCountableContentItem(item)) return '';

		if (item.type === 'text' && typeof item.text === 'string') return item.text;

		if (item.type === 'tool_use') {
			const minimal = {
				id: item.id,
				name: item.name,
				input: item.input
			};
			return stableStringify(minimal);
		}

		if (item.type === 'tool_result') {
			const minimal = {
				tool_use_id: item.tool_use_id,
				is_error: item.is_error,
				content: item.content
			};
			return stableStringify(minimal);
		}

		const minimal = {};
		if (typeof item.text === 'string') minimal.text = item.text;
		if (typeof item.title === 'string') minimal.title = item.title;
		if (typeof item.url === 'string') minimal.url = item.url;
		if (typeof item.content === 'string') minimal.content = item.content;
		if (Array.isArray(item.content)) minimal.content = item.content;
		if (Object.keys(minimal).length === 0) return '';
		return stableStringify(minimal);
	}

	function stringifyMessageCountables(message) {
		const parts = [];

		const content = Array.isArray(message?.content) ? message.content : [];
		for (const item of content) {
			const s = stringifyCountableContentItem(item);
			if (s) parts.push(s);
		}

		// Also check top-level text property if content was a string
		if (typeof message?.text === 'string' && message.text) {
			parts.push(message.text);
		}

		const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
		for (const a of attachments) {
			if (typeof a?.extracted_content === 'string' && a.extracted_content) {
				parts.push(a.extracted_content);
			}
		}

		return parts.join('\n');
	}

	async function hashString(str) {
		if (!CC.bridge?.requestHash) return null;
		try {
			const res = await CC.bridge.requestHash(str);
			if (res?.hash) return res.hash;
		} catch {
			// No local hashing fallback
		}
		return null;
	}

	async function fingerprint(text) {
		if (!text) return null;
		const hash = await hashString(text);
		if (!hash) return null;
		return `${text.length}:${hash}`;
	}

	class TokenCache {
		constructor() {
			this._byMessageId = new Map(); // uuid -> { fp, tokens }
		}

		async getMessageTokens(messageId, messageText) {
			const fp = await fingerprint(messageText);
			if (!fp) return countTokens(messageText);
			const cached = this._byMessageId.get(messageId);
			if (cached && cached.fp === fp) return cached.tokens;

			const tokens = countTokens(messageText);
			this._byMessageId.set(messageId, { fp, tokens });
			return tokens;
		}

		pruneToMessageIds(keepIds) {
			const keep = new Set(keepIds);
			for (const id of this._byMessageId.keys()) {
				if (!keep.has(id)) this._byMessageId.delete(id);
			}
		}
	}

	const tokenCache = new TokenCache();

	// Micro-yield to keep the main thread responsive during heavy calculations
	function yieldToMain() {
		return new Promise((resolve) => setTimeout(resolve, 0));
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
		const trunkIds = trunk.map((m) => m.uuid).filter(Boolean);
		tokenCache.pruneToMessageIds(trunkIds);

		let totalTokens = 0;
		let lastAssistantMs = null;

		for (let i = 0; i < trunk.length; i++) {
			const msg = trunk[i];

			// Yield every 10 messages so the UI never stutters
			if (i > 0 && i % 10 === 0) {
				await yieldToMain();
			}

			if (msg?.sender === 'assistant' && msg?.created_at) {
				const msgMs = Date.parse(msg.created_at);
				if (!lastAssistantMs || msgMs > lastAssistantMs) {
					lastAssistantMs = msgMs;
				}
			}

			const msgText = stringifyMessageCountables(msg);
			const msgTokens = msg?.uuid ? await tokenCache.getMessageTokens(msg.uuid, msgText) : countTokens(msgText);
			totalTokens += msgTokens;
		}

		const cacheWindow = CC.CONST?.CACHE_WINDOW_MS || (5 * 60 * 1000);
		const cachedUntil = lastAssistantMs ? lastAssistantMs + cacheWindow : null;

		return {
			trunkMessageCount: trunk.length,
			totalTokens,
			lastAssistantMs,
			cachedUntil,
			isLoaded: true
		};
	}

	function formatTokens(tokens) {
		if (typeof tokens !== 'number' || isNaN(tokens) || tokens < 0) return '—';
		if (tokens >= 1000) {
			return `~${Math.round(tokens / 1000)}k`;
		}
		return `~${tokens}`;
	}

	function formatContextUtilization(tokens, limit = (CC.CONST?.CONTEXT_LIMIT_TOKENS || 200000)) {
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

	const exp = {
		ROOT_MESSAGE_ID,
		countTokens,
		buildTrunk,
		isCountableContentItem,
		stringifyCountableContentItem,
		stringifyMessageCountables,
		computeConversationMetrics,
		formatTokens,
		formatContextUtilization
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = exp;
	}

	CC.tokens = exp;
})();
