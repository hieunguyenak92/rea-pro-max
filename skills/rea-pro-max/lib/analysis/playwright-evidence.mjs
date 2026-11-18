import { digest, hashBytes, RpmError } from '../common.mjs';

export const PLAYWRIGHT_EVIDENCE_LIMITS = Object.freeze({
  max_stream_bytes: 8 * 1024 * 1024,
  max_line_bytes: 512 * 1024,
  max_lines_per_stream: 32_768,
  max_action_rows: 4096,
  max_page_rows: 2048,
});

const version = 10;
const MAX_CLOCK_MS = 1e12;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const contextTypes = new Set(['library', 'testRunner']);
const browsers = new Set(['chromium', 'firefox', 'webkit', 'bidiChromium', 'bidiFirefox']);
const pageApis = new Map([
  ['navigation', ['goto', 'reload', 'goBack', 'goForward', 'setContent']],
  ['interaction', ['click', 'dblclick', 'tap', 'fill', 'clear', 'press', 'type', 'pressSequentially', 'check', 'uncheck', 'setChecked', 'selectOption', 'setInputFiles', 'hover', 'dragAndDrop', 'scrollIntoViewIfNeeded', 'focus', 'blur', 'dispatchEvent']],
  ['read', ['textContent', 'innerText', 'innerHTML', 'getAttribute', 'inputValue', 'count', 'title', 'content', 'isVisible', 'isEnabled', 'isChecked', 'isHidden', 'evaluate', 'evaluateExpression']],
  ['wait', ['waitForSelector', 'waitForTimeout', 'waitForFunction', 'waitForLoadState', 'waitForNavigation', 'waitForURL', 'waitForEvent', 'waitForRequest', 'waitForResponse', 'waitForElementState']],
  ['verification', ['expect']],
]);
const categories = new Map([...pageApis].flatMap(([category, names]) => names.map(name => [name, category])));
const pageClasses = new Set(['Page', 'Frame', 'Locator', 'ElementHandle']);
const testStepMethods = new Set(['fixture', 'hook', 'pw:api', 'test.step', 'test.attach']);
const pageMethods = new Map([['page', 'open'], ['pageClosed', 'close'], ['pageError', 'error']]);
const errorNames = new Set(['AssertionError', 'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TimeoutError', 'TargetClosedError', 'AbortError']);
const auxiliaryTypes = new Set(['log', 'input', 'console', 'screencast-frame', 'video', 'stdout', 'stderr', 'resource-snapshot']);
const resourceTypes = new Set(['document', 'stylesheet', 'image', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'preflight', 'ping', 'other']);
const requestMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE', 'QUERY']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const clock = value => Number.isFinite(value) && value >= 0 && value < MAX_CLOCK_MS;
const round = value => Number(value.toFixed(3));

function source(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new RpmError('playwright_evidence_input', 'Playwright evidence requires admitted NDJSON bytes.');
  if (bytes.length > PLAYWRIGHT_EVIDENCE_LIMITS.max_stream_bytes) throw new RpmError('playwright_evidence_bounds', 'A Playwright evidence stream exceeds the 8 MiB input bound.');
  return { sha256: hashBytes(bytes), bytes: bytes.length };
}

function issueLedger() {
  const entries = new Map();
  return {
    add(source, code, line = null) {
      const key = `${source}:${code}`;
      const existing = entries.get(key);
      if (existing) existing.count++;
      else entries.set(key, { source, code, count: 1, first_line: line });
    },
    has(source) { return [...entries.values()].some(entry => entry.source === source); },
    rows() { return [...entries.values()]; },
  };
}

