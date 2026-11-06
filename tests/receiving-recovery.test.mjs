import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import test from 'node:test';

const directory = new URL('../skills/rea-pro-max/assets/recovery/recovered/', import.meta.url);
const source = await readFile(new URL('worker.js', directory), 'utf8');

// Controlled Chrome-API model, not evidence of a real browser worker lifecycle.
function storageModel() {
  const disk = {};
  let hold;
  return {
    disk,
    reads: 0,
    attempts: [],
    commits: 0,
    failRead: false,
    failWrite: false,
    holdNextWrite() {
      let entered;
      let release;
      const reached = new Promise(resolve => { entered = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      hold = { entered, gate };
      return { reached, release };
    },
    async get(key) {
      this.reads++;
      if (this.failRead) { this.failRead = false; throw new Error('Read unavailable'); }
      return Object.hasOwn(disk, key) ? { [key]: structuredClone(disk[key]) } : {};
    },
    async set(update) {
      const copy = structuredClone(update);
      this.attempts.push(copy);
      if (hold) {
        const current = hold;
        hold = undefined;
        current.entered();
        await current.gate;
      }
      if (this.failWrite) { this.failWrite = false; throw new Error('Write unavailable'); }
      Object.assign(disk, copy);
      this.commits++;
    },
  };
}

function initialize(storage) {
  let listener;
  const chrome = {
    storage: { local: storage },
    runtime: { onMessage: { addListener(callback) { listener = callback; } } },
  };
  new Script(source, { filename: 'receiving-worker.js' }).runInNewContext({ chrome, crypto: { randomUUID } });
  assert.equal(typeof listener, 'function', 'listener is registered during initialization');
  return {
    send(message) {
      return new Promise(resolve => {
        const keepAlive = listener(structuredClone(message), {}, response => resolve(structuredClone(response)));
        assert.equal(keepAlive, true, 'asynchronous response keeps its message channel open');
      });
    },
  };
}

function result(response, expected, bootId) {
  assert.deepEqual(response, { ok: true, result: expected, boot_id: bootId ?? response.boot_id });
  assert.match(response.boot_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  return response.boot_id;
}

function error(response, code, bootId) {
  assert.deepEqual(response, { ok: false, error: { code }, boot_id: bootId ?? response.boot_id });
}

test('receiving extension has a usable local MV3 entry with only storage permission', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.background.service_worker, 'worker.js');
  assert.equal(manifest.action.default_popup, 'runner.html');
  const html = await readFile(new URL('runner.html', directory), 'utf8');
  assert.match(html, /src="runner\.js"/u);
  const ui = await readFile(new URL('runner.js', directory), 'utf8');
  assert.match(ui, /chrome\.runtime\.sendMessage/u);
});

test('a fresh worker starts empty and creates a new observational boot ID per initialization', async () => {
  const storage = storageModel();
  const first = initialize(storage);
  const id = result(await first.send({ type: 'boot' }), { protocol: 'rpm-kv-v1' });
  result(await first.send({ type: 'snapshot' }), { revision: 0, entries: [] }, id);
  result(await first.send({ type: 'get', key: 'missing' }), { revision: 0, found: false, value: null }, id);
  assert.equal(storage.commits, 0);
  const second = initialize(storage);
  const nextId = result(await second.send({ type: 'boot' }), { protocol: 'rpm-kv-v1' });
  assert.notEqual(id, nextId);
  result(await second.send({ type: 'snapshot' }), { revision: 0, entries: [] }, nextId);
});

test('values, prototype-looking keys and ECMAScript ordering are preserved without normalization', async () => {
  const worker = initialize(storageModel());
  const keys = ['__proto__', 'constructor', 'toString', 'a', 'A', 'é', 'e\u0301', '\ud800', '😀', ' key '];
  let revision = 0;
  for (const [index, key] of keys.entries()) {
    const value = ` \t${key}\u0000\n`;
    result(await worker.send({ type: 'put', key, value, requestId: `unicode-${index}` }), { revision: ++revision, key, value });
    result(await worker.send({ type: 'get', key }), { revision, found: true, value });
  }
  result(await worker.send({ type: 'snapshot' }), {
    revision,
    entries: keys.slice().sort().map(key => ({ key, value: ` \t${key}\u0000\n` })),
  });
  result(await worker.send({ type: 'put', key: '__proto__', value: '', requestId: 'empty-value' }), { revision: ++revision, key: '__proto__', value: '' });
  result(await worker.send({ type: 'put', key: '__proto__', value: '', requestId: 'same-value' }), { revision: ++revision, key: '__proto__', value: '' });
  result(await worker.send({ type: 'remove', key: 'never-here', requestId: 'absent-remove' }), { revision: ++revision, key: 'never-here', removed: false });
});

test('validation rejects malformed messages without changing state', async () => {
  const worker = initialize(storageModel());
  const id = result(await worker.send({ type: 'put', key: 'kept', value: 'before', requestId: 'initial' }), { revision: 1, key: 'kept', value: 'before' });
  const cases = [
    [null, 'invalid_message'], [[], 'invalid_message'], [0, 'invalid_message'], ['', 'invalid_message'],
    [{}, 'unsupported_operation'], [{ type: null }, 'unsupported_operation'], [{ type: 42 }, 'unsupported_operation'],
    [{ type: '__proto__' }, 'unsupported_operation'], [{ type: 'unknown' }, 'unsupported_operation'],
    [{ type: 'boot', extra: true }, 'invalid_message'], [{ type: 'snapshot', requestId: 'x' }, 'invalid_message'],
    [{ type: 'get', key: 'kept', value: 'x' }, 'invalid_message'],
    [{ type: 'remove', key: 'kept', requestId: 'x', value: 'x' }, 'invalid_message'],
    [{ type: 'put', key: 'kept', value: 'after', requestId: 'x', extra: false }, 'invalid_message'],
    [{ type: 'get' }, 'invalid_key'], [{ type: 'get', key: '' }, 'invalid_key'], [{ type: 'get', key: 1 }, 'invalid_key'],
    [{ type: 'get', key: 'x'.repeat(129) }, 'invalid_key'],
    [{ type: 'put', key: 'kept', requestId: 'x' }, 'invalid_value'],
    [{ type: 'put', key: 'kept', value: null, requestId: 'x' }, 'invalid_value'],
    [{ type: 'put', key: 'kept', value: 'x'.repeat(4097), requestId: 'x' }, 'invalid_value'],
    [{ type: 'put', key: 'kept', value: 'after' }, 'invalid_request_id'],
    [{ type: 'put', key: 'kept', value: 'after', requestId: '' }, 'invalid_request_id'],
    [{ type: 'remove', key: 'kept', requestId: 1 }, 'invalid_request_id'],
    [{ type: 'remove', key: 'kept', requestId: 'x'.repeat(129) }, 'invalid_request_id'],
  ];
  for (const [message, code] of cases) error(await worker.send(message), code, id);
  result(await worker.send({ type: 'snapshot' }), { revision: 1, entries: [{ key: 'kept', value: 'before' }] }, id);
});

test('string bounds count UTF-16 units, including supplementary characters', async () => {
  const worker = initialize(storageModel());
  const key = '😀'.repeat(64);
  const value = '😀'.repeat(2048);
  const requestId = '😀'.repeat(64);
  result(await worker.send({ type: 'put', key, value, requestId }), { revision: 1, key, value });
  error(await worker.send({ type: 'put', key: key + 'x', value, requestId: 'long-key' }), 'invalid_key');
  error(await worker.send({ type: 'put', key, value: value + 'x', requestId: 'long-value' }), 'invalid_value');
  error(await worker.send({ type: 'remove', key, requestId: requestId + 'x' }), 'invalid_request_id');
  result(await worker.send({ type: 'get', key }), { revision: 1, found: true, value });
});

test('durable receipts return the original result after overwrite, removal and worker reinitialization', async () => {
  const storage = storageModel();
  let worker = initialize(storage);
  const put = { type: 'put', key: 'note', value: 'original', requestId: 'save-one' };
  const original = { revision: 1, key: 'note', value: 'original' };
  const id = result(await worker.send(put), original);
  result(await worker.send({ ...put, value: 'later', requestId: 'save-two' }), { revision: 2, key: 'note', value: 'later' }, id);
  const remove = { type: 'remove', key: 'note', requestId: 'delete-one' };
  result(await worker.send(remove), { revision: 3, key: 'note', removed: true }, id);
  result(await worker.send(put), original, id);
  result(await worker.send({ type: 'get', key: 'note' }), { revision: 3, found: false, value: null }, id);
  worker = initialize(storage);
  const nextId = result(await worker.send(put), original);
  assert.notEqual(id, nextId);
  result(await worker.send(remove), { revision: 3, key: 'note', removed: true }, nextId);
  for (const conflict of [
    { ...put, key: 'other' }, { ...put, value: 'other' },
    { type: 'remove', key: 'note', requestId: put.requestId },
    { type: 'put', key: 'note', value: 'later', requestId: remove.requestId },
  ]) error(await worker.send(conflict), 'request_conflict', nextId);
  result(await worker.send({ type: 'snapshot' }), { revision: 3, entries: [] }, nextId);
  assert.equal(storage.commits, 3, 'duplicates and conflicts perform no storage mutation');
});

test('entry limit allows updates and removals; rejected IDs remain available', async () => {
  const worker = initialize(storageModel());
  for (let index = 0; index < 128; index++) {
    result(await worker.send({ type: 'put', key: `key-${index}`, value: 'v', requestId: `add-${index}` }), {
      revision: index + 1, key: `key-${index}`, value: 'v',
    });
  }
  const blocked = { type: 'put', key: 'overflow', value: 'v', requestId: 'blocked' };
  error(await worker.send(blocked), 'entry_limit');
  result(await worker.send({ type: 'put', key: 'key-0', value: 'updated', requestId: 'update' }), { revision: 129, key: 'key-0', value: 'updated' });
  result(await worker.send({ type: 'remove', key: 'key-1', requestId: 'free' }), { revision: 130, key: 'key-1', removed: true });
  result(await worker.send(blocked), { revision: 131, key: 'overflow', value: 'v' });
  const snapshot = await worker.send({ type: 'snapshot' });
  assert.equal(snapshot.result.revision, 131);
  assert.equal(snapshot.result.entries.length, 128);
});

test('all 256 mutation receipts are retained and duplicates still work at the request limit', async () => {
  const storage = storageModel();
  let worker = initialize(storage);
  const first = { type: 'put', key: 'one-key', value: '0', requestId: 'request-0' };
  for (let index = 0; index < 256; index++) {
    result(await worker.send({ ...first, value: String(index), requestId: `request-${index}` }), {
      revision: index + 1, key: 'one-key', value: String(index),
    });
  }
  error(await worker.send({ type: 'remove', key: 'one-key', requestId: 'new-request' }), 'request_limit');
  result(await worker.send(first), { revision: 1, key: 'one-key', value: '0' });
  error(await worker.send({ ...first, value: 'conflict' }), 'request_conflict');
  worker = initialize(storage);
  result(await worker.send(first), { revision: 1, key: 'one-key', value: '0' });
  error(await worker.send({ type: 'put', key: 'new-key', value: 'v', requestId: 'new-request' }), 'request_limit');
  result(await worker.send({ type: 'get', key: 'one-key' }), { revision: 256, found: true, value: '255' });
  assert.equal(storage.commits, 256);
});

test('acknowledgement waits for one durable state-and-receipt write and messages cannot overtake it', async () => {
  const storage = storageModel();
  const worker = initialize(storage);
  const gate = storage.holdNextWrite();
  const mutation = { type: 'put', key: 'saved', value: 'durable-value', requestId: 'durable-id' };
  let acknowledged = false;
  const save = worker.send(mutation).then(response => { acknowledged = true; return response; });
  const read = worker.send({ type: 'get', key: 'saved' });
  const duplicate = worker.send(mutation);
  await gate.reached;
  assert.equal(acknowledged, false);
  assert.equal(storage.commits, 0);
  assert.deepEqual(storage.disk, {});
  assert.equal(storage.attempts.length, 1);
  const update = storage.attempts[0];
  assert.equal(Object.keys(update).length, 1, 'data and receipt share one storage item');
  assert.ok(JSON.stringify(update).includes('durable-id'));
  assert.ok(JSON.stringify(update).includes('durable-value'));
  gate.release();
  const [saved, found, retried] = await Promise.all([save, read, duplicate]);
  const id = result(saved, { revision: 1, key: 'saved', value: 'durable-value' });
  result(found, { revision: 1, found: true, value: 'durable-value' }, id);
  result(retried, { revision: 1, key: 'saved', value: 'durable-value' }, id);
  assert.equal(storage.commits, 1);
  const afterRestart = initialize(storage);
  result(await afterRestart.send(mutation), { revision: 1, key: 'saved', value: 'durable-value' });
});

test('storage failures acknowledge no mutation, consume no ID and leave the queue usable', async () => {
  const storage = storageModel();
  let worker = initialize(storage);
  storage.failRead = true;
  error(await worker.send({ type: 'snapshot' }), 'storage_failure');
  result(await worker.send({ type: 'put', key: 'kept', value: 'old', requestId: 'old-id' }), { revision: 1, key: 'kept', value: 'old' });
  storage.failWrite = true;
  const mutation = { type: 'put', key: 'kept', value: 'new', requestId: 'retry-id' };
  error(await worker.send(mutation), 'storage_failure');
  result(await worker.send({ type: 'get', key: 'kept' }), { revision: 1, found: true, value: 'old' });
  assert.equal(storage.commits, 1);
  worker = initialize(storage);
  result(await worker.send({ type: 'get', key: 'kept' }), { revision: 1, found: true, value: 'old' });
  result(await worker.send(mutation), { revision: 2, key: 'kept', value: 'new' });
  assert.equal(storage.commits, 2);
  assert.equal(storage.attempts.length, 3);
});
