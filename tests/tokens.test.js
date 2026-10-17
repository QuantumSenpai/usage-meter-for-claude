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
	formatContextUtilization
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

		const formatZero = formatContextUtilization(zeroMetrics.totalTokens);
		assert.strictEqual(formatZero.formatted, '~0 est. / 200k');
		assert.strictEqual(formatZero.percentText, '0%');
		assert.strictEqual(formatZero.barPercent, 0);
		assert.strictEqual(formatZero.isOverLimit, false);
	});

	// Test 7: Over-limit formatting (real cases: ~218k and 231,255)
	await test('Over-limit: ~218k tokens produces ~218k est. / 200k, "long chat", isExceeded10Pct=false, and tooltip', () => {
		const chat218k = formatContextUtilization(218000);
		assert.strictEqual(chat218k.formatted, '~218k est. / 200k');
		assert.strictEqual(chat218k.percentText, 'long chat');
		assert.strictEqual(chat218k.barPercent, 100, 'Bar width must be capped at 100%');
		assert.strictEqual(chat218k.isOverLimit, true);
		assert.strictEqual(chat218k.isExceeded10Pct, false, '218k is within 10% of 200k (<= 220k)');
		assert.strictEqual(chat218k.tooltip, 'Estimated size; limit may differ by model. This is not your plan usage limit.');
	});

	await test('Over-limit: 231,255 tokens produces ~231k est. / 200k, "long chat", isExceeded10Pct=true, and tooltip', () => {
		const overLimit = formatContextUtilization(231255);

		assert.strictEqual(overLimit.formatted, '~231k est. / 200k');
		assert.strictEqual(overLimit.percentText, 'long chat');
		assert.strictEqual(overLimit.barPercent, 100, 'Bar width must be capped at 100%');
		assert.strictEqual(overLimit.isOverLimit, true);
		assert.strictEqual(overLimit.isExceeded10Pct, true, '231,255 exceeds 200k by >10% (> 220k)');
		assert.strictEqual(overLimit.tooltip, 'Estimated size; limit may differ by model. This is not your plan usage limit.');
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

	// Test 9: Context utilization percentage and bar widths for normal ranges
	await test('Utilization: calculates accurate percentages within normal range with estimate label', () => {
		const half = formatContextUtilization(100000);
		assert.strictEqual(half.formatted, '~100k est. / 200k');
		assert.strictEqual(half.percentText, '50.0%');
		assert.strictEqual(half.barPercent, 50);
		assert.strictEqual(half.isOverLimit, false);
		assert.strictEqual(half.isExceeded10Pct, false);

		const small = formatContextUtilization(2000);
		assert.strictEqual(small.formatted, '~2k est. / 200k');
		assert.strictEqual(small.percentText, '1.0%');
		assert.strictEqual(small.barPercent, 1);
		assert.strictEqual(small.isOverLimit, false);
		assert.strictEqual(small.isExceeded10Pct, false);
	});

	// Test 10: Custom context window override
	await test('Override: respects custom limit (e.g. 250,000)', () => {
		const overridden = formatContextUtilization(231255, 250000);
		assert.strictEqual(overridden.formatted, '~231k est. / 250k');
		assert.strictEqual(overridden.isOverLimit, false, '231,255 is under 250,000');
		assert.strictEqual(overridden.percentText, '92.5%');
		assert.strictEqual(Math.round(overridden.barPercent), 93);
	});

	// Test 11: CONTEXT_WINDOW_TOKENS named constant
	await test('Constant: CONTEXT_WINDOW_TOKENS is defined as 200,000 default', () => {
		assert.strictEqual(CONTEXT_WINDOW_TOKENS, 200000);
	});

	console.log(`\nTests finished: ${passCount} passed, ${failCount} failed.`);
	if (failCount > 0) process.exit(1);
})();