function scan(bytes, sourceName, issues, visit) {
  const coverage = { lines: 0, event_rows: 0, unreadable_rows: 0, truncated: false };
  let cursor = 0;
  while (cursor < bytes.length) {
    if (coverage.lines === PLAYWRIGHT_EVIDENCE_LIMITS.max_lines_per_stream) {
      coverage.truncated = true;
      issues.add(sourceName, 'line_limit', coverage.lines + 1);
      break;
    }
    const newline = bytes.indexOf(0x0a, cursor);
    const end = newline === -1 ? bytes.length : newline;
    const line = ++coverage.lines;
    const raw = bytes.subarray(cursor, end);
    cursor = end + 1;
    if (raw.length > PLAYWRIGHT_EVIDENCE_LIMITS.max_line_bytes) {
      coverage.unreadable_rows++;
      issues.add(sourceName, 'row_too_large', line);
      continue;
    }
    let text;
    try { text = decoder.decode(raw).trim(); }
    catch {
      coverage.unreadable_rows++;
      issues.add(sourceName, 'invalid_utf8', line);
      continue;
    }
    if (!text) continue;
    let event;
    try { event = JSON.parse(text); }
    catch {
      coverage.unreadable_rows++;
      issues.add(sourceName, 'invalid_json_row', line);
      continue;
    }
    if (!record(event) || typeof event.type !== 'string') {
      coverage.unreadable_rows++;
      issues.add(sourceName, 'invalid_event_row', line);
      continue;
    }
    coverage.event_rows++;
    visit(event, line);
  }
  return coverage;
}

function actionKind(event) {
  // All labels are taken from fixed protocol names. User-authored test titles,
  // action text, selectors, arguments and unknown labels stay in the source.
  if (pageClasses.has(event.class) && categories.has(event.method)) return { category: categories.get(event.method), api: event.method };
  if (event.class === 'BrowserContext' && ['newPage', 'close'].includes(event.method)) return { category: 'lifecycle', api: event.method };
  if (event.class === 'Page' && event.method === 'close') return { category: 'lifecycle', api: 'close' };
  if (event.class === 'Tracing' && event.method === 'tracingGroup') return { category: 'test-step', api: 'tracingGroup' };
  if (event.class === 'Test') {
    if (event.method === 'expect') return { category: 'verification', api: 'expect' };
    return { category: 'test-step', api: testStepMethods.has(event.method) ? event.method : null };
  }
  return { category: 'other', api: null };
}

function actionStart(event, line, state, issues) {
  if (!validId(event.callId)) {
    issues.add('trace', 'invalid_action_id', line);
    return;
  }
  if (state.calls.has(event.callId)) {
    state.calls.get(event.callId).invalid = true;
    issues.add('trace', 'duplicate_action_start', line);
    return;
  }
  state.calls.set(event.callId, {
    id: state.calls.size + 1, ...actionKind(event), start: clock(event.startTime) ? event.startTime : null,
    parent: validId(event.parentId) ? event.parentId : null, startLine: line,
  });
}

function actionEnd(event, line, state, issues) {
  const action = state.calls.get(event.callId);
  if (!action) {
    issues.add('trace', 'orphan_action_end', line);
    return;
  }
  if (action.endLine !== undefined) {
    action.invalid = true;
    issues.add('trace', 'duplicate_action_end', line);
    return;
  }
  action.endLine = line;
  action.end = clock(event.endTime) ? event.endTime : null;
  action.failed = event.error !== undefined && event.error !== null;
  if (action.failed) {
    if (!record(event.error)) {
      action.invalid = true;
      issues.add('trace', 'invalid_action_error', line);
    } else action.errorKind = errorNames.has(event.error.name) ? event.error.name : 'other';
  }
}

function pageId(state, rawId) {
  const existing = state.pages.get(rawId);
  if (existing) return existing;
  const page = { id: state.pages.size + 1, open: false, closed: false };
  state.pages.set(rawId, page);
  return page;
}

function pageEvent(event, line, state, issues) {
  const kind = pageMethods.get(event.method);
  const rawId = event.method === 'pageError' ? (event.pageId ?? event.params?.pageId) : event.params?.pageId;
  if (!validId(rawId) || !clock(event.time) || event.time < state.origin) {
    issues.add('trace', 'invalid_page_event', line);
    return;
  }
  const page = pageId(state, rawId);
  if ((kind === 'open' && page.open) || page.closed || (kind === 'close' && !page.open)) {
    issues.add('trace', 'page_order_unresolved', line);
  }
  if (kind === 'open') page.open = true;
  if (kind === 'close') page.closed = true;
  if (kind === 'error') state.pageErrors++;
  state.pageCount++;
  if (state.pageRows.length === PLAYWRIGHT_EVIDENCE_LIMITS.max_page_rows) {
    issues.add('trace', 'page_row_limit', line);
    return;
  }
  state.pageRows.push({ type: 'page', event: kind, page_id: page.id, time_ms: round(event.time - state.origin), source: { line } });
}

