(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	if (CC.__started) return;
	CC.__started = true;

	// ==========================================
	// Debug Logger (sanitized ring buffer)
	// ==========================================
	const debugLogBuffer = [];

	function sanitizeDebugData(obj) {
		if (!obj) return obj;
		try {
			const str = JSON.stringify(obj, (key, value) => {
				if (typeof value === 'string') {
					// Redact UUIDs
					if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
						return '[REDACTED_UUID]';
					}
					// Redact emails
					if (value.includes('@') && value.includes('.')) {
						return '[REDACTED_EMAIL]';
					}
					// Redact tokens/cookies/keys
					if (key.toLowerCase().includes('token') || key.toLowerCase().includes('cookie') || key.toLowerCase().includes('auth')) {
						return '[REDACTED_SECRET]';
					}
					// Redact long user chat text
					if (key === 'text' || key === 'content' || key === 'extracted_content') {
						return `[TEXT_${value.length}_CHARS]`;
					}
				}
				return value;
			});
			return JSON.parse(str);
		} catch {
			return '[UNSERIALIZABLE]';
		}
	}

	function logDebug(category, data = {}) {
		const entry = {
			time: new Date().toISOString(),
			category,
			data: sanitizeDebugData(data)
		};
		debugLogBuffer.push(entry);
		if (debugLogBuffer.length > CC.CONST.DEBUG_LOG_MAX_ENTRIES) {
			debugLogBuffer.shift();
		}
		if (localStorage.getItem(CC.CONST.DEBUG_STORAGE_KEY) === 'true' || window.__CC_DEBUG) {
			console.log(`[UsageMeter:Debug] [${category}]`, entry.data);
		}
	}

	// Expose one-line copy feature
	window.__CC_COPY_DEBUG_LOG = () => {
		const formatted = JSON.stringify(debugLogBuffer, null, 2);
		if (navigator.clipboard?.writeText) {
			navigator.clipboard.writeText(formatted).then(() => {
				console.log('%c[Usage Meter] Debug log copied to clipboard! (Redacted)', 'color: #10b981; font-weight: bold;');
			});
		}
		return formatted;
	};

	logDebug('init', { userAgent: navigator.userAgent });

	// ==========================================
	// Utilities
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
					// Strip surrounding quotes or URI encoding if present
					return decodeURIComponent(val.replace(/^["']|["']$/g, ''));
				}
			}
		} catch {
			// ignore
		}
		return null;
	}

	// ==========================================
	// Usage Parsers (with generous fallbacks)
	// ==========================================
	function normalizeUtilization(val) {
		if (typeof val !== 'number' || !Number.isFinite(val)) return null;
		// If returned as 0.0 - 1.0 fraction, scale to 0 - 100
		const num = val <= 1 && val > 0 ? val * 100 : val;
		return Math.max(0, Math.min(100, num));
	}

	function normalizeResetsAt(val) {
		if (!val) return null;
		if (typeof val === 'string') return val;
		if (typeof val === 'number' && Number.isFinite(val)) {
			// Check if unix seconds vs ms
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

		// 1. Direct windows wrapper
		const windows = raw.windows || raw;

		// 2. 5-hour window
		const fiveHour =
			normalizeWindow(windows.five_hour, 5) ||
			normalizeWindow(windows['5h'], 5) ||
			normalizeWindow(raw.five_hour, 5) ||
			normalizeWindow(raw['5h'], 5);

		// 3. 7-day window
		const sevenDay =
			normalizeWindow(windows.seven_day, 24 * 7) ||
			normalizeWindow(windows['7d'], 24 * 7) ||
			normalizeWindow(raw.seven_day, 24 * 7) ||
			normalizeWindow(raw['7d'], 24 * 7);

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay };
	}

	// ==========================================
	// State & UI Instance
	// ==========================================
	let currentConversationId = null;
	let currentOrgId = null;
	let usageState = null;
	let usageResetMs = { five_hour: null, seven_day: null };
	let lastUsageSseMs = 0;
	let usageFetchInFlight = false;
	let lastUsageUpdateMs = 0;
	const rolloverHandled = { five_hour: null, seven_day: null };

	const ui = new CC.ui.CounterUI({
		onUsageRefresh: async () => {
			await refreshUsage(true);
		},
		onCopyDebug: () => {
			window.__CC_COPY_DEBUG_LOG();
		}
	});

	const bridgeReady = CC.injectBridgeOnce();

	function applyUsageUpdate(parsed, source) {
		if (!parsed) return;
		const now = Date.now();
		usageState = parsed;
		lastUsageUpdateMs = now;
		if (source === 'sse') lastUsageSseMs = now;

		usageResetMs.five_hour = parsed.five_hour?.resets_at ? Date.parse(parsed.five_hour.resets_at) : null;
		usageResetMs.seven_day = parsed.seven_day?.resets_at ? Date.parse(parsed.seven_day.resets_at) : null;

		logDebug('usage_applied', { source, session: parsed.five_hour?.utilization, weekly: parsed.seven_day?.utilization });
		ui.setUsage(parsed);
	}

	function updateOrgId(newOrgId) {
		if (newOrgId && typeof newOrgId === 'string' && newOrgId !== currentOrgId) {
			currentOrgId = newOrgId;
			logDebug('org_detected', { orgId: newOrgId });
		}
	}

	async function refreshUsage(manual = false) {
		await bridgeReady;
		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) {
			logDebug('refresh_usage_skipped', { reason: 'No orgId found' });
			ui.setUnavailable('Sign in to view usage');
			return;
		}
		updateOrgId(orgId);

		if (usageFetchInFlight && !manual) return;
		usageFetchInFlight = true;

		try {
			logDebug('fetch_usage_start', { orgId });
			const raw = await CC.bridge.requestUsage(orgId);
			const parsed = parseUsagePayload(raw);
			if (parsed) {
				applyUsageUpdate(parsed, 'api');
			} else {
				logDebug('fetch_usage_unrecognized_payload', { raw });
				ui.setUnavailable('Unrecognized usage response');
			}
		} catch (err) {
			logDebug('fetch_usage_error', { message: err?.message, status: err?.status });
			if (err?.status === 429) {
				ui.setUnavailable('Rate limited (retrying soon)');
			} else if (err?.status === 401 || err?.status === 403) {
				ui.setUnavailable('Session expired');
			} else {
				ui.setUnavailable('Usage currently unavailable');
			}
		} finally {
			usageFetchInFlight = false;
		}
	}

	async function refreshConversation() {
		await bridgeReady;
		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) return;
		updateOrgId(orgId);

		try {
			logDebug('fetch_conversation_start', { conversationId: currentConversationId });
			await CC.bridge.requestConversation(orgId, currentConversationId);
		} catch (err) {
			logDebug('fetch_conversation_error', { message: err?.message });
		}
	}

	// ==========================================
	// Bridge Event Subscriptions
	// ==========================================
	CC.bridge.on('cc:detected_org', ({ orgId }) => updateOrgId(orgId));

	CC.bridge.on('cc:generation_start', () => {
		if (!currentConversationId) return;
		ui.setPendingCache(true);
	});

	CC.bridge.on('cc:stream_completed', () => {
		// Re-fetch usage after assistant finishes streaming
		setTimeout(() => refreshUsage(), 1000);
	});

	CC.bridge.on('cc:message_limit', (messageLimit) => {
		logDebug('sse_message_limit_received', messageLimit);
		const parsed = parseUsagePayload(messageLimit);
		if (parsed) applyUsageUpdate(parsed, 'sse');
	});

	CC.bridge.on('cc:usage_intercepted', ({ orgId, data }) => {
		updateOrgId(orgId);
		logDebug('intercepted_usage_received', data);
		const parsed = parseUsagePayload(data);
		if (parsed) applyUsageUpdate(parsed, 'intercept');
	});

	CC.bridge.on('cc:conversation', async ({ orgId, conversationId, data }) => {
		if (!conversationId || conversationId !== currentConversationId) return;
		updateOrgId(orgId);
		if (!data) return;

		try {
			const metrics = await CC.tokens.computeConversationMetrics(data);
			logDebug('conversation_metrics_computed', { tokens: metrics.totalTokens, cachedUntil: metrics.cachedUntil });
			ui.setConversationMetrics({ totalTokens: metrics.totalTokens, cachedUntil: metrics.cachedUntil });
		} catch (err) {
			logDebug('conversation_metrics_error', { message: err?.message });
		}
	});

	// ==========================================
	// Resilient Mount System
	// ==========================================
	let fallbackTimer = null;

	function findBestAnchor() {
		for (const candidate of CC.SELECTORS.INPUT_ANCHORS) {
			try {
				const el = document.querySelector(candidate.selector);
				if (el && el.isConnected) {
					// Locate surrounding toolbar container if available
					const container = el.closest('[data-testid="chat-input-controls"]') ||
						el.closest('form') ||
						el.closest('fieldset') ||
						el.parentElement;
					return { element: container || el, name: candidate.name };
				}
			} catch {
				// skip invalid selector
			}
		}
		return null;
	}

	function attemptMount() {
		const match = findBestAnchor();
		if (match) {
			if (fallbackTimer) {
				clearTimeout(fallbackTimer);
				fallbackTimer = null;
			}
			logDebug('mount_inline_success', { anchor: match.name });
			ui.attachTo(match.element, false);
		} else {
			// Anchor not found yet. If it hasn't appeared within 3s, render floating fallback
			if (!fallbackTimer && !ui.isFloating) {
				fallbackTimer = setTimeout(() => {
					logDebug('mount_fallback_triggered', { reason: 'No inline anchor matched within 3s' });
					ui.attachTo(null, true);
					fallbackTimer = null;
				}, CC.CONST.FALLBACK_MOUNT_TIMEOUT_MS);
			}
		}
	}

	// Debounced MutationObserver for layout changes
	let domDebounce = null;
	const observer = new MutationObserver(() => {
		if (domDebounce) clearTimeout(domDebounce);
		domDebounce = setTimeout(() => {
			// If inline widget detached or not attached, try mounting
			if (!ui.rootElement || !ui.rootElement.isConnected || (ui.isFloating && findBestAnchor())) {
				attemptMount();
			}
		}, 150);
	});
	observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

	// ==========================================
	// SPA Navigation Tracking
	// ==========================================
	let lastKnownPath = window.location.pathname;

	async function handleUrlChange() {
		const newConvId = getConversationId();
		const pathChanged = window.location.pathname !== lastKnownPath;
		lastKnownPath = window.location.pathname;

		logDebug('url_change', { pathname: window.location.pathname, conversationId: newConvId });
		currentConversationId = newConvId;

		// Mount widget in new route
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

	window.addEventListener('popstate', handleUrlChange);
	CC.bridge.on('cc:urlchange', handleUrlChange);

	// Periodic safety check for SPA route change (catches any framework transitions)
	setInterval(() => {
		if (window.location.pathname !== lastKnownPath) {
			handleUrlChange();
		}
	}, 500);

	// Refresh on tab focus
	window.addEventListener('focus', () => {
		const now = Date.now();
		if (now - lastUsageUpdateMs > 60000) {
			refreshUsage();
		}
	});

	// Branch navigation listener
	document.addEventListener('click', (e) => {
		if (!currentConversationId) return;
		const btn = e.target.closest(CC.SELECTORS.BRANCH_BUTTONS);
		if (!btn) return;
		// Small delay for DOM to update trunk
		setTimeout(() => refreshConversation(), 300);
	});

	// ==========================================
	// Tick Loop (countdowns, rollover, safety poll)
	// ==========================================
	function tick() {
		ui.tick();

		const now = Date.now();

		// Window rollover handling
		if (usageResetMs.five_hour && now >= usageResetMs.five_hour && rolloverHandled.five_hour !== usageResetMs.five_hour) {
			rolloverHandled.five_hour = usageResetMs.five_hour;
			logDebug('window_rollover', { window: '5h' });
			refreshUsage();
		}
		if (usageResetMs.seven_day && now >= usageResetMs.seven_day && rolloverHandled.seven_day !== usageResetMs.seven_day) {
			rolloverHandled.seven_day = usageResetMs.seven_day;
			logDebug('window_rollover', { window: '7d' });
			refreshUsage();
		}

		// Slow safety poll (every 5 minutes when tab is visible)
		if (!document.hidden && now - lastUsageUpdateMs > CC.CONST.SLOW_USAGE_REFRESH_INTERVAL_MS) {
			refreshUsage();
		}
	}

	setInterval(tick, 1000);

	// Initial trigger
	handleUrlChange();
})();
