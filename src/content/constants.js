(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	/**
	 * Centralized DOM Selectors Configuration
	 *
	 * Selectors avoid ephemeral or hashed class names (e.g. Tailwind dynamic hashes).
	 * We prioritize:
	 * 1. data-testid attributes
	 * 2. Standard HTML5 elements & ARIA roles
	 * 3. Semantic structural containers
	 * 4. Fallback floating container if no inline mount matches within ~3s
	 */
	CC.SELECTORS = Object.freeze({
		// In-page anchor search order for usage bars (near chat input)
		INPUT_ANCHORS: [
			// Primary 1: Standard model selector dropdown trigger
			{ name: 'model-selector-dropdown', selector: '[data-testid="model-selector-dropdown"]' },
			// Primary 2: Alternative model selector button variants by aria
			{ name: 'model-selector-aria', selector: 'button[aria-haspopup="menu"][data-testid*="model"], button[aria-label*="model" i]' },
			// Fallback 1: Chat input controls container (toolbar row)
			{ name: 'chat-input-controls', selector: '[data-testid="chat-input-controls"], [data-testid="chat-controls"]' },
			// Fallback 2: The chat input form / fieldset container
			{ name: 'chat-input-form', selector: 'fieldset:has([contenteditable="true"]), form:has([contenteditable="true"])' },
			// Fallback 3: Contenteditable wrapper
			{ name: 'contenteditable-wrapper', selector: '[contenteditable="true"]' }
		],

		// Top header anchor search order for context tokens + cache pill
		HEADER_ANCHORS: [
			// Primary 1: Chat menu dropdown in top bar
			{ name: 'chat-menu-trigger', selector: '[data-testid="chat-menu-trigger"]' },
			// Primary 2: Chat title or project selector in header
			{ name: 'chat-title', selector: '[data-testid="chat-title"], header [aria-haspopup="menu"]' },
			// Fallback 1: Any top header / banner element
			{ name: 'header-banner', selector: 'header, [role="banner"]' }
		],

		// Chat input and composer card selectors (Real evidence)
		CHAT_INPUT: '[data-testid="chat-input"]',
		COMPOSER_CARD_CLASS: 'bg-surface-3',

		// Branch navigation buttons (Previous / Next response)
		BRANCH_BUTTONS: 'button[aria-label="Previous"], button[aria-label="Next"], button[aria-label*="previous response" i], button[aria-label*="next response" i]'
	});

	CC.DOM = Object.freeze({
		BRIDGE_SCRIPT_ID: 'cc-bridge-script',
		METER_ROOT_ID: 'cc-usage-meter-root'
	});

	/**
	 * Context window token limit.
	 * Default: 200,000 tokens (estimated via o200k_base tokenizer).
	 */
	const CONTEXT_WINDOW_TOKENS = 200000; // unverified, needs real evidence

	CC.CONTEXT_WINDOW_TOKENS = CONTEXT_WINDOW_TOKENS;

	CC.CONST = Object.freeze({
		CACHE_WINDOW_MS: 5 * 60 * 1000,
		CONTEXT_WINDOW_TOKENS,
		CONTEXT_LIMIT_TOKENS: CONTEXT_WINDOW_TOKENS, // backwards-compatible alias
		SLOW_USAGE_REFRESH_INTERVAL_MS: 5 * 60 * 1000,
		DEBUG_LOG_MAX_ENTRIES: 200,
		DEBUG_STORAGE_KEY: 'cc_debug'
	});

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = {
			SELECTORS: CC.SELECTORS,
			DOM: CC.DOM,
			CONST: CC.CONST,
			CONTEXT_WINDOW_TOKENS
		};
	}
})();
