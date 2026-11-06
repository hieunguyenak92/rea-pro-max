import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const fixture = variant => new URL(`../skills/rea-pro-max/assets/recovery/${variant}/worker.js`, import.meta.url);
const corpus = JSON.parse(readFileSync(new URL('./fixtures/recovery/acceptance.json', import.meta.url), 'utf8'));
const withoutBoot = response => { const { boot_id, ...body } = response; assert.match(boot_id, /^[a-f0-9-]{36}$/u); return body; };

// These tests execute owned worker source under a storage model. Real Chromium
// lifecycle qualification belongs to the optional runtime-provider integration.
function harness(variant = 'reference') {
  let stored = {}, listener, failWrite = false;
  const boot = () => {
    const chrome = {
      runtime: { onMessage: { addListener(value) { listener = value; } } },
      storage: { local: {
        async get(key) { return Object.hasOwn(stored, key) ? { [key]: structuredClone(stored[key]) } : {}; },
        async set(values) { if (failWrite) { failWrite = false; throw new Error('simulated storage failure'); } stored = { ...stored, ...structuredClone(values) }; },
      } },
    };
    const context = vm.createContext({ chrome, crypto: { randomUUID }, structuredClone });
    vm.runInContext(readFileSync(fixture(variant), 'utf8'), context, { timeout: 1000 });
  };
  boot();
  return {
    send(message) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker did not respond')), 1000);
        const keep = listener(structuredClone(message), {}, value => { clearTimeout(timer); resolve(structuredClone(value)); });
        assert.equal(keep, true);
      });
    },
    restart: boot,
    failNextWrite() { failWrite = true; },
  };
}

for (const scenario of corpus.cases) test(`owned recovery protocol model: ${scenario.id}`, async () => {
  const app = harness();
  let previousBoot;
  for (const action of scenario.actions) {
    if (action.kind === 'worker-restart') {
      app.restart();
      const next = await app.send({ type: 'boot' });
      assert.notEqual(next.boot_id, previousBoot);
      previousBoot = next.boot_id;
    } else if (action.kind === 'message') {
      const response = await app.send(action.message);
      if (previousBoot) assert.equal(response.boot_id, previousBoot);
      previousBoot = response.boot_id;
      assert.deepEqual(withoutBoot(response), action.expected);
    } else assert.equal(action.kind, 'page-reopen'); // No worker reset in this model.
  }
});

test('regression and starter retain warm state but lose acknowledged data on modeled restart', async () => {
  for (const variant of ['regression', 'starter']) {
    const app = harness(variant);
    const first = await app.send({ type: 'put', key: 'note', value: 'saved', requestId: 'one' });
    assert.equal((await app.send({ type: 'get', key: 'note' })).result.value, 'saved');
    app.restart();
    const after = await app.send({ type: 'get', key: 'note' });
    assert.notEqual(after.boot_id, first.boot_id);
    assert.deepEqual(withoutBoot(after), { ok: true, result: { revision: 0, found: false, value: null } });
  }
});

test('storage failure never acknowledges mutation or consumes its request ID', async () => {
  const app = harness();
  app.failNextWrite();
  const message = { type: 'put', key: 'x', value: 'v', requestId: 'retry' };
  assert.deepEqual(withoutBoot(await app.send(message)), { ok: false, error: { code: 'storage_failure' } });
  assert.deepEqual(withoutBoot(await app.send({ type: 'snapshot' })), { ok: true, result: { revision: 0, entries: [] } });
  assert.deepEqual(withoutBoot(await app.send(message)), { ok: true, result: { revision: 1, key: 'x', value: 'v' } });
});

test('queued messages serialize read-modify-write without losing revisions', async () => {
  const app = harness();
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => app.send({ type: 'put', key: `k${index}`, value: `${index}`, requestId: `r${index}` })));
  assert.deepEqual(responses.map(response => response.result.revision), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.equal((await app.send({ type: 'snapshot' })).result.entries.length, 12);
});

test('protocol boundaries preserve exact strings and reject out-of-domain values', async () => {
  const app = harness();
  const key = 'x'.repeat(128), value = '🌙'.repeat(2048);
  assert.equal((await app.send({ type: 'put', key, value, requestId: 'r'.repeat(128) })).ok, true);
  for (const [message, code] of [
    [{ type: 'get', key: `${key}x` }, 'invalid_key'],
    [{ type: 'put', key, value: `${value}x`, requestId: 'extra' }, 'invalid_value'],
    [{ type: 'remove', key, requestId: 'r'.repeat(129) }, 'invalid_request_id'],
  ]) assert.deepEqual(withoutBoot(await app.send(message)), { ok: false, error: { code } });
  assert.equal((await app.send({ type: 'get', key })).result.value, value);
});

test('bounded key/request capacity retains duplicate history without eviction', async () => {
  const app = harness();
  for (let index = 0; index < 128; index++) assert.equal((await app.send({ type: 'put', key: `k${index}`, value: 'v', requestId: `r${index}` })).ok, true);
  assert.deepEqual(withoutBoot(await app.send({ type: 'put', key: 'overflow', value: 'v', requestId: 'overflow' })), { ok: false, error: { code: 'entry_limit' } });
  for (let index = 128; index < 256; index++) assert.equal((await app.send({ type: 'put', key: 'k0', value: `${index}`, requestId: `r${index}` })).ok, true);
  app.restart();
  assert.deepEqual(withoutBoot(await app.send({ type: 'remove', key: 'k0', requestId: 'r256' })), { ok: false, error: { code: 'request_limit' } });
  assert.deepEqual(withoutBoot(await app.send({ type: 'put', key: 'k0', value: 'v', requestId: 'r0' })), { ok: true, result: { revision: 1, key: 'k0', value: 'v' } });
  assert.equal((await app.send({ type: 'get', key: 'k0' })).result.value, '255');
});
