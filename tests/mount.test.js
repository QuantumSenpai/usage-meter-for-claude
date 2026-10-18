const fs = require('fs');
const assert = require('assert');
const path = require('path');

// Load constants, normalize, tokens, and ui
require('../src/content/constants.js');
require('../src/content/normalize.js');
const { formatContextUtilization } = require('../src/content/tokens.js');
const { resolveComposerCard } = require('../src/content/main.js');
const { CounterUI, PRESETS } = require('../src/content/ui.js');
const { handleEventStream } = require('../src/injected/bridge.js');

const createMockStorage = () => {
	const store = {};
	return {
		getItem: (k) => store[k] || null,
		setItem: (k, v) => { store[k] = String(v); },
		removeItem: (k) => { delete store[k]; },
		key: (i) => Object.keys(store)[i] || null,
		get length() { return Object.keys(store).length; }
	};
};

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

		// Restore mock storage
		globalThis.localStorage = createMockStorage();
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

	// Test 14: Polish 4 - Context Window input does not save on partial keystrokes, debounces ~600ms, and resets on blur with invalid value
	await test('Input: Context Window input debounces ~600ms, ignores < 1000, and resets only on blur when invalid', async () => {
		const ui = new CounterUI();
		const savedSettings = [];
		ui._saveSettings = function() {
			savedSettings.push(this.settings.contextWindow);
		};

		const inputListeners = {};
		const mockInput = {
			value: '200000',
			addEventListener: (event, handler) => { inputListeners[event] = handler; }
		};

		ui.dom = {
			summaryLine: { addEventListener: () => {} },
			expandBtn: { addEventListener: () => {} },
			gearBtn: { addEventListener: () => {} },
			debugBtn: { style: {}, addEventListener: () => {} },
			retryBtn: { addEventListener: () => {} },
			colLow: { addEventListener: () => {} },
			colMid: { addEventListener: () => {} },
			colHigh: { addEventListener: () => {} },
			opacitySlider: { addEventListener: () => {} },
			chkSess: { addEventListener: () => {} },
			chkWeek: { addEventListener: () => {} },
			resetDefaultsBtn: { addEventListener: () => {} },
			contextWindowInput: mockInput
		};
		ui.shadowRoot = { querySelectorAll: () => [] };

		// Bind real listeners from CounterUI
		ui._bindEvents();

		// 1. Partial keystroke mid-typing: "1" -> ignored, no save
		mockInput.value = '1';
		inputListeners['input']({ target: mockInput });
		assert.strictEqual(savedSettings.length, 0, 'Must not save on partial input "1"');
		assert.strictEqual(ui.settings.contextWindow, 200000, 'Must not modify setting on partial input "1"');

		// 2. Mid-typing empty string "" -> must NOT reset to 200000 mid-typing
		mockInput.value = '';
		inputListeners['input']({ target: mockInput });
		assert.strictEqual(savedSettings.length, 0, 'Must not save on empty mid-typing');
		assert.strictEqual(mockInput.value, '', 'Must not reset input text to 200000 mid-typing');

		// 3. Value < 1000: "999" -> ignored, no save
		mockInput.value = '999';
		inputListeners['input']({ target: mockInput });
		assert.strictEqual(savedSettings.length, 0, 'Must ignore value < 1000');

		// 4. Valid value >= 1000: "150000" -> debounced ~600ms
		mockInput.value = '150000';
		inputListeners['input']({ target: mockInput });
		assert.strictEqual(savedSettings.length, 0, 'Must not save immediately upon valid keystroke');

		// Wait 650ms for debounce timer to fire
		await new Promise((r) => setTimeout(r, 650));
		assert.strictEqual(savedSettings.length, 1, 'Must save after 600ms debounce');
		assert.strictEqual(ui.settings.contextWindow, 150000, 'Must apply 150,000 limit after debounce');

		// 5. Change event (e.g. Enter key) -> applies immediately
		mockInput.value = '250000';
		inputListeners['change']({ target: mockInput });
		assert.strictEqual(savedSettings.length, 2, 'Must apply immediately on change/Enter');
		assert.strictEqual(ui.settings.contextWindow, 250000, 'Must set 250,000 on change/Enter');

		// 6. Blur event with invalid empty string -> resets to 200,000 default
		mockInput.value = '';
		inputListeners['blur']({ target: mockInput });
		assert.strictEqual(ui.settings.contextWindow, 200000, 'Must reset setting to 200,000 default on blur');
		assert.strictEqual(mockInput.value, 200000, 'Must reset input field value to 200,000 on blur');
	});

	// Helper to load real main.js in headless Node environment
	const originalCounterUIInitialize = ClaudeCounter.ui.CounterUI.prototype.initialize;
	function setupRealMainEnvironment() {
		ClaudeCounter.ui.CounterUI.prototype.initialize = function() {
			this.rootElement = { parentElement: null };
			this.dom = {
				ctxMain: { textContent: '' },
				ctxPct: { textContent: '', title: '', style: {} },
				ctxBar: { style: {}, parentElement: { setAttribute: () => {} } },
				cacheText: { textContent: '' }
			};
			this.panel = { classList: { toggle: () => {}, remove: () => {}, add: () => {}, contains: () => false }, style: { setProperty: () => {} } };
		};

		const bridgeListeners = {};
		global.ClaudeCounter.injectBridgeOnce = () => Promise.resolve();
		global.ClaudeCounter.bridge = {
			on: (event, handler) => { bridgeListeners[event] = handler; },
			emit: (event, data) => { if (bridgeListeners[event]) return bridgeListeners[event](data); },
			requestConversation: async () => ({ chat_messages: [] }),
			requestUsage: async () => ({})
		};

		global.window = {
			location: { pathname: '/chat/initial' },
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => {}
		};

		global.document = {
			cookie: 'lastActiveOrg=00000000-0000-4000-8000-000000000001',
			querySelector: () => null,
			querySelectorAll: () => [],
			addEventListener: () => {},
			removeEventListener: () => {},
			body: null,
			documentElement: null
		};

		global.MutationObserver = class {
			observe() {}
			disconnect() {}
		};

		global.history = {
			pushState: () => {},
			replaceState: () => {}
		};

		delete require.cache[require.resolve('../src/content/main.js')];
		delete global.ClaudeCounter.__started;

		const main = require('../src/content/main.js');
		return { main, bridgeListeners };
	}

	// Test 15: Bug 2 - Chat switch during in-flight fetch triggers a separate fetch for chat B
	await test('Bug 2: Chat A in flight -> switch to B -> a separate fetch for B is issued', async () => {
		const { main } = setupRealMainEnvironment();
		const { _internal } = main;
		_internal.getUi().settings.showContext = true;

		const requested = [];
		let resolveA, resolveB;
		const promiseA = new Promise((r) => { resolveA = r; });
		const promiseB = new Promise((r) => { resolveB = r; });

		global.ClaudeCounter.bridge.requestConversation = (org, conv) => {
			requested.push(conv);
			if (conv === 'chat-A') return promiseA;
			if (conv === 'chat-B') return promiseB;
			return Promise.resolve({ chat_messages: [] });
		};

		// Start fetch for chat-A
		_internal.setCurrentConversationId('chat-A');
		const fetchAPromise = _internal.refreshConversation();
		await Promise.resolve(); // yield microtask to enter inFlight

		assert.deepStrictEqual(requested, ['chat-A'], 'Must issue fetch for chat-A');
		assert.strictEqual(_internal.getConversationInFlight()?.conversationId, 'chat-A', 'In-flight entry must track chat-A');

		// Switch to chat-B while A is in flight
		_internal.setCurrentConversationId('chat-B');
		const fetchBPromise = _internal.refreshConversation();
		await Promise.resolve(); // yield microtask

		assert.deepStrictEqual(requested, ['chat-A', 'chat-B'], 'Must issue separate fetch for chat-B without reusing chat-A promise');
		assert.strictEqual(_internal.getConversationInFlight()?.conversationId, 'chat-B', 'In-flight entry must now track chat-B');

		// Resolve chat-A
		resolveA({ chat_messages: [] });
		await fetchAPromise;
		assert.strictEqual(_internal.getConversationInFlight()?.conversationId, 'chat-B', 'Resolving chat-A must NOT clear chat-B in-flight entry');

		// Resolve chat-B
		resolveB({ chat_messages: [] });
		await fetchBPromise;
		assert.strictEqual(_internal.getConversationInFlight(), null, 'Resolving chat-B must clear in-flight entry');
	});

	// Test 16: Bug 1 - Chat A late metrics never reach the UI after switching to B
	await test('Bug 1: Chat A late metrics never reach the UI after switching to B', async () => {
		const { main, bridgeListeners } = setupRealMainEnvironment();
		const { _internal } = main;

		const uiCalls = [];
		global.ClaudeCounter.ui.CounterUI.prototype.setConversationMetrics = function(metrics) {
			uiCalls.push(metrics);
		};

		_internal.setCurrentConversationId('chat-A');

		let finishTokenization;
		const slowTokenPromise = new Promise((r) => { finishTokenization = r; });
		global.ClaudeCounter.tokens.computeConversationMetrics = () => slowTokenPromise;

		const payloadA = {
			chat_messages: [{ uuid: 'msg-1', text: 'hello', sender: 'human' }]
		};

		// 1. Emit cc:conversation for chat-A (triggers real listener in main.js)
		const handlerPromise = bridgeListeners['cc:conversation']({
			orgId: '00000000-0000-4000-8000-000000000001',
			conversationId: 'chat-A',
			data: payloadA
		});

		await Promise.resolve(); // yield microtask to enter tokenization

		// 2. User switches to chat-B during tokenization
		_internal.setCurrentConversationId('chat-B');

		// 3. Late tokenization completes
		finishTokenization({ totalTokens: 12345, isLoaded: true, cachedUntil: null });
		await handlerPromise;

		// 4. Stale metrics for chat-A must be dropped and never passed to UI
		assert.strictEqual(uiCalls.length, 0, 'Late metrics for chat-A must be dropped and never update the UI');
	});

	// Test 17: Retry timer still cleared on chat switch
	await test('Retry timer: post-stream retry timer is cleared immediately on chat switch', async () => {
		const { main, bridgeListeners } = setupRealMainEnvironment();
		const { _internal } = main;
		_internal.getUi().settings.showContext = true;

		_internal.setCurrentConversationId('chat-A');
		_internal.setCurrentConversationLeafId('leaf-1');

		// Trigger post-stream refetch where leaf/tokens are unchanged -> schedules 1500ms retry timer
		await _internal.triggerStreamPostRefetch('chat-A', 'leaf-1', null, Date.now());
		assert.ok(_internal.getStreamRetryTimeoutId() !== null, 'Must schedule 1500ms retry timer when leaf is unchanged');

		// Simulate chat switch navigation
		global.window.location.pathname = '/chat/chat-B';
		await bridgeListeners['cc:urlchange']();

		assert.strictEqual(_internal.getStreamRetryTimeoutId(), null, 'Must immediately clear retry timer upon switching chats');
	});

	// Test 18: Stream completion logs sse_event_types and message_limit_not_seen when message_limit is absent
	await test('Diagnostics: completion stream logs sse_event_types and message_limit_not_seen when message_limit absent', async () => {
		globalThis.__CC_DEBUG = true;
		const { main, bridgeListeners } = setupRealMainEnvironment();
		const { _internal } = main;

		// Simulate stream completion with event types and messageLimitSeen = false
		bridgeListeners['cc:stream_completed']({
			eventTypes: ['message_start', 'content_block_delta', 'message_stop'],
			messageLimitSeen: false
		});

		const buffer = _internal.getDebugLogBuffer();
		const typesEntry = buffer.find((e) => e.category === 'sse_event_types');
		const notSeenEntry = buffer.find((e) => e.category === 'message_limit_not_seen');

		assert.ok(typesEntry, 'Must log sse_event_types');
		assert.deepStrictEqual(typesEntry.data.types, ['message_start', 'content_block_delta', 'message_stop']);
		assert.ok(notSeenEntry, 'Must log message_limit_not_seen when message_limit was not seen');
		globalThis.__CC_DEBUG = false;
	});

	// Test 19: Stream with message_limit logs message_limit_event_shape and suppresses message_limit_not_seen; usage logs usage_response_shape
	await test('Diagnostics: logs message_limit_event_shape and usage_response_shape', async () => {
		globalThis.__CC_DEBUG = true;
		const { main, bridgeListeners } = setupRealMainEnvironment();
		const { _internal } = main;

		// 1. Emit cc:message_limit_raw with sensitive string
		const rawEvent = {
			type: 'message_limit',
			message_limit: {
				resets_at: '2026-10-17T20:00:00Z',
				utilization: 0.85,
				user_prompt_text: 'Secret user prompt in chat'
			}
		};
		bridgeListeners['cc:message_limit_raw'](rawEvent);

		// 2. Stream completes with messageLimitSeen = true
		bridgeListeners['cc:stream_completed']({
			eventTypes: ['message_limit'],
			messageLimitSeen: true
		});

		// 3. Trigger usage refresh with /usage payload
		global.ClaudeCounter.bridge.requestUsage = async () => ({
			five_hour: { utilization: 0.85, resets_at: 1729184400 },
			seven_day: null,
			tangelo: null
		});
		await _internal.refreshUsage({ force: true });

		const buffer = _internal.getDebugLogBuffer();
		const shapeEntry = buffer.find((e) => e.category === 'message_limit_event_shape');
		const notSeenEntry = buffer.find((e) => e.category === 'message_limit_not_seen');
		const usageShapeEntry = buffer.find((e) => e.category === 'usage_response_shape');

		assert.ok(shapeEntry, 'Must log message_limit_event_shape');
		assert.strictEqual(shapeEntry.data.message_limit.user_prompt_text, `[STR_${'Secret user prompt in chat'.length}_CHARS]`);
		assert.strictEqual(notSeenEntry, undefined, 'Must NOT log message_limit_not_seen when message_limit was seen');

		assert.ok(usageShapeEntry, 'Must log usage_response_shape');
		assert.strictEqual(usageShapeEntry.data.five_hour.type, 'object');
		assert.deepStrictEqual(usageShapeEntry.data.five_hour.children.utilization, { type: 'number', value: 0.85 });
		assert.deepStrictEqual(usageShapeEntry.data.tangelo, { type: 'null' });

		globalThis.__CC_DEBUG = false;
	});

	// Test 21: Real bridge handler + fake stream + real fixture -> real normalize
	await test('Real bridge handler + fake stream + real fixture -> real normalize -> 3% / 97% and 6% / 94%', async () => {
		const fixturePath = path.join(__dirname, 'fixtures/sse_message_limit.real.json');
		const realFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

		const sseText = [
			'event: message_start\ndata: {"type":"message_start"}\n\n',
			`event: message_limit\ndata: ${JSON.stringify(realFixture)}\n\n`,
			'event: message_stop\ndata: {"type":"message_stop"}\n\n'
		].join('');

		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sseText));
				controller.close();
			}
		});

		const fakeResponse = {
			clone: () => ({ body: stream }),
			body: stream
		};

		let interceptedLimit = null;
		const originalPostMessage = global.window.postMessage;
		global.window.postMessage = (data, target) => {
			if (data?.type === 'cc:message_limit') {
				interceptedLimit = data.payload;
			}
			if (originalPostMessage) originalPostMessage(data, target);
		};

		try {
			await handleEventStream(fakeResponse);
			assert.ok(interceptedLimit !== null, 'Bridge must intercept cc:message_limit event from SSE stream');
			assert.strictEqual(interceptedLimit.windows['5h'].utilization, 0.03);
			assert.strictEqual(interceptedLimit.windows['7d'].utilization, 0.06);

			const norm = global.ClaudeCounter.normalize.normalizeUsagePayload(null, interceptedLimit);
			assert.strictEqual(norm.state, 'ok');
			assert.strictEqual(norm.session.pctUsed, 3, 'Session pctUsed must be 3');
			assert.strictEqual(norm.session.pctLeft, 97, 'Session pctLeft must be 97 (100 - 3)');
			assert.strictEqual(norm.session.resetsAt, '2026-10-17T19:30:00.000Z', 'Session reset time must match unix seconds');

			assert.strictEqual(norm.weekly.pctUsed, 6, 'Weekly pctUsed must be 6');
			assert.strictEqual(norm.weekly.pctLeft, 94, 'Weekly pctLeft must be 94 (100 - 6)');
			assert.strictEqual(norm.weekly.resetsAt, '2026-10-23T00:00:00.000Z', 'Weekly reset time must match unix seconds');
		} finally {
			global.window.postMessage = originalPostMessage;
		}
	});

	// Test 22: Org isolation - Org A persisted data is never shown for Org B
	await test('Org isolation: Org A persisted data is never shown for Org B', () => {
		const storage = createMockStorage();
		global.localStorage = storage;

		const orgA = '00000000-0000-4000-8000-00000000000a';
		const orgB = '00000000-0000-4000-8000-00000000000b';

		const fixturePath = path.join(__dirname, 'fixtures/sse_message_limit.real.json');
		const realFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

		const { main } = setupRealMainEnvironment();
		const { _internal } = main;
		const ui = _internal.getUi();

		// Save limit for Org A
		_internal.savePersistedLimit(orgA, realFixture.message_limit);

		// Switch to Org A -> shows Org A data
		_internal.onOrgChanged(orgA);
		assert.strictEqual(ui.currentNormalizedState?.session?.pctUsed, 3, 'Org A must show 3% used');
		assert.strictEqual(ui.currentNormalizedState?.weekly?.pctUsed, 6, 'Org A must show 6% used');

		// Switch to Org B -> must show empty / dash, NEVER Org A data
		_internal.onOrgChanged(orgB);
		assert.strictEqual(ui.currentNormalizedState?.session?.pctUsed, null, 'Org B must not have Org A session data');
		assert.strictEqual(ui.currentNormalizedState?.weekly?.pctUsed, null, 'Org B must not have Org A weekly data');
		assert.strictEqual(ui.currentNormalizedState?.state, 'empty', 'Org B with no data must be in empty state');

		// Switch back to Org A -> Org A data is restored
		_internal.onOrgChanged(orgA);
		assert.strictEqual(ui.currentNormalizedState?.session?.pctUsed, 3, 'Org A data must be restored upon switching back');
		assert.strictEqual(ui.currentNormalizedState?.weekly?.pctUsed, 6, 'Org A data must be restored upon switching back');
	});

	// Test 23: Rollover - when now >= resets_at, window shows "—" and "Window reset, send a message to update"
	await test('Rollover: now >= resets_at displays dash and "Window reset, send a message to update"', () => {
		const ui = new CounterUI();
		const panel = new FakeElement('div', { class: 'cc-panel' });
		const host = new FakeElement('div');
		host.attachShadow = () => host;
		ui.rootElement = host;
		ui.shadowRoot = host;
		ui.panel = panel;

		const sessPct = new FakeElement('span');
		const sessReset = new FakeElement('span');
		const sessBar = new FakeElement('div');
		const sessBarTrack = new FakeElement('div');
		sessBarTrack.appendChild(sessBar);

		const weekPct = new FakeElement('span');
		const weekReset = new FakeElement('span');
		const weekBar = new FakeElement('div');
		const weekBarTrack = new FakeElement('div');
		weekBarTrack.appendChild(weekBar);

		ui.dom = {
			rowSession: new FakeElement('div'),
			rowWeekly: new FakeElement('div'),
			sessPct,
			sessReset,
			sessBar,
			weekPct,
			weekReset,
			weekBar
		};

		const resetTimeMs = 1792265400 * 1000;
		const norm = {
			state: 'ok',
			session: {
				pctUsed: 42,
				pctLeft: 58,
				resetsAt: new Date(resetTimeMs).toISOString()
			},
			weekly: {
				pctUsed: 15,
				pctLeft: 85,
				resetsAt: new Date(resetTimeMs + 86400000).toISOString()
			},
			capturedAt: resetTimeMs - 3600000
		};

		ui.setNormalizedUsage(norm);

		// Before rollover: shows percent used/left and countdown
		ui.renderSessionAndWeekly(resetTimeMs - 60000);
		assert.strictEqual(sessPct.textContent, '42% used · 58% left');
		assert.strictEqual(sessReset.textContent, 'resets in 1m');
		assert.strictEqual(sessBar.style.width, '42%');

		// At and after rollover (now >= resets_at):
		ui.renderSessionAndWeekly(resetTimeMs);
		assert.strictEqual(sessPct.textContent, '—', 'Rolled over session must display dash');
		assert.strictEqual(sessReset.textContent, 'Window reset, send a message to update', 'Rolled over session must show reset notice');
		assert.strictEqual(sessBar.style.width, '0%', 'Rolled over session bar width must be 0%');

		// Weekly reset has not passed yet: still active
		assert.strictEqual(weekPct.textContent, '15% used · 85% left');
		assert.strictEqual(weekBar.style.width, '15%');
	});

	// Test 24: Migration - keeps Context & Cache visible for existing saved settings while preserving custom colors/theme
	await test('Migration: keeps Context and Cache visible for existing saved settings while preserving theme and colors', () => {
		const storage = createMockStorage();
		global.localStorage = storage;

		// Pre-existing settings saved by v0.5.8 user
		const existingSettings = {
			preset: 'sunset',
			lowColor: '#123456',
			midColor: '#345678',
			highColor: '#789abc',
			opacity: 0.85,
			showContext: true,
			showCache: true,
			showSession: true,
			showWeekly: true
		};
		storage.setItem('cc_settings', JSON.stringify(existingSettings));

		// Load CounterUI in v0.6.5
		const ui = new CounterUI();

		// Asserts
		assert.strictEqual(ui.settings.preset, 'sunset', 'Must preserve user preset');
		assert.strictEqual(ui.settings.lowColor, '#123456', 'Must preserve custom lowColor');
		assert.strictEqual(ui.settings.opacity, 0.85, 'Must preserve opacity');
		assert.strictEqual(ui.settings.showSession, true, 'Must preserve showSession');
		assert.strictEqual(ui.settings.showWeekly, true, 'Must preserve showWeekly');

		assert.strictEqual(ui.settings.v060_migrated, true, 'Must set v060_migrated=true');
		assert.strictEqual(ui.settings.showContext, true, 'Must preserve user showContext true');
		assert.strictEqual(ui.settings.showCache, true, 'Must preserve user showCache true');

		// Check persisted in storage
		const saved = JSON.parse(storage.getItem('cc_settings'));
		assert.strictEqual(saved.v060_migrated, true);
		assert.strictEqual(saved.showContext, true);
		assert.strictEqual(saved.showCache, true);
		assert.strictEqual(saved.lowColor, '#123456');
	});

	// Test 25: No conversation fetch is issued while Context and Cache are hidden; resumes when enabled
	await test('No conversation fetch is issued while Context and Cache are hidden; resumes when turned back on', async () => {
		global.localStorage = createMockStorage();
		const { main } = setupRealMainEnvironment();
		const { _internal } = main;
		const ui = _internal.getUi();

		// Default in v0.6.6: Context & Cache are OFF by default
		assert.strictEqual(ui.settings.showContext, false);
		assert.strictEqual(ui.settings.showCache, false);
		assert.strictEqual(ui.shouldFetchConversation(), false);

		// Let initial async mount load settle
		await new Promise(r => setTimeout(r, 20));

		// Verified initial state: Context & Cache are false
		assert.strictEqual(ui.shouldFetchConversation(), false);

		let fetchCalls = 0;
		global.ClaudeCounter.bridge.requestConversation = async () => {
			fetchCalls++;
			return { chat_messages: [] };
		};

		_internal.setCurrentConversationId('chat-hidden-test');

		// 1. Calling refreshConversation must be a NO-OP (0 network requests)
		await _internal.refreshConversation();
		assert.strictEqual(fetchCalls, 0, 'No conversation fetch should be issued while Context & Cache are hidden');

		// 2. Stream post-refetch must also be a NO-OP
		await _internal.triggerStreamPostRefetch('chat-hidden-test', 'leaf-1', null, Date.now());
		assert.strictEqual(fetchCalls, 0, 'No stream post-refetch should be issued while Context & Cache are hidden');

		// 3. User turns Context back on in settings
		ui.settings.showContext = true;
		assert.strictEqual(ui.shouldFetchConversation(), true);

		// 4. Now refreshConversation proceeds and issues fetch
		await _internal.refreshConversation();
		assert.strictEqual(fetchCalls, 1, 'Conversation fetch must proceed after user enables Context');
	});

	// =========================================================================
	// Reproduction Matrix & Safety Tests (0.6.1 Bug Fixes)
	// =========================================================================
	function setupDOMForRealCounterUI() {
		ClaudeCounter.ui.CounterUI.prototype.initialize = originalCounterUIInitialize;

		function parseHTMLInto(html, parent) {
			const cleaned = html.replace(/<!--[\s\S]*?-->/g, '');
			const tagRegex = /<(?:\/([a-zA-Z0-9\-]+)|([a-zA-Z0-9\-]+)([^>]*?)(\/)?)>/g;
			const voidTags = new Set(['input', 'img', 'br', 'hr', 'rect', 'circle', 'path']);
			let stack = [parent];
			let match;
			let lastIdx = 0;

			while ((match = tagRegex.exec(cleaned)) !== null) {
				const [full, closeTag, openTag, attrStr, selfClose] = match;
				const textBetween = cleaned.slice(lastIdx, match.index).trim();
				if (textBetween && stack.length > 0) {
					const top = stack[stack.length - 1];
					top._rawText = (top._rawText ? top._rawText + ' ' : '') + textBetween;
				}
				lastIdx = tagRegex.lastIndex;

				if (closeTag) {
					const tagUpper = closeTag.toUpperCase();
					if (stack.length > 1 && stack[stack.length - 1].tagName === tagUpper) {
						stack.pop();
					}
				} else if (openTag) {
					const el = new TestDOMElement(openTag);
					if (attrStr) {
						const attrRegex = /([a-zA-Z0-9\-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
						let attrMatch;
						while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
							const name = attrMatch[1];
							const val = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
							el.setAttribute(name, val);
							if (name.startsWith('data-')) {
								const dataKey = name.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
								el.dataset[dataKey] = val;
							}
						}
					}
					stack[stack.length - 1].appendChild(el);
					const isVoid = voidTags.has(openTag.toLowerCase()) || Boolean(selfClose);
					if (!isVoid) {
						stack.push(el);
					}
				}
			}
		}

		class TestDOMElement {
			constructor(tagName = 'div') {
				this.tagName = tagName.toUpperCase();
				this.id = '';
				this.className = '';
				this.children = [];
				this.parentElement = null;
				this.shadowRoot = null;
				this.style = {
					properties: {},
					setProperty(k, v) { this.properties[k] = String(v); this[k] = String(v); },
					getPropertyValue(k) { return this.properties[k] || this[k] || ''; }
				};
				this.attributes = {};
				this._classes = new Set();
				this.classList = {
					add: (...cls) => {
						for (const c of cls) this._classes.add(c);
						this.className = Array.from(this._classes).join(' ');
					},
					remove: (...cls) => {
						for (const c of cls) this._classes.delete(c);
						this.className = Array.from(this._classes).join(' ');
					},
					toggle: (c, force) => {
						if (force === undefined) {
							if (this._classes.has(c)) this._classes.delete(c);
							else this._classes.add(c);
						} else if (force) {
							this._classes.add(c);
						} else {
							this._classes.delete(c);
						}
						this.className = Array.from(this._classes).join(' ');
						return this._classes.has(c);
					},
					contains: (c) => this._classes.has(c)
				};
				this.listeners = {};
				this.dataset = {};
				this._textContent = undefined;
				this._rawText = '';
				this.title = '';
				this.value = '';
				this.checked = false;
			}

			get textContent() {
				if (this._textContent !== undefined) return this._textContent;
				if (this.children.length === 0) return this._rawText || '';
				return this.children.map(c => c.textContent).join('');
			}

			set textContent(val) {
				this._textContent = String(val);
			}

			set innerHTML(html) {
				this._innerHTML = html;
				this.children = [];
				parseHTMLInto(html, this);
			}

			get innerHTML() {
				return this._innerHTML || '';
			}

			attachShadow() {
				this.shadowRoot = new TestShadowRoot(this);
				return this.shadowRoot;
			}

			appendChild(child) {
				child.parentElement = this;
				this.children.push(child);
				return child;
			}

			setAttribute(k, v) {
				this.attributes[k] = String(v);
				if (k === 'id') this.id = String(v);
				if (k === 'class') {
					this.className = String(v);
					this._classes = new Set(this.className.split(/\s+/).filter(Boolean));
				}
				if (k === 'style') {
					const stylePairs = String(v).split(';').map(s => s.trim()).filter(Boolean);
					for (const pair of stylePairs) {
						const [prop, ...valParts] = pair.split(':');
						if (prop && valParts.length > 0) {
							const propName = prop.trim();
							const propVal = valParts.join(':').trim();
							this.style[propName] = propVal;
							this.style.setProperty(propName, propVal);
						}
					}
				}
			}

			getAttribute(k) {
				return this.attributes[k] || null;
			}

			addEventListener(evt, fn) {
				if (!this.listeners[evt]) this.listeners[evt] = [];
				this.listeners[evt].push(fn);
			}

			dispatchEvent(evt, data = {}) {
				const handlers = this.listeners[evt] || [];
				const eventObj = Object.assign({ target: this, currentTarget: this, stopPropagation: () => {} }, data);
				for (const fn of handlers) {
					fn(eventObj);
				}
			}

			closest(sel) {
				let cur = this;
				while (cur) {
					if (cur.matches && cur.matches(sel)) return cur;
					cur = cur.parentElement;
				}
				return null;
			}

			matches(sel) {
				if (sel.startsWith('#')) return this.id === sel.slice(1);
				if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
				return false;
			}
		}

		class TestShadowRoot {
			constructor(host) {
				this.host = host;
				this.children = [];
				this._elementsById = new Map();
			}

			appendChild(child) {
				child.parentElement = this;
				this.children.push(child);
				this._indexElements(child);
				return child;
			}

			_indexElements(el) {
				if (el.id) this._elementsById.set(el.id, el);
				if (el.children) {
					for (const c of el.children) this._indexElements(c);
				}
			}

			getElementById(id) {
				return this._elementsById.get(id) || null;
			}

			querySelectorAll(sel) {
				const res = [];
				const walk = (el) => {
					if (el.matches && el.matches(sel)) res.push(el);
					if (el.children) {
						for (const c of el.children) walk(c);
					}
				};
				for (const c of this.children) walk(c);
				return res;
			}
		}

		global.document = {
			documentElement: new TestDOMElement('html'),
			body: new TestDOMElement('body'),
			createElement: (tag) => new TestDOMElement(tag)
		};
		global.window = {
			matchMedia: () => ({ matches: false })
		};
		global.MutationObserver = class {
			observe() {}
			disconnect() {}
		};
	}

	// Test 26: Reproduction Case 1: 0.5.3 saved settings with showSession: false, showWeekly: false -> migrated to visible and not empty
	await test('Reproduction Case 1: 0.5.3 saved settings (showSession: false, showWeekly: false) -> migrated to visible and panel not empty', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_settings', JSON.stringify({
			preset: 'default',
			lowColor: '#10b981',
			midColor: '#f59e0b',
			highColor: '#ef4444',
			accentColor: '#d97706',
			opacity: 0.94,
			showSession: false,
			showWeekly: false
		}));

		const ui = new CounterUI();
		ui.initialize();
		ui.renderSessionAndWeekly();

		assert.strictEqual(ui.settings.v061_migrated, true, 'Must set v061_migrated=true');
		assert.strictEqual(ui.settings.showSession, true, 'showSession must be migrated to true');
		assert.strictEqual(ui.settings.showWeekly, true, 'showWeekly must be migrated to true');

		const rowSess = ui.shadowRoot.getElementById('cc-row-session');
		const rowWeek = ui.shadowRoot.getElementById('cc-row-weekly');
		assert.ok(rowSess && !rowSess.classList.contains('cc-hidden'), 'Session row must not be cc-hidden');
		assert.ok(rowWeek && !rowWeek.classList.contains('cc-hidden'), 'Weekly row must not be cc-hidden');

		const gearBtn = ui.shadowRoot.getElementById('cc-gear-btn');
		assert.ok(gearBtn, 'Gear button must exist');
		const isPanelEmpty = rowSess.classList.contains('cc-hidden') && rowWeek.classList.contains('cc-hidden');
		assert.strictEqual(isPanelEmpty, false, 'Panel must not be empty');
	});

	// Test 27: Reproduction Case 2: 0.5.5 / 0.5.7 saved settings with showSession: false, showWeekly: false -> migrated to visible
	await test('Reproduction Case 2: 0.5.5 / 0.5.7 saved settings (showSession: false, showWeekly: false) -> migrated to visible', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_settings', JSON.stringify({
			preset: 'default',
			lowColor: '#10b981',
			midColor: '#f59e0b',
			highColor: '#ef4444',
			accentColor: '#d97706',
			opacity: 0.94,
			showSession: false,
			showWeekly: false,
			contextWindow: 200000
		}));

		const ui = new CounterUI();
		ui.initialize();

		assert.strictEqual(ui.settings.v061_migrated, true, 'Must set v061_migrated=true');
		assert.strictEqual(ui.settings.showSession, true, 'showSession must be true');
		assert.strictEqual(ui.settings.showWeekly, true, 'showWeekly must be true');
		const rowSess = ui.shadowRoot.getElementById('cc-row-session');
		assert.strictEqual(rowSess.classList.contains('cc-hidden'), false, 'Session row must not be cc-hidden');
	});

	// Test 28: Reproduction Case 3: 0.6.0 post-migration with preserved showSession: false, showWeekly: false -> migrated by v061
	await test('Reproduction Case 3: 0.6.0 post-migration with preserved showSession: false, showWeekly: false -> migrated by v061', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_settings', JSON.stringify({
			preset: 'default',
			lowColor: '#10b981',
			midColor: '#f59e0b',
			highColor: '#ef4444',
			accentColor: '#d97706',
			opacity: 0.94,
			showSession: false,
			showWeekly: false,
			showContext: false,
			showCache: false,
			contextWindow: 200000,
			v060_migrated: true
		}));

		const ui = new CounterUI();
		ui.initialize();

		assert.strictEqual(ui.settings.v061_migrated, true, 'Must set v061_migrated=true');
		assert.strictEqual(ui.settings.showSession, true, 'showSession must be true');
		assert.strictEqual(ui.settings.showWeekly, true, 'showWeekly must be true');
		const rowSess = ui.shadowRoot.getElementById('cc-row-session');
		const rowWeek = ui.shadowRoot.getElementById('cc-row-weekly');
		assert.strictEqual(rowSess.classList.contains('cc-hidden'), false);
		assert.strictEqual(rowWeek.classList.contains('cc-hidden'), false);
	});

	// Test 29: Reproduction Case 4: 0.5.7 showSession: false, showWeekly: false + cc_expanded: false -> rows visible, not empty
	await test('Reproduction Case 4: 0.5.7 showSession: false, showWeekly: false + cc_expanded: false -> rows visible, not empty', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_settings', JSON.stringify({
			preset: 'default',
			lowColor: '#10b981',
			midColor: '#f59e0b',
			highColor: '#ef4444',
			accentColor: '#d97706',
			opacity: 0.94,
			showSession: false,
			showWeekly: false
		}));
		storage.setItem('cc_expanded', 'false');

		const ui = new CounterUI();
		ui.initialize();

		assert.strictEqual(ui.isExpanded, false);
		assert.strictEqual(ui.settings.showSession, true);
		assert.strictEqual(ui.settings.showWeekly, true);
		const rowSess = ui.shadowRoot.getElementById('cc-row-session');
		assert.strictEqual(rowSess.classList.contains('cc-hidden'), false);
	});

	// Test 30: Reproduction Case 5: Wrong type: null for showSession/showWeekly -> falls back to boolean defaults
	await test('Reproduction Case 5: Wrong type: null for showSession/showWeekly -> falls back to boolean defaults', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_settings', JSON.stringify({
			showSession: null,
			showWeekly: null,
			v061_migrated: true
		}));

		const ui = new CounterUI();
		assert.strictEqual(ui.settings.showSession, true, 'null showSession must fall back to default true');
		assert.strictEqual(ui.settings.showWeekly, true, 'null showWeekly must fall back to default true');
	});

	// Test 31: Reproduction Case 6: Persistent header and gear button render and are accessible in empty state
	await test('Reproduction Case 6: Persistent header and gear button render and are accessible in empty state', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;

		const ui = new CounterUI();
		ui.initialize();
		// Empty state: no usage data yet
		ui.renderSessionAndWeekly();

		const header = ui.shadowRoot.getElementById('cc-header');
		assert.ok(header, 'Persistent header must exist in DOM');
		const gearBtn = ui.shadowRoot.getElementById('cc-gear-btn');
		assert.ok(gearBtn, 'Gear button must exist');
		assert.strictEqual(gearBtn.parentElement.id, 'cc-header-actions', 'Gear button must be inside persistent header, not row');
		assert.strictEqual(gearBtn.closest('.cc-hidden'), null, 'Gear button must never be hidden');
	});

	// Test 32: Reproduction Case 7: Settings validation & range clamping: invalid preset, invalid colors, clamped opacity, contextWindow
	await test('Reproduction Case 7: Settings validation & range clamping: invalid preset, invalid colors, clamped opacity, contextWindow', () => {
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_settings', JSON.stringify({
			preset: 'invalid_preset',
			lowColor: 'not-a-color',
			midColor: '',
			highColor: null,
			opacity: 0.1, // below slider range min 50%
			contextWindow: 50 // below min 1000
		}));

		const ui = new CounterUI();
		assert.strictEqual(ui.settings.preset, 'default', 'Invalid preset must fall back to default');
		assert.strictEqual(ui.settings.lowColor, PRESETS.default.low, 'Invalid lowColor must fall back to default');
		assert.strictEqual(ui.settings.midColor, PRESETS.default.mid, 'Empty midColor must fall back to default');
		assert.strictEqual(ui.settings.highColor, PRESETS.default.high, 'Null highColor must fall back to default');
		assert.strictEqual(ui.settings.opacity, 0.50, 'Opacity below 0.50 must be clamped to 0.50');
		assert.strictEqual(ui.settings.contextWindow, 200000, 'ContextWindow < 1000 must fall back to default 200000');
	});

	// Test 33: Reproduction Case 8: Render error fallback: catches throw, logs render_error, and displays fallback rows with "—"
	await test('Reproduction Case 8: Render error fallback: catches throw, logs render_error, and displays fallback rows with "—"', () => {
		setupDOMForRealCounterUI();
		const debugLogs = [];
		const ui = new CounterUI({
			onDebugLog: (cat, data) => debugLogs.push({ cat, data })
		});
		ui.initialize();

		// Trigger renderSessionAndWeekly with malformed currentNormalizedState causing error
		ui.currentNormalizedState = {
			session: {
				get pctUsed() {
					throw new Error('Simulated session calculation failure');
				}
			}
		};

		// Should not throw uncaught error
		ui.renderSessionAndWeekly();

		const errorLog = debugLogs.find(l => l.cat === 'render_error');
		assert.ok(errorLog, 'Must log render_error event');
		assert.strictEqual(errorLog.data.name, 'Error');
		assert.strictEqual(errorLog.data.message, 'Simulated session calculation failure');

		// Fallback rows rendered with "—" and visible
		const sessPct = ui.shadowRoot.getElementById('cc-sess-pct');
		const rowSess = ui.shadowRoot.getElementById('cc-row-session');
		assert.strictEqual(sessPct.textContent, '—', 'Fallback row must show —');
		assert.strictEqual(rowSess.classList.contains('cc-hidden'), false, 'Fallback row must be visible');
	});

	// Test 34: Reproduction Case 9: panel_render_state debug log emitted with booleans only and cc_* key names
	await test('Reproduction Case 9: panel_render_state debug log emitted with booleans only and cc_* key names', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_settings', '{}');
		storage.setItem('cc_expanded', 'true');
		storage.setItem('unrelated_key', 'secret_val');

		const debugLogs = [];
		const ui = new CounterUI({
			onDebugLog: (cat, data) => debugLogs.push({ cat, data })
		});
		ui.initialize();
		ui.renderSessionAndWeekly();

		const stateLog = debugLogs.find(l => l.cat === 'panel_render_state');
		assert.ok(stateLog, 'Must log panel_render_state');
		assert.strictEqual(typeof stateLog.data.showSession, 'boolean');
		assert.strictEqual(typeof stateLog.data.showWeekly, 'boolean');
		assert.strictEqual(typeof stateLog.data.showContext, 'boolean');
		assert.strictEqual(typeof stateLog.data.showCache, 'boolean');
		assert.strictEqual(typeof stateLog.data.rowsInDom, 'boolean');
		assert.ok(Array.isArray(stateLog.data.keys), 'Must contain list of keys');
		assert.ok(stateLog.data.keys.includes('cc_settings'));
		assert.ok(stateLog.data.keys.includes('cc_expanded'));
		assert.strictEqual(stateLog.data.keys.includes('unrelated_key'), false, 'Must only include cc_* keys');
		assert.strictEqual(JSON.stringify(stateLog.data).includes('secret_val'), false, 'Never log values');
	});

	// Test 35: Amendment 2: Test A - General CSS parser over UI_STYLES
	await test('Test A (Amendment 2): parse every CSS rule in UI_STYLES; fail if row selectors have display:none or hiding properties', () => {
		const uiModule = require('../src/content/ui.js');
		let uiStyles = uiModule.UI_STYLES || uiModule.CounterUI?.UI_STYLES;
		if (!uiStyles) {
			const content = fs.readFileSync(path.join(__dirname, '../src/content/ui.js'), 'utf8');
			const match = content.match(/const\s+UI_STYLES\s*=\s*`([\s\S]*?)`;/);
			if (match) uiStyles = match[1];
		}
		assert.ok(uiStyles && typeof uiStyles === 'string', 'UI_STYLES must be non-empty string');

		function parseCSSRules(css) {
			const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
			function extractRules(text) {
				const result = [];
				let pos = 0;
				while (pos < text.length) {
					const openBrace = text.indexOf('{', pos);
					if (openBrace === -1) break;

					const selector = text.slice(pos, openBrace).trim();
					let depth = 1;
					let closeBrace = openBrace + 1;
					while (closeBrace < text.length && depth > 0) {
						if (text[closeBrace] === '{') depth++;
						else if (text[closeBrace] === '}') depth--;
						closeBrace++;
					}

					const body = text.slice(openBrace + 1, closeBrace - 1).trim();
					pos = closeBrace;

					if (selector.startsWith('@media') || selector.startsWith('@supports')) {
						result.push(...extractRules(body));
					} else if (selector.startsWith('@keyframes')) {
						// Keyframes steps, skip
					} else if (selector) {
						result.push({ selector, body });
					}
				}
				return result;
			}
			return extractRules(noComments);
		}

		const rules = parseCSSRules(uiStyles);
		assert.ok(rules.length > 10, `Expected many CSS rules, got ${rules.length}`);

		const targetTokens = ['#cc-row-session', '#cc-row-weekly', '.cc-row--session', '.cc-row--weekly'];
		const violations = [];

		for (const rule of rules) {
			// Allowed: the generic .cc-hidden class only
			if (rule.selector.trim() === '.cc-hidden') continue;

			const matchedToken = targetTokens.find(token => rule.selector.includes(token));
			if (!matchedToken) continue;

			// Check for hiding properties in the body
			const normBody = rule.body.replace(/\s+/g, '').toLowerCase();
			const hasDisplayNone = normBody.includes('display:none');
			const hasVisibilityHidden = normBody.includes('visibility:hidden');
			const hasHeightZero = /(^|;)(max-)?height:0(px)?([;!]|$)/.test(normBody);
			const hasOpacityZero = /(^|;)opacity:0([;!]|$)/.test(normBody);

			if (hasDisplayNone || hasVisibilityHidden || hasHeightZero || hasOpacityZero) {
				violations.push({
					selector: rule.selector,
					body: rule.body,
					matchedToken
				});
			}
		}

		assert.strictEqual(
			violations.length,
			0,
			`Disallowed hiding CSS rules found for row selectors: ${JSON.stringify(violations, null, 2)}`
		);
	});

	// Test 36: Amendment 4: Test B - Real CounterUI render path for empty and error states asserting on textContent
	await test('Test B (Amendment 4): real CounterUI render path asserts on textContent for empty and error states', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;

		const ui = new CounterUI();
		ui.initialize();

		// Helper to check for hiding ancestors
		function assertNoHidingAncestor(element, elementName) {
			let cur = element.parentElement;
			while (cur) {
				const inlineDisplay = cur.style?.display || cur.style?.getPropertyValue?.('display');
				if (inlineDisplay === 'none') {
					assert.fail(`${elementName} is inside display:none ancestor: <${cur.tagName} id="${cur.id}">`);
				}
				const styleAttr = cur.getAttribute?.('style') || '';
				if (/display\s*:\s*none/i.test(styleAttr)) {
					assert.fail(`${elementName} is inside display:none style attribute: <${cur.tagName} id="${cur.id}">`);
				}
				if (cur.classList?.contains?.('cc-hidden')) {
					assert.fail(`${elementName} is inside .cc-hidden ancestor: <${cur.tagName} id="${cur.id}">`);
				}
				cur = cur.parentElement;
			}
		}

		// 1. State: Empty
		ui.setNormalizedUsage({ state: 'empty' });

		const rowSessEmpty = ui.shadowRoot.getElementById('cc-row-session');
		const rowWeekEmpty = ui.shadowRoot.getElementById('cc-row-weekly');
		assert.ok(rowSessEmpty, 'Session row must exist in DOM');
		assert.ok(rowWeekEmpty, 'Weekly row must exist in DOM');
		assert.strictEqual(rowSessEmpty.classList.contains('cc-hidden'), false, 'Session row must not have cc-hidden in empty state');
		assert.strictEqual(rowWeekEmpty.classList.contains('cc-hidden'), false, 'Weekly row must not have cc-hidden in empty state');

		const sessPctEmpty = ui.shadowRoot.getElementById('cc-sess-pct');
		const sessResetEmpty = ui.shadowRoot.getElementById('cc-sess-reset');
		const weekPctEmpty = ui.shadowRoot.getElementById('cc-week-pct');
		const weekResetEmpty = ui.shadowRoot.getElementById('cc-week-reset');

		assert.strictEqual(sessPctEmpty.textContent, '—', 'sessPct must be non-empty "—" in empty state');
		assert.strictEqual(sessResetEmpty.textContent, '—', 'sessReset must be non-empty "—" in empty state');
		assert.strictEqual(weekPctEmpty.textContent, '—', 'weekPct must be non-empty "—" in empty state');
		assert.strictEqual(weekResetEmpty.textContent, '—', 'weekReset must be non-empty "—" in empty state');

		const emptyNotice = ui.shadowRoot.getElementById('cc-empty-notice');
		assert.ok(emptyNotice, 'Empty notice must exist in DOM');
		assert.strictEqual(emptyNotice.textContent, 'No data yet. Updates after your next message.', 'Empty notice text must match exactly');
		assertNoHidingAncestor(emptyNotice, '#cc-empty-notice');
		assert.strictEqual(ui.panel.classList.contains('cc-state-empty'), true, 'Panel must have cc-state-empty class');
		assert.strictEqual(ui.panel.classList.contains('cc-state-error'), false, 'Panel must not have cc-state-error class');

		// 2. State: Error
		ui.setNormalizedUsage({ state: 'error', errorReason: 'Network error 503' });

		const rowSessErr = ui.shadowRoot.getElementById('cc-row-session');
		const rowWeekErr = ui.shadowRoot.getElementById('cc-row-weekly');
		assert.ok(rowSessErr, 'Session row must exist in error state');
		assert.ok(rowWeekErr, 'Weekly row must exist in error state');
		assert.strictEqual(rowSessErr.classList.contains('cc-hidden'), false, 'Session row must not have cc-hidden in error state');
		assert.strictEqual(rowWeekErr.classList.contains('cc-hidden'), false, 'Weekly row must not have cc-hidden in error state');

		const sessPctErr = ui.shadowRoot.getElementById('cc-sess-pct');
		const sessResetErr = ui.shadowRoot.getElementById('cc-sess-reset');
		const weekPctErr = ui.shadowRoot.getElementById('cc-week-pct');
		const weekResetErr = ui.shadowRoot.getElementById('cc-week-reset');

		assert.strictEqual(sessPctErr.textContent, '—', 'sessPct must be "—" in error state');
		assert.strictEqual(sessResetErr.textContent, '—', 'sessReset must be "—" in error state');
		assert.strictEqual(weekPctErr.textContent, '—', 'weekPct must be "—" in error state');
		assert.strictEqual(weekResetErr.textContent, '—', 'weekReset must be "—" in error state');

		const errorNotice = ui.shadowRoot.getElementById('cc-error-notice');
		assert.ok(errorNotice, 'Error notice must exist in DOM');
		const errorMsg = ui.shadowRoot.getElementById('cc-error-msg');
		assert.strictEqual(errorMsg.textContent, 'Network error 503', 'Error message textContent must match errorReason');
		assertNoHidingAncestor(errorNotice, '#cc-error-notice');
		assert.strictEqual(ui.panel.classList.contains('cc-state-error'), true, 'Panel must have cc-state-error class');
		assert.strictEqual(ui.panel.classList.contains('cc-state-empty'), false, 'Panel must not have cc-state-empty class');
	});

	// Test 37: State OK Preservation - Real CounterUI render path for active usage
	await test('State OK Preservation: real CounterUI renders "X% used · Y% left" and reset countdown in ok state', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;

		const ui = new CounterUI();
		ui.initialize();

		const now = Date.now();
		ui.setNormalizedUsage({
			state: 'ok',
			session: {
				pct: 35,
				pctUsed: 35,
				pctLeft: 65,
				resetsAt: new Date(now + 3600 * 1000 * 3).toISOString()
			},
			weekly: {
				pct: 15,
				pctUsed: 15,
				pctLeft: 85,
				resetsAt: new Date(now + 3600 * 1000 * 50).toISOString()
			}
		});

		const rowSess = ui.shadowRoot.getElementById('cc-row-session');
		const rowWeek = ui.shadowRoot.getElementById('cc-row-weekly');
		assert.ok(rowSess, 'Session row exists');
		assert.ok(rowWeek, 'Weekly row exists');
		assert.strictEqual(rowSess.classList.contains('cc-hidden'), false, 'Session row not hidden');
		assert.strictEqual(rowWeek.classList.contains('cc-hidden'), false, 'Weekly row not hidden');

		const sessPct = ui.shadowRoot.getElementById('cc-sess-pct');
		const sessReset = ui.shadowRoot.getElementById('cc-sess-reset');
		const weekPct = ui.shadowRoot.getElementById('cc-week-pct');
		const weekReset = ui.shadowRoot.getElementById('cc-week-reset');

		assert.strictEqual(sessPct.textContent, '35% used · 65% left', 'sessPct shows "X% used · Y% left"');
		assert.ok(sessReset.textContent.includes('resets in'), `sessReset countdown text must be present, got: "${sessReset.textContent}"`);

		assert.strictEqual(weekPct.textContent, '15% used · 85% left', 'weekPct shows "X% used · Y% left"');
		assert.ok(weekReset.textContent.includes('d') || weekReset.textContent.includes('h'), `weekReset countdown text must be present, got: "${weekReset.textContent}"`);

		assert.strictEqual(ui.panel.classList.contains('cc-state-empty'), false, 'Panel must not have cc-state-empty');
		assert.strictEqual(ui.panel.classList.contains('cc-state-error'), false, 'Panel must not have cc-state-error');
	});

	// =========================================================================
	// Version 0.6.3 Tests: Stream Interception & Transport Diagnostics
	// =========================================================================

	function createMockSseResponse(sseText, contentType = 'text/event-stream; charset=utf-8', status = 200) {
		const encoder = new TextEncoder();
		const bodyStream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sseText));
				controller.close();
			}
		});
		return {
			status,
			ok: status >= 200 && status < 300,
			headers: {
				get(name) {
					if (name.toLowerCase() === 'content-type') return contentType;
					return null;
				}
			},
			clone() {
				const cloneStream = new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode(sseText));
						controller.close();
					}
				});
				return { body: cloneStream };
			},
			body: bodyStream
		};
	}

	function setupBridgeTestEnvironment() {
		const postedMessages = [];
		if (!global.window) global.window = {};
		global.window.location = {
			origin: 'https://claude.ai',
			pathname: '/chat'
		};
		global.window.postMessage = (msg) => {
			postedMessages.push(msg);
		};
		if (!global.window.addEventListener) {
			global.window.addEventListener = () => {};
		}
		global.window.__cc_fetch_wrapped__ = false;
		global.window.localStorage = global.localStorage;
		return { fakeWindow: global.window, postedMessages };
	}

	// Test 38: 5(a) - SSE response at an unknown path /api/organizations/<uuid>/foo/bar forwards cc:message_limit
	await test('5(a): SSE response at unknown path /api/organizations/<uuid>/foo/bar forwards cc:message_limit', async () => {
		const bridge = require('../src/injected/bridge.js');
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'true');

		const { fakeWindow, postedMessages } = setupBridgeTestEnvironment();
		const ssePayload = 'event: message_limit\ndata: {"type":"message_limit","message_limit":{"windows":{"5h":{"utilization":0.4}}}}\n\n';
		const expectedResponse = createMockSseResponse(ssePayload);

		fakeWindow.fetch = async () => expectedResponse;
		assert.strictEqual(typeof bridge.wrapFetch, 'function', 'wrapFetch must be exported by bridge.js');
		bridge.wrapFetch(fakeWindow);

		const res = await fakeWindow.fetch('https://claude.ai/api/organizations/11111111-1111-1111-1111-111111111111/foo/bar', {
			method: 'POST'
		});
		assert.strictEqual(res, expectedResponse, 'Page must receive the original response untouched');

		await new Promise(r => setTimeout(r, 50));

		const limitMsg = postedMessages.find(m => m.type === 'cc:message_limit');
		assert.ok(limitMsg, 'SSE response at unknown /api/ path must forward cc:message_limit');
		assert.strictEqual(limitMsg.payload?.windows?.['5h']?.utilization, 0.4);

		const diagMsg = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'sse_stream_seen');
		assert.ok(diagMsg, 'sse_stream_seen must be posted when debug is on');
		assert.strictEqual(diagMsg.payload.data.matchedBy, 'content-type');
		assert.strictEqual(diagMsg.payload.data.pathShape, '/api/organizations/:id/foo/bar');
		assert.strictEqual(diagMsg.payload.data.host, 'claude.ai');
		assert.strictEqual(diagMsg.payload.data.method, 'POST');
		assert.strictEqual(diagMsg.payload.data.status, 200);
	});

	// Test 39: 5(b) - JSON response at /api/... is not intercepted
	await test('5(b): JSON response at /api/... is not intercepted as SSE', async () => {
		const bridge = require('../src/injected/bridge.js');
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'true');

		const { fakeWindow, postedMessages } = setupBridgeTestEnvironment();
		const jsonResponse = {
			status: 200,
			ok: true,
			headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
			clone: () => { throw new Error('Must not clone non-intercepted response'); },
			json: async () => ({ foo: 'bar' })
		};

		fakeWindow.fetch = async () => jsonResponse;
		if (bridge.wrapFetch) bridge.wrapFetch(fakeWindow);

		const res = await fakeWindow.fetch('https://claude.ai/api/organizations/11111111-1111-1111-1111-111111111111/telemetry', {
			method: 'POST'
		});
		assert.strictEqual(res, jsonResponse);

		await new Promise(r => setTimeout(r, 20));
		const sseDiag = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'sse_stream_seen');
		assert.strictEqual(sseDiag, undefined, 'Must not emit sse_stream_seen for JSON responses');
		const streamEnd = postedMessages.find(m => m.type === 'cc:stream_completed');
		assert.strictEqual(streamEnd, undefined, 'Must not stream-complete non-SSE responses');
	});

	// Test 40: 5(c) - SSE response at a non-/api/ path IS still parsed (breadth preserved)
	await test('5(c): SSE response at a non-/api/ path IS still parsed (breadth preserved)', async () => {
		const bridge = require('../src/injected/bridge.js');
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'true');

		const { fakeWindow, postedMessages } = setupBridgeTestEnvironment();
		const ssePayload = 'event: message_limit\ndata: {"type":"message_limit","message_limit":{"windows":{"5h":{"utilization":0.7}}}}\n\n';
		const sseResponse = createMockSseResponse(ssePayload);
		let currentResponse = sseResponse;

		fakeWindow.fetch = async () => currentResponse;
		if (bridge.wrapFetch) bridge.wrapFetch(fakeWindow);

		const res = await fakeWindow.fetch('https://claude.ai/telemetry/stream', {
			method: 'POST'
		});
		assert.strictEqual(res, sseResponse, 'Page must receive original response untouched');

		await new Promise(r => setTimeout(r, 50));
		const sseDiag = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'sse_stream_seen');
		assert.ok(sseDiag, 'Must emit sse_stream_seen for non-/api/ SSE stream');
		assert.strictEqual(sseDiag.payload.data.matchedBy, 'content-type');
		assert.strictEqual(sseDiag.payload.data.pathShape, '/telemetry/stream');
		assert.strictEqual(sseDiag.payload.data.host, 'claude.ai');
		const limitMsg = postedMessages.find(m => m.type === 'cc:message_limit');
		assert.ok(limitMsg, 'Must forward cc:message_limit from non-/api/ stream');
		assert.strictEqual(limitMsg.payload?.windows?.['5h']?.utilization, 0.7);

		// Also test cross-host SSE stream
		currentResponse = createMockSseResponse('data: {"type":"ping"}\n\n');
		await fakeWindow.fetch('https://stats.anthropic.com/events', { method: 'GET' });
		await new Promise(r => setTimeout(r, 20));
		const crossHostDiag = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'sse_stream_seen' && m.payload?.data?.host === 'stats.anthropic.com');
		assert.ok(crossHostDiag, 'Must emit sse_stream_seen with hostname for cross-host SSE');
		assert.strictEqual(crossHostDiag.payload.data.host, 'stats.anthropic.com');
		assert.strictEqual(crossHostDiag.payload.data.pathShape, '/events');
	});

	// Test 41: 5(d) - Existing completion URL still works
	await test('5(d): existing completion URL still works and is matchedBy url', async () => {
		const bridge = require('../src/injected/bridge.js');
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'true');

		const { fakeWindow, postedMessages } = setupBridgeTestEnvironment();
		const ssePayload = 'event: message_limit\ndata: {"type":"message_limit","message_limit":{"windows":{"5h":{"utilization":0.05}}}}\n\n';
		const expectedResponse = createMockSseResponse(ssePayload);

		fakeWindow.fetch = async () => expectedResponse;
		if (bridge.wrapFetch) bridge.wrapFetch(fakeWindow);

		const url = 'https://claude.ai/api/organizations/11111111-1111-1111-1111-111111111111/chat_conversations/22222222-2222-2222-2222-222222222222/completion';
		const res = await fakeWindow.fetch(url, { method: 'POST' });
		assert.strictEqual(res, expectedResponse);

		await new Promise(r => setTimeout(r, 50));

		const startMsg = postedMessages.find(m => m.type === 'cc:generation_start');
		assert.ok(startMsg, 'Must post cc:generation_start for completion URL');

		const limitMsg = postedMessages.find(m => m.type === 'cc:message_limit');
		assert.ok(limitMsg, 'Must forward cc:message_limit');
		assert.strictEqual(limitMsg.payload?.windows?.['5h']?.utilization, 0.05);

		const diagMsg = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'sse_stream_seen');
		assert.ok(diagMsg, 'sse_stream_seen must be posted');
		assert.strictEqual(diagMsg.payload.data.matchedBy, 'url', 'Legacy completion URL must be matchedBy url');
		assert.strictEqual(diagMsg.payload.data.pathShape, '/api/organizations/:id/chat_conversations/:id/completion');
		assert.strictEqual(diagMsg.payload.data.host, 'claude.ai');
	});

	// Test 42: 5(e) - pathShape redaction cases (uuid, hex, digits, query stripped, blob:)
	await test('5(e): pathShape redaction cases (uuid, hex, digits, query stripped, blob:)', () => {
		const { computePathShape } = require('../src/injected/bridge.js');

		// 1. UUID replaced with :id
		assert.strictEqual(
			computePathShape('https://claude.ai/api/organizations/123e4567-e89b-12d3-a456-426614174000/chat_conversations/987e6543-e89b-12d3-a456-426614174000/messages'),
			'/api/organizations/:id/chat_conversations/:id/messages'
		);

		// 2. Hex strings of 16+ chars replaced with :id
		assert.strictEqual(
			computePathShape('https://claude.ai/api/files/0123456789abcdef0123456789abcdef/view'),
			'/api/files/:id/view'
		);

		// 3. All-digit segments replaced with :id
		assert.strictEqual(
			computePathShape('/api/v1/projects/987654321/items/42'),
			'/api/v1/projects/:id/items/:id'
		);

		// 4. Query string and host stripped (pathname only)
		assert.strictEqual(
			computePathShape('https://claude.ai/api/query?secret=token&foo=bar#section'),
			'/api/query'
		);

		// 5. blob: URLs log only scheme
		assert.strictEqual(
			computePathShape('blob:https://claude.ai/123e4567-e89b-12d3-a456-426614174000'),
			'blob:'
		);

		// 6. data: URLs log only scheme
		assert.strictEqual(
			computePathShape('data:application/javascript;base64,YWxlcnQoMSk='),
			'data:'
		);
	});

	// Test 43: 5(f) - Proxy wrappers return real instance, pass args, and throwing logger does not break construction
	await test('5(f): Proxy wrappers return real instance with identical args; throwing logger never breaks construction', () => {
		const bridge = require('../src/injected/bridge.js');
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'true');

		const { fakeWindow, postedMessages } = setupBridgeTestEnvironment();

		const kinds = ['EventSource', 'WebSocket', 'Worker', 'SharedWorker'];
		for (const kind of kinds) {
			class OriginalMock {
				constructor(...args) {
					this.kind = kind;
					this.receivedArgs = args;
					this.isOriginalInstance = true;
				}
			}
			fakeWindow[kind] = OriginalMock;
			bridge.wrapTransportConstructor(kind, fakeWindow);

			// Test construction with args
			const testUrl = 'https://claude.ai/api/ws/12345';
			const testOpt = { protocol: 'v1' };
			const inst = new fakeWindow[kind](testUrl, testOpt);

			assert.ok(inst.isOriginalInstance, `${kind} must return real instance`);
			assert.strictEqual(inst instanceof OriginalMock, true, `${kind} must be instance of original`);
			assert.deepStrictEqual(inst.receivedArgs, [testUrl, testOpt], `${kind} must pass through identical args`);

			const diag = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'transport_created' && m.payload?.data?.kind === kind);
			assert.ok(diag, `Must emit transport_created for ${kind}`);
			assert.strictEqual(diag.payload.data.pathShape, '/api/ws/:id');

			// Test throwing logger resilience: arg that throws when read
			const badArg = {
				get [Symbol.toPrimitive]() {
					throw new Error('Exploding logger');
				}
			};
			const safeInst = new fakeWindow[kind](badArg);
			assert.ok(safeInst.isOriginalInstance, `${kind} must construct successfully even if logger throws`);
		}
	});

	// Test 44: 5(g) - Debug off: no diag messages posted
	await test('5(g): debug off: no diag messages posted and zero extra logging', async () => {
		const bridge = require('../src/injected/bridge.js');
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'false');

		const { fakeWindow, postedMessages } = setupBridgeTestEnvironment();
		fakeWindow.fetch = async () => createMockSseResponse('data: {"type":"message_limit"}\n\n');
		if (bridge.wrapFetch) bridge.wrapFetch(fakeWindow);

		class MockWs {
			constructor(...args) { this.args = args; }
		}
		fakeWindow.WebSocket = MockWs;
		if (bridge.wrapTransportConstructor) bridge.wrapTransportConstructor('WebSocket', fakeWindow);

		// Execute fetch and constructor
		await fakeWindow.fetch('https://claude.ai/api/organizations/11111111-1111-1111-1111-111111111111/foo/bar', { method: 'POST' });
		new fakeWindow.WebSocket('wss://claude.ai/api/ws/999');

		await new Promise(r => setTimeout(r, 20));

		const diagMessages = postedMessages.filter(m => m.type === 'cc:diag');
		assert.strictEqual(diagMessages.length, 0, 'No cc:diag messages must be posted when cc_debug is off');
	});

	// =========================================================================
	// Version 0.6.4 Tests: Bridge Message Handling & Sandbox Integrity
	// =========================================================================

	// Test 45: VM Sandbox message listener integrity across all cc:* types
	await test('VM Sandbox: all cc:* messages sent by content script are handled without ReferenceError/TypeError', async () => {
		const vm = require('vm');
		const fs = require('fs');
		const path = require('path');

		const bridgeCode = fs.readFileSync(path.join(__dirname, '../src/injected/bridge.js'), 'utf8');

		const postedToWindow = [];
		const listeners = { message: [] };

		class MockXHR {
			open() {}
			send() {}
			setRequestHeader() {}
			addEventListener() {}
		}
		class MockEventSource {
			constructor(url) { this.url = url; }
		}
		class MockWebSocket {
			constructor(url) { this.url = url; }
		}
		class MockWorker {
			constructor(url) { this.url = url; }
		}
		class MockSharedWorker {
			constructor(url) { this.url = url; }
		}

		const mockStorage = {
			getItem: () => 'true',
			setItem: () => {}
		};

		const fakeFetch = async (input) => {
			const url = typeof input === 'string' ? input : (input?.url || '');
			if (url.includes('/usage')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						five_hour: { utilization: 0.25, resets_at: 1792265400 },
						seven_day: { utilization: 0.1, resets_at: 1792713600 }
					})
				};
			}
			if (url.includes('/chat_conversations/')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						chat_messages: [{ id: '1', text: 'hi' }]
					})
				};
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({})
			};
		};

		const sandboxWindow = {
			addEventListener: (event, handler) => {
				if (!listeners[event]) listeners[event] = [];
				listeners[event].push(handler);
			},
			removeEventListener: (event, handler) => {
				if (listeners[event]) {
					listeners[event] = listeners[event].filter(h => h !== handler);
				}
			},
			postMessage: (msg) => {
				postedToWindow.push(msg);
			},
			location: {
				origin: 'https://claude.ai',
				pathname: '/chat'
			},
			fetch: fakeFetch,
			XMLHttpRequest: MockXHR,
			EventSource: MockEventSource,
			WebSocket: MockWebSocket,
			Worker: MockWorker,
			SharedWorker: MockSharedWorker,
			localStorage: mockStorage,
			document: {
				head: { appendChild: () => {} },
				documentElement: { appendChild: () => {} },
				getElementById: () => null,
				addEventListener: () => {}
			},
			history: {
				pushState: () => {},
				replaceState: () => {}
			},
			crypto: {
				subtle: {
					digest: async () => new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]).buffer
				}
			},
			TextEncoder,
			URL,
			Request,
			Date,
			setTimeout,
			clearTimeout,
			console
		};
		sandboxWindow.window = sandboxWindow;
		sandboxWindow.globalThis = sandboxWindow;

		const context = vm.createContext(sandboxWindow);
		vm.runInContext(bridgeCode, context);
		const innerWin = vm.runInContext('window', context);

		// Verify bridge announced readiness
		const readyMsg = postedToWindow.find(m => m.type === 'cc:ready');
		assert.ok(readyMsg, 'Bridge must announce cc:ready on load in VM sandbox');

		async function dispatchMessageFromContentScript(msgData) {
			const evt = { source: innerWin, data: msgData };
			for (const handler of (listeners.message || [])) {
				await handler(evt);
			}
		}

		// 1. cc:ping -> cc:pong
		postedToWindow.length = 0;
		await dispatchMessageFromContentScript({ cc: 'ClaudeCounter', type: 'cc:ping' });
		const pongMsg = postedToWindow.find(m => m.type === 'cc:pong');
		assert.ok(pongMsg, 'cc:ping must receive cc:pong');
		assert.strictEqual(pongMsg.payload?.ready, true);

		// 2. cc:request (kind: 'hash') -> cc:response
		postedToWindow.length = 0;
		await dispatchMessageFromContentScript({
			cc: 'ClaudeCounter',
			type: 'cc:request',
			requestId: 'req-hash-1',
			kind: 'hash',
			payload: { text: 'test text' }
		});
		const hashRes = postedToWindow.find(m => m.type === 'cc:response' && m.requestId === 'req-hash-1');
		assert.ok(hashRes, 'kind: hash must receive cc:response');
		assert.strictEqual(hashRes.ok, true);
		assert.strictEqual(hashRes.payload?.hash, 'deadbeef01020304');

		// 3. cc:request (kind: 'usage') -> cc:response
		postedToWindow.length = 0;
		await dispatchMessageFromContentScript({
			cc: 'ClaudeCounter',
			type: 'cc:request',
			requestId: 'req-usage-1',
			kind: 'usage',
			payload: { orgId: '11111111-1111-1111-1111-111111111111' }
		});
		const usageRes = postedToWindow.find(m => m.type === 'cc:response' && m.requestId === 'req-usage-1');
		assert.ok(usageRes, 'kind: usage must receive cc:response');
		assert.strictEqual(usageRes.ok, true, 'Usage response must be ok: true');
		assert.strictEqual(usageRes.payload?.five_hour?.utilization, 0.25);
		assert.strictEqual(usageRes.error, null);
		assert.strictEqual(JSON.stringify(usageRes).includes('originalFetch'), false, 'Response must never contain originalFetch error');

		// 4. cc:request (kind: 'conversation') -> cc:conversation and cc:response
		postedToWindow.length = 0;
		await dispatchMessageFromContentScript({
			cc: 'ClaudeCounter',
			type: 'cc:request',
			requestId: 'req-conv-1',
			kind: 'conversation',
			payload: { orgId: '11111111-1111-1111-1111-111111111111', conversationId: 'conv-999' }
		});
		const convEvent = postedToWindow.find(m => m.type === 'cc:conversation');
		assert.ok(convEvent, 'kind: conversation must post cc:conversation event');
		const convRes = postedToWindow.find(m => m.type === 'cc:response' && m.requestId === 'req-conv-1');
		assert.ok(convRes, 'kind: conversation must receive cc:response');
		assert.strictEqual(convRes.ok, true);
		assert.strictEqual(convRes.error, null);
		assert.strictEqual(JSON.stringify(convRes).includes('originalFetch'), false);

		// 5. cc:request with unknown kind safely returns ok: false
		postedToWindow.length = 0;
		await dispatchMessageFromContentScript({
			cc: 'ClaudeCounter',
			type: 'cc:request',
			requestId: 'req-unknown-1',
			kind: 'unknown_kind',
			payload: {}
		});
		const unknownRes = postedToWindow.find(m => m.type === 'cc:response' && m.requestId === 'req-unknown-1');
		assert.ok(unknownRes, 'Unknown kind must receive cc:response');
		assert.strictEqual(unknownRes.ok, false);
	});

	// Test 46: Specific test for cc:request /usage returning payload without "originalFetch"
	await test('cc:request for /usage goes through real handler with fake fetch and returns cc:response without originalFetch error', async () => {
		const vm = require('vm');
		const fs = require('fs');
		const path = require('path');

		const bridgeCode = fs.readFileSync(path.join(__dirname, '../src/injected/bridge.js'), 'utf8');
		const posted = [];
		const listeners = [];

		const expectedUsage = {
			five_hour: { utilization: 0.15, resets_at: 1792265400 },
			seven_day: { utilization: 0.05, resets_at: 1792713600 }
		};

		const win = {
			addEventListener: (evt, fn) => { if (evt === 'message') listeners.push(fn); },
			removeEventListener: () => {},
			postMessage: (msg) => { posted.push(msg); },
			location: { origin: 'https://claude.ai', pathname: '/chat' },
			fetch: async (url) => {
				assert.ok(url.includes('/api/organizations/11111111-1111-1111-1111-111111111111/usage'));
				return {
					ok: true,
					status: 200,
					json: async () => expectedUsage
				};
			},
			localStorage: { getItem: () => null, setItem: () => {} },
			document: { head: { appendChild: () => {} } },
			history: { pushState: () => {}, replaceState: () => {} },
			TextEncoder,
			URL,
			Request,
			Date,
			setTimeout,
			clearTimeout,
			console
		};
		win.window = win;
		win.globalThis = win;

		const ctx = vm.createContext(win);
		vm.runInContext(bridgeCode, ctx);
		const innerWin = vm.runInContext('window', ctx);

		// Post cc:request for usage
		const reqId = 'req-usage-exact';
		const event = {
			source: innerWin,
			data: {
				cc: 'ClaudeCounter',
				type: 'cc:request',
				requestId: reqId,
				kind: 'usage',
				payload: { orgId: '11111111-1111-1111-1111-111111111111' }
			}
		};

		for (const listener of listeners) {
			await listener(event);
		}

		const resp = posted.find(m => m.type === 'cc:response' && m.requestId === reqId);
		assert.ok(resp, 'Must receive cc:response for usage request');
		assert.strictEqual(resp.ok, true, 'Response must be ok');
		assert.deepStrictEqual(resp.payload, expectedUsage, 'Response payload must match fetched usage');
		assert.strictEqual(resp.error, null, 'Error must be null');
		assert.strictEqual(JSON.stringify(resp).includes('originalFetch'), false, 'Response must not contain "originalFetch"');
	});

	// =========================================================================
	// Version 0.6.5 Tests: Row Visibility, Migration, and Telemetry Noise Fixes
	// =========================================================================

	// Test 47: Exact cc_settings JSON from user evidence preserves user saved Context and Cache rows as false (no migration overrides them)
	await test('0.6.6 Test 47: exact evidence cc_settings JSON preserves Context and Cache rows as false without migration', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;

		// The exact cc_settings JSON from user evidence (Brave profile)
		const evidenceJson = '{"preset":"default","lowColor":"#10b981","midColor":"#f59e0b","highColor":"#ef4444","accentColor":"#3b82f6","opacity":0.94,"showSession":true,"showWeekly":true,"showContext":false,"showCache":false,"v060_migrated":true,"v061_migrated":true,"contextWindow":200000}';
		storage.setItem('cc_settings', evidenceJson);

		const ui = new CounterUI();
		ui.initialize();

		// Real code verification: preserved as false without any migration forcing them to true
		assert.strictEqual(ui.settings.showContext, false, 'showContext must remain false as user saved');
		assert.strictEqual(ui.settings.showCache, false, 'showCache must remain false as user saved');
		assert.strictEqual(ui.settings.showSession, true, 'showSession must remain true');
		assert.strictEqual(ui.settings.showWeekly, true, 'showWeekly must remain true');

		// DOM row visibility
		const rowContext = ui.shadowRoot.getElementById('cc-row-context');
		const rowCache = ui.shadowRoot.getElementById('cc-row-cache');
		const rowSession = ui.shadowRoot.getElementById('cc-row-session');
		const rowWeekly = ui.shadowRoot.getElementById('cc-row-weekly');

		assert.ok(rowContext, 'Context row must exist in DOM');
		assert.ok(rowCache, 'Cache row must exist in DOM');
		assert.strictEqual(rowContext.classList.contains('cc-hidden'), true, 'Context row must be hidden');
		assert.strictEqual(rowCache.classList.contains('cc-hidden'), true, 'Cache row must be hidden');
		assert.strictEqual(rowSession.classList.contains('cc-hidden'), false, 'Session row must NOT be hidden');
		assert.strictEqual(rowWeekly.classList.contains('cc-hidden'), false, 'Weekly row must NOT be hidden');

		// Drawer checkboxes
		const chkCtx = ui.shadowRoot.getElementById('cc-chk-ctx');
		const chkCache = ui.shadowRoot.getElementById('cc-chk-cache');
		assert.ok(chkCtx, 'Context checkbox must exist in drawer');
		assert.ok(chkCache, 'Cache checkbox must exist in drawer');
		assert.strictEqual(chkCtx.checked, false, 'Context checkbox must be unchecked');
		assert.strictEqual(chkCache.checked, false, 'Cache checkbox must be unchecked');
	});

	// Test 48: Fresh profile with no cc_settings saved defaults Context and Cache to false (off by default)
	await test('0.6.6 Test 48: fresh profile defaults showContext: false and showCache: false while Session and Weekly are true', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;
		// Ensure empty storage (no cc_settings)
		assert.strictEqual(storage.getItem('cc_settings'), null);

		const ui = new CounterUI();
		ui.initialize();

		assert.strictEqual(ui.settings.showSession, true, 'Fresh profile must have showSession true');
		assert.strictEqual(ui.settings.showWeekly, true, 'Fresh profile must have showWeekly true');
		assert.strictEqual(ui.settings.showContext, false, 'Fresh profile must have showContext false');
		assert.strictEqual(ui.settings.showCache, false, 'Fresh profile must have showCache false');

		const rowContext = ui.shadowRoot.getElementById('cc-row-context');
		const rowCache = ui.shadowRoot.getElementById('cc-row-cache');
		const rowSession = ui.shadowRoot.getElementById('cc-row-session');
		const rowWeekly = ui.shadowRoot.getElementById('cc-row-weekly');
		assert.strictEqual(rowContext.classList.contains('cc-hidden'), true, 'Context row must be hidden on fresh profile');
		assert.strictEqual(rowCache.classList.contains('cc-hidden'), true, 'Cache row must be hidden on fresh profile');
		assert.strictEqual(rowSession.classList.contains('cc-hidden'), false, 'Session row must be visible on fresh profile');
		assert.strictEqual(rowWeekly.classList.contains('cc-hidden'), false, 'Weekly row must be visible on fresh profile');

		const chkCtx = ui.shadowRoot.getElementById('cc-chk-ctx');
		const chkCache = ui.shadowRoot.getElementById('cc-chk-cache');
		assert.strictEqual(chkCtx.checked, false, 'Context checkbox must be unchecked by default');
		assert.strictEqual(chkCache.checked, false, 'Cache checkbox must be unchecked by default');
	});

	// Test 49: A user who turns Context on by hand keeps it visible after reload
	await test('0.6.6 Test 49: a user who turns Context on by hand keeps it visible after reload', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;

		// Initial load: fresh profile (defaults to false)
		const ui1 = new CounterUI();
		ui1.initialize();
		assert.strictEqual(ui1.settings.showContext, false);
		assert.strictEqual(ui1.settings.showCache, false);

		// User checks Context row in the drawer
		const chkCtx = ui1.shadowRoot.getElementById('cc-chk-ctx');
		chkCtx.checked = true;
		// Dispatch real change event to trigger event listener
		chkCtx.dispatchEvent('change', { target: chkCtx });

		assert.strictEqual(ui1.settings.showContext, true, 'showContext must now be true');
		const rowContext1 = ui1.shadowRoot.getElementById('cc-row-context');
		assert.strictEqual(rowContext1.classList.contains('cc-hidden'), false, 'Context row must now be visible');

		// Check saved in storage
		const saved = JSON.parse(storage.getItem('cc_settings'));
		assert.strictEqual(saved.showContext, true, 'Saved settings must store showContext: true');

		// Reload (new CounterUI instance reading from same localStorage)
		const ui2 = new CounterUI();
		ui2.initialize();

		assert.strictEqual(ui2.settings.showContext, true, 'Reload must keep showContext true');
		assert.strictEqual(ui2.settings.showCache, false, 'showCache must remain false');
		const rowContext2 = ui2.shadowRoot.getElementById('cc-row-context');
		assert.strictEqual(rowContext2.classList.contains('cc-hidden'), false, 'Context row must remain visible after reload');
		const chkCtx2 = ui2.shadowRoot.getElementById('cc-chk-ctx');
		assert.strictEqual(chkCtx2.checked, true, 'Context checkbox must remain checked');
	});

	// Test 50: User-saved settings are never altered or forced by any migration
	await test('0.6.6 Test 50: user-saved settings are never altered or forced by any migration', () => {
		const storage = createMockStorage();
		global.localStorage = storage;

		storage.setItem('cc_settings', JSON.stringify({
			preset: 'default',
			lowColor: '#10b981',
			midColor: '#f59e0b',
			highColor: '#ef4444',
			accentColor: '#3b82f6',
			opacity: 0.94,
			showSession: true,
			showWeekly: true,
			showContext: true,
			showCache: false,
			contextWindow: 200000
		}));

		const ui = new CounterUI();
		assert.strictEqual(ui.settings.showContext, true, 'Must preserve user saved showContext: true');
		assert.strictEqual(ui.settings.showCache, false, 'Must preserve user saved showCache: false');
	});

	// Test 51: No runtime path (countdown ticks, metrics, usage normalization, expanded toggle) changes flags
	await test('0.6.6 Test 51: no runtime path changes the visibility flags', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;

		const ui = new CounterUI();
		ui.initialize();

		assert.strictEqual(ui.settings.showContext, false);
		assert.strictEqual(ui.settings.showCache, false);

		// 1. Tick countdowns repeatedly
		for (let i = 0; i < 5; i++) {
			ui.renderSessionAndWeekly();
			ui.tick();
		}
		assert.strictEqual(ui.settings.showContext, false, 'Tick must not change showContext');
		assert.strictEqual(ui.settings.showCache, false, 'Tick must not change showCache');

		// 2. Normalize usage updates
		ui.setNormalizedUsage({
			state: 'ok',
			session: { pctUsed: 50, resetsAt: new Date(Date.now() + 3600000).toISOString() },
			weekly: { pctUsed: 25, resetsAt: new Date(Date.now() + 86400000).toISOString() }
		});
		assert.strictEqual(ui.settings.showContext, false, 'Usage update must not change showContext');
		assert.strictEqual(ui.settings.showCache, false, 'Usage update must not change showCache');

		// 3. Conversation metrics updates
		ui.setConversationMetrics({ totalTokens: 45000, isLoaded: true });
		assert.strictEqual(ui.settings.showContext, false, 'Conversation metrics must not change showContext');
		assert.strictEqual(ui.settings.showCache, false, 'Conversation metrics must not change showCache');

		// 4. Expand / collapse toggling
		ui._saveExpanded(!ui.isExpanded);
		assert.strictEqual(ui.settings.showContext, false, 'Expand toggle must not change showContext');
		assert.strictEqual(ui.settings.showCache, false, 'Expand toggle must not change showCache');

		// 5. Panel render state logging
		ui.logPanelRenderState();
		assert.strictEqual(ui.settings.showContext, false, 'logPanelRenderState must not change showContext');
		assert.strictEqual(ui.settings.showCache, false, 'logPanelRenderState must not change showCache');
	});

	// Test 52: panel_render_state logs only when its values change
	await test('0.6.6 Test 52: panel_render_state logs only on value change, eliminating ring buffer noise', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_settings', '{}');

		const logs = [];
		const ui = new CounterUI({
			onDebugLog: (cat, data) => logs.push({ cat, data })
		});
		ui.initialize();

		// Initial render calls logPanelRenderState
		ui.renderSessionAndWeekly();
		const initialCount = logs.filter(l => l.cat === 'panel_render_state').length;
		assert.strictEqual(initialCount, 1, 'Initial render must log panel_render_state once');

		// Repeated 1-second ticks with unchanged state
		for (let i = 0; i < 10; i++) {
			ui.renderSessionAndWeekly();
		}
		const repeatedCount = logs.filter(l => l.cat === 'panel_render_state').length;
		assert.strictEqual(repeatedCount, 1, 'Unchanged state across 10 ticks must NOT log duplicate panel_render_state');

		// Now change a setting: toggle showContext to true
		ui.settings.showContext = true;
		ui.renderSessionAndWeekly();
		const changedCount = logs.filter(l => l.cat === 'panel_render_state').length;
		assert.strictEqual(changedCount, 2, 'Value change must emit a new panel_render_state log');
		const latestLog = logs.filter(l => l.cat === 'panel_render_state')[1];
		assert.strictEqual(latestLog.data.showContext, true, 'New log must reflect updated showContext: true');

		// Subsequent ticks with the new state should again produce no noise
		for (let i = 0; i < 5; i++) {
			ui.renderSessionAndWeekly();
		}
		const finalCount = logs.filter(l => l.cat === 'panel_render_state').length;
		assert.strictEqual(finalCount, 2, 'Subsequent ticks must not produce noise');
	});

	// Test 53: Row visibility changes emit debug log with caller label
	await test('0.6.6 Test 53: row visibility changes emit debug log with caller label', () => {
		setupDOMForRealCounterUI();
		const storage = createMockStorage();
		global.localStorage = storage;

		const logs = [];
		const ui = new CounterUI({
			onDebugLog: (cat, data) => logs.push({ cat, data })
		});
		ui.initialize();

		// Toggle Context from false to true in drawer
		const chkCtx = ui.shadowRoot.getElementById('cc-chk-ctx');
		chkCtx.checked = true;
		chkCtx.dispatchEvent('change', { target: chkCtx });

		const rowLogs = logs.filter(l => l.cat === 'row_visibility_changed');
		assert.ok(rowLogs.length >= 1, 'Must emit row_visibility_changed debug log');
		const lastCtxLog = rowLogs.find(l => l.data.row === 'context' && l.data.visible === true);
		assert.ok(lastCtxLog, 'Must log context row visibility change');
		assert.strictEqual(lastCtxLog.data.caller, 'chk_ctx', 'Caller label must identify chk_ctx');

		// Reset defaults caller label
		ui.resetDefaults();
		const resetLogs = logs.filter(l => l.cat === 'row_visibility_changed' && l.data.caller === 'reset_defaults');
		assert.ok(resetLogs.length >= 2, 'resetDefaults must emit caller label reset_defaults for context and cache');
	});

	// =========================================================================
	// Version 0.6.6 Task B Tests: Request Diagnostics & Request Object Handling
	// =========================================================================

	// Test 54: wrapFetch emits request_seen with required fields for string, URL, and Request inputs
	await test('0.6.6 Test 54: wrapFetch emits request_seen for string, URL, and Request objects when cc_debug is active', async () => {
		const bridge = require('../src/injected/bridge.js');
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'true');

		const { fakeWindow, postedMessages } = setupBridgeTestEnvironment();
		fakeWindow.fetch = async (input, init) => {
			return {
				status: 200,
				headers: {
					get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null)
				}
			};
		};
		bridge.wrapFetch(fakeWindow);

		// 1. Fetch with string URL and query params
		await fakeWindow.fetch('https://claude.ai/api/organizations/11111111-1111-1111-1111-111111111111/chat_conversations/22222222-2222-2222-2222-222222222222?tree=true');
		const strLog = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'request_seen' && m.payload?.data?.inputType === 'string');
		assert.ok(strLog, 'Must emit request_seen for string input');
		assert.strictEqual(strLog.payload.data.method, 'GET');
		assert.strictEqual(strLog.payload.data.host, 'claude.ai');
		assert.strictEqual(strLog.payload.data.pathShape, '/api/organizations/:id/chat_conversations/:id');
		assert.strictEqual(strLog.payload.data.status, 200);
		assert.strictEqual(strLog.payload.data['content-type'], 'application/json');
		assert.strictEqual(strLog.payload.data.inputType, 'string');
		// Privacy check: no query params, bodies, or cookies in data
		assert.strictEqual(JSON.stringify(strLog.payload.data).includes('tree'), false, 'Query string must NOT leak');

		// 2. Fetch with URL object
		await fakeWindow.fetch(new URL('https://claude.ai/api/bootstrap'));
		const urlLog = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'request_seen' && m.payload?.data?.inputType === 'url');
		assert.ok(urlLog, 'Must emit request_seen for URL input');
		assert.strictEqual(urlLog.payload.data.pathShape, '/api/bootstrap');
		assert.strictEqual(urlLog.payload.data.inputType, 'url');

		// 3. Fetch with Request / duck-typed Request object
		const reqObj = {
			url: 'https://claude.ai/api/organizations/11111111-1111-1111-1111-111111111111/completion',
			method: 'POST'
		};
		await fakeWindow.fetch(reqObj);
		const reqLog = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'request_seen' && m.payload?.data?.inputType === 'request');
		assert.ok(reqLog, 'Must emit request_seen for Request input');
		assert.strictEqual(reqLog.payload.data.method, 'POST');
		assert.strictEqual(reqLog.payload.data.pathShape, '/api/organizations/:id/completion');
		assert.strictEqual(reqLog.payload.data.inputType, 'request');
	});

	// Test 55: wrapFetch emits request_seen with status: 0 when fetch throws network error
	await test('0.6.6 Test 55: wrapFetch emits request_seen with status 0 on network error', async () => {
		const bridge = require('../src/injected/bridge.js');
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'true');

		const { fakeWindow, postedMessages } = setupBridgeTestEnvironment();
		fakeWindow.fetch = async () => {
			throw new Error('Failed to fetch');
		};
		bridge.wrapFetch(fakeWindow);

		let threw = false;
		try {
			await fakeWindow.fetch('https://claude.ai/api/network_fail');
		} catch {
			threw = true;
		}
		assert.strictEqual(threw, true, 'Original page error must be preserved');

		const failLog = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'request_seen' && m.payload?.data?.pathShape === '/api/network_fail');
		assert.ok(failLog, 'Must emit request_seen even on network error');
		assert.strictEqual(failLog.payload.data.status, 0);
	});

	// Test 56: XMLHttpRequest emits request_seen on completion
	await test('0.6.6 Test 56: XMLHttpRequest emits request_seen on completion when cc_debug is active', () => {
		const bridge = require('../src/injected/bridge.js');
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'true');

		const { fakeWindow, postedMessages } = setupBridgeTestEnvironment();

		// Mock XMLHttpRequest with real load listeners
		class FakeXHR {
			constructor() {
				this._listeners = {};
				this.status = 200;
			}
			open(method, url) {
				this.method = method;
				this.url = url;
			}
			send() {
				setTimeout(() => {
					if (this._listeners['load']) this._listeners['load'].forEach(fn => fn());
					if (this._listeners['loadend']) this._listeners['loadend'].forEach(fn => fn());
				}, 5);
			}
			addEventListener(evt, fn) {
				if (!this._listeners[evt]) this._listeners[evt] = [];
				this._listeners[evt].push(fn);
			}
			getResponseHeader(header) {
				if (header.toLowerCase() === 'content-type') return 'application/json';
				return null;
			}
		}

		fakeWindow.XMLHttpRequest = FakeXHR;
		global.XMLHttpRequest = FakeXHR;

		// Use the REAL bridge wrapXHR function
		bridge.wrapXHR(fakeWindow);

		const xhr = new FakeXHR();
		xhr.open('POST', 'https://claude.ai/api/xhr/test');
		xhr.send();

		return new Promise((resolve) => {
			setTimeout(() => {
				const xhrLog = postedMessages.find(m => m.type === 'cc:diag' && m.payload?.category === 'request_seen' && m.payload?.data?.pathShape === '/api/xhr/test');
				assert.ok(xhrLog, 'XHR must emit request_seen');
				assert.strictEqual(xhrLog.payload.data.method, 'POST');
				assert.strictEqual(xhrLog.payload.data.status, 200);
				assert.strictEqual(xhrLog.payload.data.inputType, 'string');
				assert.strictEqual(xhrLog.payload.data['content-type'], 'application/json');
				resolve();
			}, 25);
		});
	});

	// Test 57: cc_debug off produces zero request_seen or diag messages
	await test('0.6.6 Test 57: cc_debug off produces zero request_seen messages', async () => {
		const bridge = require('../src/injected/bridge.js');
		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'false');

		const { fakeWindow, postedMessages } = setupBridgeTestEnvironment();
		fakeWindow.fetch = async () => ({ status: 200, headers: { get: () => 'application/json' } });
		bridge.wrapFetch(fakeWindow);

		await fakeWindow.fetch('https://claude.ai/api/test_quiet');
		const diagLogs = postedMessages.filter(m => m.type === 'cc:diag');
		assert.strictEqual(diagLogs.length, 0, 'No diag messages posted when cc_debug is false');
	});

	// Test 58: Ring buffer caps at 200 entries
	await test('0.6.6 Test 58: Ring buffer caps at 200 entries (CC.CONST.DEBUG_LOG_MAX_ENTRIES = 200)', () => {
		assert.strictEqual(global.ClaudeCounter.CONST.DEBUG_LOG_MAX_ENTRIES, 200, 'DEBUG_LOG_MAX_ENTRIES must be 200');

		const storage = createMockStorage();
		global.localStorage = storage;
		storage.setItem('cc_debug', 'true');

		const { main, bridgeListeners } = setupRealMainEnvironment();
		// Simulate 250 diag entries sent to content script
		for (let i = 0; i < 250; i++) {
			bridgeListeners['cc:diag']({
				category: 'request_seen',
				data: { method: 'GET', host: 'claude.ai', pathShape: `/api/req/${i}`, status: 200 }
			});
		}

		const exported = JSON.parse(globalThis.__CC_COPY_DEBUG_LOG());
		assert.strictEqual(exported.length, 200, 'Debug log buffer must be capped at 200 entries');
		// Oldest entries must have shifted off:
		const hasOld = exported.some(e => e.data?.pathShape === '/api/req/0');
		assert.strictEqual(hasOld, false, 'Oldest entries must have shifted off');
		const hasNew = exported.some(e => e.data?.pathShape === '/api/req/249');
		assert.strictEqual(hasNew, true, 'Newest entry must be present');
	});

	console.log(`\nTests finished: ${passCount} passed, ${failCount} failed.`);
	process.exit(failCount > 0 ? 1 : 0);
})();



