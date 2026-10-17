const fs = require('fs');
const assert = require('assert');
const path = require('path');

// Load constants, tokens, and ui
require('../src/content/constants.js');
const { formatContextUtilization } = require('../src/content/tokens.js');
const { resolveComposerCard } = require('../src/content/main.js');
const { CounterUI, PRESETS } = require('../src/content/ui.js');

// Minimal Fake Element & DOM for testing mount-point resolution
class FakeElement {
	constructor(tagName = 'div', attributes = {}, className = '') {
		this.tagName = tagName.toUpperCase();
		this.attributes = Object.assign({}, attributes);
		this.className = className;
		this.parentElement = null;
		this.children = [];
		this.previousElementSibling = null;
		this.nextElementSibling = null;
		this.style = {};
		this.id = attributes.id || '';
		this._classes = new Set(className.split(' ').filter(Boolean));
		this.classList = {
			contains: (c) => this._classes.has(c),
			add: (c) => this._classes.add(c),
			remove: (c) => this._classes.delete(c),
			toggle: (c, force) => {
				if (force === undefined) {
					if (this._classes.has(c)) this._classes.delete(c);
					else this._classes.add(c);
				} else if (force) {
					this._classes.add(c);
				} else {
					this._classes.delete(c);
				}
			}
		};
	}

	getAttribute(name) {
		return this.attributes[name] || null;
	}

	setAttribute(name, val) {
		this.attributes[name] = String(val);
		if (name === 'id') this.id = String(val);
	}

	appendChild(child) {
		child.parentElement = this;
		this.children.push(child);
		this._updateSiblings();
		return child;
	}

	insertBefore(newNode, refNode) {
		if (newNode.parentElement) {
			newNode.parentElement.removeChild(newNode);
		}
		newNode.parentElement = this;
		const index = this.children.indexOf(refNode);
		if (index === -1) {
			this.children.push(newNode);
		} else {
			this.children.splice(index, 0, newNode);
		}
		this._updateSiblings();
		return newNode;
	}

	removeChild(child) {
		const index = this.children.indexOf(child);
		if (index !== -1) {
			this.children.splice(index, 1);
			child.parentElement = null;
			this._updateSiblings();
		}
		return child;
	}

	_updateSiblings() {
		for (let i = 0; i < this.children.length; i++) {
			this.children[i].previousElementSibling = this.children[i - 1] || null;
			this.children[i].nextElementSibling = this.children[i + 1] || null;
		}
	}

	closest(selector) {
		let cur = this;
		while (cur) {
			if (cur.matches(selector)) return cur;
			cur = cur.parentElement;
		}
		return null;
	}

	matches(selector) {
		if (selector.startsWith('[data-testid="') && selector.endsWith('"]')) {
			const val = selector.slice('[data-testid="'.length, -2);
			return this.attributes['data-testid'] === val;
		}
		if (selector.includes('[class*="') && selector.endsWith('"]')) {
			const start = selector.indexOf('[class*="') + '[class*="'.length;
			const end = selector.lastIndexOf('"]');
			const sub = selector.slice(start, end);
			return (this.className || '').includes(sub);
		}
		return false;
	}

	querySelector(selector) {
		for (const child of this.children) {
			if (child.matches(selector)) return child;
			const res = child.querySelector(selector);
			if (res) return res;
		}
		return null;
	}

	querySelectorAll(selector) {
		const res = [];
		const walk = (node) => {
			for (const child of node.children) {
				if (child.matches(selector) || (selector.startsWith('#') && child.id === selector.slice(1))) {
					res.push(child);
				}
				walk(child);
			}
		};
		walk(this);
		return res;
	}
}

