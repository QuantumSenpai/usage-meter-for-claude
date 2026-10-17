const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
	isValidOrgId,
	normalizeUsagePayload,
	normalizeUtilization,
	normalizeResetsAt
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

console.log(`\nTests finished: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) process.exit(1);
