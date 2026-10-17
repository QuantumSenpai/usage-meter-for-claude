(() => {
	'use strict';

	if (window.__CC_BRIDGE_INSTALLED__) return;
	window.__CC_BRIDGE_INSTALLED__ = true;

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
		// Matches /api/organizations/{orgId}/chat_conversations/{conversationId}
		const match = url.match(/\/api\/organizations\/([^/?#]+)\/chat_conversations\/([^/?#]+)/);
		return match ? { orgId: match[1], conversationId: match[2] } : null;
	}

	function getOrgMeta(url) {
		const match = url.match(/\/api\/organizations\/([^/?#]+)/);
		return match ? match[1] : null;
	}

	// 1. Wrap History Early
	const originalPushState = history.pushState ? history.pushState.bind(history) : null;
	const originalReplaceState = history.replaceState ? history.replaceState.bind(history) : null;

	if (originalPushState) {
		history.pushState = function (...args) {
			const result = originalPushState(...args);
			post('cc:urlchange', { path: window.location.pathname });
			return result;
		};
	}

	if (originalReplaceState) {
		history.replaceState = function (...args) {
			const result = originalReplaceState(...args);
			post('cc:urlchange', { path: window.location.pathname });
			return result;
		};
	}

	window.addEventListener('popstate', () => {
		post('cc:urlchange', { path: window.location.pathname });
	});

	// 2. Wrap Fetch
	const originalFetch = window.fetch ? window.fetch.bind(window) : null;
	if (originalFetch) {
		window.fetch = async (...args) => {
			let url = '';
			let method = 'GET';

			try {
				url = toAbsoluteUrl(args[0]);
				const opts = args[1] || {};
				method = (opts.method || (args[0] instanceof Request ? args[0].method : 'GET') || 'GET').toUpperCase();
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
			if (url && method === 'POST' && (url.includes('/completion') || url.includes('/retry_completion'))) {
				post('cc:generation_start', { url });
			}

			// Execute actual fetch
			let response;
			try {
				response = await originalFetch(...args);
			} catch (err) {
				throw err; // preserve original page behavior
			}

			// Non-blocking response inspection
			try {
				const contentType = response.headers.get('content-type') || '';

				if (contentType.includes('event-stream')) {
					handleEventStream(response);
				} else if (url && response.ok) {
					// Check conversation payload
					if (url.includes('/chat_conversations/')) {
						const meta = getConversationMeta(url);
						if (meta) {
							handleConversationResponse(meta, response);
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
	}

	// 3. Wrap XHR for completeness
	if (typeof XMLHttpRequest !== 'undefined') {
		const originalOpen = XMLHttpRequest.prototype.open;
		const originalSend = XMLHttpRequest.prototype.send;

		XMLHttpRequest.prototype.open = function (method, url, ...rest) {
			this.__cc_url = toAbsoluteUrl(url);
			this.__cc_method = (method || 'GET').toUpperCase();
			return originalOpen.call(this, method, url, ...rest);
		};

		XMLHttpRequest.prototype.send = function (...args) {
			if (this.__cc_url) {
				const detectedOrg = getOrgMeta(this.__cc_url);
				if (detectedOrg) post('cc:detected_org', { orgId: detectedOrg });

				if (this.__cc_method === 'POST' && (this.__cc_url.includes('/completion') || this.__cc_url.includes('/retry_completion'))) {
					post('cc:generation_start', { url: this.__cc_url });
				}

				this.addEventListener('load', () => {
					try {
						if (this.status >= 200 && this.status < 300 && this.responseText) {
							if (this.__cc_url.includes('/chat_conversations/')) {
								const meta = getConversationMeta(this.__cc_url);
								if (meta) {
									const data = JSON.parse(this.responseText);
									post('cc:conversation', { orgId: meta.orgId, conversationId: meta.conversationId, data });
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

	async function handleConversationResponse({ orgId, conversationId }, response) {
		try {
			const cloned = response.clone();
			const data = await cloned.json();
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
		try {
			const cloned = response.clone();
			const reader = cloned.body?.getReader?.();
			if (!reader) return;
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					post('cc:stream_completed', {});
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
						// Handle message_limit event format
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
		}
	}

	// 4. Handle incoming requests from Content Script
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
				if (!orgId) throw new Error('Missing orgId');
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
				if (!orgId || !conversationId) throw new Error('Missing orgId/conversationId');

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

	// Announce readiness
	post('cc:ready', { time: Date.now() });
})();