function linkPage(event, line, state, issues) {
  const link = event.type === 'frame-snapshot' ? event.snapshot : event;
  if (!validId(link?.callId) || !validId(link.pageId)) return;
  const action = state.calls.get(link.callId);
  if (!action) return;
  if (action.pageLink === undefined) action.pageLink = { rawId: link.pageId, line };
  else if (action.pageLink !== null && action.pageLink.rawId !== link.pageId) {
    action.pageLink = null;
    issues.add('trace', 'ambiguous_action_page', line);
  }
}

function interpretEvent(event, line, state, issues) {
  if (!state.contextSeen) {
    state.contextSeen = true;
    if (event.type !== 'context-options') {
      issues.add('trace', 'context_header_required', line);
      return;
    }
    state.context = {
      trace_version: Number.isSafeInteger(event.version) ? event.version : null,
      origin: contextTypes.has(event.origin) ? event.origin : null,
      browser: browsers.has(event.browserName) ? event.browserName : null,
      source_line: line,
    };
    if (event.version !== version || state.context.origin === null || !clock(event.monotonicTime)) {
      issues.add('trace', 'unsupported_context', line);
      return;
    }
    state.origin = event.monotonicTime;
    state.supported = true;
    return;
  }
  if (!state.supported) return;
  if (event.type === 'before' || event.type === 'action') {
    actionStart(event, line, state, issues);
    if (event.type === 'action' && state.calls.get(event.callId)?.startLine === line) actionEnd(event, line, state, issues);
  } else if (event.type === 'after') actionEnd(event, line, state, issues);
  else if (event.type === 'event' && event.class === 'BrowserContext' && pageMethods.has(event.method)) pageEvent(event, line, state, issues);
  else if (event.type === 'frame-snapshot' || event.type === 'screenshot' || event.type === 'aria-snapshot') linkPage(event, line, state, issues);
  else if (event.type === 'error') state.traceErrors++;
  else if (event.type === 'context-options') {
    state.supported = false;
    issues.add('trace', 'multiple_context_headers', line);
  } else if (auxiliaryTypes.has(event.type) || event.type === 'event') {
    state.ignoredEvents++;
    if (event.type === 'resource-snapshot') state.embeddedNetworkRows++;
  } else {
    state.ignoredEvents++;
    issues.add('trace', 'unsupported_event_type', line);
  }
}

function finalizeAction(action, state, issues) {
  const startKnown = clock(action.start) && action.start >= state.origin;
  const endKnown = action.endLine !== undefined && clock(action.end) && action.end >= action.start;
  let status;
  if (action.invalid || !startKnown || (action.endLine !== undefined && !endKnown)) {
    status = 'invalid';
    if (!startKnown || (action.endLine !== undefined && !endKnown)) issues.add('trace', 'invalid_action_clock', action.startLine);
  } else if (action.endLine === undefined) {
    status = 'incomplete';
    issues.add('trace', 'action_end_missing', action.startLine);
  } else status = action.failed ? 'failed' : 'completed';

  if (action.parent !== null && (!state.calls.has(action.parent) || state.calls.get(action.parent).id >= action.id)) {
    issues.add('trace', 'action_parent_unresolved', action.startLine);
  }
  const parent = state.calls.get(action.parent);
  const page = action.pageLink ? pageId(state, action.pageLink.rawId) : null;
  return {
    type: 'action', action_id: action.id, category: action.category, api: action.api, status,
    start_ms: startKnown ? round(action.start - state.origin) : null,
    duration_ms: status === 'completed' || status === 'failed' ? round(action.end - action.start) : null,
    error_kind: action.errorKind ?? null,
    page_id: page?.id ?? null,
    parent_action_id: parent && parent.id < action.id ? parent.id : null,
    source: { start_line: action.startLine, end_line: action.endLine ?? null, page_link_line: action.pageLink?.line ?? null },
  };
}

function timelineFor(state, issues) {
  const actions = { total: 0, completed: 0, failed: 0, incomplete: 0, invalid: 0, omitted: 0 };
  if (!state.supported) return { timeline: [], actions };
  const rows = [];
  for (const action of state.calls.values()) {
    const row = finalizeAction(action, state, issues);
    actions.total++;
    actions[row.status]++;
    if (rows.length < PLAYWRIGHT_EVIDENCE_LIMITS.max_action_rows) rows.push(row);
    else {
      actions.omitted++;
      issues.add('trace', 'action_row_limit', action.startLine);
    }
  }
  const time = row => (row.type === 'action' ? row.start_ms : row.time_ms) ?? Infinity;
  const line = row => (row.type === 'action' ? row.source.start_line : row.source.line);
  const timeline = [...rows, ...state.pageRows].sort((left, right) => {
    const a = time(left), b = time(right);
    return a === b ? line(left) - line(right) : a - b;
  });
  return { timeline, actions };
}

