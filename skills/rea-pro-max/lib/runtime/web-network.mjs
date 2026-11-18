const MAX_REQUESTS_PER_ACTION = 64;
const MAX_PATH_LENGTH = 512;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TRACE_HEADER = 'x-rea-operation-id';
const OP_ID = /^[A-Za-z0-9_-]{1,80}$/u;

function scriptLocation(initiator, origin) {
  const frames = initiator?.stack?.callFrames;
  if (!Array.isArray(frames)) return undefined;
  for (const frame of frames.slice(0, 8)) {
    try {
      const url = new URL(frame.url);
      if (url.origin === origin && url.pathname.length <= MAX_PATH_LENGTH &&
          Number.isSafeInteger(frame.lineNumber) && frame.lineNumber >= 0 &&
          Number.isSafeInteger(frame.columnNumber) && frame.columnNumber >= 0) {
        return { path: url.pathname, line: frame.lineNumber, column: frame.columnNumber };
      }
    } catch {
      // Frames for VM scripts do not have a usable URL.
    }
  }
}

/** Observe request starts in an attached page session. Lifecycles are evidence,
 * and can finish after the action window that recorded the start. */
export async function observePageNetwork(connection, sessionId, { enabled = true, correlation = false } = {}) {
  const activeRequests = new Map();
  let current;
  let unavailable = enabled ? null : 'observer_disabled';
  const issues = () => [...new Set([unavailable, ...(current?.issues ?? [])].filter(Boolean))];
  const mark = reason => current?.issues.add(reason);
  const elapsed = window => Number((performance.now() - window.started).toFixed(3));

  function recordResponse(request, response) {
    if (Number.isInteger(response?.status)) request.status = response.status;
    if (response?.fromDiskCache === true || response?.fromServiceWorker === true) request.response_source = response.fromServiceWorker === true ? 'service-worker' : 'cache';
    if (!correlation || !response?.headers) return;
    const header = Object.entries(response.headers).find(([key]) => key.toLowerCase() === TRACE_HEADER);
    if (typeof header?.[1] === 'string' && OP_ID.test(header[1])) request.operation_id = header[1];
  }

  if (enabled) {
    const listeners = [];
    const on = (method, handle) => listeners.push(connection.on(method, (params, sourceSession) => {
      if (sourceSession === sessionId) handle(params);
    }));
    on('Network.requestWillBeSent', params => {
      const previous = activeRequests.get(params.requestId);
      if (previous) {
        if (params.redirectResponse) {
          recordResponse(previous, params.redirectResponse);
          previous.outcome = 'redirect';
        } else {
          previous.outcome = 'unknown';
          mark('unexpected_duplicate_request_id');
        }
        activeRequests.delete(params.requestId);
      }
      if (!current || unavailable || !params.request) return;
      const method = typeof params.request.method === 'string' ? params.request.method.toUpperCase() : '';
      if (SAFE_METHODS.has(method) && params.type !== 'Fetch' && params.type !== 'XHR') return;
      let url;
      try { url = new URL(params.request.url); } catch { mark('invalid_request_locator'); return; }
      if (url.origin !== current.origin) return;
      if (!/^[A-Z]{1,24}$/u.test(method) || url.pathname.length > MAX_PATH_LENGTH || typeof params.requestId !== 'string') {
        mark('request_metadata_bounds');
        return;
      }
      if (current.requests.length >= MAX_REQUESTS_PER_ACTION) { mark('request_budget_exceeded'); return; }
      const request = { request_id: params.requestId, method, path: url.pathname, observed_at_ms: elapsed(current), outcome: 'pending' };
      if (Number.isFinite(params.timestamp)) request.browser_monotonic_s = params.timestamp;
      const source = correlation && scriptLocation(params.initiator, current.origin);
      if (source) request.source = source;
      current.requests.push(request);
      activeRequests.set(params.requestId, request);
    });
    on('Network.responseReceived', ({ requestId, response }) => {
      const request = activeRequests.get(requestId);
      if (request) recordResponse(request, response);
    });
    function finish(requestId, outcome) {
      const request = activeRequests.get(requestId);
      if (request) request.outcome = outcome;
      activeRequests.delete(requestId);
    }
    on('Network.loadingFinished', ({ requestId }) => finish(requestId, 'finished'));
    on('Network.loadingFailed', ({ requestId }) => finish(requestId, 'failed'));
    on('Network.requestServedFromCache', ({ requestId }) => {
      const request = activeRequests.get(requestId);
      if (request) request.response_source = 'cache';
    });
    on('Inspector.detached', () => { unavailable = 'observer_detached'; });
    listeners.push(connection.on('Target.detachedFromTarget', ({ sessionId: detached }) => {
      if (detached === sessionId) unavailable = 'observer_detached';
    }));
    try {
      await connection.send('Network.enable', { maxPostDataSize: 0 }, sessionId);
    } catch {
      unavailable = 'observer_enable_failed';
      for (const stop of listeners) stop();
    }
  }

  return {
    begin(origin) {
      current = { origin, requests: [], started: performance.now(), issues: new Set() };
    },
    end() {
      if (connection.closed) unavailable = 'observer_disconnected';
      const coverageIssues = issues();
      const result = {
        complete: coverageIssues.length === 0,
        duration_ms: elapsed(current),
        issues: coverageIssues,
        requests: current.requests,
      };
      current = undefined;
      return result;
    },
  };
}
