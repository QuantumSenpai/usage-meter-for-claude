(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	if (CC.__started) return;
	CC.__started = true;

	const { isValidOrgId, normalizeUsagePayload } = CC.normalize;

	// ==========================================
	// Debug Logger (Sanitized Ring Buffer)
	// ==========================================
	const debugLogBuffer = [];

	function sanitizeDebugData(obj) {
		if (!obj) return obj;
		try {
			const str = JSON.stringify(obj, (key, value) => {
				if (typeof value === 'string') {
					if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
						return '[REDACTED_UUID]';
					}
					if (value.includes('@') && value.includes('.')) {
						return '[REDACTED_EMAIL]';
					}
					if (key.toLowerCase().includes('token') || key.toLowerCase().includes('cookie') || key.toLowerCase().includes('auth') || key.toLowerCase().includes('secret')) {
						return '[REDACTED_SECRET]';
					}
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
	// Org ID Retrieval (Task 1)
	// ==========================================
	let currentOrgId = null;
	let orgIdSource = null;

	function getOrgIdFromCookie() {
		try {
			const cookies = document.cookie.split(';');
			for (const item of cookies) {
				const trimmed = item.trim();
				if (trimmed.startsWith('lastActiveOrg=')) {
					const raw = trimmed.slice('lastActiveOrg='.length);
					const candidate = decodeURIComponent(raw.replace(/^["']|["']$/g, ''));
					if (isValidOrgId(candidate)) {
						return candidate;
					}
				}
			}
		} catch {
			// ignore
		}
		return null;
	}

	function resolveOrgId(sniffedCandidate = null) {
		// Priority 1: Valid UUID in lastActiveOrg cookie
		const cookieOrg = getOrgIdFromCookie();
		if (cookieOrg) {
			if (currentOrgId !== cookieOrg) {
				currentOrgId = cookieOrg;
				orgIdSource = 'cookie';
				logDebug('org_id_resolved', { source: 'cookie' });
			}
			return currentOrgId;
		}

		// Priority 2: Valid UUID sniffed from network paths
		if (sniffedCandidate && isValidOrgId(sniffedCandidate)) {
			if (currentOrgId !== sniffedCandidate) {
				currentOrgId = sniffedCandidate;
				orgIdSource = 'sniffed';
				logDebug('org_id_resolved', { source: 'sniffed' });
			}
			return currentOrgId;
		}

		if (currentOrgId && isValidOrgId(currentOrgId)) {
			return currentOrgId;
		}

		return null;
	}

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?#]+)/);
		return match ? match[1] : null;
	}

	// ==========================================
	// Request Discipline (Task 3)
	// ==========================================
	let usageInFlightPromise = null;
	let lastUsageFetchTime = 0;
	let consecutiveFetchErrors = 0;
	let lastRawUsagePayload = null;
	let lastSseMessageLimit = null;
	let currentNormalizedState = null;
	const MIN_FETCH_INTERVAL_MS = 30000; // 30s throttle
	const MAX_CONSECUTIVE_ERRORS = 3;

	// UI Controller
	const ui = new CC.ui.CounterUI({
		onUsageRefresh: async () => {
			logDebug('manual_refresh_requested', {});
			consecutiveFetchErrors = 0; // reset backoff on manual retry
			await refreshUsage({ force: true });
		},
		onCopyDebug: () => {
			window.__CC_COPY_DEBUG_LOG();
		}
	});

	// Bridge readiness
	const bridgeReady = CC.injectBridgeOnce();

	async function fetchUsageFromEndpoint(orgId) {
		await bridgeReady;
		return await CC.bridge.requestUsage(orgId);
	}

	async function refreshUsage({ force = false } = {}) {
		const orgId = resolveOrgId();
		if (!orgId) {
			logDebug('refresh_usage_skipped', { reason: 'No valid orgId found yet' });
			// Quietly wait for an orgId to appear; do not throw red error
			return;
		}

		const now = Date.now();
		const timeSinceLast = now - lastUsageFetchTime;

		// 30s minimum interval throttle unless forced (e.g. after message stream or manual retry)
		if (!force && timeSinceLast < MIN_FETCH_INTERVAL_MS) {
			logDebug('refresh_usage_throttled', { timeSinceLast, minInterval: MIN_FETCH_INTERVAL_MS });
			return;
		}

		// Exponential backoff if consecutive errors occurred
		if (consecutiveFetchErrors >= MAX_CONSECUTIVE_ERRORS && !force) {
			logDebug('refresh_usage_backoff_stopped', { consecutiveFetchErrors });
			return;
		}

		// Promise deduplication: share single in-flight request
		if (usageInFlightPromise) {
			return await usageInFlightPromise;
		}

		usageInFlightPromise = (async () => {
			lastUsageFetchTime = Date.now();
			logDebug('fetch_usage_start', { source: orgIdSource });

			try {
				const raw = await fetchUsageFromEndpoint(orgId);
				consecutiveFetchErrors = 0;
				lastRawUsagePayload = raw;

				const normalized = normalizeUsagePayload(raw, lastSseMessageLimit);
				currentNormalizedState = normalized;

				logDebug('fetch_usage_success', {
					state: normalized.state,
					hasSession: normalized.session.pct !== null,
					hasWeekly: normalized.weekly.pct !== null
				});

				ui.setNormalizedUsage(normalized);
			} catch (err) {
				consecutiveFetchErrors++;
				logDebug('fetch_usage_error', {
					status: err?.status,
					message: err?.message,
					consecutiveErrors: consecutiveFetchErrors
				});

				const normalized = normalizeUsagePayload(null, null, {
					status: err?.status,
					message: err?.message
				});
				currentNormalizedState = normalized;
				ui.setNormalizedUsage(normalized);
			} finally {
				usageInFlightPromise = null;
			}
		})();

		return await usageInFlightPromise;
	}

	let currentConversationId = null;

	async function refreshConversation() {
		await bridgeReady;
		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		const orgId = resolveOrgId();
		if (!orgId) return;

		try {
			logDebug('fetch_conversation_start', { conversationId: currentConversationId });
			await CC.bridge.requestConversation(orgId, currentConversationId);
		} catch (err) {
			logDebug('fetch_conversation_error', { message: err?.message });
		}
	}

	// ==========================================
	// Bridge Event Handling
	// ==========================================
	CC.bridge.on('cc:detected_org', ({ orgId }) => {
		if (isValidOrgId(orgId)) {
			const changed = currentOrgId !== orgId;
			resolveOrgId(orgId);
			if (changed && (!currentNormalizedState || currentNormalizedState.state === 'empty')) {
				refreshUsage({ force: true });
			}
		}
	});

	CC.bridge.on('cc:generation_start', () => {
		if (!currentConversationId) return;
		ui.setPendingCache(true);
	});

	CC.bridge.on('cc:stream_completed', () => {
		logDebug('stream_completed', {});
		// Immediate post-message usage refresh (allowed to bypass 30s throttle)
		setTimeout(() => {
			consecutiveFetchErrors = 0;
			refreshUsage({ force: true });
		}, 1000);
	});

	CC.bridge.on('cc:message_limit', (messageLimit) => {
		logDebug('sse_message_limit_received', messageLimit);
		lastSseMessageLimit = messageLimit;

		// Re-normalize using SSE data
		const normalized = normalizeUsagePayload(lastRawUsagePayload, lastSseMessageLimit);
		currentNormalizedState = normalized;
		ui.setNormalizedUsage(normalized);
	});

	CC.bridge.on('cc:usage_intercepted', ({ orgId, data }) => {
		if (isValidOrgId(orgId)) resolveOrgId(orgId);
		logDebug('intercepted_usage_received', {});
		lastRawUsagePayload = data;

		const normalized = normalizeUsagePayload(data, lastSseMessageLimit);
		currentNormalizedState = normalized;
		ui.setNormalizedUsage(normalized);
	});

	CC.bridge.on('cc:conversation', async ({ orgId, conversationId, data }) => {
		if (!conversationId || conversationId !== currentConversationId) return;
		if (isValidOrgId(orgId)) resolveOrgId(orgId);
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
	// Panel Mounting & Self-Healing (Task 4)
	// ==========================================
	function ensurePanelAttached() {
		const target = document.body || document.documentElement;
		if (target && !target.contains(ui.rootElement)) {
			ui.attach();
			logDebug('panel_attached', {});
		}
	}

	// Mount immediately
	ensurePanelAttached();

	// Self-healing: lightweight MutationObserver on documentElement + interval check
	let mountDebounce = null;
	const healObserver = new MutationObserver(() => {
		if (mountDebounce) clearTimeout(mountDebounce);
		mountDebounce = setTimeout(() => {
			ensurePanelAttached();
		}, 300);
	});
	healObserver.observe(document.documentElement, { childList: true, subtree: false });
	if (document.body) {
		healObserver.observe(document.body, { childList: true, subtree: false });
	}

	setInterval(ensurePanelAttached, 1000);

	// ==========================================
	// SPA Navigation Watcher
	// ==========================================
	let lastKnownPath = window.location.pathname;

	async function handleUrlChange() {
		const newConvId = getConversationId();
		const pathChanged = window.location.pathname !== lastKnownPath;
		lastKnownPath = window.location.pathname;

		logDebug('url_change', { pathname: window.location.pathname, conversationId: newConvId });
		currentConversationId = newConvId;

		ui.setConversationActive(!!currentConversationId);

		if (!currentConversationId) {
			ui.setConversationMetrics();
		} else {
			await refreshConversation();
		}

		if (!currentNormalizedState || pathChanged) {
			await refreshUsage();
		}
	}

	window.addEventListener('popstate', handleUrlChange);
	CC.bridge.on('cc:urlchange', handleUrlChange);

	setInterval(() => {
		if (window.location.pathname !== lastKnownPath) {
			handleUrlChange();
		}
	}, 500);

	// Branch navigation listener
	document.addEventListener('click', (e) => {
		if (!currentConversationId) return;
		const btn = e.target.closest(CC.SELECTORS.BRANCH_BUTTONS);
		if (!btn) return;
		setTimeout(() => refreshConversation(), 300);
	});

	// Refresh on tab focus
	window.addEventListener('focus', () => {
		const now = Date.now();
		if (now - lastUsageFetchTime > MIN_FETCH_INTERVAL_MS) {
			refreshUsage();
		}
	});

	// ==========================================
	// Tick Loop (Countdowns & Slow Refresh)
	// ==========================================
	function tick() {
		ui.tick();

		const now = Date.now();

		// Check window rollover
		if (currentNormalizedState?.session?.resetsAt) {
			const resetMs = Date.parse(currentNormalizedState.session.resetsAt);
			if (now >= resetMs && now - resetMs < 2000) {
				logDebug('window_rollover', { window: '5h' });
				refreshUsage({ force: true });
			}
		}

		// Slow background refresh (every 5 minutes only while tab is visible)
		if (!document.hidden && now - lastUsageFetchTime > CC.CONST.SLOW_USAGE_REFRESH_INTERVAL_MS) {
			refreshUsage();
		}
	}

	setInterval(tick, 1000);

	// Initial trigger
	handleUrlChange();
})();
