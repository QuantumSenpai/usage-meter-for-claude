(() => {
	'use strict';

	const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	function isValidOrgId(id) {
		return typeof id === 'string' && UUID_REGEX.test(id) && id.toLowerCase() !== 'discoverable';
	}

	function normalizeUtilization(val) {
		if (typeof val !== 'number' || !Number.isFinite(val)) return null;
		// Detect 0.0 - 1.0 fraction vs 0 - 100 percentage
		// If 0 < val <= 1, scale fraction to percentage (e.g. 0.42 -> 42%)
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

	/**
	 * normalizeUsagePayload(payload, sseFallback, errorContext)
	 *
	 * Returns:
	 * {
	 *   session: { pct: number|null, resetsAt: string|null },
	 *   weekly: { pct: number|null, resetsAt: string|null },
	 *   extras: Array<{ label: string, pct: number|null, resetsAt: string|null }>,
	 *   state: "ok" | "empty" | "error",
	 *   errorReason: string|null
	 * }
	 */
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
					extras.push({
						label: item.name || item.label || item.type || 'Limit',
						pct: w.pct,
						resetsAt: w.resetsAt
					});
				}
			}
		}

		// SSE fallback: if /usage is empty but SSE message_limit had active window data
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

	const exp = {
		UUID_REGEX,
		isValidOrgId,
		normalizeUtilization,
		normalizeResetsAt,
		normalizeUsagePayload
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = exp;
	}

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	CC.normalize = exp;
})();
