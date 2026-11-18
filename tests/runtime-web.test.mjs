import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { observePageNetwork } from '../skills/rea-pro-max/lib/runtime/web-network.mjs';
import { validateWebScenario } from '../skills/rea-pro-max/lib/runtime/web.mjs';
import { replayWebFeature } from '../skills/rea-pro-max/lib/runtime/web-replay.mjs';
import { compileContract } from '../skills/rea-pro-max/lib/web-recovery/contract.mjs';
import { compareBehavior } from '../skills/rea-pro-max/lib/web-recovery/compare.mjs';

const scenario = {
  schema_version: 1,
  name: 'bounded local search',
  url: 'http://127.0.0.1:4173/',
  actions: [
    { id: 'open', kind: 'wait', milliseconds: 0 },
    { id: 'type', kind: 'input', selector: '#search', value: 'café' },
    { id: 'submit', kind: 'click', selector: '#submit' },
  ],
};

test('web scenarios are finite, credential-free and selector-bounded', () => {
  assert.deepEqual(validateWebScenario(scenario), scenario);
  assert.throws(() => validateWebScenario({ ...scenario, url: 'file:///tmp/app.html' }), { code: 'invalid_web_scenario' });
  assert.throws(() => validateWebScenario({ ...scenario, url: 'https://user:pass@example.org/app' }), { code: 'invalid_web_scenario' });
  assert.throws(() => validateWebScenario({ ...scenario, actions: [{ ...scenario.actions[0], extra: true }] }), { code: 'invalid_web_scenario' });
  assert.throws(() => validateWebScenario({ ...scenario, actions: Array.from({ length: 65 }, (_, index) => ({ id: `a${index}`, kind: 'wait', milliseconds: 0 })) }), { code: 'invalid_web_scenario' });
});

test('web replay rejects malformed URLs before starting a browser', async () => {
  await assert.rejects(() => replayWebFeature({ referenceUrl: 'file:///tmp/reference', candidateUrl: 'http://127.0.0.1:4174/', executablePath: process.execPath, scenario }), { code: 'web_replay_input' });
  await assert.rejects(() => replayWebFeature({
    referenceUrl: scenario.url, candidateUrl: 'http://127.0.0.1:4174/', executablePath: process.execPath,
    scenario: { ...scenario, actions: [{ id: 'switch-origin', kind: 'navigate', url: 'http://127.0.0.1:4175/' }] },
  }), { code: 'web_replay_input' });
  await assert.rejects(() => replayWebFeature({
    referenceUrl: scenario.url, candidateUrl: scenario.url + 'candidate', executablePath: process.execPath,
    scenario: { ...scenario, actions: [{ id: 'open', kind: 'navigate', url: scenario.url + 'feature' }] },
  }), { code: 'web_replay_input' });
});

function simulatedTransport({ failEnable = false } = {}) {
  const events = new EventEmitter();
  return {
    closed: false,
    on(method, listener) {
      events.on(method, listener);
      return () => events.off(method, listener);
    },
    async send() {
      if (failEnable) throw new Error('unsupported network domain');
    },
    emit(method, params, session = 'page') { events.emit(method, params, session); },
  };
}

const localOrigin = 'http://127.0.0.1:4173';
const post = (id, path = '/save') => ({ requestId: id, type: 'Fetch', request: { url: localOrigin + path, method: 'POST' } });

test('page observer distinguishes measured empty, disabled and lost windows', async () => {
  const connection = simulatedTransport();
  const observer = await observePageNetwork(connection, 'page');
  observer.begin(localOrigin);
  connection.emit('Network.requestWillBeSent', post('other-session'), 'worker');
  const empty = observer.end();
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.requests, []);
  observer.begin(localOrigin);
  connection.emit('Target.detachedFromTarget', { sessionId: 'page' });
  assert.deepEqual(observer.end().issues, ['observer_detached']);
  const disabled = await observePageNetwork(connection, 'page', { enabled: false });
  disabled.begin(localOrigin);
  assert.deepEqual(disabled.end().issues, ['observer_disabled']);
  const unsupported = await observePageNetwork(simulatedTransport({ failEnable: true }), 'page');
  unsupported.begin(localOrigin);
  assert.deepEqual(unsupported.end().issues, ['observer_enable_failed']);
});

