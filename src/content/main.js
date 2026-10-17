(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	if (CC.__started) return;
	CC.__started = true;

	const { isValidOrgId, normalizeUsagePayload } = CC.normalize || {};

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

	function isCcDebugActive() {
		try {
			if (typeof localStorage !== 'undefined' && localStorage.getItem(CC.CONST?.DEBUG_STORAGE_KEY || 'cc_debug') === 'true') {
				return true;
			}
		} catch {
			// ignore SecurityError / access denied
		}
		return Boolean(globalThis.__CC_DEBUG);
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
		if (isCcDebugActive()) {
			console.log(`[UsageMeter:Debug] [${category}]`, entry.data);
		}
	}

	globalThis.__CC_COPY_DEBUG_LOG = () => {
		const formatted = JSON.stringify(debugLogBuffer, null, 2);
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			navigator.clipboard.writeText(formatted).then(() => {
				console.log('%c[Usage Meter] Debug log copied to clipboard! (Redacted)', 'color: #10b981; font-weight: bold;');
			});
		}
		return formatted;
	};

	if (typeof navigator !== 'undefined') {
		logDebug('init', { userAgent: navigator.userAgent });
	}

	// ==========================================
	// Org ID Retrieval (Task 1)
	// ==========================================
	let currentOrgId = null;
	let orgIdSource = null;

	function extractStatusAndNumbers(obj, depth = 0) {
		if (!obj || typeof obj !== 'object' || depth > 4) return null;
		const out = {};
		for (const [k, v] of Object.entries(obj)) {
			if (typeof v === 'number' && !isNaN(v)) {
				out[k] = v;
			} else if (typeof v === 'string') {
				const keyLower = k.toLowerCase();
				if (keyLower === 'status' || keyLower === 'severity' || keyLower === 'type' || keyLower === 'kind' || keyLower === 'group') {
					out[k] = v;
				}
			} else if (v && typeof v === 'object' && !Array.isArray(v)) {
				const nested = extractStatusAndNumbers(v, depth + 1);
				if (nested && Object.keys(nested).length > 0) {
					out[k] = nested;
				}
			}
		}
		return out;
	}

	function savePersistedLimit(orgId, messageLimit) {
		if (!isValidOrgId(orgId) || !messageLimit) return;
		try {
			if (typeof localStorage !== 'undefined') {
				const toStore = {
					windows: messageLimit.windows || null,
					resolved: messageLimit.resolved || null,
					capturedAt: Date.now()
				};
				localStorage.setItem(`cc_last_limit:${orgId}`, JSON.stringify(toStore));
			}
		} catch {
			// ignore SecurityError / quota
		}
	}

	function loadPersistedLimit(orgId) {
		if (!isValidOrgId(orgId)) return null;
		try {
			if (typeof localStorage !== 'undefined') {
				const raw = localStorage.getItem(`cc_last_limit:${orgId}`);
				if (raw) {
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === 'object') {
						return parsed;
					}
				}
			}
		} catch {
			// ignore
		}
		return null;
	}

	function onOrgChanged(newOrgId) {
		currentOrgId = newOrgId;
		lastRawUsagePayload = null;
		lastSseMessageLimit = null;

		const persisted = loadPersistedLimit(newOrgId);
		if (persisted) {
			lastSseMessageLimit = persisted;
			const normalized = normalizeUsagePayload(null, persisted, null, { capturedAt: persisted.capturedAt });
			currentNormalizedState = normalized;
			if (ui?.setNormalizedUsage) {
				ui.setNormalizedUsage(normalized);
			}
		} else {
			const empty = normalizeUsagePayload({ five_hour: null, seven_day: null });
			currentNormalizedState = empty;
			if (ui?.setNormalizedUsage) {
				ui.setNormalizedUsage(empty);
			}
		}
	}

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
				orgIdSource = 'cookie';
				logDebug('org_id_resolved', { source: 'cookie' });
				onOrgChanged(cookieOrg);
			}
			return currentOrgId;
		}

		// Priority 2: Valid UUID sniffed from network paths
		if (sniffedCandidate && isValidOrgId(sniffedCandidate)) {
			if (currentOrgId !== sniffedCandidate) {
				orgIdSource = 'sniffed';
				logDebug('org_id_resolved', { source: 'sniffed' });
				onOrgChanged(sniffedCandidate);
			}
			return currentOrgId;
		}

		if (currentOrgId && isValidOrgId(currentOrgId)) {
			return currentOrgId;
		}

		return null;
	}

	function getConversationId() {
		if (typeof window === 'undefined') return null;
		const match = window.location.pathname.match(/\/chat\/([^/?#]+)/);
		return match ? match[1] : null;
	}

	function resolveComposerCard(doc = (typeof document !== 'undefined' ? document : null)) {
		if (!doc) return null;
		const anchor = doc.querySelector(CC.SELECTORS?.CHAT_INPUT || '[data-testid="chat-input"]');
		if (!anchor) return null;

		// Primary: closest composer card by class bg-surface-3
		const cardByClass = anchor.closest('[class*="bg-surface-3"]');
		if (cardByClass && cardByClass.parentElement) {
			return { anchor, card: cardByClass };
		}

		// Fallback: exactly 6th ancestor of anchor (Level 6 in real evidence)
		let cur = anchor;
		for (let i = 0; i < 6; i++) {
			cur = cur ? cur.parentElement : null;
		}

		if (cur && cur.parentElement && cur !== doc.body && cur !== doc.documentElement) {
			return { anchor, card: cur };
		}

		return null;
	}

	CC.mount = { resolveComposerCard };

	if (typeof window === 'undefined' || typeof document === 'undefined') {
		if (typeof module !== 'undefined' && module.exports) {
			module.exports = {
				resolveComposerCard,
				getOrgIdFromCookie,
				resolveOrgId,
				getConversationId,
				savePersistedLimit,
				loadPersistedLimit,
				onOrgChanged,
				extractStatusAndNumbers
			};
		}
		return;
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
		},
		onToggleContextOrCache: () => {
			if (ui.shouldFetchConversation && ui.shouldFetchConversation()) {
				refreshConversation();
			}
		},
		onDebugLog: (category, data) => {
			logDebug(category, data);
		}
	});

	// If org is already resolved at startup (e.g. from cookie), load persisted limit immediately
	const initialOrg = resolveOrgId();
	if (initialOrg) {
		onOrgChanged(initialOrg);
	}

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

				if (isCcDebugActive() && CC.normalize?.redactUsageResponseShape) {
					logDebug('usage_response_shape', CC.normalize.redactUsageResponseShape(raw));
				}

				const normalized = normalizeUsagePayload(raw, lastSseMessageLimit, null, { capturedAt: lastSseMessageLimit?.capturedAt || null });
				if (normalized.limitMismatch) {
					logDebug('limit_percent_mismatch', {
						windowPct: normalized.limitMismatch.windowPct,
						resolvedPct: normalized.limitMismatch.resolvedPct
					});
				}
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
	let currentConversationLeafId = null;
	let conversationInFlight = null; // { conversationId, promise }
	let conversationPayloadSeq = 0;
	let lastStreamEndMs = null;
	let streamRetryTimeoutId = null;

	async function refreshConversation() {
		if (ui.shouldFetchConversation && !ui.shouldFetchConversation()) {
			return;
		}
		await bridgeReady;
		const convId = currentConversationId;
		if (!convId) {
			ui.setConversationLoading();
			return;
		}

		const orgId = resolveOrgId();
		if (!orgId) return;

		// Deduplicate only if in-flight request is for the exact same conversation
		if (conversationInFlight && conversationInFlight.conversationId === convId) {
			return await conversationInFlight.promise;
		}

		const inFlightEntry = { conversationId: convId, promise: null };
		inFlightEntry.promise = (async () => {
			try {
				logDebug('fetch_conversation_start', { conversationId: convId });
				await CC.bridge.requestConversation(orgId, convId);
			} catch (err) {
				logDebug('fetch_conversation_error', { message: err?.message });
			} finally {
				// Clear only if stored entry is still the same object
				if (conversationInFlight === inFlightEntry) {
					conversationInFlight = null;
				}
			}
		})();

		conversationInFlight = inFlightEntry;
		return await inFlightEntry.promise;
	}

	async function triggerStreamPostRefetch(convId, preLeafId, preTokens, streamEndMs) {
		if (ui.shouldFetchConversation && !ui.shouldFetchConversation()) {
			return;
		}
		if (streamRetryTimeoutId) {
			clearTimeout(streamRetryTimeoutId);
			streamRetryTimeoutId = null;
		}

		await refreshConversation();

		if (currentConversationId !== convId) return;

		const currentLeaf = currentConversationLeafId;
		const currentTokens = ui.metrics?.context?.tokens ?? null;
		const leafChanged = Boolean(currentLeaf && currentLeaf !== preLeafId);
		const tokensChanged = typeof currentTokens === 'number' && typeof preTokens === 'number' && currentTokens !== preTokens;

		// If leaf message ID or token count did NOT change, retry ONCE after ~1500ms, then stop
		if (!leafChanged && !tokensChanged) {
			streamRetryTimeoutId = setTimeout(async () => {
				streamRetryTimeoutId = null;
				if (currentConversationId !== convId) return;
				logDebug('refetch_start', {
					conversationId: convId,
					reason: 'stream_retry_1500ms',
					elapsedMs: Date.now() - streamEndMs
				});
				await refreshConversation();
			}, 1500);
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
			if (currentConversationId && (!ui.metrics.context.isLoaded || changed)) {
				refreshConversation();
			}
		}
	});

	CC.bridge.on('cc:generation_start', () => {
		if (!currentConversationId) return;
		ui.setPendingCache(true);
	});

	CC.bridge.on('cc:stream_completed', (streamInfo = {}) => {
		const streamEndMs = Date.now();
		lastStreamEndMs = streamEndMs;
		logDebug('stream_end', { conversationId: currentConversationId });

		if (isCcDebugActive()) {
			logDebug('sse_event_types', { types: Array.isArray(streamInfo?.eventTypes) ? streamInfo.eventTypes : [] });
			if (!streamInfo?.messageLimitSeen) {
				logDebug('message_limit_not_seen', {});
			}
		}

		ensurePanelAttached();

		// Immediate conversation refetch after stream completion
		if (currentConversationId && (!ui.shouldFetchConversation || ui.shouldFetchConversation())) {
			const preLeafId = currentConversationLeafId;
			const preTokens = ui.metrics?.context?.tokens ?? null;
			logDebug('refetch_start', {
				conversationId: currentConversationId,
				reason: 'stream_end',
				elapsedMs: Date.now() - streamEndMs
			});
			triggerStreamPostRefetch(currentConversationId, preLeafId, preTokens, streamEndMs);
		}

		// Existing post-message usage refresh (allowed to bypass 30s throttle)
		setTimeout(() => {
			consecutiveFetchErrors = 0;
			ensurePanelAttached();
			refreshUsage({ force: true });
		}, 1000);
	});

	CC.bridge.on('cc:diag', (diag = {}) => {
		if (isCcDebugActive() && diag && typeof diag.category === 'string') {
			logDebug(diag.category, diag.data || {});
		}
	});

	CC.bridge.on('cc:message_limit_raw', (rawEvent) => {
		if (isCcDebugActive() && CC.normalize?.redactMessageLimitShape) {
			logDebug('message_limit_event_shape', CC.normalize.redactMessageLimitShape(rawEvent));
		}
	});

	CC.bridge.on('cc:message_limit', (messageLimit) => {
		logDebug('sse_message_limit_received', messageLimit);
		if (isCcDebugActive()) {
			logDebug('message_limit_received', extractStatusAndNumbers(messageLimit));
		}
		lastSseMessageLimit = messageLimit;
		const orgId = resolveOrgId();
		if (orgId) {
			savePersistedLimit(orgId, messageLimit);
		}

		// Re-normalize using SSE data
		const capturedAt = Date.now();
		const normalized = normalizeUsagePayload(lastRawUsagePayload, lastSseMessageLimit, null, { capturedAt });
		if (normalized.limitMismatch) {
			logDebug('limit_percent_mismatch', {
				windowPct: normalized.limitMismatch.windowPct,
				resolvedPct: normalized.limitMismatch.resolvedPct
			});
		}
		currentNormalizedState = normalized;
		ui.setNormalizedUsage(normalized);
	});

	CC.bridge.on('cc:usage_intercepted', ({ orgId, data }) => {
		if (isValidOrgId(orgId)) resolveOrgId(orgId);
		logDebug('intercepted_usage_received', {});
		lastRawUsagePayload = data;

		if (isCcDebugActive() && CC.normalize?.redactUsageResponseShape) {
			logDebug('usage_response_shape', CC.normalize.redactUsageResponseShape(data));
		}

		const normalized = normalizeUsagePayload(data, lastSseMessageLimit, null, { capturedAt: lastSseMessageLimit?.capturedAt || null });
		if (normalized.limitMismatch) {
			logDebug('limit_percent_mismatch', {
				windowPct: normalized.limitMismatch.windowPct,
				resolvedPct: normalized.limitMismatch.resolvedPct
			});
		}
		currentNormalizedState = normalized;
		ui.setNormalizedUsage(normalized);
	});

	CC.bridge.on('cc:conversation', async ({ orgId, conversationId, data }) => {
		if (ui.shouldFetchConversation && !ui.shouldFetchConversation()) return;
		if (!conversationId || conversationId !== currentConversationId) return;
		if (isValidOrgId(orgId)) resolveOrgId(orgId);
		if (!data || typeof data !== 'object' || !Array.isArray(data.chat_messages)) return;

		const payloadSeq = ++conversationPayloadSeq;

		// Debug scan: log top-level and first message key names + numeric/model matches only
		if (CC.tokens?.scanPayloadDebugKeys) {
			const keyScan = CC.tokens.scanPayloadDebugKeys(data);
			logDebug('conversation_payload_keys', keyScan);
		}

		try {
			const metrics = await CC.tokens.computeConversationMetrics(data);

			// Post-tokenization re-check: must match current active chat and be newest sequence
			if (conversationId !== currentConversationId || payloadSeq !== conversationPayloadSeq) {
				logDebug('conversation_metrics_dropped_stale', {
					conversationId,
					currentConversationId,
					payloadSeq,
					latestSeq: conversationPayloadSeq
				});
				return;
			}

			if (data.current_leaf_message_uuid) {
				currentConversationLeafId = data.current_leaf_message_uuid;
			}

			const elapsedMs = lastStreamEndMs ? (Date.now() - lastStreamEndMs) : null;
			logDebug('metrics_computed', {
				tokens: metrics.totalTokens,
				elapsedMs
			});
			logDebug('conversation_metrics_computed', {
				tokens: metrics.totalTokens,
				cachedUntil: metrics.cachedUntil,
				elapsedMs
			});
			ui.setConversationMetrics({
				totalTokens: metrics.totalTokens,
				cachedUntil: metrics.cachedUntil,
				isLoaded: metrics.isLoaded
			});
		} catch (err) {
			logDebug('conversation_metrics_error', { message: err?.message });
		}
	});

	// ==========================================
	// Inline Panel Mounting & Self-Healing
	// ==========================================
	let lastObservedParent = null;

	function ensurePanelAttached() {
		ui.initialize();

		const target = resolveComposerCard();
		if (!target || !target.card || !target.card.parentElement) {
			logDebug('mount_target_not_found', { reason: 'No composer card found' });
			return false;
		}

		const { card } = target;
		const parent = card.parentElement;

		// Guard against duplicate hosts (#cc-usage-meter-root)
		const rootId = CC.DOM?.METER_ROOT_ID || 'cc-usage-meter-root';
		const existing = document.querySelectorAll(`#${rootId}`);
		for (const el of existing) {
			if (el !== ui.rootElement && el.parentElement) {
				el.parentElement.removeChild(el);
			}
		}

		// If already mounted as previous sibling of card, keep state intact
		if (ui.rootElement.parentElement === parent && ui.rootElement.nextElementSibling === card) {
			return true;
		}

		// Normal document flow: insert directly above the composer card
		parent.insertBefore(ui.rootElement, card);
		logDebug('panel_mounted_inline', {});
		if (ui.logPanelRenderState) ui.logPanelRenderState();

		// Attach observer to closest stable container (parent of card)
		if (parent !== lastObservedParent) {
			lastObservedParent = parent;
			try {
				parentObserver.disconnect();
				parentObserver.observe(parent, { childList: true });
			} catch {
				// ignore
			}
		}

		return true;
	}

	let mountDebounce = null;
	function throttledRemount() {
		if (mountDebounce) clearTimeout(mountDebounce);
		mountDebounce = setTimeout(() => {
			ensurePanelAttached();
		}, 100);
	}

	const parentObserver = new MutationObserver(throttledRemount);
	const healObserver = new MutationObserver(throttledRemount);
	if (document.body) {
		healObserver.observe(document.body, { childList: true, subtree: true });
	} else if (document.documentElement) {
		healObserver.observe(document.documentElement, { childList: true, subtree: true });
	}

	// Mount immediately
	ensurePanelAttached();

	const mountInterval = setInterval(ensurePanelAttached, 1000);
	if (typeof mountInterval?.unref === 'function') {
		mountInterval.unref();
	}

	// ==========================================
	// SPA Navigation Watcher
	// ==========================================
	let lastKnownPath = window.location.pathname;

	async function handleUrlChange() {
		ensurePanelAttached();
		const newConvId = getConversationId();
		const convChanged = newConvId !== currentConversationId;
		const pathChanged = window.location.pathname !== lastKnownPath;
		lastKnownPath = window.location.pathname;

		logDebug('url_change', { pathname: window.location.pathname, conversationId: newConvId });
		currentConversationId = newConvId;

		ui.setConversationActive(!!currentConversationId);

		if (!currentConversationId) {
			currentConversationLeafId = null;
			conversationPayloadSeq++;
			if (streamRetryTimeoutId) {
				clearTimeout(streamRetryTimeoutId);
				streamRetryTimeoutId = null;
			}
			lastStreamEndMs = null;
			ui.setConversationLoading();
		} else {
			if (convChanged) {
				currentConversationLeafId = null;
				conversationPayloadSeq++;
				if (streamRetryTimeoutId) {
					clearTimeout(streamRetryTimeoutId);
					streamRetryTimeoutId = null;
				}
				lastStreamEndMs = null;
				ui.setConversationLoading();
			}
			await refreshConversation();
		}

		if (!currentNormalizedState || pathChanged) {
			await refreshUsage();
		}
	}

	window.addEventListener('popstate', handleUrlChange);
	CC.bridge.on('cc:urlchange', handleUrlChange);

	const pollInterval = setInterval(() => {
		if (window.location.pathname !== lastKnownPath) {
			handleUrlChange();
		}
	}, 500);
	if (typeof pollInterval?.unref === 'function') {
		pollInterval.unref();
	}

	// Sidebar & in-page chat navigation click listener
	document.addEventListener('click', (e) => {
		const link = e.target.closest('a[href*="/chat/"]');
		if (link) {
			setTimeout(handleUrlChange, 100);
		}
	});

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

	const tickInterval = setInterval(tick, 1000);
	if (typeof tickInterval?.unref === 'function') {
		tickInterval.unref();
	}

	// Initial trigger
	handleUrlChange();

	CC.mount = { resolveComposerCard };
	CC._internal = {
		triggerStreamPostRefetch,
		refreshConversation,
		refreshUsage,
		getUi: () => ui,
		savePersistedLimit,
		loadPersistedLimit,
		onOrgChanged,
		extractStatusAndNumbers,
		getConversationInFlight: () => conversationInFlight,
		getCurrentConversationId: () => currentConversationId,
		setCurrentConversationId: (id) => { currentConversationId = id; },
		getCurrentConversationLeafId: () => currentConversationLeafId,
		setCurrentConversationLeafId: (id) => { currentConversationLeafId = id; },
		getStreamRetryTimeoutId: () => streamRetryTimeoutId,
		getConversationPayloadSeq: () => conversationPayloadSeq,
		isCcDebugActive,
		getDebugLogBuffer: () => debugLogBuffer
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = {
			resolveComposerCard,
			getOrgIdFromCookie,
			resolveOrgId,
			getConversationId,
			triggerStreamPostRefetch,
			refreshConversation,
			savePersistedLimit,
			loadPersistedLimit,
			onOrgChanged,
			extractStatusAndNumbers,
			_internal: CC._internal
		};
	}
})();