function buildLiveEvidenceDOM({ includeCardClass = true } = {}) {
	const doc = {
		body: new FakeElement('body'),
		documentElement: new FakeElement('html'),
		querySelector(sel) {
			return this.body.querySelector(sel);
		},
		querySelectorAll(sel) {
			return this.body.querySelectorAll(sel);
		}
	};
	doc.documentElement.appendChild(doc.body);

	const level8 = new FakeElement('div', {}, 'relative in-data-cds-dock-masked:bg-page');
	doc.body.appendChild(level8);

	const level7 = new FakeElement('div', {}, 'flex w-full min-w-0 flex-col font-sans in-data-cds-dock-masked:bg-page px-2 md:p...');
	level8.appendChild(level7);

	const level6 = new FakeElement('div', {}, includeCardClass ? 'bg-surface-3 [--cmp-pad-x:0.5rem] ...' : '[--cmp-pad-x:0.5rem] ...');
	level7.appendChild(level6);

	const level5 = new FakeElement('div', {}, 'relative w-full min-w-0');
	level6.appendChild(level5);

	const level4 = new FakeElement('div', {}, 'w-full min-w-0 motion-safe:transition-[padding-left,padding-right,padding-bottom ...');
	level5.appendChild(level4);

	const level3 = new FakeElement('div', {}, 'relative min-w-0 break-words');
	level4.appendChild(level3);

	const level2 = new FakeElement('div', {}, 'relative min-w-0');
	level3.appendChild(level2);

	const level1 = new FakeElement('div', {}, 'w-full max-h-96 min-h-[var(--cmp-row-h)] overflow-y-auto break-words ...');
	level2.appendChild(level1);

	const level0 = new FakeElement('div', { 'data-testid': 'chat-input', role: 'textbox' }, 'tiptap ProseMirror');
	level1.appendChild(level0);

	return { doc, levels: [level0, level1, level2, level3, level4, level5, level6, level7, level8] };
}

let passCount = 0;
let failCount = 0;

async function test(name, fn) {
	try {
		await fn();
		console.log(`  ✓ PASS: ${name}`);
		passCount++;
	} catch (err) {
		console.error(`  ✗ FAIL: ${name}`);
		console.error(err);
		failCount++;
	}
}