test('page observer matches delayed responses by request ID and bounds the window', async () => {
  const connection = simulatedTransport();
  const observer = await observePageNetwork(connection, 'page', { correlation: true });
  observer.begin(localOrigin);
  connection.emit('Network.requestWillBeSent', post('first', '/save?secret=redacted'));
  const first = observer.end();
  observer.begin(localOrigin);
  connection.emit('Network.requestWillBeSent', post('second'));
  for (const id of ['second', 'first']) {
    connection.emit('Network.responseReceived', { requestId: id, response: { status: 204, headers: { 'X-REA-Operation-ID': id, Cookie: 'redacted' } } });
    connection.emit('Network.loadingFinished', { requestId: id });
  }
  const second = observer.end();
  assert.deepEqual(first.requests.map(({ operation_id, path, outcome }) => [operation_id, path, outcome]), [['first', '/save', 'finished']]);
  assert.deepEqual(second.requests.map(({ operation_id, path, outcome }) => [operation_id, path, outcome]), [['second', '/save', 'finished']]);
  assert.equal(JSON.stringify([first, second]).includes('redacted'), false);
  observer.begin(localOrigin);
  for (let i = 0; i < 65; i++) connection.emit('Network.requestWillBeSent', post('id-' + i));
  const bounded = observer.end();
  assert.equal(bounded.complete, false);
  assert.equal(bounded.requests.length, 64);
  assert.deepEqual(bounded.issues, ['request_budget_exceeded']);
});

test('Chromium proves same-picture pages can differ in network behavior', { skip: !process.env.RPM_BROWSER_EXECUTABLE, timeout: 120_000 }, async t => {
  async function serve(sendsPost) {
    let count = 0;
    const server = createServer((request, response) => {
      if (request.method === 'POST' && request.url === '/save') {
        count++;
        response.writeHead(204).end();
      } else if (request.url === '/' || request.url === '/feature?lab=1') {
        response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Owned fixture</title><button id="save">Save</button><p id="status"></p><script src="/app.js"></script>');
      } else if (request.url === '/app.js') {
        const send = sendsPost ? "void fetch('/save', { method: 'POST' });" : '';
        response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(
          "document.getElementById('save').onclick = () => { document.getElementById('status').textContent = 'Saved'; " + send + ' };');
      } else response.writeHead(404).end();
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => new Promise(done => server.close(done)));
    return { url: 'http://127.0.0.1:' + server.address().port + '/', count: () => count };
  }
  const [before, after] = await Promise.all([serve(true), serve(false)]);
  const args = {
    referenceUrl: before.url, candidateUrl: after.url,
    executablePath: process.env.RPM_BROWSER_EXECUTABLE,
    scenario: {
      schema_version: 1, name: 'Owned save fixture', url: before.url,
      actions: [
        { id: 'feature', kind: 'navigate', url: before.url + 'feature?lab=1#view' },
        { id: 'save', kind: 'click', selector: '#save' }, { id: 'settle', kind: 'wait', milliseconds: 200 },
      ],
    },
  };
  const replay = await replayWebFeature(args);
  assert.equal(replay.status, 'fail');
  assert.equal(replay.verification.visual.status, 'pass');
  assert.deepEqual([before.count(), after.count()], [1, 0]);
  assert.equal(replay.reference.receipt.cases[0].output.url, before.url + 'feature?lab=1#view');
  assert.equal(replay.candidate.receipt.cases[0].output.url, after.url + 'feature?lab=1#view');
  assert.deepEqual(replay.reference_ir.observations[1].network.summary, [{ method: 'POST', path: '/save' }]);
  assert.deepEqual(replay.candidate_ir.observations[1].network.summary, []);
  assert.ok(replay.reference.provenance.duration_ms >= 200);
  assert.equal(replay.reference.provenance.target_identity.kind, 'url-locator');
  const networkOnly = compileContract(replay.reference_ir, replay.candidate_ir, { required_channels: ['network'] });
  assert.equal(compareBehavior(replay.reference_ir, replay.candidate_ir, networkOnly).status, 'fail');
  const disabled = await replayWebFeature({ ...args, scenario: { ...args.scenario, network: false } });
  assert.equal(disabled.status, 'unknown');
  assert.equal(disabled.verification.visual.status, 'pass');
  assert.ok(disabled.verification.behavior.cases.every(item => item.reasons.includes('network:observer_disabled')));
  const knownEmpty = await replayWebFeature({ ...args, referenceUrl: after.url });
  assert.equal(knownEmpty.status, 'pass');
});
