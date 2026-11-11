import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../assets/recovery-web/', import.meta.url);
const pathFor = relative => new URL(relative, root);
const read = relative => readFileSync(pathFor(relative), 'utf8');
const readJson = relative => JSON.parse(read(relative));
const contract = readJson('contract.json');
const scenario = readJson('scenario.json');
const variants = ['reference', 'starter', 'recovered'];

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function scheduler() {
  const jobs = [];
  return {
    jobs,
    schedule(callback, milliseconds) {
      const job = { callback, milliseconds, cancelled: false };
      jobs.push(job);
      return job;
    },
    cancel(job) { if (job) job.cancelled = true; },
    run(index, { ignoreCancelled = false } = {}) {
      const job = jobs[index];
      assert.ok(job, `missing scheduled job ${index}`);
      if (!job.cancelled || ignoreCancelled) job.callback();
      return job;
    },
  };
}

function apiFor(variant) {
  const context = { console, setTimeout() { throw new Error('tests require a manual scheduler'); }, clearTimeout() {} };
  context.globalThis = context;
  vm.runInNewContext(read(`${variant}/app.js`), context, { timeout: 1000, filename: `${variant}/app.js` });
  assert.ok(context.__rpmWeb, `${variant} did not expose its local model`);
  return context.__rpmWeb;
}

function makeModel(variant, clock, saved = {}) {
  const api = apiFor(variant);
  const model = api.createModel({ storage: saved.storage, schedule: clock.schedule, cancel: clock.cancel });
  return { api, model };
}

function ids(state) { return Array.from(state.results, row => row.id); }

test('owned web manifest, contract and finite scenario are self-contained', () => {
  const manifest = readJson('manifest.json');
  assert.deepEqual(manifest.variants, variants);
  assert.equal(manifest.entry, 'index.html');
  assert.equal(manifest.contract, 'contract.json');
  assert.equal(manifest.scenario, 'scenario.json');
  assert.equal(manifest.network, 'none');
  assert.deepEqual(manifest.runtime.external_dependencies, []);
  assert.deepEqual(contract.storage.value, { query: '', filter: 'all' });
  assert.deepEqual(contract.filters, ['all', 'open', 'done']);
  assert.deepEqual(contract.states, ['ready', 'loading', 'success', 'empty', 'error', 'cancelled']);
  assert.equal(scenario.actions.length, 8);
  for (const action of scenario.actions) {
    assert.equal(typeof action.id, 'string');
    assert.equal(typeof action.kind, 'string');
    assert.ok(action.expected && typeof action.expected === 'object');
  }
  for (const variant of variants) {
    for (const file of manifest.files) {
      const source = read(`${variant}/${file}`);
      assert.doesNotMatch(source, /\bfetch\s*\(/u, `${variant}/${file} must not fetch`);
      assert.doesNotMatch(source, /https?:\/\//u, `${variant}/${file} must not call an external origin`);
    }
  }
});

test('each variant is a responsive, independently stored static app', () => {
  const hashes = variants.map(variant => createHash('sha256').update(read(`${variant}/app.js`)).digest('hex'));
  assert.equal(new Set(hashes).size, variants.length, 'variants should retain separate authored implementations');
  for (const variant of variants) {
    const html = read(`${variant}/index.html`);
    const css = read(`${variant}/style.css`);
    assert.match(html, /meta name="viewport"/u);
    assert.match(css, /@media\s*\(max-width:/u);
    assert.match(html, /id="search"/u);
    assert.match(html, /id="filter"/u);
    assert.match(html, /id="results"/u);
  }
  assert.match(read('reference/index.html'), /<label for="search">Search projects<\/label>/u);
  assert.match(read('recovered/index.html'), /<label for="search">Search projects<\/label>/u);
  assert.doesNotMatch(read('starter/index.html'), /<label for="search">/u);
});

for (const variant of ['reference', 'recovered']) {
  test(`${variant} model satisfies persistence, Unicode, finite states and cancellation`, async () => {
    const clock = scheduler();
    const saved = storage();
    const { model } = makeModel(variant, clock, { storage: saved });
    assert.deepEqual(ids(model.state()), ['alpha', 'bravo', 'charlie', 'delta']);

    const unicode = model.search('ＣＡＦÉ', 'all');
    assert.equal(clock.jobs[0].milliseconds, 45);
    clock.run(0);
    assert.deepEqual(ids(await unicode), ['charlie']);
    assert.equal(model.state().status, 'success');

    const filtered = model.search('ＣＡＦÉ', 'done');
    clock.run(1);
    assert.deepEqual(ids(await filtered), []);
    assert.equal(model.state().status, 'empty');

    const empty = model.search('does-not-exist', 'all');
    clock.run(2);
    assert.equal((await empty).status, 'empty');

    const error = model.search('error', 'all');
    clock.run(3);
    assert.deepEqual((await error).error, 'synthetic_transport');
    assert.equal(model.state().status, 'error');

    const slow = model.search('slow', 'all');
    const cancelled = model.cancel();
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await slow).cancelled, true);
    assert.equal(model.state().status, 'cancelled');

    const persisted = apiFor(variant).createModel({ storage: saved, schedule: clock.schedule, cancel: clock.cancel });
    assert.equal(persisted.state().query, 'slow');
    assert.equal(persisted.state().filter, 'all');
  });

  test(`${variant} ignores a delayed response from an older query`, async () => {
    const clock = scheduler();
    const { model } = makeModel(variant, clock, { storage: storage() });
    const slow = model.search('slow', 'all');
    const latest = model.search('release', 'all');
    assert.equal(clock.jobs.length, 2);
    clock.run(1);
    assert.deepEqual(ids(await latest), ['bravo']);
    clock.run(0, { ignoreCancelled: true });
    assert.deepEqual(ids(model.state()), ['bravo']);
    assert.equal((await slow).cancelled, true);
  });
}

test('starter retains deliberate recovery defects for the before/after fixture', async () => {
  const clock = scheduler();
  const saved = storage();
  const { model } = makeModel('starter', clock, { storage: saved });
  const slow = model.search('slow', 'all');
  const latest = model.search('release', 'all');
  clock.run(1);
  assert.deepEqual(ids(await latest), ['bravo']);
  clock.run(0, { ignoreCancelled: true });
  assert.deepEqual(ids(model.state()), [], 'older slow response wins in the starter');
  assert.equal((await slow).status, 'success');

  const empty = model.search('does-not-exist', 'all');
  clock.run(2);
  assert.equal((await empty).status, 'success', 'starter labels an empty result as success');
  assert.equal(model.state().error, null);

  const reloaded = apiFor('starter').createModel({ storage: saved, schedule: clock.schedule, cancel: clock.cancel });
  assert.equal(reloaded.state().query, '', 'starter does not persist the query');
  assert.doesNotMatch(read('starter/app.js'), /localStorage|rpm-web-filter-v1/u);
  assert.match(read('starter/app.js'), /dataset\.state = 'success'/u);
});

test('scenario expectations name the same finite outcomes the corrected models expose', () => {
  const unicode = scenario.actions.find(action => action.id === 'unicode-search');
  assert.deepEqual(unicode.expected.result_ids, ['charlie']);
  const race = scenario.actions.find(action => action.id === 'latest-wins');
  assert.deepEqual(race.values, ['slow', 'release']);
  assert.deepEqual(race.expected.result_ids, ['bravo']);
  assert.equal(scenario.expected_outcomes.reference, 'all actions satisfy the contract');
  assert.equal(scenario.expected_outcomes.recovered, 'all actions satisfy the contract');
});
