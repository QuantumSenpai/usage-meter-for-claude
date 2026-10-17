(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	function getRuntime() {
		return globalThis.browser?.runtime || globalThis.chrome?.runtime || null;
	}

	function makeRequestId() {
		return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	class BridgeClient {
		constructor() {
			this._pending = new Map();
			this._listeners = new Map();
			this.isReady = false;

			window.addEventListener('message', (event) => {
				if (event.source !== window) return;
				const data = event.data;
				if (!data || data.cc !== 'ClaudeCounter') return;

				if (data.type === 'cc:ready' || data.type === 'cc:pong') {
					this.isReady = true;
					this._emit('ready', data.payload);
					return;
				}

				if (data.type === 'cc:response') {
					const { requestId, ok, payload, error, status } = data;
					const pending = this._pending.get(requestId);
					if (!pending) return;
					this._pending.delete(requestId);
					clearTimeout(pending.timeoutId);
					if (ok) {
						pending.resolve(payload);
					} else {
						const err = new Error(error || 'Bridge request failed');
						err.status = status || 0;
						pending.reject(err);
					}
					return;
				}

				// Forward other events (cc:generation_start, cc:stream_completed, cc:conversation, cc:message_limit, cc:usage_intercepted, cc:urlchange, cc:detected_org)
				this._emit(data.type, data.payload);
			});

			// Ping bridge
			window.postMessage({ cc: 'ClaudeCounter', type: 'cc:ping' }, '*');
		}

		_emit(type, payload) {
			const listeners = this._listeners.get(type);
			if (!listeners) return;
			for (const fn of listeners) {
				try {
					fn(payload);
				} catch {
					// safe listener execution
				}
			}
		}

		on(type, fn) {
			if (!this._listeners.has(type)) this._listeners.set(type, new Set());
			this._listeners.get(type).add(fn);
			return () => this._listeners.get(type)?.delete(fn);
		}

		request(kind, payload, { timeoutMs = 10000 } = {}) {
			const requestId = makeRequestId();
			return new Promise((resolve, reject) => {
				const timeoutId = setTimeout(() => {
					this._pending.delete(requestId);
					reject(new Error(`Bridge request timed out (${kind})`));
				}, timeoutMs);

				this._pending.set(requestId, { resolve, reject, timeoutId });
				window.postMessage(
					{
						cc: 'ClaudeCounter',
						type: 'cc:request',
						requestId,
						kind,
						payload
					},
					'*'
				);
			});
		}

		async requestUsage(orgId) {
			return this.request('usage', { orgId }, { timeoutMs: 15000 });
		}

		async requestConversation(orgId, conversationId) {
			return this.request('conversation', { orgId, conversationId }, { timeoutMs: 20000 });
		}

		async requestHash(text) {
			return this.request('hash', { text }, { timeoutMs: 5000 });
		}
	}

	let bridgeReadyPromise = null;

	function injectBridgeOnce() {
		if (bridgeReadyPromise) return bridgeReadyPromise;

		bridgeReadyPromise = new Promise((resolve) => {
			if (CC.bridge?.isReady) {
				resolve(true);
				return;
			}

			// Listen for readiness event
			const unbind = CC.bridge.on('ready', () => {
				unbind();
				resolve(true);
			});

			// Fallback: Check if already declared via MAIN world content script or inject
			setTimeout(() => {
				if (CC.bridge.isReady) {
					resolve(true);
					return;
				}

				const runtime = getRuntime();
				if (!runtime) {
					resolve(false);
					return;
				}

				if (document.getElementById(CC.DOM.BRIDGE_SCRIPT_ID)) {
					resolve(true);
					return;
				}

				try {
					const script = document.createElement('script');
					script.id = CC.DOM.BRIDGE_SCRIPT_ID;
					script.src = runtime.getURL('src/injected/bridge.js');
					script.onload = () => resolve(true);
					script.onerror = () => resolve(false);
					(document.head || document.documentElement).appendChild(script);
				} catch {
					resolve(false);
				}
			}, 100);
		});

		return bridgeReadyPromise;
	}

	CC.bridge = new BridgeClient();
	CC.injectBridgeOnce = injectBridgeOnce;
})();