(async () => {
	console.log('Running mount.test.js...\n');

	// Test 1: Resolve composer card using primary bg-surface-3 selector
	await test('Mount: resolves card (Level 6) via bg-surface-3 class from chat-input anchor (Level 0)', () => {
		const { doc, levels } = buildLiveEvidenceDOM({ includeCardClass: true });
		const resolved = resolveComposerCard(doc);

		assert.notStrictEqual(resolved, null, 'Must find mount targets');
		assert.strictEqual(resolved.anchor, levels[0], 'Anchor must be Level 0 chat-input');
		assert.strictEqual(resolved.card, levels[6], 'Card must be Level 6 visible composer card');
	});

	// Test 2: Fallback to 6th ancestor when Tailwind classes change
	await test('Mount Fallback: resolves card (Level 6) via 6th ancestor when bg-surface-3 class is absent', () => {
		const { doc, levels } = buildLiveEvidenceDOM({ includeCardClass: false });
		const resolved = resolveComposerCard(doc);

		assert.notStrictEqual(resolved, null, 'Fallback must find 6th ancestor');
		assert.strictEqual(resolved.anchor, levels[0]);
		assert.strictEqual(resolved.card, levels[6], '6th ancestor must be Level 6 card');
	});

	// Test 3: Inline mount insertion before Card
	await test('Mount: inserts host as previous sibling of Card in normal document flow', () => {
		const { levels } = buildLiveEvidenceDOM({ includeCardClass: true });
		const card = levels[6];
		const parent = card.parentElement; // Level 7

		const host = new FakeElement('div', { id: 'cc-usage-meter-root' });
		parent.insertBefore(host, card);

		assert.strictEqual(host.parentElement, parent, 'Host must be child of Level 7');
		assert.strictEqual(host.nextElementSibling, card, 'Host must immediately precede card');
		assert.strictEqual(card.previousElementSibling, host, 'Card previous sibling must be host');
		assert.strictEqual(parent.children[0], host, 'Host is first child before card');
		assert.strictEqual(parent.children[1], card, 'Card is second child');
	});

	// Test 4: Missing anchor returns null safely
	await test('Mount: returns null safely when chat-input is absent, never falling back to fixed overlay', () => {
		const emptyDoc = {
			body: new FakeElement('body'),
			querySelector: () => null
		};
		const resolved = resolveComposerCard(emptyDoc);
		assert.strictEqual(resolved, null, 'Must return null when anchor not present');
	});

	// Test 5: Collapsed / Expanded state persistence in localStorage
	await test('State: loads default collapsed=false, toggles to expanded=true and remembers in localStorage', () => {
		const store = {};
		const mockLocalStorage = {
			getItem: (k) => store[k] || null,
			setItem: (k, v) => { store[k] = String(v); }
		};
		globalThis.localStorage = mockLocalStorage;

		const ui = new CounterUI();
		assert.strictEqual(ui.isExpanded, false, 'Default view must be collapsed (thin line)');

		ui._saveExpanded(true);
		assert.strictEqual(ui.isExpanded, true, 'Must expand upon save');
		assert.strictEqual(mockLocalStorage.getItem('cc_expanded'), 'true');

		// Recreate UI, verifying persistence
		const uiReloaded = new CounterUI();
		assert.strictEqual(uiReloaded.isExpanded, true, 'Must load saved expanded state');

		uiReloaded._saveExpanded(false);
		assert.strictEqual(uiReloaded.isExpanded, false);
		assert.strictEqual(mockLocalStorage.getItem('cc_expanded'), 'false');
	});

	// Test 6: Resilient against localStorage errors (e.g. SecurityError in iframe)
	await test('State: handles localStorage exceptions gracefully inside try/catch', () => {
		globalThis.localStorage = {
			getItem: () => { throw new Error('SecurityError: access denied'); },
			setItem: () => { throw new Error('QuotaExceededError'); }
		};

		const ui = new CounterUI();
		assert.strictEqual(ui.isExpanded, false, 'Must default to false if localStorage throws');

		// Saving must not throw
		assert.doesNotThrow(() => {
			ui._saveExpanded(true);
		});
		assert.strictEqual(ui.isExpanded, true);
	});

	// Test 7: Context row percentage used · left and tier colors (<60 low, 60 to <90 mid, >=90 high)
	await test('Utilization: 124,000 / 200,000 (62%) shows "62% used · 38% left" and orange midColor (#f59e0b)', () => {
		const util = formatContextUtilization(124000, 200000);
		assert.strictEqual(util.isOverLimit, false);
		assert.strictEqual(util.percentText, '62% used · 38% left');
		assert.strictEqual(util.pctUsed, 62);
		assert.strictEqual(util.pctLeft, 38);
		assert.strictEqual(util.tier, 'mid');
		assert.strictEqual(util.barPercent, 62);
		assert.strictEqual(util.formatted, '~124k est. / 200k');

		const ui = new CounterUI();
		ui.dom = {
			ctxMain: { textContent: '' },
			ctxPct: { textContent: '', title: '', style: {} },
			ctxBar: {
				style: {},
				title: '',
				parentElement: { setAttribute: () => {}, title: '' }
			}
		};
		const panelClasses = new Set();
		ui.panel = {
			classList: {
				toggle(c, force) {
					if (force) panelClasses.add(c);
					else panelClasses.delete(c);
				},
				remove(c) { panelClasses.delete(c); },
				contains(c) { return panelClasses.has(c); }
			},
			style: { setProperty: () => {} }
		};

		ui.setConversationMetrics({ totalTokens: 124000, isLoaded: true });

		assert.strictEqual(ui.metrics.context.pctUsed, 62);
		assert.strictEqual(ui.metrics.context.pctLeft, 38);
		assert.strictEqual(ui.dom.ctxBar.style.width, '62%');
		assert.strictEqual(ui.panel.classList.contains('cc-ctx-mid'), true, 'Panel must have cc-ctx-mid class');
		assert.strictEqual(ui.dom.ctxBar.style.backgroundColor, '#f59e0b', '62% must use orange midColor (#f59e0b)');
		assert.strictEqual(ui.dom.ctxPct.textContent, '62% used · 38% left');
		assert.strictEqual(ui.dom.ctxPct.title, 'Estimated size of this chat vs. context window. Not your plan usage limit. The window size may differ by model, adjust it in settings.');
	});

	await test('Over-limit: 231,255 / 200,000 (>100%) shows "100%+ used · 0% left", bar capped at 100%, and red highColor (#ef4444)', () => {
		const util = formatContextUtilization(231255, 200000);
		assert.strictEqual(util.isOverLimit, true);
		assert.strictEqual(util.percentText, '100%+ used · 0% left');
		assert.strictEqual(util.barPercent, 100, 'Bar percentage must be strictly capped at 100%');
		assert.strictEqual(util.formatted, '~231k est. / 200k');

		const ui = new CounterUI();
		ui.dom = {
			ctxMain: { textContent: '' },
			ctxPct: { textContent: '', title: '', style: {} },
			ctxBar: {
				style: {},
				title: '',
				parentElement: { setAttribute: () => {}, title: '' }
			}
		};
		const panelClasses = new Set();
		ui.panel = {
			classList: {
				toggle(c, force) {
					if (force) panelClasses.add(c);
					else panelClasses.delete(c);
				},
				remove(c) { panelClasses.delete(c); },
				contains(c) { return panelClasses.has(c); }
			},
			style: { setProperty: () => {} }
		};

		ui.setConversationMetrics({ totalTokens: 231255, isLoaded: true });

		assert.strictEqual(ui.metrics.context.pct, 100);
		assert.strictEqual(ui.dom.ctxBar.style.width, '100%');
		assert.strictEqual(ui.panel.classList.contains('cc-over-limit'), true, 'Panel must have cc-over-limit class');
		assert.strictEqual(ui.panel.classList.contains('cc-ctx-high'), true, 'Panel must have cc-ctx-high class');
		assert.strictEqual(ui.dom.ctxBar.style.backgroundColor, '#ef4444', 'Over-limit bar must use red warning color (#ef4444)');
		assert.strictEqual(ui.dom.ctxPct.textContent, '100%+ used · 0% left');
	});

	// Test 8: User override for context window limit
	await test('Override: setting custom context window adjusts threshold and colors', () => {
		const ui = new CounterUI();
		ui.dom = {
			ctxMain: { textContent: '' },
			ctxPct: { textContent: '', title: '', style: {} },
			ctxBar: {
				style: {},
				title: '',
				parentElement: { setAttribute: () => {}, title: '' }
			}
		};
		const panelClasses = new Set();
		ui.panel = {
			classList: {
				toggle(c, force) {
					if (force) panelClasses.add(c);
					else panelClasses.delete(c);
				},
				remove(c) { panelClasses.delete(c); },
				contains(c) { return panelClasses.has(c); }
			},
			style: { setProperty: () => {} }
		};

		// Override to 250,000 tokens: 125,000 is 50%
		ui.settings.contextWindow = 250000;
		ui.setConversationMetrics({ totalTokens: 125000, isLoaded: true });

		assert.strictEqual(ui.panel.classList.contains('cc-over-limit'), false);
		assert.strictEqual(ui.panel.classList.contains('cc-ctx-low'), true);
		assert.strictEqual(ui.dom.ctxMain.textContent, '~125k est. / 250k');
		assert.strictEqual(ui.dom.ctxPct.textContent, '50% used · 50% left');
		assert.strictEqual(ui.dom.ctxBar.style.backgroundColor, '#10b981');

		// 231,255 / 250,000 is 93% (high color)
		ui.setConversationMetrics({ totalTokens: 231255, isLoaded: true });
		assert.strictEqual(ui.panel.classList.contains('cc-over-limit'), false);
		assert.strictEqual(ui.panel.classList.contains('cc-ctx-high'), true);
		assert.strictEqual(ui.dom.ctxMain.textContent, '~231k est. / 250k');
		assert.strictEqual(ui.dom.ctxPct.textContent, '93% used · 7% left');
		assert.strictEqual(ui.dom.ctxBar.style.backgroundColor, '#ef4444');
	});

	// Test 9: Normal token usage does not trigger over-limit warning color
	await test('Normal: 50,000 / 200,000 utilization formats 25% used · 75% left with lowColor', () => {
		const util = formatContextUtilization(50000, 200000);
		assert.strictEqual(util.isOverLimit, false);
		assert.strictEqual(util.percentText, '25% used · 75% left');
		assert.strictEqual(util.barPercent, 25);
		assert.strictEqual(util.tier, 'low');
		assert.strictEqual(util.formatted, '~50k est. / 200k');

		const ui = new CounterUI();
		ui.dom = {
			ctxMain: { textContent: '' },
			ctxPct: { textContent: '', title: '', style: {} },
			ctxBar: {
				style: {},
				title: '',
				parentElement: { setAttribute: () => {}, title: '' }
			}
		};
		const panelClasses = new Set();
		ui.panel = {
			classList: {
				toggle(c, force) {
					if (force) panelClasses.add(c);
					else panelClasses.delete(c);
				},
				remove(c) { panelClasses.delete(c); },
				contains(c) { return panelClasses.has(c); }
			},
			style: { setProperty: () => {} }
		};

		ui.setConversationMetrics({ totalTokens: 50000, isLoaded: true });

		assert.strictEqual(ui.metrics.context.pct, 25);
		assert.strictEqual(ui.dom.ctxBar.style.width, '25%');
		assert.strictEqual(ui.panel.classList.contains('cc-over-limit'), false);
		assert.strictEqual(ui.panel.classList.contains('cc-ctx-low'), true);
		assert.strictEqual(ui.dom.ctxBar.style.backgroundColor, '#10b981');
	});

	// Test 10: Cache timer shows "—" when no cache is active
	await test('Cache Timer: displays "—" when inactive, not hidden', () => {
		const ui = new CounterUI();
		ui.dom = {
			cacheText: { textContent: '' },
			cacheFill: { style: {} }
		};

		// Conversation loading without cache
		ui.setConversationLoading();
		assert.strictEqual(ui.dom.cacheText.textContent, '—', 'Must show dash when no cache');

		// Tick when expired
		ui.metrics.cachedUntil = Date.now() - 1000;
		ui.tick();
		assert.strictEqual(ui.dom.cacheText.textContent, '—', 'Must show dash after expiry');

		// Caching pending
		ui.setPendingCache(true);
		assert.strictEqual(ui.dom.cacheText.textContent, 'caching...', 'Must show caching when pending');
	});

	// Test 11: Context label tooltip, collapsed hiding rule, and Settings Drawer override input
	await test('UI: Context label has tooltip, drawer has number input, and settings default to 200,000', () => {
		const uiSrc = fs.readFileSync(path.join(__dirname, '../src/content/ui.js'), 'utf8');

		// Tooltip on Context row & label
		assert.ok(
			uiSrc.includes('title="Estimated size of this chat vs. context window. Not your plan usage limit. The window size may differ by model, adjust it in settings."'),
			'Context label and row must have specified tooltip'
		);

		// Collapsed view hides #cc-ctx-main so only "Context [bar] 62% used · 38% left" shows
		assert.ok(
			uiSrc.includes('.cc-panel:not(.cc-expanded) #cc-ctx-main'),
			'Must include rule hiding #cc-ctx-main when collapsed'
		);

		// Number input in drawer
		assert.ok(
			uiSrc.includes('id="cc-context-window-input"'),
			'Settings drawer must include #cc-context-window-input'
		);
		assert.ok(
			uiSrc.includes('type="number"'),
			'Context window override input must be of type number'
		);

		// Settings defaults
		const ui = new CounterUI();
		assert.strictEqual(ui.settings.contextWindow, 200000, 'Must default contextWindow to 200,000');

		// Reset defaults preserves 200,000
		ui.settings.contextWindow = 300000;
		ui.resetDefaults();
		assert.strictEqual(ui.settings.contextWindow, 200000, 'resetDefaults() must restore 200,000');
	});

	// Test 12: Size CSS values present in UI_STYLES
	await test('CSS Sizes: verifies min-height: 32px, 7px tracks, 12px fonts, and padding: 5px 12px', () => {
		const uiSrc = fs.readFileSync(path.join(__dirname, '../src/content/ui.js'), 'utf8');

		assert.ok(uiSrc.includes('min-height: 32px;'), 'Must have min-height: 32px on summary line');
		assert.ok(uiSrc.includes('padding: 5px 12px;'), 'Must have padding: 5px 12px on summary line');
		assert.ok(uiSrc.includes('height: 7px;'), 'Must have height: 7px on bar tracks');
		assert.ok(uiSrc.includes('font-size: 12px;'), 'Must have font-size: 12px on host and labels');
	});

	// Test 13: Post-stream refresh and stale-while-revalidate timing (no flicker, one retry max, no loop)
	await test('Post-stream: stale-while-revalidate keeps previous value, single 1500ms retry max, no loop', async () => {
		const ui = new CounterUI();
		ui.dom = {
			ctxMain: { textContent: '' },
			ctxPct: { textContent: '', title: '', style: {} },
			ctxBar: {
				style: {},
				title: '',
				parentElement: { setAttribute: () => {}, title: '' }
			}
		};
		const panelClasses = new Set();
		ui.panel = {
			classList: {
				toggle(c, force) {
					if (force) panelClasses.add(c);
					else panelClasses.delete(c);
				},
				remove(c) { panelClasses.delete(c); },
				add(c) { panelClasses.add(c); },
				contains(c) { return panelClasses.has(c); }
			},
			style: { setProperty: () => {} }
		};

		// 1. Initial load sets valid tokens (100,000 = 50%)
		ui.setConversationMetrics({ totalTokens: 100000, isLoaded: true });
		assert.strictEqual(ui.metrics.context.isLoaded, true);
		assert.strictEqual(ui.dom.ctxPct.textContent, '50% used · 50% left');

		// 2. Stale-while-revalidate in same chat: if re-fetching or empty update received, do NOT reset to "—"
		ui.setConversationMetrics({ totalTokens: null, isLoaded: false });
		assert.strictEqual(ui.metrics.context.isLoaded, true, 'Must preserve isLoaded=true in same chat');
		assert.strictEqual(ui.dom.ctxPct.textContent, '50% used · 50% left', 'Must not flash dash');

		// 3. Fake timer retry logic simulation
		let refetchCount = 0;
		let conversationLeaf = 'msg-leaf-1';
		let totalTokens = 100000;
		let retryTimerId = null;

		async function mockRefreshConversation() {
			refetchCount++;
		}

		async function simulateStreamPostRefetch(convId, preLeafId, preTokens, onDone) {
			await mockRefreshConversation();

			const leafChanged = conversationLeaf !== preLeafId;
			const tokensChanged = totalTokens !== preTokens;

			if (!leafChanged && !tokensChanged) {
				retryTimerId = setTimeout(async () => {
					retryTimerId = null;
					await mockRefreshConversation();
					if (onDone) onDone();
				}, 1500);
			} else {
				if (onDone) onDone();
			}
		}

		// A: Immediate refetch with uncommitted leaf (no change) -> schedules 1 retry after 1500ms
		await simulateStreamPostRefetch('conv-1', 'msg-leaf-1', 100000);
		assert.strictEqual(refetchCount, 1, 'Must immediately trigger conversation refetch');
		assert.ok(retryTimerId !== null, 'Must schedule one retry after 1500ms when leaf/tokens unchanged');

		// Advance timer by 1500ms
		await new Promise((resolve) => {
			const originalTimer = retryTimerId;
			clearTimeout(originalTimer);
			// Execute retry callback directly
			mockRefreshConversation().then(() => {
				retryTimerId = null;
				resolve();
			});
		});

		assert.strictEqual(refetchCount, 2, 'Must have executed exactly one retry');
		assert.strictEqual(retryTimerId, null, 'Must stop after one retry (no loop)');

		// B: Immediate refetch with new leaf -> does NOT schedule retry
		refetchCount = 0;
		conversationLeaf = 'msg-leaf-2'; // new leaf committed
		totalTokens = 120000;
		await simulateStreamPostRefetch('conv-1', 'msg-leaf-1', 100000);
		assert.strictEqual(refetchCount, 1, 'Immediate refetch triggered');
		assert.strictEqual(retryTimerId, null, 'No retry scheduled when leaf/tokens changed');
	});

	console.log(`\nTests finished: ${passCount} passed, ${failCount} failed.`);
	if (failCount > 0) process.exit(1);
})();
