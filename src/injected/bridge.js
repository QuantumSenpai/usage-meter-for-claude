(() => {
	'use strict';

	if (typeof window !== 'undefined' && window.__CC_BRIDGE_INSTALLED__) return;
	if (typeof window !== 'undefined') window.__CC_BRIDGE_INSTALLED__ = true;

	const CC_MARKER = 'ClaudeCounter';

	// Safe dispatch to ISOLATED world
	function post(type, payload) {
		try {
			window.postMessage({ cc: CC_MARKER, type, payload }, '*');
		} catch {
			// ignore structured clone errors
		}
	}

	function postResponse(requestId, ok, payload, error, status = 200) {
		try {
			window.postMessage(
				{
					cc: CC_MARKER,
					type: 'cc:response',
					requestId,
					ok,
					payload,
					error,
					status
				},
				'*'
			);
		} catch {
			// ignore
		}
	}

	function toAbsoluteUrl(input) {
		try {
			if (typeof input === 'string') {
				if (input.startsWith('/')) {
					const origin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'https://claude.ai';
					return `${origin}${input}`;
				}
				return input;
			}
			if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
			if ((typeof Request !== 'undefined' && input instanceof Request) || (input && typeof input === 'object' && typeof input.url === 'string')) {
				const u = input.url;
				if (typeof u === 'string' && u.startsWith('/')) {
					const origin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'https://claude.ai';
					return `${origin}${u}`;
				}
				return u || '';
			}
		} catch {
			// ignore
		}
		return '';
	}

	const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	function isValidOrgId(id) {
		return typeof id === 'string' && UUID_REGEX.test(id) && id.toLowerCase() !== 'discoverable';
	}

	function getConversationMeta(url) {
		// Matches /api/organizations/{orgId}/chat_conversations/{conversationId} where orgId is a valid UUID
		const match = url.match(/\/api\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/chat_conversations\/([^/?#]+)/i);
		return match ? { orgId: match[1], conversationId: match[2] } : null;
	}

	function getOrgMeta(url) {
		// Strict UUID capture to prevent grabbing non-UUID paths like /api/organizations/discoverable
		const match = url.match(/\/api\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
		return match ? match[1] : null;
	}

	// 1. Wrap History Early
	const originalPushState = (typeof history !== 'undefined' && history.pushState) ? history.pushState.bind(history) : null;
	const originalReplaceState = (typeof history !== 'undefined' && history.replaceState) ? history.replaceState.bind(history) : null;

	if (originalPushState && typeof history !== 'undefined') {
		history.pushState = function (...args) {
			const result = originalPushState(...args);
			post('cc:urlchange', { path: typeof window !== 'undefined' ? window.location?.pathname : '' });
			return result;
		};
	}

	if (originalReplaceState && typeof history !== 'undefined') {
		history.replaceState = function (...args) {
			const result = originalReplaceState(...args);
			post('cc:urlchange', { path: typeof window !== 'undefined' ? window.location?.pathname : '' });
			return result;
		};
	}

	if (typeof window !== 'undefined' && window.addEventListener) {
		window.addEventListener('popstate', () => {
			post('cc:urlchange', { path: window.location?.pathname });
		});
	}

	function isDebugActive() {
		try {
			const storage = (typeof window !== 'undefined' && window.localStorage)
				? window.localStorage
				: (typeof localStorage !== 'undefined' ? localStorage : null);
			if (storage && typeof storage.getItem === 'function') {
				const val = storage.getItem('cc_debug');
				if (val !== null) return val === 'true';
			}
		} catch {
			// ignore
		}
		if (typeof globalThis !== 'undefined' && typeof globalThis.__CC_DEBUG === 'boolean') {
			return globalThis.__CC_DEBUG;
		}
		return false;
	}

	function postDiag(category, data) {
		try {
			if (!isDebugActive()) return;
			post('cc:diag', { category, data });
		} catch {
			// ignore
		}
	}

	function isSseResponse(response) {
		try {
			const ct = (typeof response?.headers?.get === 'function'
				? response.headers.get('content-type')
				: response?.headers?.['content-type'] || response?.headers?.['Content-Type']) || '';
			return typeof ct === 'string' && ct.toLowerCase().includes('event-stream');
		} catch {
			return false;
		}
	}

	function getHost(rawUrl) {
		try {
			let urlStr = '';
			if (typeof rawUrl === 'string') {
				urlStr = rawUrl.trim();
			} else if (typeof URL !== 'undefined' && rawUrl instanceof URL) {
				urlStr = rawUrl.href;
			} else if ((typeof Request !== 'undefined' && rawUrl instanceof Request) || (rawUrl && typeof rawUrl === 'object' && typeof rawUrl.url === 'string')) {
				urlStr = rawUrl.url;
			}
			if (!urlStr) return '';
			if (urlStr.startsWith('blob:') || urlStr.startsWith('data:')) {
				return '';
			}
			const baseOrigin = (typeof window !== 'undefined' && window.location?.origin)
				? window.location.origin
				: 'https://claude.ai';
			const parsed = new URL(urlStr, baseOrigin);
			return parsed.hostname || '';
		} catch {
			return '';
		}
	}

	function computePathShape(input) {
		try {
			let urlStr = '';
			if (typeof input === 'string') {
				urlStr = input.trim();
			} else if (typeof URL !== 'undefined' && input instanceof URL) {
				urlStr = input.href;
			} else if ((typeof Request !== 'undefined' && input instanceof Request) || (input && typeof input === 'object' && typeof input.url === 'string')) {
				urlStr = input.url;
			}
			if (!urlStr) return '';

			if (urlStr.startsWith('blob:')) return 'blob:';
			if (urlStr.startsWith('data:')) return 'data:';

			const baseOrigin = (typeof window !== 'undefined' && window.location?.origin)
				? window.location.origin
				: 'https://claude.ai';
			const parsed = new URL(urlStr, baseOrigin);
			const pathname = parsed.pathname || '';

			const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			const HEX_16_RE = /^[0-9a-f]{16,}$/i;
			const DIGITS_RE = /^\d+$/;

			const parts = pathname.split('/').map((seg) => {
				if (!seg) return seg;
				if (UUID_RE.test(seg) || HEX_16_RE.test(seg) || DIGITS_RE.test(seg)) {
					return ':id';
				}
				return seg;
			});

			return parts.join('/');
		} catch {
			return '';
		}
	}

	function getRequestInputType(rawInput) {
		if (typeof rawInput === 'string') return 'string';
		if (typeof URL !== 'undefined' && rawInput instanceof URL) return 'url';
		if ((typeof Request !== 'undefined' && rawInput instanceof Request) || (rawInput && typeof rawInput === 'object' && typeof rawInput.url === 'string')) {
			return 'request';
		}
		return typeof rawInput;
	}

	const COMPLETION_PATH_REGEX = /^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(completion|retry_completion)$/;

	function isCompletionRequestUrl(input) {
		try {
			let urlStr = '';
			if (typeof input === 'string') {
				urlStr = input.trim();
			} else if (typeof URL !== 'undefined' && input instanceof URL) {
				urlStr = input.href;
			} else if ((typeof Request !== 'undefined' && input instanceof Request) || (input && typeof input === 'object' && typeof input.url === 'string')) {
				urlStr = input.url;
			}
			if (!urlStr) return false;
			if (urlStr.startsWith('blob:') || urlStr.startsWith('data:')) return false;

			const baseOrigin = (typeof window !== 'undefined' && window.location?.origin)
				? window.location.origin
				: 'https://claude.ai';
			const parsed = new URL(urlStr, baseOrigin);
			const host = (parsed.hostname || '').toLowerCase();
			if (host !== 'claude.ai') return false;

			return COMPLETION_PATH_REGEX.test(parsed.pathname || '');
		} catch {
			return false;
		}
	}

	function shouldLogRequestSeen(rawUrl) {
		try {
			let urlStr = '';
			if (typeof rawUrl === 'string') {
				urlStr = rawUrl.trim();
			} else if (typeof URL !== 'undefined' && rawUrl instanceof URL) {
				urlStr = rawUrl.href;
			} else if ((typeof Request !== 'undefined' && rawUrl instanceof Request) || (rawUrl && typeof rawUrl === 'object' && typeof rawUrl.url === 'string')) {
				urlStr = rawUrl.url;
			}
			if (!urlStr) return false;
			if (urlStr.startsWith('blob:') || urlStr.startsWith('data:')) return false;

			const baseOrigin = (typeof window !== 'undefined' && window.location?.origin)
				? window.location.origin
				: 'https://claude.ai';
			const parsed = new URL(urlStr, baseOrigin);

			const host = (parsed.hostname || '').toLowerCase();
			if (host === 'assets-proxy.anthropic.com') {
				return false;
			}

			const pathname = parsed.pathname || '';
			if (pathname.startsWith('/api/') || pathname.startsWith('/claudeai-rpc/') || pathname.startsWith('/edge-api/')) {
				return true;
			}

			return false;
		} catch {
			return false;
		}
	}

	// 2. Wrap Fetch
	let originalFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : null;

	function wrapFetch(targetWindow = (typeof window !== 'undefined' ? window : null)) {
		if (!targetWindow || !targetWindow.fetch) return;
		if (targetWindow.__cc_fetch_wrapped__) return;
		originalFetch = targetWindow.fetch.bind(targetWindow);

		targetWindow.fetch = async (...args) => {
			let url = '';
			let method = 'GET';
			const rawInput = args[0];
			const inputType = getRequestInputType(rawInput);

			try {
				url = toAbsoluteUrl(rawInput);
				const opts = args[1] || {};
				const reqMethod = (rawInput && typeof rawInput === 'object' && typeof rawInput.method === 'string') ? rawInput.method : undefined;
				method = (opts.method || reqMethod || 'GET').toUpperCase();
			} catch {
				// pass through safely
			}

			// Capture org ID whenever seen
			if (url) {
				const detectedOrg = getOrgMeta(url);
				if (detectedOrg) {
					post('cc:detected_org', { orgId: detectedOrg });
				}
			}

			// Detect completion start
			if (method === 'POST' && isCompletionRequestUrl(url)) {
				post('cc:generation_start', { url });
			}

			// Execute actual fetch
			let response;
			try {
				response = await originalFetch(...args);
			} catch (err) {
				try {
					if (shouldLogRequestSeen(url || rawInput)) {
						postDiag('request_seen', {
							method,
							host: getHost(url || rawInput),
							pathShape: computePathShape(url || rawInput),
							status: 0,
							'content-type': '',
							contentType: '',
							inputType,
							input: inputType
						});
					}
				} catch {
					// ignore
				}
				throw err; // preserve original page behavior
			}

			// Diagnostic logging: request_seen
			try {
				if (shouldLogRequestSeen(url || rawInput)) {
					const ct = (typeof response?.headers?.get === 'function'
						? response.headers.get('content-type')
						: response?.headers?.['content-type'] || response?.headers?.['Content-Type']) || '';
					postDiag('request_seen', {
						method,
						host: getHost(url || rawInput),
						pathShape: computePathShape(url || rawInput),
						status: (typeof response?.status === 'number') ? response.status : 0,
						'content-type': ct,
						contentType: ct,
						inputType,
						input: inputType
					});
				}
			} catch {
				// ignore
			}

			// Non-blocking response inspection
			try {
				let matchedBy = null;
				const isSse = isSseResponse(response);
				const isCompletionUrl = isCompletionRequestUrl(url);

				if (isCompletionUrl) {
					matchedBy = 'url';
				} else if (isSse) {
					matchedBy = 'content-type';
				}

				if (matchedBy) {
					if (isSse) {
						const pathShape = computePathShape(url);
						const host = getHost(url);
						postDiag('sse_stream_seen', {
							method,
							status: response.status,
							host,
							pathShape,
							matchedBy
						});
					}
					handleEventStream(response);
				} else if (url && response.ok) {
					// Check conversation payload
					if (method === 'GET' && url.includes('/chat_conversations/')) {
						const meta = getConversationMeta(url);
						if (meta) {
							handleConversationResponse(meta, response, url);
						}
					}
					// Check usage endpoint intercepted
					else if (url.includes('/usage') && url.includes('/api/organizations/')) {
						const orgId = getOrgMeta(url);
						if (orgId) {
							handleUsageResponse(orgId, response);
						}
					}
				}
			} catch {
				// Never fail the page request
			}

			return response;
		};

		targetWindow.__cc_fetch_wrapped__ = true;
	}

	if (typeof window !== 'undefined') {
		wrapFetch(window);
	}

	// 2.5 Wrap Transport Constructors (EventSource, WebSocket, Worker, SharedWorker)
	function wrapTransportConstructor(kind, targetWindow = (typeof window !== 'undefined' ? window : null)) {
		try {
			if (!targetWindow || typeof targetWindow[kind] === 'undefined') return;
			const Original = targetWindow[kind];
			if (typeof Original !== 'function' || Original.__cc_wrapped__) return;

			const proxy = new Proxy(Original, {
				construct(target, args, newTarget) {
					const instance = Reflect.construct(target, args, newTarget);
					try {
						const rawUrl = args[0];
						const pathShape = computePathShape(rawUrl);
						postDiag('transport_created', { kind, pathShape });
					} catch {
						// Swallow logging errors to ensure construction never breaks
					}
					return instance;
				}
			});

			try {
				proxy.__cc_wrapped__ = true;
			} catch {
				// ignore if non-extensible
			}

			targetWindow[kind] = proxy;
		} catch {
			// ignore proxy setup failure
		}
	}

	function initTransportProxies(targetWindow = (typeof window !== 'undefined' ? window : null)) {
		['EventSource', 'WebSocket', 'Worker', 'SharedWorker'].forEach((kind) => {
			wrapTransportConstructor(kind, targetWindow);
		});
	}

	if (typeof window !== 'undefined') {
		initTransportProxies(window);
	}

	// 3. Wrap XHR for completeness
	function wrapXHR(targetGlobal = (typeof window !== 'undefined' ? window : null)) {
		const XHR = targetGlobal?.XMLHttpRequest || (typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : null);
		if (!XHR || !XHR.prototype || XHR.__cc_wrapped__) return;
		XHR.__cc_wrapped__ = true;

		const originalOpen = XHR.prototype.open;
		const originalSend = XHR.prototype.send;

		XHR.prototype.open = function (method, url, ...rest) {
			this.__cc_raw_input = url;
			this.__cc_url = toAbsoluteUrl(url);
			this.__cc_method = (method || 'GET').toUpperCase();
			return originalOpen.call(this, method, url, ...rest);
		};

		XHR.prototype.send = function (...args) {
			const logXhrSeen = () => {
				if (this.__cc_seen_logged) return;
				this.__cc_seen_logged = true;
				try {
					const rawInput = this.__cc_raw_input;
					const targetUrl = this.__cc_url || rawInput;
					if (!shouldLogRequestSeen(targetUrl)) return;
					let ct = '';
					try {
						ct = (typeof this.getResponseHeader === 'function' ? this.getResponseHeader('content-type') : '') || '';
					} catch {
						// ignore
					}
					const inputType = getRequestInputType(rawInput);
					postDiag('request_seen', {
						method: this.__cc_method || 'GET',
						host: getHost(targetUrl),
						pathShape: computePathShape(targetUrl),
						status: (typeof this.status === 'number') ? this.status : 0,
						'content-type': ct,
						contentType: ct,
						inputType,
						input: inputType
					});
				} catch {
					// ignore
				}
			};

			if (typeof this.addEventListener === 'function') {
				this.addEventListener('loadend', logXhrSeen);
				this.addEventListener('load', logXhrSeen);
				this.addEventListener('error', logXhrSeen);
				this.addEventListener('abort', logXhrSeen);
			}

			if (this.__cc_url) {
				const detectedOrg = getOrgMeta(this.__cc_url);
				if (detectedOrg) post('cc:detected_org', { orgId: detectedOrg });

				if (this.__cc_method === 'POST' && isCompletionRequestUrl(this.__cc_url)) {
					post('cc:generation_start', { url: this.__cc_url });
				}

				this.addEventListener('load', () => {
					try {
						if (this.status >= 200 && this.status < 300 && this.responseText) {
							if (this.__cc_method === 'GET' && this.__cc_url.includes('/chat_conversations/')) {
								const meta = getConversationMeta(this.__cc_url);
								if (meta) {
									const data = JSON.parse(this.responseText);
									if (data && typeof data === 'object' && Array.isArray(data.chat_messages)) {
										if (data.chat_messages.length > 0 || this.__cc_url.includes('tree=') || data.current_leaf_message_uuid) {
											post('cc:conversation', { orgId: meta.orgId, conversationId: meta.conversationId, data });
										}
									}
								}
							} else if (this.__cc_url.includes('/usage') && this.__cc_url.includes('/api/organizations/')) {
								const orgId = getOrgMeta(this.__cc_url);
								if (orgId) {
									const data = JSON.parse(this.responseText);
									post('cc:usage_intercepted', { orgId, data });
								}
							}
						}
					} catch {
						// ignore
					}
				});
			}
			return originalSend.call(this, ...args);
		};
	}

	if (typeof XMLHttpRequest !== 'undefined') {
		wrapXHR(typeof window !== 'undefined' ? window : null);
	}

	async function handleConversationResponse({ orgId, conversationId }, response, requestUrl = '') {
		try {
			const cloned = response.clone();
			const data = await cloned.json();
			if (!data || typeof data !== 'object') return;
			if (!Array.isArray(data.chat_messages)) return;
			// Guard against shallow metadata GETs that lack tree data
			if (data.chat_messages.length === 0 && !requestUrl.includes('tree=') && !data.current_leaf_message_uuid) {
				return;
			}
			post('cc:conversation', { orgId, conversationId, data });
		} catch {
			// ignore parse failures
		}
	}

	async function handleUsageResponse(orgId, response) {
		try {
			const cloned = response.clone();
			const data = await cloned.json();
			post('cc:usage_intercepted', { orgId, data });
		} catch {
			// ignore
		}
	}

	async function handleEventStream(response) {
		let completedPosted = false;
		const seenEventTypes = new Set();
		let messageLimitSeen = false;

		try {
			const cloned = response.clone();
			const reader = cloned.body?.getReader?.();
			if (!reader) return;
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split(/\r\n|\r|\n/);
				buffer = lines.pop() || '';
				for (const line of lines) {
					if (line.startsWith('event:')) {
						const evType = line.slice(6).trim();
						if (evType) seenEventTypes.add(evType);
						continue;
					}
					if (!line.startsWith('data:')) continue;
					const raw = line.slice(5).trim();
					if (!raw || raw === '[DONE]') continue;
					try {
						const json = JSON.parse(raw);
						if (typeof json?.type === 'string' && json.type) {
							seenEventTypes.add(json.type);
						}

						// Handle message_limit event format
						const isMessageLimit = json?.type === 'message_limit' || Boolean(json?.message_limit) || (Boolean(json?.windows) && !json?.type);
						if (isMessageLimit) {
							messageLimitSeen = true;
							post('cc:message_limit_raw', json);
						}

						if (json?.type === 'message_limit' && json.message_limit) {
							post('cc:message_limit', json.message_limit);
						} else if (json?.message_limit) {
							post('cc:message_limit', json.message_limit);
						} else if (json?.windows) {
							post('cc:message_limit', json);
						}
					} catch {
						// ignore parse error on individual chunk
					}
				}
			}
		} catch {
			// best effort
		} finally {
			if (!completedPosted) {
				completedPosted = true;
				post('cc:stream_completed', {
					eventTypes: Array.from(seenEventTypes),
					messageLimitSeen
				});
			}
		}
	}

	// 4. Handle incoming requests from Content Script
	if (typeof window !== 'undefined' && window.addEventListener) {
		window.addEventListener('message', async (event) => {
			if (event.source !== window) return;
		const data = event.data;
		if (!data || data.cc !== CC_MARKER) return;

		if (data.type === 'cc:ping') {
			post('cc:pong', { ready: true });
			return;
		}

		if (data.type !== 'cc:request') return;

		const { requestId, kind, payload } = data;
		try {
			if (kind === 'hash') {
				const text = typeof payload?.text === 'string' ? payload.text : '';
				if (!text || !crypto?.subtle?.digest) {
					postResponse(requestId, false, null, 'Hash unavailable');
					return;
				}
				const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
				const bytes = new Uint8Array(buffer);
				const hash = Array.from(bytes.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
				postResponse(requestId, true, { hash }, null);
				return;
			}

			if (kind === 'usage') {
				const orgId = payload?.orgId;
				if (!isValidOrgId(orgId)) {
					postResponse(requestId, false, null, 'Invalid organization UUID', 400);
					return;
				}
				const fetchFn = originalFetch || window.fetch;
				const res = await fetchFn(`https://claude.ai/api/organizations/${orgId}/usage`, {
					method: 'GET',
					credentials: 'include'
				});
				if (!res.ok) {
					postResponse(requestId, false, null, `HTTP ${res.status}: ${res.statusText}`, res.status);
					return;
				}
				const json = await res.json();
				postResponse(requestId, true, json, null, res.status);
				return;
			}

			if (kind === 'conversation') {
				const orgId = payload?.orgId;
				const conversationId = payload?.conversationId;
				if (!isValidOrgId(orgId) || !conversationId) {
					postResponse(requestId, false, null, 'Invalid orgId or conversationId', 400);
					return;
				}

				const fetchFn = originalFetch || window.fetch;
				const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;
				const res = await fetchFn(url, {
					method: 'GET',
					credentials: 'include'
				});
				if (!res.ok) {
					// Fallback to simpler URL if tree/rendering_mode parameters cause issues
					const fallbackUrl = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}`;
					const res2 = await fetchFn(fallbackUrl, {
						method: 'GET',
						credentials: 'include'
					});
					if (!res2.ok) {
						postResponse(requestId, false, null, `HTTP ${res2.status}: ${res2.statusText}`, res2.status);
						return;
					}
					const json2 = await res2.json();
					post('cc:conversation', { orgId, conversationId, data: json2 });
					postResponse(requestId, true, json2, null, res2.status);
					return;
				}

				const json = await res.json();
				post('cc:conversation', { orgId, conversationId, data: json });
				postResponse(requestId, true, json, null, res.status);
				return;
			}

			throw new Error(`Unknown request kind: ${kind}`);
		} catch (e) {
			postResponse(requestId, false, null, e?.message || String(e), 0);
		}
	});
}

	// Announce readiness
	if (typeof window !== 'undefined') {
		post('cc:ready', { time: Date.now() });
	}

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = {
			handleEventStream,
			isSseResponse,
			getHost,
			computePathShape,
			wrapTransportConstructor,
			initTransportProxies,
			wrapFetch,
			wrapXHR,
			toAbsoluteUrl,
			getRequestInputType,
			isCompletionRequestUrl,
			shouldLogRequestSeen
		};
	}
})();