function increment(counts, key) { counts[key] = (counts[key] ?? 0) + 1; }

function summarizeNetwork(networkBytes, supported, issues) {
  const byResource = {}, byMethod = {}, byStatus = {};
  let resources = 0;
  let stream = null;
  let status = 'missing';
  if (networkBytes !== undefined && !supported) status = 'unsupported';
  else if (networkBytes !== undefined) {
    stream = scan(networkBytes, 'network', issues, (event, line) => {
      if (event.type !== 'resource-snapshot') {
        issues.add('network', 'unsupported_network_event', line);
        return;
      }
      const item = event.snapshot;
      if (!record(item) || !record(item.request) || !record(item.response)) {
        issues.add('network', 'invalid_resource_snapshot', line);
        return;
      }
      const code = item.response.status;
      const statusClass = Number.isInteger(code) && code >= 100 && code <= 599 ?
        `${Math.floor(code / 100)}xx` : (typeof item.response._failureText === 'string' || item._wasAborted === true) ? 'transport-error' : 'unknown';
      const resourceType = resourceTypes.has(item._resourceType) ? item._resourceType : 'unknown';
      const method = requestMethods.has(item.request.method) ? item.request.method : 'other';
      increment(byResource, resourceType);
      increment(byStatus, statusClass);
      increment(byMethod, method);
      resources++;
    });
    status = issues.has('network') ? 'partial' : resources === 0 ? 'empty' : 'complete';
  }
  return {
    authority: 'reported', coverage: { status, resources, stream },
    by_resource_type: byResource, by_status_class: byStatus, by_method: byMethod,
  };
}

/** Import one unpacked Playwright v10 trace stream and its optional network companion.
 * Results summarize saved observations with byte and line provenance. No target or trace payload is executed.
 */
export function inspectPlaywrightEvidence(traceBytes, networkBytes) {
  const sources = { trace: source(traceBytes), network: networkBytes === undefined ? null : source(networkBytes) };
  const issues = issueLedger();
  const state = {
    contextSeen: false, context: null, supported: false, origin: null, traceErrors: 0, ignoredEvents: 0, embeddedNetworkRows: 0,
    calls: new Map(), pages: new Map(), pageCount: 0, pageErrors: 0, pageRows: [],
  };
  const trace = scan(traceBytes, 'trace', issues, (event, line) => interpretEvent(event, line, state, issues));
  if (!state.contextSeen) issues.add('trace', 'context_header_required');
  const { timeline, actions } = timelineFor(state, issues);
  const network = summarizeNetwork(networkBytes, state.supported, issues);
  const result = {
    schema_version: 1, kind: 'playwright-evidence',
    status: state.supported ? (issues.has('trace') || issues.has('network') ? 'partial' : 'complete') : 'unsupported',
    authority: 'reported',
    context: state.context,
    sources,
    timeline,
    network,
    coverage: {
      trace: { ...trace, ignored_events: state.supported ? state.ignoredEvents : null, trace_errors: state.supported ? state.traceErrors : null },
      actions,
      pages: state.supported ? {
        total_events: state.pageCount, error_events: state.pageErrors,
        retained_events: state.pageRows.length, omitted_events: state.pageCount - state.pageRows.length,
      } : null,
      embedded_resource_rows: state.supported ? state.embeddedNetworkRows : null,
    },
    issues: issues.rows(),
    limitations: [
      'One Playwright v10 context stream. Timing is relative to its recorded monotonic origin. Output uses fixed method names and numeric action and page identifiers.',
      'The supplied bytes carry reported authority. A complete import means the supported records were read. It does not certify capture completeness, elapsed performance or application behavior.',
      'Network buckets describe the supplied companion stream only. A companion can retain resources across chunks and has no authenticated action or context binding.',
      'Console text, arguments and results, URLs, cookies, bodies, headers, stacks, page contents and image or attachment bytes are omitted.',
    ],
  };
  return { ...result, receipt_sha256: digest(result) };
}
