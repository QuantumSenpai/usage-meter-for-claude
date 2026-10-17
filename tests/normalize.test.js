const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
	isValidOrgId,
	normalizeUsagePayload,
	normalizeUtilization,
	normalizeResetsAt,
	isIsoDateString,
	redactMessageLimitShape,
	redactUsageResponseShape
} = require('../src/content/normalize.js');

function loadFixture(filename) {
	const p = path.join(__dirname, 'fixtures', filename);
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

let passCount = 0;
let failCount = 0;

function test(name, fn) {
	try {
		fn();
		console.log(`  ✓ PASS: ${name}`);
		passCount++;
	} catch (err) {
		console.error(`  ✗ FAIL: ${name}`);
		console.error(err);
		failCount++;
	}
}

console.log('Running normalize.test.js...\n');

// 1. UUID Validation Tests (Confirmed Fact 1)
test('Org ID: rejects "discoverable"', () => {
	assert.strictEqual(isValidOrgId('discoverable'), false);
	assert.strictEqual(isValidOrgId('DISCOVERABLE'), false);
});

test('Org ID: rejects invalid slugs and empty strings', () => {
	assert.strictEqual(isValidOrgId(''), false);
	assert.strictEqual(isValidOrgId('default'), false);
	assert.strictEqual(isValidOrgId('12345'), false);
	assert.strictEqual(isValidOrgId(null), false);
	assert.strictEqual(isValidOrgId(undefined), false);
});

test('Org ID: accepts valid UUID formats', () => {
	assert.strictEqual(isValidOrgId('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'), true);
	assert.strictEqual(isValidOrgId('12345678-1234-1234-1234-123456789abc'), true);
	assert.strictEqual(isValidOrgId('A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D'), true);
});

// 2. Free Plan Response (Confirmed Fact 2)
test('Free Plan: real all-null response produces state="empty" with no error', () => {
	const raw = loadFixture('free_plan.json');
	const res = normalizeUsagePayload(raw);

	assert.strictEqual(res.state, 'empty');
	assert.strictEqual(res.errorReason, null);
	assert.strictEqual(res.session.pct, null);
	assert.strictEqual(res.session.resetsAt, null);
	assert.strictEqual(res.weekly.pct, null);
	assert.strictEqual(res.weekly.resetsAt, null);
	assert.deepStrictEqual(res.extras, []);
});

// 3. Paid Plan Response (Confirmed Fact 5)
test('Paid Plan (Synthetic): parses five_hour and seven_day percentage windows', () => {
	const raw = loadFixture('paid_plan.synthetic.json');
	const res = normalizeUsagePayload(raw);

	assert.strictEqual(res.state, 'ok');
	assert.strictEqual(res.errorReason, null);
	assert.strictEqual(res.session.pct, 42.5);
	assert.strictEqual(res.session.resetsAt, '2026-10-17T17:00:00.000Z');
	assert.strictEqual(res.weekly.pct, 18.0);
	assert.strictEqual(res.weekly.resetsAt, '2026-10-24T12:00:00.000Z');
});

// 4. Fractional windows with alternative naming
test('Paid Plan Fractions (Synthetic): normalizes 0-1 fractions to 0-100 and unix timestamps', () => {
	const raw = loadFixture('paid_plan_fractions.synthetic.json');
	const res = normalizeUsagePayload(raw);

	assert.strictEqual(res.state, 'ok');
	assert.strictEqual(res.session.pct, 65.0);
	assert.strictEqual(res.weekly.pct, 22.0);
	assert.ok(res.session.resetsAt.startsWith('2024-10-17T'));
});

// 5. SSE Fallback when /usage is empty
test('SSE Fallback: fills empty plan windows when message_limit stream event provides data', () => {
	const freeRaw = loadFixture('free_plan.json');
	const sseRaw = loadFixture('sse_message_limit.synthetic.json');

	const res = normalizeUsagePayload(freeRaw, sseRaw);

	assert.strictEqual(res.state, 'ok');
	assert.strictEqual(res.session.pct, 35.0);
	assert.strictEqual(res.weekly.pct, 12.0);
	assert.ok(res.session.resetsAt);
});

// 6. Error Contexts (HTTP 429, 401, network)
test('Error Handling: HTTP 429 produces state="error" with rate limited message', () => {
	const res = normalizeUsagePayload(null, null, { status: 429 });
	assert.strictEqual(res.state, 'error');
	assert.ok(res.errorReason.includes('Rate limited'));
	assert.strictEqual(res.session.pct, null);
});

test('Error Handling: HTTP 401/403 produces state="error" with session expired', () => {
	const res = normalizeUsagePayload(null, null, { status: 401 });
	assert.strictEqual(res.state, 'error');
	assert.ok(res.errorReason.includes('Session expired'));
});

test('Error Handling: network failure produces state="error"', () => {
	const res = normalizeUsagePayload(null, null, { message: 'Network failed' });
	assert.strictEqual(res.state, 'error');
	assert.strictEqual(res.errorReason, 'Network failed');
});

// 7. Malformed Payloads
test('Malformed: null or non-object payload produces state="error"', () => {
	const res = normalizeUsagePayload(null);
	assert.strictEqual(res.state, 'error');
	assert.strictEqual(res.errorReason, 'Malformed usage response');
});

test('Empty object payload produces state="empty"', () => {
	const res = normalizeUsagePayload({});
	assert.strictEqual(res.state, 'empty');
	assert.strictEqual(res.errorReason, null);
	assert.strictEqual(res.session.pct, null);
});

// 8. Diagnostic Shape Redaction Tests (v0.5.8)
test('Diagnostics: redactMessageLimitShape preserves numbers, booleans, null, ISO dates, and short snake/lower strings', () => {
	const payload = {
		type: 'message_limit',
		message_limit: {
			tier: 'active_plan',
			resets_at: '2026-10-17T20:00:00Z',
			is_active: true,
			null_field: null,
			windows: {
				'5h': {
					utilization: 0.9,
					resets_at: 1729184400
				}
			}
		}
	};

	const redacted = redactMessageLimitShape(payload);
	assert.strictEqual(redacted.type, 'message_limit');
	assert.strictEqual(redacted.message_limit.tier, 'active_plan');
	assert.strictEqual(redacted.message_limit.resets_at, '2026-10-17T20:00:00Z');
	assert.strictEqual(redacted.message_limit.is_active, true);
	assert.strictEqual(redacted.message_limit.null_field, null);
	assert.strictEqual(redacted.message_limit.windows['5h'].utilization, 0.9);
	assert.strictEqual(redacted.message_limit.windows['5h'].resets_at, 1729184400);
});

test('Diagnostics: redactMessageLimitShape NEVER emits raw string values for chat or user text', () => {
	const sensitiveText = "You've used 90% of your session limit";
	const userPrompt = 'Please summarize our confidential meeting notes.';
	const payload = {
		type: 'message_limit',
		message_limit: {
			warning_banner: sensitiveText,
			conversation: {
				user_message: userPrompt
			}
		}
	};

	const redacted = redactMessageLimitShape(payload);
	const serialized = JSON.stringify(redacted);

	// Ensure the raw sensitive strings are NEVER in the output
	assert.strictEqual(serialized.includes(sensitiveText), false, 'Raw sensitive string must NOT be emitted');
	assert.strictEqual(serialized.includes(userPrompt), false, 'Raw chat prompt must NOT be emitted');

	// Verify exact redaction tokens
	assert.strictEqual(redacted.message_limit.warning_banner, `[STR_${sensitiveText.length}_CHARS]`);
	assert.strictEqual(redacted.message_limit.conversation.user_message, `[STR_${userPrompt.length}_CHARS]`);
});

test('Diagnostics: redactMessageLimitShape enforces depth limit <= 4', () => {
	const deepPayload = {
		l1: {
			l2: {
				l3: {
					l4: {
						l5_should_be_capped: {
							secret: 'secret'
						}
					}
				}
			}
		}
	};

	const redacted = redactMessageLimitShape(deepPayload);
	assert.strictEqual(typeof redacted.l1.l2.l3, 'object');
	assert.strictEqual(redacted.l1.l2.l3.l4, '[OBJECT_1_KEYS]');
});

test('Diagnostics: redactUsageResponseShape logs top-level and one-level-deep key names and types without leaking string contents', () => {
	const sensitiveUsage = {
		five_hour: {
			utilization: 0.75,
			resets_at: 1729184400,
			description: 'Five hour floating usage window for user@example.com'
		},
		seven_day: {
			utilization: 0.1,
			resets_at: '2026-10-24T00:00:00Z'
		},
		extra_blob: 'encrypted_secret_token_12345',
		tangelo: null,
		iguana_necktie: null
	};

	const shape = redactUsageResponseShape(sensitiveUsage);
	const serialized = JSON.stringify(shape);

	// Strings must NOT be in the shape
	assert.strictEqual(serialized.includes('Five hour floating usage window'), false);
	assert.strictEqual(serialized.includes('user@example.com'), false);
	assert.strictEqual(serialized.includes('encrypted_secret_token_12345'), false);

	// Types and numeric values must match
	assert.strictEqual(shape.five_hour.type, 'object');
	assert.deepStrictEqual(shape.five_hour.children.utilization, { type: 'number', value: 0.75 });
	assert.deepStrictEqual(shape.five_hour.children.resets_at, { type: 'number', value: 1729184400 });
	assert.deepStrictEqual(shape.five_hour.children.description, { type: 'string' });
	assert.deepStrictEqual(shape.extra_blob, { type: 'string' });
	assert.deepStrictEqual(shape.tangelo, { type: 'null' });
	assert.deepStrictEqual(shape.iguana_necktie, { type: 'null' });
});

console.log(`\nTests finished: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) process.exit(1);
