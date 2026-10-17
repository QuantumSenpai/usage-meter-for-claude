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

	// Test 7: Over-limit color rules (orange "long chat" for <= 10% excess, red warning only for >10% excess)
	await test('Over-limit: 218,000 / 200,000 shows orange midColor (#f59e0b), "long chat", and tooltip', () => {
		const util = formatContextUtilization(218000, 200000);
		assert.strictEqual(util.isOverLimit, true);
		assert.strictEqual(util.isExceeded10Pct, false);
		assert.strictEqual(util.percentText, 'long chat');
		assert.strictEqual(util.barPercent, 100, 'Bar percentage must be strictly capped at 100%');
		assert.strictEqual(util.formatted, '~218k est. / 200k');

		const ui = new CounterUI();
		ui.dom = {
			ctxMain: { textContent: '' },
			ctxPct: { textContent: '', title: '' },
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

		ui.setConversationMetrics({ totalTokens: 218000, isLoaded: true });

		assert.strictEqual(ui.metrics.context.pct, 100);
		assert.strictEqual(ui.dom.ctxBar.style.width, '100%');
		assert.strictEqual(ui.panel.classList.contains('cc-over-limit'), true, 'Panel must have cc-over-limit class');
		assert.strictEqual(ui.panel.classList.contains('cc-over-limit-10pct'), false, 'Panel must NOT have cc-over-limit-10pct class');
		assert.strictEqual(ui.dom.ctxBar.style.backgroundColor, '#f59e0b', 'Over-limit <=10% bar must use orange midColor (#f59e0b)');
		assert.strictEqual(ui.dom.ctxPct.textContent, 'long chat');
		assert.strictEqual(ui.dom.ctxPct.title, 'Estimated size; limit may differ by model. This is not your plan usage limit.');
	});

	await test('Over-limit: 231,255 / 200,000 exceeds by >10% and uses red warning color (#ef4444)', () => {
		const util = formatContextUtilization(231255, 200000);
		assert.strictEqual(util.isOverLimit, true);
		assert.strictEqual(util.isExceeded10Pct, true);
		assert.strictEqual(util.percentText, 'long chat');
		assert.strictEqual(util.barPercent, 100, 'Bar percentage must be strictly capped at 100%');
		assert.strictEqual(util.formatted, '~231k est. / 200k');

		const ui = new CounterUI();
		ui.dom = {
			ctxMain: { textContent: '' },
			ctxPct: { textContent: '', title: '' },
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
		assert.strictEqual(ui.panel.classList.contains('cc-over-limit-10pct'), true, 'Panel must have cc-over-limit-10pct class');
		assert.strictEqual(ui.dom.ctxBar.style.backgroundColor, '#ef4444', 'Over-limit >10% bar must use red warning color (#ef4444)');
	});

	// Test 8: User override for context window limit
	await test('Override: setting custom context window adjusts threshold and colors', () => {
		const ui = new CounterUI();
		ui.dom = {
			ctxMain: { textContent: '' },
			ctxPct: { textContent: '', title: '' },
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

		// Override to 250,000 tokens
		ui.settings.contextWindow = 250000;
		ui.setConversationMetrics({ totalTokens: 231255, isLoaded: true });

		assert.strictEqual(ui.panel.classList.contains('cc-over-limit'), false, '231,255 is under 250k override');
		assert.strictEqual(ui.dom.ctxMain.textContent, '~231k est. / 250k');
		assert.strictEqual(ui.dom.ctxPct.textContent, '92.5%');

		// Override to 220,000 tokens: 231,255 is over 220,000 but <= 242,000 (within 10%)
		ui.settings.contextWindow = 220000;
		ui.setConversationMetrics({ totalTokens: 231255, isLoaded: true });

		assert.strictEqual(ui.panel.classList.contains('cc-over-limit'), true);
		assert.strictEqual(ui.panel.classList.contains('cc-over-limit-10pct'), false, 'Within 10% of override');
		assert.strictEqual(ui.dom.ctxBar.style.backgroundColor, '#f59e0b', 'Must be orange for <=10% excess of override');
	});

	// Test 9: Normal token usage does not trigger over-limit warning color
	await test('Normal: 50,000 / 200,000 utilization formats 25% and does not trigger over-limit class', () => {
		const util = formatContextUtilization(50000, 200000);
		assert.strictEqual(util.isOverLimit, false);
		assert.strictEqual(util.percentText, '25.0%');
		assert.strictEqual(util.barPercent, 25);
		assert.strictEqual(util.formatted, '~50k est. / 200k');

		const ui = new CounterUI();
		ui.dom = {
			ctxMain: { textContent: '' },
			ctxPct: { textContent: '', title: '' },
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
	});

	// Test 9: Cache timer shows "—" when no cache is active
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

	// Test 11: Context label tooltip and Settings Drawer override input in source & settings defaults
	await test('UI: Context label has tooltip, drawer has number input, and settings default to 200,000', () => {
		const uiSrc = fs.readFileSync(path.join(__dirname, '../src/content/ui.js'), 'utf8');

		// Tooltip on Context label
		assert.ok(
			uiSrc.includes('title="Size of this chat vs. context window. Not your usage limit.">Context</span>'),
			'Context label must have specified tooltip'
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

	console.log(`\nTests finished: ${passCount} passed, ${failCount} failed.`);
	if (failCount > 0) process.exit(1);
})();
