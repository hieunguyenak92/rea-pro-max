import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectPlaywrightEvidence, PLAYWRIGHT_EVIDENCE_LIMITS } from '../skills/rea-pro-max/lib/analysis/playwright-evidence.mjs';
import { digest, hashBytes } from '../skills/rea-pro-max/lib/common.mjs';

const marker = 'sensitive-token-314159';
const header = { type: 'context-options', version: 10, origin: 'library', browserName: 'chromium', monotonicTime: 1000.125, wallTime: 27, title: marker, options: { baseURL: 'https://private.invalid' } };
const before = (id, startTime, method = 'click') => ({ type: 'before', callId: id, startTime, class: 'Frame', method, params: { selector: marker }, title: marker });
const after = (id, endTime) => ({ type: 'after', callId: id, endTime, result: { text: marker } });
const page = (method, time, id) => ({ type: 'event', class: 'BrowserContext', method, time, params: { pageId: id, openerPageId: marker } });
const lineStream = (...rows) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
const resources = (type, status, method = 'GET', failed = false) => ({
  type: 'resource-snapshot',
  snapshot: {
    _resourceType: type, request: { method, url: 'https://private.invalid?q=' + marker, headers: [{ name: 'Cookie', value: marker }], postData: marker },
    response: { status, headers: [{ name: 'Set-Cookie', value: marker }], content: { text: marker }, ...(failed ? { _failureText: marker } : {}) },
  },
});
const actions = result => result.timeline.filter(row => row.type === 'action');

test('imports Playwright v10 action boundaries and page evidence without copying recorded text', () => {
  const parentId = 'call@group-' + marker;
  const childId = 'call@22-' + marker;
  const pageId = 'page@' + marker;
  const trace = lineStream(
    header,
    page('page', 1001.125, pageId),
    { ...before(parentId, 1002.125, 'tracingGroup'), class: 'Tracing' },
    { ...before(childId, 1004.250), parentId },
    { type: 'frame-snapshot', snapshot: { callId: childId, pageId, html: ['DIV', {}, marker], frameUrl: 'https://private.invalid', timestamp: 1005 } },
    { type: 'log', callId: childId, message: marker },
    after(childId, 1006.875),
    after(parentId, 1007.125),
    { type: 'event', class: 'BrowserContext', method: 'pageError', time: 1008.125, pageId, params: { error: { message: marker } } },
    page('pageClosed', 1009.125, pageId),
  );
  const result = inspectPlaywrightEvidence(trace);
  assert.equal(result.status, 'complete');
  assert.equal(result.authority, 'reported');
  assert.deepEqual(result.sources.trace, { bytes: trace.length, sha256: hashBytes(trace) });
  assert.deepEqual(result.context, { trace_version: 10, origin: 'library', browser: 'chromium', source_line: 1 });
  assert.equal(result.network.coverage.status, 'missing');
  assert.deepEqual(result.coverage.actions, { total: 2, completed: 2, failed: 0, incomplete: 0, invalid: 0, omitted: 0 });
  assert.deepEqual(result.coverage.pages, { total_events: 3, error_events: 1, retained_events: 3, omitted_events: 0 });
  assert.deepEqual(result.timeline.map(row => row.type === 'page' ? row.event : row.api), ['open', 'tracingGroup', 'click', 'error', 'close']);
  assert.deepEqual(actions(result)[1], {
    type: 'action', action_id: 2, category: 'interaction', api: 'click', status: 'completed',
    start_ms: 4.125, duration_ms: 2.625, error_kind: null, page_id: 1, parent_action_id: 1,
    source: { start_line: 4, end_line: 7, page_link_line: 5 },
  });
  const { receipt_sha256, ...envelope } = result;
  assert.equal(receipt_sha256, digest(envelope));
  assert.deepEqual(inspectPlaywrightEvidence(trace), result);
  assert.doesNotMatch(JSON.stringify(result), /sensitive-token|private\.invalid|call@|page@/u);
});

