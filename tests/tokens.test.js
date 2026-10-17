const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Initialize tokenizer into globalThis
const tokenizer = require('../src/vendor/o200k_base.js');
globalThis.GPTTokenizer_o200k_base = tokenizer;

// 2. Load constants & tokens module
const { CONTEXT_WINDOW_TOKENS } = require('../src/content/constants.js');
const {
	ROOT_MESSAGE_ID,
	countTokens,
	buildTrunk,
	isCountableContentItem,
	stringifyCountableContentItem,
	stringifyMessageCountables,
	computeConversationMetrics,
	formatTokens,
	formatContextUtilization,
	resolveContextWindow,
	scanPayloadDebugKeys
} = require('../src/content/tokens.js');

function loadFixture(filename) {
	const p = path.join(__dirname, 'fixtures', filename);
	return JSON.parse(fs.readFileSync(p, 'utf8'));
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
	console.log('Running tokens.test.js...\n');

	// Test 1: Real-shape tree traversal & branch filtering
	await test('Tree: traverses leaf trunk only, ignores abandoned branch A', () => {
		const tree = loadFixture('conversation_tree.json');
		const trunk = buildTrunk(tree);

		// Trunk should follow: msg-1 -> msg-2 -> msg-3b -> msg-leaf-4b
		const trunkIds = trunk.map((m) => m.uuid);
		assert.deepStrictEqual(trunkIds, ['msg-1', 'msg-2', 'msg-3b', 'msg-leaf-4b']);
		assert.strictEqual(trunkIds.includes('msg-3a'), false, 'Branch A human message must be excluded');
		assert.strictEqual(trunkIds.includes('msg-4a'), false, 'Branch A assistant message must be excluded');
	});

	// Test 2: Root message ID stop condition
	await test('Tree: stops traversal at root message ID (00000000-0000-4000-8000-000000000000)', () => {
		const tree = loadFixture('conversation_tree.json');
		const trunk = buildTrunk(tree);

		assert.strictEqual(trunk[0].parent_message_uuid, ROOT_MESSAGE_ID);
		assert.strictEqual(trunk[0].uuid, 'msg-1');
	});

	// Test 3: Empty text + content[].text counting
	await test('Content: counts tokens from content[].text when message.text is empty ("")', () => {
		const tree = loadFixture('conversation_tree.json');
		const msg1 = tree.chat_messages.find((m) => m.uuid === 'msg-1');

		assert.strictEqual(msg1.text, '');
		assert.ok(Array.isArray(msg1.content) && msg1.content.length > 0);

		const textToCount = stringifyMessageCountables(msg1);
		assert.strictEqual(textToCount, 'Hello Claude, please summarize the quarterly report.');

		const tokens = countTokens(textToCount);
		assert.ok(tokens > 0, `Expected tokens > 0, got ${tokens}`);
		assert.strictEqual(tokens, tokenizer.countTokens(textToCount));
	});

	// Test 4: Attachments extracted_content counting
	await test('Content: counts tokens from attachments[].extracted_content', () => {
		const tree = loadFixture('conversation_tree.json');
		const msg3b = tree.chat_messages.find((m) => m.uuid === 'msg-3b');

		assert.ok(msg3b.attachments && msg3b.attachments.length > 0);
		const countables = stringifyMessageCountables(msg3b);

		assert.ok(countables.includes('REPORT_EXTRACTED_CONTENT: Revenue increased'));
		assert.ok(countables.includes('Here is the attached report data.'));

		const tokens = countTokens(countables);
		assert.ok(tokens > 15, `Expected tokens > 15, got ${tokens}`);
	});

	// Test 5: Full conversation metrics computation on real tree fixture
	await test('Metrics: computes conversation metrics with correct trunk count and assistant cache timestamp', async () => {
		const tree = loadFixture('conversation_tree.json');
		const metrics = await computeConversationMetrics(tree);

		assert.strictEqual(metrics.isLoaded, true);
		assert.strictEqual(metrics.trunkMessageCount, 4);
		assert.ok(metrics.totalTokens > 30, `Expected totalTokens > 30, got ${metrics.totalTokens}`);
		assert.ok(metrics.lastAssistantMs > 0);
		assert.strictEqual(metrics.lastAssistantMs, Date.parse('2026-10-17T12:03:30.000Z'));
		assert.strictEqual(metrics.cachedUntil, metrics.lastAssistantMs + 5 * 60 * 1000);
	});

	// Test 6: 0-before-data (loading) vs genuine real zero
	await test('Loading vs Zero: un-loaded or invalid data returns isLoaded=false and totalTokens=null', async () => {
		const nullMetrics = await computeConversationMetrics(null);
		assert.strictEqual(nullMetrics.isLoaded, false);
		assert.strictEqual(nullMetrics.totalTokens, null);

		const shallowObjMetrics = await computeConversationMetrics({ uuid: 'conv-123' });
		assert.strictEqual(shallowObjMetrics.isLoaded, false);
		assert.strictEqual(shallowObjMetrics.totalTokens, null);

		const formatLoading = formatContextUtilization(nullMetrics.totalTokens);
		assert.strictEqual(formatLoading.formatted, '— / 200k');
		assert.strictEqual(formatLoading.percentText, '—');
		assert.strictEqual(formatLoading.barPercent, 0);
		assert.strictEqual(formatLoading.isOverLimit, false);
	});

	await test('Loading vs Zero: genuinely empty conversation (chat_messages: []) returns isLoaded=true and totalTokens=0', async () => {
		const emptyTree = {
			uuid: 'conv-new',
			chat_messages: [],
			current_leaf_message_uuid: null
		};
		const zeroMetrics = await computeConversationMetrics(emptyTree);
		assert.strictEqual(zeroMetrics.isLoaded, true);
		assert.strictEqual(zeroMetrics.totalTokens, 0);
		assert.strictEqual(zeroMetrics.trunkMessageCount, 0);

		// Empty chat: 0% used · 100% left
		const formatZero = formatContextUtilization(zeroMetrics.totalTokens);
		assert.strictEqual(formatZero.formatted, '~0 est. / 200k');
		assert.strictEqual(formatZero.percentText, '0% used · 100% left');
		assert.strictEqual(formatZero.barPercent, 0);
		assert.strictEqual(formatZero.pctUsed, 0);
		assert.strictEqual(formatZero.pctLeft, 100);
		assert.strictEqual(formatZero.tier, 'low');
		assert.strictEqual(formatZero.isOverLimit, false);
	});

	// Test 7: 0%, 50%, 59/60 boundary, 89/90 boundary, 100%, 115% utilization and tier colors
	await test('Utilization: 0% shows "0% used · 100% left" and low tier', () => {
		const u0 = formatContextUtilization(0);
		assert.strictEqual(u0.percentText, '0% used · 100% left');
		assert.strictEqual(u0.barPercent, 0);
		assert.strictEqual(u0.pctUsed, 0);
		assert.strictEqual(u0.pctLeft, 100);
		assert.strictEqual(u0.tier, 'low');
		assert.strictEqual(u0.isOverLimit, false);
	});

	await test('Utilization: 50% (100,000 / 200,000) shows "50% used · 50% left" and low tier (<60)', () => {
		const u50 = formatContextUtilization(100000);
		assert.strictEqual(u50.formatted, '~100k est. / 200k');
		assert.strictEqual(u50.percentText, '50% used · 50% left');
		assert.strictEqual(u50.barPercent, 50);
		assert.strictEqual(u50.pctUsed, 50);
		assert.strictEqual(u50.pctLeft, 50);
		assert.strictEqual(u50.tier, 'low');
		assert.strictEqual(u50.isOverLimit, false);
	});

	await test('Utilization: 59/60 boundary (59% is low tier, 60% is mid tier)', () => {
		// 59% of 200,000 = 118,000
		const u59 = formatContextUtilization(118000);
		assert.strictEqual(u59.percentText, '59% used · 41% left');
		assert.strictEqual(u59.barPercent, 59);
		assert.strictEqual(u59.pctUsed, 59);
		assert.strictEqual(u59.pctLeft, 41);
		assert.strictEqual(u59.tier, 'low', '59% must be low tier (<60)');

		// 60% of 200,000 = 120,000
		const u60 = formatContextUtilization(120000);
		assert.strictEqual(u60.percentText, '60% used · 40% left');
		assert.strictEqual(u60.barPercent, 60);
		assert.strictEqual(u60.pctUsed, 60);
		assert.strictEqual(u60.pctLeft, 40);
		assert.strictEqual(u60.tier, 'mid', '60% must be mid tier (60 to <90)');
	});

	await test('Utilization: 89/90 boundary (89% is mid tier, 90% is high tier)', () => {
		// 89% of 200,000 = 178,000
		const u89 = formatContextUtilization(178000);
		assert.strictEqual(u89.percentText, '89% used · 11% left');
		assert.strictEqual(u89.barPercent, 89);
		assert.strictEqual(u89.pctUsed, 89);
		assert.strictEqual(u89.pctLeft, 11);
		assert.strictEqual(u89.tier, 'mid', '89% must be mid tier (60 to <90)');

		// 90% of 200,000 = 180,000
		const u90 = formatContextUtilization(180000);
		assert.strictEqual(u90.percentText, '90% used · 10% left');
		assert.strictEqual(u90.barPercent, 90);
		assert.strictEqual(u90.pctUsed, 90);
		assert.strictEqual(u90.pctLeft, 10);
		assert.strictEqual(u90.tier, 'high', '90% must be high tier (>=90)');
	});

	await test('Utilization: 100% (200,000 / 200,000) shows "100% used · 0% left" and high tier', () => {
		const u100 = formatContextUtilization(200000);
		assert.strictEqual(u100.formatted, '~200k est. / 200k');
		assert.strictEqual(u100.percentText, '100% used · 0% left');
		assert.strictEqual(u100.barPercent, 100);
		assert.strictEqual(u100.pctUsed, 100);
		assert.strictEqual(u100.pctLeft, 0);
		assert.strictEqual(u100.tier, 'high');
		assert.strictEqual(u100.isOverLimit, false);
	});

	await test('Utilization: 115% (230,000 / 200,000) shows "100%+ used · 0% left", bar capped at 100%, and high tier', () => {
		const u115 = formatContextUtilization(230000);
		assert.strictEqual(u115.formatted, '~230k est. / 200k');
		assert.strictEqual(u115.percentText, '100%+ used · 0% left');
		assert.strictEqual(u115.barPercent, 100, 'Bar percentage must be strictly capped at 100%');
		assert.strictEqual(u115.pctUsed, 115);
		assert.strictEqual(u115.pctLeft, 0);
		assert.strictEqual(u115.tier, 'high');
		assert.strictEqual(u115.isOverLimit, true);
		assert.strictEqual(u115.tooltip, 'Estimated size of this chat vs. context window. Not your plan usage limit. The window size may differ by model, adjust it in settings.');
	});

	// Test 8: Consistent compact (k) formatting across scales
	await test('Formatting: formats numbers compactly and consistently', () => {
		assert.strictEqual(formatTokens(0), '~0');
		assert.strictEqual(formatTokens(450), '~450');
		assert.strictEqual(formatTokens(999), '~999');
		assert.strictEqual(formatTokens(1000), '~1k');
		assert.strictEqual(formatTokens(14200), '~14k');
		assert.strictEqual(formatTokens(50450), '~50k');
		assert.strictEqual(formatTokens(200000), '~200k');
		assert.strictEqual(formatTokens(231255), '~231k');
		assert.strictEqual(formatTokens(null), '—');
		assert.strictEqual(formatTokens(undefined), '—');
		assert.strictEqual(formatTokens(NaN), '—');
	});

	// Test 9: Loading state formatting
	await test('Loading State: null or undefined returns "— / 200k" and "—"', () => {
		const loadingNull = formatContextUtilization(null);
		assert.strictEqual(loadingNull.formatted, '— / 200k');
		assert.strictEqual(loadingNull.percentText, '—');
		assert.strictEqual(loadingNull.barPercent, 0);
		assert.strictEqual(loadingNull.pctUsed, null);

		const loadingUndef = formatContextUtilization(undefined);
		assert.strictEqual(loadingUndef.formatted, '— / 200k');
		assert.strictEqual(loadingUndef.percentText, '—');
		assert.strictEqual(loadingUndef.barPercent, 0);
		assert.strictEqual(loadingUndef.pctUsed, null);
	});

	// Test 10: Custom context window override
	await test('Override: respects custom limit (e.g. 250,000)', () => {
		const overridden = formatContextUtilization(125000, 250000);
		assert.strictEqual(overridden.formatted, '~125k est. / 250k');
		assert.strictEqual(overridden.percentText, '50% used · 50% left');
		assert.strictEqual(overridden.pctUsed, 50);
		assert.strictEqual(overridden.tier, 'low');
		assert.strictEqual(overridden.isOverLimit, false);

		const overLimit = formatContextUtilization(275000, 250000);
		assert.strictEqual(overLimit.formatted, '~275k est. / 250k');
		assert.strictEqual(overLimit.percentText, '100%+ used · 0% left');
		assert.strictEqual(overLimit.pctUsed, 110);
		assert.strictEqual(overLimit.barPercent, 100);
		assert.strictEqual(overLimit.tier, 'high');
		assert.strictEqual(overLimit.isOverLimit, true);
	});

	// Test 11: CONTEXT_WINDOW_TOKENS named constant
	await test('Constant: CONTEXT_WINDOW_TOKENS is defined as 200,000 default', () => {
		assert.strictEqual(CONTEXT_WINDOW_TOKENS, 200000);
	});

	// Test 12: resolveContextWindow priority order
	await test('Context Window Resolution: priority order = user override > detected limit > default 200,000', () => {
		// 1. User override takes top priority
		assert.strictEqual(resolveContextWindow(300000, 150000, 200000), 300000);
		assert.strictEqual(resolveContextWindow(100000, null, 200000), 100000);

		// 2. Detected limit takes priority over default if override is absent/invalid
		assert.strictEqual(resolveContextWindow(null, 150000, 200000), 150000);
		assert.strictEqual(resolveContextWindow(undefined, 180000, 200000), 180000);
		assert.strictEqual(resolveContextWindow(0, 160000, 200000), 160000);
		assert.strictEqual(resolveContextWindow(NaN, 140000, 200000), 140000);

		// 3. Default (200000) when neither override nor detected limit is provided
		assert.strictEqual(resolveContextWindow(null, null, 200000), 200000);
		assert.strictEqual(resolveContextWindow(undefined, undefined, 200000), 200000);
		assert.strictEqual(resolveContextWindow(null, null), 200000);
	});

	// Test 13: scanPayloadDebugKeys returns key names only for payloads
	await test('Diagnostic Key Scan: returns key names only and matches numeric/short-model fields without leaking chat text', () => {
		const tree = loadFixture('conversation_tree.json');
		const scan = scanPayloadDebugKeys(tree);

		assert.ok(scan, 'Scan result should not be null');
		// topLevelKeys must be an array of key name strings only
		assert.deepStrictEqual(scan.topLevelKeys, [
			'uuid',
			'name',
			'created_at',
			'updated_at',
			'current_leaf_message_uuid',
			'chat_messages'
		]);

		// chatMessageKeys must be an array of key name strings only
		assert.deepStrictEqual(scan.chatMessageKeys, [
			'uuid',
			'parent_message_uuid',
			'sender',
			'created_at',
			'text',
			'content',
			'attachments'
		]);

		// Test with mock object containing model id, window number, and long chat text
		const mockPayload = {
			model: 'claude-3-7-sonnet',
			context_window_size: 200000,
			some_long_text: 'This is a long chat sentence that should not be extracted as a match',
			nested_limit: 50000,
			chat_messages: [
				{
					model_version: 'claude-3.5',
					text: 'Chat message content that must never be in matches',
					sender: 'human'
				}
			]
		};

		const mockScan = scanPayloadDebugKeys(mockPayload);
		assert.strictEqual(mockScan.matches['model'], 'claude-3-7-sonnet');
		assert.strictEqual(mockScan.matches['context_window_size'], 200000);
		assert.strictEqual(mockScan.matches['nested_limit'], 50000);
		assert.strictEqual(mockScan.matches['chat_messages[0].model_version'], 'claude-3.5');
		// Non-matching or text with spaces must never be in matches
		assert.strictEqual('some_long_text' in mockScan.matches, false);
		assert.strictEqual('chat_messages[0].text' in mockScan.matches, false);
	});

	console.log(`\nTests finished: ${passCount} passed, ${failCount} failed.`);
	if (failCount > 0) process.exit(1);
})();
