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
		removeItem: (k) => { delete store[k]; }
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

	// Test 24: Migration - migrates existing saved settings to hide Context & Cache by default while preserving custom colors/theme
	await test('Migration: hides Context and Cache for existing saved settings while preserving theme and colors', () => {
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

		// Load CounterUI in v0.6.0
		const ui = new CounterUI();

		// Asserts
		assert.strictEqual(ui.settings.preset, 'sunset', 'Must preserve user preset');
		assert.strictEqual(ui.settings.lowColor, '#123456', 'Must preserve custom lowColor');
		assert.strictEqual(ui.settings.opacity, 0.85, 'Must preserve opacity');
		assert.strictEqual(ui.settings.showSession, true, 'Must preserve showSession');
		assert.strictEqual(ui.settings.showWeekly, true, 'Must preserve showWeekly');

		assert.strictEqual(ui.settings.v060_migrated, true, 'Must set v060_migrated=true');
		assert.strictEqual(ui.settings.showContext, false, 'Must migrate showContext to false');
		assert.strictEqual(ui.settings.showCache, false, 'Must migrate showCache to false');

		// Check persisted in storage
		const saved = JSON.parse(storage.getItem('cc_settings'));
		assert.strictEqual(saved.v060_migrated, true);
		assert.strictEqual(saved.showContext, false);
		assert.strictEqual(saved.showCache, false);
		assert.strictEqual(saved.lowColor, '#123456');
	});

	// Test 25: No conversation fetch is issued while Context and Cache are hidden; resumes when enabled
	await test('No conversation fetch is issued while Context and Cache are hidden; resumes when turned back on', async () => {
		const { main } = setupRealMainEnvironment();
		const { _internal } = main;
		const ui = _internal.getUi();

		// Default in v0.6.0: Context & Cache are hidden
		assert.strictEqual(ui.settings.showContext, false);
		assert.strictEqual(ui.settings.showCache, false);
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

	console.log(`\nTests finished: ${passCount} passed, ${failCount} failed.`);
	process.exit(failCount > 0 ? 1 : 0);
})();