test('separates action failures, unknown labels and trace-level error records', () => {
  const result = inspectPlaywrightEvidence(lineStream(
    { ...header, origin: 'testRunner', browserName: '' },
    { ...before('custom', 1005, marker), class: marker },
    { ...after('custom', 1010), error: { name: marker, message: marker, stack: marker } },
    { ...before('assertion', 1020, 'expect'), ...after('assertion', 1028), type: 'action', class: 'Test', error: { name: 'AssertionError', message: marker } },
    { type: 'error', message: marker, stack: [{ file: marker }] },
  ));
  assert.equal(result.status, 'complete');
  assert.equal(result.coverage.trace.trace_errors, 1);
  assert.deepEqual(actions(result).map(row => [row.category, row.api, row.error_kind, row.status]), [
    ['other', null, 'other', 'failed'], ['verification', 'expect', 'AssertionError', 'failed'],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /sensitive-token/u);
});

test('missing ends, orphan and duplicate rows, malformed clocks and ambiguous page link remain explicit', () => {
  const result = inspectPlaywrightEvidence(lineStream(
    header,
    after('orphan', 1008),
    before('open', 1009),
    before('duplicate', 1010),
    before('duplicate', 1011),
    after('duplicate', 1012),
    before('clock', 1015),
    after('clock', 1014),
    before('ambiguous', 1020),
    { type: 'screenshot', callId: 'ambiguous', pageId: 'one', file: marker },
    { type: 'aria-snapshot', callId: 'ambiguous', pageId: 'two', file: marker },
    after('ambiguous', 1021),
  ));
  assert.equal(result.status, 'partial');
  assert.deepEqual(actions(result).map(row => row.status), ['incomplete', 'invalid', 'invalid', 'completed']);
  assert.deepEqual(result.issues.map(row => row.code).sort(), [
    'action_end_missing', 'ambiguous_action_page', 'duplicate_action_start', 'invalid_action_clock', 'orphan_action_end',
  ]);
  assert.equal(actions(result).at(-1).page_id, null);
  assert.equal(actions(result).at(-1).source.page_link_line, null);
  assert.doesNotMatch(JSON.stringify(result), /sensitive-token/u);
});

test('only the supplied network companion contributes fixed resource categories and HTTP classes', () => {
  const trace = lineStream(header, resources('document', 200), page('page', 1001, 'example'));
  const network = lineStream(resources('document', 200), resources('fetch', 404, 'POST'), resources(marker, -1, marker, true), resources('websocket', 101), resources(undefined, -1));
  const result = inspectPlaywrightEvidence(trace, network);
  assert.equal(result.status, 'complete');
  assert.equal(result.coverage.embedded_resource_rows, 1);
  assert.equal(result.network.coverage.resources, 5);
  assert.equal(result.network.coverage.status, 'complete');
  assert.deepEqual(result.sources.network, { bytes: network.length, sha256: hashBytes(network) });
  assert.deepEqual(result.network.by_resource_type, { document: 1, fetch: 1, unknown: 2, websocket: 1 });
  assert.deepEqual(result.network.by_status_class, { '2xx': 1, '4xx': 1, 'transport-error': 1, '1xx': 1, unknown: 1 });
  assert.deepEqual(result.network.by_method, { GET: 3, POST: 1, other: 1 });
  assert.doesNotMatch(JSON.stringify(result), /sensitive-token|private\.invalid/u);
  assert.equal(inspectPlaywrightEvidence(trace, Buffer.alloc(0)).network.coverage.status, 'empty');
});

test('unsupported schema and multiple context headers withhold derived timeline rows', () => {
  const network = lineStream(resources('fetch', 201));
  const old = inspectPlaywrightEvidence(lineStream({ ...header, version: 9 }, before('one', 1001), after('one', 1003)), network);
  assert.equal(old.status, 'unsupported');
  assert.equal(old.context.trace_version, 9);
  assert.deepEqual(old.timeline, []);
  assert.equal(old.network.coverage.status, 'unsupported');
  const multiple = inspectPlaywrightEvidence(lineStream(header, before('one', 1001), after('one', 1003), { ...header, monotonicTime: 1900 }), network);
  assert.equal(multiple.status, 'unsupported');
  assert.deepEqual(multiple.timeline, []);
  assert.equal(multiple.coverage.actions.total, 0);
  assert.equal(multiple.issues.find(row => row.code === 'multiple_context_headers')?.first_line, 4);
  const missing = inspectPlaywrightEvidence(lineStream(before('one', 1001)));
  assert.equal(missing.status, 'unsupported');
  assert.equal(missing.issues[0].code, 'context_header_required');
});

test('damaged NDJSON and output budgets preserve partial stream coverage', () => {
  const trace = Buffer.concat([
    lineStream(header, before('one', 1001), after('one', 1002)),
    Buffer.from([0xff, 0x0a]), Buffer.from('{\n'),
    Buffer.alloc(PLAYWRIGHT_EVIDENCE_LIMITS.max_line_bytes + 1, 0x20), Buffer.from('\n'),
    Buffer.alloc(PLAYWRIGHT_EVIDENCE_LIMITS.max_lines_per_stream, 0x0a),
  ]);
  const result = inspectPlaywrightEvidence(trace, lineStream({ type: 'resource-snapshot', snapshot: {} }, { type: 'unexpected-secret' }));
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.trace.truncated, true);
  assert.equal(result.coverage.trace.unreadable_rows, 3);
  assert.equal(result.coverage.trace.lines, PLAYWRIGHT_EVIDENCE_LIMITS.max_lines_per_stream);
  assert.equal(result.network.coverage.status, 'partial');
  assert.deepEqual(result.issues.map(row => row.code), [
    'invalid_utf8', 'invalid_json_row', 'row_too_large', 'line_limit', 'invalid_resource_snapshot', 'unsupported_network_event',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /unexpected-secret/u);
  assert.throws(() => inspectPlaywrightEvidence(Buffer.alloc(PLAYWRIGHT_EVIDENCE_LIMITS.max_stream_bytes + 1)), { code: 'playwright_evidence_bounds' });
  assert.throws(() => inspectPlaywrightEvidence('content'), { code: 'playwright_evidence_input' });
});

test('action retention cap leaves the summary count intact and marks partial', () => {
  const rows = [header];
  for (let index = 0; index <= PLAYWRIGHT_EVIDENCE_LIMITS.max_action_rows; index++) {
    rows.push({ ...before('call@' + index, 1001 + index), ...after('call@' + index, 1002 + index), type: 'action' });
  }
  const result = inspectPlaywrightEvidence(lineStream(...rows));
  const limit = PLAYWRIGHT_EVIDENCE_LIMITS.max_action_rows;
  assert.equal(result.status, 'partial');
  assert.equal(result.timeline.length, limit);
  assert.deepEqual(result.coverage.actions, { total: limit + 1, completed: limit + 1, failed: 0, incomplete: 0, invalid: 0, omitted: 1 });
  assert.deepEqual(result.issues.find(row => row.code === 'action_row_limit'), { source: 'trace', code: 'action_row_limit', count: 1, first_line: limit + 2 });
});
