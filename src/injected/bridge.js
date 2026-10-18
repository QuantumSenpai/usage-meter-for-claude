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

	// 1.5 Diagnostic JSON & Proto Scanners (Active only when cc_debug is on)
	const LIMIT_KEY_REGEX = /limit|usage|utiliz|quota|remaining|reset|percent|severity|notice|banner/i;
	const PROTO_TOKENS = [
		'five_hour',
		'seven_day',
		'within_limit',
		'utilization',
		'message_limit',
		'resets_at',
		'rate_limit',
		'usage_limit',
		'representativeClaim',
		'overage'
	];
	const MAX_LIMIT_KEYS = 40;
	const MAX_PROTO_TOKEN_LOGS = 80;
	const MAX_PROTO_DONE_LOGS = 40;
	const MAX_PROTO_FRAME_TEXT_LOGS = 5;
	const MAX_PROTO_SCAN_BYTES = 262144; // 256 KB
	const MAX_PROTO_SCAN_TIME_MS = 15000; // 15s
	const STREAM_TIMELINE_MAX_BYTES = 1048576; // 1 MiB
	const STREAM_TIMELINE_HARD_CAP_MS = 600000; // 600s

	let limitKeyCount = 0;
	const seenLimitKeys = new Set();
	let protoTokenLogCount = 0;
	let protoDoneLogCount = 0;
	let protoFrameTextLogCount = 0;

	function getValueType(val) {
		if (val === null) return 'null';
		if (Array.isArray(val)) return 'array';
		const t = typeof val;
		if (t === 'number') return 'number';
		if (t === 'string') return 'string';
		if (t === 'boolean') return 'boolean';
		if (t === 'object') return 'object';
		return t;
	}

	function walkJson(obj, currentPath, depth, pathShape) {
		if (!obj || typeof obj !== 'object' || depth > 6) return;
		if (limitKeyCount >= MAX_LIMIT_KEYS) return;

		if (Array.isArray(obj)) {
			for (let i = 0; i < obj.length; i++) {
				if (limitKeyCount >= MAX_LIMIT_KEYS) break;
				const nextPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
				walkJson(obj[i], nextPath, depth + 1, pathShape);
			}
			return;
		}

		const keys = Object.keys(obj);
		for (const k of keys) {
			if (limitKeyCount >= MAX_LIMIT_KEYS) break;
			const nextPath = currentPath ? `${currentPath}.${k}` : k;
			const val = obj[k];

			if (LIMIT_KEY_REGEX.test(k)) {
				const dedupeKey = `${pathShape}::${nextPath}`;
				if (!seenLimitKeys.has(dedupeKey)) {
					seenLimitKeys.add(dedupeKey);
					limitKeyCount++;
					postDiag('limit_key_seen', {
						pathShape,
						keyPath: nextPath,
						valueType: getValueType(val)
					});
				}
			}

			if (val && typeof val === 'object' && depth < 6) {
				walkJson(val, nextPath, depth + 1, pathShape);
			}
		}
	}

	async function scanJsonResponse(response, pathShape, host, pathname, ct) {
		try {
			if (!isDebugActive()) return;
			if (limitKeyCount >= MAX_LIMIT_KEYS) return;
			if (host !== 'claude.ai') return;
			if (!pathname.startsWith('/api/')) return;
			if (response.status !== 200) return;
			if (!ct || !ct.toLowerCase().includes('application/json')) return;

			let cloned;
			try {
				cloned = response.clone();
			} catch {
				return;
			}

			const text = await cloned.text();
			if (typeof text !== 'string' || text.length > 200000) return;

			let data;
			try {
				data = JSON.parse(text);
			} catch {
				return;
			}
			if (!data || typeof data !== 'object') return;

			walkJson(data, '', 1, pathShape);
		} catch {
			// ignore
		}
	}

	async function scanBinaryResponse(response, pathShape, host, pathname, ct) {
		try {
			if (!isDebugActive()) return;
			if (protoDoneLogCount >= MAX_PROTO_DONE_LOGS && protoTokenLogCount >= MAX_PROTO_TOKEN_LOGS && protoFrameTextLogCount >= MAX_PROTO_FRAME_TEXT_LOGS) return;

			const isProtoCt = Boolean(ct && ct.toLowerCase().includes('proto'));
			const isRpcPath = host === 'claude.ai' && pathname.startsWith('/claudeai-rpc/');
			if (!isProtoCt && !isRpcPath) return;

			let cloned;
			try {
				cloned = response.clone();
			} catch {
				return;
			}

			const reader = cloned?.body?.getReader?.();
			if (!reader) return;

			const isStreamTimeline = isRpcPath && (pathname.endsWith('/StreamTimeline') || pathname.endsWith('/StreamTimeline/'));
			const maxBytes = isStreamTimeline ? STREAM_TIMELINE_MAX_BYTES : MAX_PROTO_SCAN_BYTES;
			const maxTimeMs = isStreamTimeline ? STREAM_TIMELINE_HARD_CAP_MS : MAX_PROTO_SCAN_TIME_MS;

			const chunks = [];
			let totalBytes = 0;
			let reason = 'stream_end';
			let timedOut = false;

			// Connect frame parser state
			let streamFrameIndex = 0;
			let streamFrameMetaCount = 0; // max 40 per scanned stream
			const parsedFrames = []; // { frameIndex, start, end }

			let parserState = 0; // 0 = reading 5-byte header, 1 = skipping payload
			const headerBuf = new Uint8Array(5);
			let headerBytesNeeded = 5;
			let currentPayloadRemaining = 0;
			let currentFrameStart = 0;

			// Candidate frame payload buffer for proto_frame_text
			let candidatePayloadBuf = null;
			let candidatePayloadBytesRead = 0;
			let candidateFrameIndex = -1;
			let candidateFrameLength = 0;

			function checkAndEmitFrameText(payload, frameIndex, length) {
				let latin1 = '';
				for (let j = 0; j < payload.length; j++) {
					latin1 += String.fromCharCode(payload[j]);
				}
				const hasToken = PROTO_TOKENS.some(token => latin1.includes(token));
				if (!hasToken) return;

				if (protoFrameTextLogCount >= MAX_PROTO_FRAME_TEXT_LOGS) return;
				protoFrameTextLogCount++;

				const headLen = Math.min(8, payload.length);
				let head8hex = '';
				for (let j = 0; j < headLen; j++) {
					head8hex += payload[j].toString(16).padStart(2, '0');
				}

				let frameAscii = '';
				for (let j = 0; j < payload.length; j++) {
					const b = payload[j];
					if (b >= 0x20 && b <= 0x7E) {
						frameAscii += String.fromCharCode(b);
					} else {
						frameAscii += '.';
					}
				}

				frameAscii = frameAscii.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '[UUID]');
				frameAscii = frameAscii.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]+/g, '[EMAIL]');
				frameAscii = frameAscii.replace(/@/g, '(at)');

				if (frameAscii.length > 512) {
					frameAscii = frameAscii.slice(0, 512);
				}

				const diagData = {
					pathShape,
					frameIndex,
					length,
					head8hex,
					frameAscii
				};

				if (payload.length <= 256 && (latin1.includes('five_hour') || latin1.includes('seven_day') || latin1.includes('within_limit') || latin1.includes('utilization'))) {
					let frameHex = '';
					for (let j = 0; j < payload.length; j++) {
						frameHex += payload[j].toString(16).padStart(2, '0');
					}
					diagData.frameHex = frameHex;
				}

				postDiag('proto_frame_text', diagData);
			}

			function processChunkForFrames(chunk) {
				let i = 0;
				while (i < chunk.length) {
					if (parserState === 0) {
						const needed = headerBytesNeeded;
						const available = chunk.length - i;
						if (available < needed) {
							headerBuf.set(chunk.subarray(i, i + available), 5 - needed);
							headerBytesNeeded -= available;
							i += available;
						} else {
							headerBuf.set(chunk.subarray(i, i + needed), 5 - needed);
							i += needed;
							headerBytesNeeded = 5;

							const flags = headerBuf[0];
							const length = ((headerBuf[1] << 24) | (headerBuf[2] << 16) | (headerBuf[3] << 8) | headerBuf[4]) >>> 0;

							const fIndex = streamFrameIndex++;
							const frameStart = currentFrameStart;
							const frameEnd = frameStart + 5 + length;
							parsedFrames.push({ frameIndex: fIndex, start: frameStart, end: frameEnd });

							if (streamFrameMetaCount < 40) {
								streamFrameMetaCount++;
								postDiag('proto_frame_meta', { pathShape, frameIndex: fIndex, flags, length });
								if ((flags & 0x01) !== 0) {
									postDiag('proto_compressed_seen', { pathShape, frameIndex: fIndex });
								}
							}

							const isCandidate = (flags & 0x01) === 0 && (flags & 0x02) === 0 && length <= 512 && protoFrameTextLogCount < MAX_PROTO_FRAME_TEXT_LOGS;
							if (isCandidate && length > 0) {
								candidatePayloadBuf = new Uint8Array(length);
								candidatePayloadBytesRead = 0;
								candidateFrameIndex = fIndex;
								candidateFrameLength = length;
							} else {
								candidatePayloadBuf = null;
								candidatePayloadBytesRead = 0;
								candidateFrameIndex = -1;
								candidateFrameLength = 0;
							}

							currentPayloadRemaining = length;
							if (length === 0) {
								parserState = 0;
								currentFrameStart = frameEnd;
							} else {
								parserState = 1;
							}
						}
					} else {
						const needed = currentPayloadRemaining;
						const available = chunk.length - i;
						const toRead = Math.min(needed, available);

						if (candidatePayloadBuf) {
							candidatePayloadBuf.set(chunk.subarray(i, i + toRead), candidatePayloadBytesRead);
							candidatePayloadBytesRead += toRead;
						}

						currentPayloadRemaining -= toRead;
						i += toRead;

						if (currentPayloadRemaining === 0) {
							if (candidatePayloadBuf) {
								checkAndEmitFrameText(candidatePayloadBuf, candidateFrameIndex, candidateFrameLength);
								candidatePayloadBuf = null;
							}
							parserState = 0;
							currentFrameStart = (parsedFrames.length > 0) ? parsedFrames[parsedFrames.length - 1].end : (currentFrameStart + 5);
						}
					}
				}
			}

			// Incremental token scanner state
			const MAX_TOKEN_LEN = 19; // 'representativeClaim'.length
			const TAIL_LEN = MAX_TOKEN_LEN - 1; // 18
			let prevTail = new Uint8Array(0);
			const streamTokens = new Map(); // token -> { count, firstOffset, frameIndex, loggedInitial, initialLoggedCount }
			const incremental = true;

			function processChunkForTokens(chunk, chunkOffset) {
				const prevTailLen = prevTail.length;
				const searchBuf = new Uint8Array(prevTailLen + chunk.length);
				if (prevTailLen > 0) {
					searchBuf.set(prevTail, 0);
				}
				searchBuf.set(chunk, prevTailLen);

				const bufStartOffset = chunkOffset - prevTailLen;
				const text = new TextDecoder('latin1').decode(searchBuf);

				for (const token of PROTO_TOKENS) {
					let pos = 0;
					while ((pos = text.indexOf(token, pos)) !== -1) {
						if (pos + token.length > prevTailLen) {
							const absOffset = bufStartOffset + pos;
							let entry = streamTokens.get(token);
							if (!entry) {
								let matchedFrameIndex = -1;
								for (const f of parsedFrames) {
									if (absOffset >= f.start && absOffset < f.end) {
										matchedFrameIndex = f.frameIndex;
										break;
									}
								}
								entry = {
									count: 1,
									firstOffset: absOffset,
									frameIndex: matchedFrameIndex,
									loggedInitial: false,
									initialLoggedCount: 0
								};
								streamTokens.set(token, entry);

								if (protoTokenLogCount < MAX_PROTO_TOKEN_LOGS) {
									protoTokenLogCount++;
									entry.loggedInitial = true;
									entry.initialLoggedCount = 1;
									postDiag('proto_token_seen', {
										pathShape,
										needle: token,
										count: entry.count,
										firstOffset: entry.firstOffset,
										frameIndex: entry.frameIndex
									});
								}
							} else {
								entry.count++;
								if (entry.frameIndex === -1) {
									for (const f of parsedFrames) {
										if (entry.firstOffset >= f.start && entry.firstOffset < f.end) {
											entry.frameIndex = f.frameIndex;
											break;
										}
									}
								}
							}
						}
						pos += token.length;
					}
				}

				if (chunk.length >= TAIL_LEN) {
					prevTail = chunk.slice(chunk.length - TAIL_LEN);
				} else {
					const start = Math.max(0, searchBuf.length - TAIL_LEN);
					prevTail = searchBuf.slice(start);
				}
			}

			const timer = setTimeout(() => {
				timedOut = true;
				try {
					reader.cancel().catch(() => {});
				} catch {
					// ignore
				}
			}, maxTimeMs);

			try {
				while (true) {
					let readResult;
					try {
						readResult = await reader.read();
					} catch {
						reason = timedOut ? 'time_cap' : 'error';
						break;
					}

					if (timedOut) {
						reason = 'time_cap';
						break;
					}

					const { done, value } = readResult;
					if (done) {
						reason = 'stream_end';
						break;
					}

					if (value && value.length > 0) {
						const remaining = maxBytes - totalBytes;
						const chunkToScan = value.length >= remaining ? value.subarray(0, remaining) : value;
						chunks.push(chunkToScan);
						processChunkForFrames(chunkToScan);
						if (incremental) {
							processChunkForTokens(chunkToScan, totalBytes);
						}
						totalBytes += chunkToScan.length;
						if (value.length >= remaining) {
							reason = 'size_cap';
							break;
						}
					}
				}
			} finally {
				clearTimeout(timer);
				try {
					reader.cancel().catch(() => {});
				} catch {
					// ignore
				}
			}

			if (!incremental) {
				let off = 0;
				for (const chunk of chunks) {
					processChunkForTokens(chunk, off);
					off += chunk.length;
				}
			}

			if (streamTokens.size > 0) {
				for (const [token, entry] of streamTokens) {
					if (entry.frameIndex === -1) {
						for (const f of parsedFrames) {
							if (entry.firstOffset >= f.start && entry.firstOffset < f.end) {
								entry.frameIndex = f.frameIndex;
								break;
							}
						}
					}

					// Log again with updated count only when scan ends
					if (entry.count > entry.initialLoggedCount || !entry.loggedInitial) {
						if (protoTokenLogCount < MAX_PROTO_TOKEN_LOGS) {
							protoTokenLogCount++;
							postDiag('proto_token_seen', {
								pathShape,
								needle: token,
								count: entry.count,
								firstOffset: entry.firstOffset,
								frameIndex: entry.frameIndex
							});
						}
					}
				}
			}

			if (protoDoneLogCount < MAX_PROTO_DONE_LOGS) {
				protoDoneLogCount++;
				postDiag('proto_scan_done', { pathShape, bytesRead: totalBytes, reason });
			}
		} catch {
			// ignore
		}
	}

	function inspectRequestBodyMeta(body) {
		if (body === undefined || body === null) {
			return { bodyType: 'empty', bodyByteLength: 0 };
		}
		if (typeof body === 'string') {
			const len = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(body).length : body.length;
			return { bodyType: 'string', bodyByteLength: len };
		}
		if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
			return { bodyType: 'arraybuffer', bodyByteLength: body.byteLength };
		}
		if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(body)) {
			return { bodyType: 'typedarray', bodyByteLength: body.byteLength };
		}
		if (typeof Blob !== 'undefined' && body instanceof Blob) {
			return { bodyType: 'blob', bodyByteLength: body.size };
		}
		if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
			const str = body.toString();
			const len = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str).length : str.length;
			return { bodyType: 'urlsearchparams', bodyByteLength: len };
		}
		if (typeof FormData !== 'undefined' && body instanceof FormData) {
			return { bodyType: 'formdata', bodyByteLength: -1 };
		}
		if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
			return { bodyType: 'stream', bodyByteLength: -1 };
		}
		return { bodyType: typeof body, bodyByteLength: -1 };
	}

	// Production Connect-frame limit extractor and protobuf parser
	function decodeProtoVarint(buf, offset, limit) {
		let res = 0;
		let shift = 0;
		let i = offset;
		let count = 0;
		while (i < limit) {
			if (count >= 10) return null;
			const b = buf[i++];
			count++;
			res += (b & 0x7f) * Math.pow(2, shift);
			if ((b & 0x80) === 0) return { val: res, next: i };
			shift += 7;
		}
		return null;
	}

	function parseWindowMessage(buf, offset, end) {
		let i = offset;
		let name = null;
		let resets_at = null;
		let utilization = null;

		while (i < end) {
			const key = decodeProtoVarint(buf, i, end);
			if (!key) return null;
			i = key.next;
			const fieldNum = Math.floor(key.val / 8);
			const wireType = key.val & 7;
			if (wireType > 2 || fieldNum === 0) return null;

			if (fieldNum === 1 && wireType === 2) {
				const len = decodeProtoVarint(buf, i, end);
				if (!len) return null;
				i = len.next;
				if (i + len.val > end) return null;
				name = new TextDecoder('utf-8').decode(buf.subarray(i, i + len.val));
				i += len.val;
			} else if (fieldNum === 2 && wireType === 2) {
				const len = decodeProtoVarint(buf, i, end);
				if (!len) return null;
				i = len.next;
				const metaEnd = i + len.val;
				if (metaEnd > end) return null;
				let j = i;
				while (j < metaEnd) {
					const mKey = decodeProtoVarint(buf, j, metaEnd);
					if (!mKey) return null;
					j = mKey.next;
					const mField = Math.floor(mKey.val / 8);
					const mWire = mKey.val & 7;
					if (mWire > 2 || mField === 0) return null;

					if (mField === 3 && mWire === 1) {
						if (j + 8 > metaEnd) return null;
						const view = new DataView(buf.buffer, buf.byteOffset + j, 8);
						utilization = view.getFloat64(0, true);
						j += 8;
					} else if (mField === 2 && mWire === 2) {
						const rLen = decodeProtoVarint(buf, j, metaEnd);
						if (!rLen) return null;
						j = rLen.next;
						const rEnd = j + rLen.val;
						if (rEnd > metaEnd) return null;
						let k = j;
						while (k < rEnd) {
							const rKey = decodeProtoVarint(buf, k, rEnd);
							if (!rKey) return null;
							k = rKey.next;
							const rField = Math.floor(rKey.val / 8);
							const rWire = rKey.val & 7;
							if (rWire > 2 || rField === 0) return null;
							if (rField === 1 && rWire === 0) {
								const rVal = decodeProtoVarint(buf, k, rEnd);
								if (!rVal) return null;
								resets_at = rVal.val;
								k = rVal.next;
							} else if (rWire === 0) {
								const s = decodeProtoVarint(buf, k, rEnd);
								if (!s) return null;
								k = s.next;
							} else if (rWire === 1) {
								if (k + 8 > rEnd) return null;
								k += 8;
							} else if (rWire === 2) {
								const sLen = decodeProtoVarint(buf, k, rEnd);
								if (!sLen) return null;
								k = sLen.next + sLen.val;
								if (k > rEnd) return null;
							}
						}
						j = rEnd;
					} else if (mWire === 0) {
						const s = decodeProtoVarint(buf, j, metaEnd);
						if (!s) return null;
						j = s.next;
					} else if (mWire === 1) {
						if (j + 8 > metaEnd) return null;
						j += 8;
					} else if (mWire === 2) {
						const sLen = decodeProtoVarint(buf, j, metaEnd);
						if (!sLen) return null;
						j = sLen.next + sLen.val;
						if (j > metaEnd) return null;
					}
				}
				i = metaEnd;
			} else if (wireType === 0) {
				const s = decodeProtoVarint(buf, i, end);
				if (!s) return null;
				i = s.next;
			} else if (wireType === 1) {
				if (i + 8 > end) return null;
				i += 8;
			} else if (wireType === 2) {
				const sLen = decodeProtoVarint(buf, i, end);
				if (!sLen) return null;
				i = sLen.next + sLen.val;
				if (i > end) return null;
			}
		}
		return { name, resets_at, utilization };
	}

	function parseProtoMessage(buf, offset, end, windows, missingWindows) {
		let i = offset;
		while (i < end) {
			const key = decodeProtoVarint(buf, i, end);
			if (!key) return false;
			i = key.next;
			const fieldNum = Math.floor(key.val / 8);
			const wireType = key.val & 7;
			if (wireType > 2 || fieldNum === 0) return false;

			if (fieldNum === 13 && wireType === 2) {
				const len = decodeProtoVarint(buf, i, end);
				if (!len) return false;
				i = len.next;
				if (i + len.val > end) return false;
				const win = parseWindowMessage(buf, i, i + len.val);
				if (!win) return false;
				if (win.name === '5h' || win.name === '7d') {
					if (win.utilization === null || win.utilization === undefined) {
						missingWindows.push(win.name);
					} else if (
						typeof win.utilization === 'number' &&
						Number.isFinite(win.utilization) &&
						win.utilization >= 0 &&
						Number.isInteger(win.resets_at) &&
						win.resets_at >= 1600000000 &&
						win.resets_at <= 2500000000
					) {
						windows[win.name] = {
							utilization: win.utilization,
							resets_at: win.resets_at
						};
					}
				}
				i += len.val;
			} else if ((fieldNum === 1 || fieldNum === 4) && wireType === 2) {
				const len = decodeProtoVarint(buf, i, end);
				if (!len) return false;
				i = len.next;
				if (i + len.val > end) return false;
				const ok = parseProtoMessage(buf, i, i + len.val, windows, missingWindows);
				if (!ok) return false;
				i += len.val;
			} else if (wireType === 0) {
				const s = decodeProtoVarint(buf, i, end);
				if (!s) return false;
				i = s.next;
			} else if (wireType === 1) {
				if (i + 8 > end) return false;
				i += 8;
			} else if (wireType === 2) {
				const sLen = decodeProtoVarint(buf, i, end);
				if (!sLen) return false;
				i = sLen.next + sLen.val;
				if (i > end) return false;
			}
		}
		return true;
	}

	function parseAndEmitProtoLimit(payloadBuf) {
		try {
			const windows = {};
			const missingWindows = [];
			const ok = parseProtoMessage(payloadBuf, 0, payloadBuf.length, windows, missingWindows);
			if (!ok) return;

			for (const missingName of missingWindows) {
				postDiag('proto_limit_field_missing', { window: missingName });
			}

			const windowKeys = Object.keys(windows);
			if (windowKeys.length > 0) {
				post('cc:message_limit', { windows });
				postDiag('proto_limit_parsed', { windows: windowKeys });
			}
		} catch {
			// ignore any error
		}
	}

	function extractConnectLimits(response) {
		try {
			if (!response || typeof response.clone !== 'function') return;
			const clone = response.clone();
			if (!clone || !clone.body || typeof clone.body.getReader !== 'function') return;
			const reader = clone.body.getReader();

			(async () => {
				let state = 'HEADER';
				const headerBuf = new Uint8Array(5);
				let headerBytes = 0;
				let flags = 0;
				let frameLen = 0;
				let payloadBuf = null;
				let payloadBytes = 0;
				let bytesToSkip = 0;

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						if (!value || value.length === 0) continue;

						let chunkOffset = 0;
						while (chunkOffset < value.length) {
							if (state === 'HEADER') {
								const needed = 5 - headerBytes;
								const available = value.length - chunkOffset;
								const toCopy = Math.min(needed, available);
								headerBuf.set(value.subarray(chunkOffset, chunkOffset + toCopy), headerBytes);
								headerBytes += toCopy;
								chunkOffset += toCopy;

								if (headerBytes === 5) {
									flags = headerBuf[0];
									frameLen = (headerBuf[1] * 16777216) + (headerBuf[2] << 16) + (headerBuf[3] << 8) + headerBuf[4];
									const isCompressed = (flags & 0x01) !== 0;
									const isEndStream = (flags & 0x02) !== 0;

									if (!isCompressed && !isEndStream && frameLen >= 0 && frameLen <= 4096) {
										if (frameLen > 0) {
											state = 'PAYLOAD';
											payloadBuf = new Uint8Array(frameLen);
											payloadBytes = 0;
										} else {
											state = 'HEADER';
											headerBytes = 0;
										}
									} else {
										if (frameLen > 0) {
											state = 'SKIP';
											bytesToSkip = frameLen;
										} else {
											state = 'HEADER';
											headerBytes = 0;
										}
									}
								}
							} else if (state === 'PAYLOAD') {
								const needed = frameLen - payloadBytes;
								const available = value.length - chunkOffset;
								const toCopy = Math.min(needed, available);
								payloadBuf.set(value.subarray(chunkOffset, chunkOffset + toCopy), payloadBytes);
								payloadBytes += toCopy;
								chunkOffset += toCopy;

								if (payloadBytes === frameLen) {
									try {
										parseAndEmitProtoLimit(payloadBuf);
									} catch {
										// ignore
									}
									state = 'HEADER';
									headerBytes = 0;
									payloadBuf = null;
								}
							} else if (state === 'SKIP') {
								const available = value.length - chunkOffset;
								const toSkip = Math.min(bytesToSkip, available);
								bytesToSkip -= toSkip;
								chunkOffset += toSkip;

								if (bytesToSkip === 0) {
									state = 'HEADER';
									headerBytes = 0;
								}
							}
						}
					}
				} catch {
					// stream read error, ignore
				}
			})().catch(() => {});
		} catch {
			// ignore
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

			let host = '';
			let pathname = '';
			let pathShape = '';
			try {
				const baseOrigin = (typeof window !== 'undefined' && window.location?.origin)
					? window.location.origin
					: 'https://claude.ai';
				const parsed = new URL(url || rawInput, baseOrigin);
				host = (parsed.hostname || '').toLowerCase();
				pathname = parsed.pathname || '';
			} catch {
				// ignore
			}
			pathShape = computePathShape(url || rawInput);

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

			// Step 4: RPC request metadata (POST /claudeai-rpc/)
			if (method === 'POST' && pathname.startsWith('/claudeai-rpc/')) {
				try {
					const opts = args[1] || {};
					const bodyInput = opts.body !== undefined ? opts.body : (rawInput && typeof rawInput === 'object' ? rawInput.body : undefined);
					const { bodyType, bodyByteLength } = inspectRequestBodyMeta(bodyInput);
					postDiag('rpc_request_meta', { pathShape, bodyType, bodyByteLength });
				} catch {
					// ignore
				}
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
						host: host || getHost(url || rawInput),
						pathShape: pathShape || computePathShape(url || rawInput),
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

			// Diagnostic response scanners (JSON and Proto)
			try {
				if (isDebugActive() && response && typeof response.clone === 'function') {
					const ct = (typeof response?.headers?.get === 'function'
						? response.headers.get('content-type')
						: response?.headers?.['content-type'] || response?.headers?.['Content-Type']) || '';
					scanJsonResponse(response, pathShape, host, pathname, ct);
					scanBinaryResponse(response, pathShape, host, pathname, ct);
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

			// Production Connect-frame limit extractor
			try {
				if (host === 'claude.ai' && (pathname.endsWith('/ConversationService/StreamTimeline') || pathname.endsWith('ConversationService/StreamTimeline'))) {
					extractConnectLimits(response);
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

			if (this.__cc_method === 'POST') {
				try {
					const targetUrl = this.__cc_url || this.__cc_raw_input;
					const baseOrigin = (typeof window !== 'undefined' && window.location?.origin)
						? window.location.origin
						: 'https://claude.ai';
					const parsed = new URL(targetUrl, baseOrigin);
					const pathname = parsed.pathname || '';
					if (pathname.startsWith('/claudeai-rpc/')) {
						const { bodyType, bodyByteLength } = inspectRequestBodyMeta(args[0]);
						postDiag('rpc_request_meta', {
							pathShape: computePathShape(targetUrl),
							bodyType,
							bodyByteLength
						});
					}
				} catch {
					// ignore
				}
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
			shouldLogRequestSeen,
			scanJsonResponse,
			scanBinaryResponse,
			inspectRequestBodyMeta,
			walkJson,
			decodeProtoVarint,
			parseWindowMessage,
			parseProtoMessage,
			parseAndEmitProtoLimit,
			extractConnectLimits
		};
	}
})();
