import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { SessionStore } from '../skills/rea-pro-max/lib/mcp/store.mjs';
import { MCP_LIMITS } from '../skills/rea-pro-max/lib/mcp/policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'skills/rea-pro-max/scripts/mcp-server.mjs');
const fixture = join(root, 'skills/rea-pro-max/assets/labs/mv3/reference');
const hash = char => char.repeat(64);
const names = ['get_capabilities', 'inspect_artifact', 'read_artifact', 'create_case', 'revise_case', 'record_observation', 'rank_probes', 'verify_behavior', 'export_artifact', 'run_owned_lab', 'list_task_prompts', 'import_case'];
function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'rpm-mcp-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(fixture, join(directory, 'target'), { recursive: true }); return directory;
}
async function connect(t, directory, modern = false) {
  const client = new Client({ name: 'rea-pro-max-test', version: '0.0.0' }, modern ? { versionNegotiation: { mode: 'auto' } } : {});
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, '--workspace', directory], cwd: tmpdir(), stderr: 'pipe', maxBufferSize: 4 * 1024 * 1024 });
  let diagnostic = ''; transport.stderr?.on('data', chunk => { diagnostic += chunk.toString(); });
  await client.connect(transport);
  t.after(async () => { await client.close(); assert.equal(diagnostic, ''); });
  return client;
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(result.structuredContent); assert.ok(Buffer.byteLength(JSON.stringify(result.structuredContent)) <= MCP_LIMITS.maxResponseBytes);
  return result.structuredContent;
}
const save = (directory, name, data) => writeFileSync(join(directory, name), JSON.stringify(data));
function behavior(target = 'a') {
  return { schema_version: 1, bindings: { target_sha256: hash(target), scenario_sha256: hash('b'), reset_sha256: hash('c'), toolchain_sha256: hash('d'), verifier_sha256: hash('e') }, complete: true, cases: [{ id: 'persist', input: { text: 'Café · 東京' }, output: { saved: true }, state: ['Café · 東京'], effects: [] }] };
}

for (const modern of [false, true]) test(`real stdio lists the exact catalog and validates schema (${modern ? 'modern' : 'legacy'})`, async t => {
  const directory = workspace(t); const client = await connect(t, directory, modern);
  assert.equal(Boolean(client.getDiscoverResult()), modern);
  assert.equal(client.getServerVersion().version, '0.2.0');
  assert.match(client.getInstructions().slice(0, 512), /host agent implements/u);
  const catalog = await client.listTools(); assert.deepEqual(catalog.tools.map(tool => tool.name).sort(), names.toSorted());
  for (const tool of catalog.tools) { assert.equal(tool.inputSchema.type, 'object'); assert.equal(tool.inputSchema.additionalProperties, false); }
  const caps = await call(client, 'get_capabilities');
  assert.equal(caps.transport, 'stdio'); assert.equal(caps.execution_policy.target_execution, false); assert.equal(caps.execution_policy.arbitrary_oracle, false);
  assert.equal(caps.limits.maxInputBufferBytes, 4 * 1024 * 1024);
  const rejected = await client.callTool({ name: 'read_artifact', arguments: { handle: 'unknown', limit: 51 } });
  assert.equal(rejected.isError, true);
  const missing = await client.callTool({ name: 'read_artifact', arguments: { handle: 'unknown' } });
  assert.equal(missing.isError, true); assert.equal(missing.structuredContent.error.code, 'unknown_handle');
});

test('inspection, pages, revisioned cases and conservative observed plans flow through actual MCP calls', async t => {
  const directory = workspace(t); const client = await connect(t, directory);
  const inspected = await call(client, 'inspect_artifact', { path: 'target' });
  assert.equal(inspected.kind, 'inspection'); assert.equal(inspected.summary.artifact.kind, 'manifest-v3');
  assert.ok(inspected.summary.counts.evidence > 0); assert.equal(inspected.nodes, undefined);
  const page = await call(client, 'read_artifact', { handle: inspected.handle, section: 'evidence', limit: 1 });
  assert.equal(page.items.length, 1); assert.ok(page.items[0].sha256); assert.equal(page.next_offset, page.total > 1 ? 1 : null);
  const context = await call(client, 'read_artifact', { handle: inspected.handle, section: 'contexts', query: 'service-worker' });
  assert.ok(context.items.length > 0); assert.ok(context.items.every(item => item.kind === 'service-worker'));
  const initial = await call(client, 'create_case', { inspection_handle: inspected.handle, goal: 'Find the clip persistence mechanism', capabilities: ['owned-model'] });
  const patch = {
    hypotheses: [{ id: 'memory', label: 'Volatile worker', predictions: { restart: 'lost' } }, { id: 'local', label: 'Persistent storage', predictions: { restart: 'retained' } }, { id: 'unknown', label: 'Another mechanism', predictions: { restart: null } }],
    probes: [{ id: 'restart', label: 'Restart owned worker', cost: 2, requires: ['owned-model'], effects: [], reset: 'Fresh owned storage', steps: ['Save', 'Restart', 'Read'] }],
  };
  const revised = await call(client, 'revise_case', { case_handle: initial.handle, expected_revision: 1, patch }); assert.equal(revised.summary.revision, 2);
  const bindings = { target_sha256: inspected.summary.artifact.sha256, scenario_sha256: hash('b'), reset_sha256: hash('c'), toolchain_sha256: hash('d') };
  const planned = await call(client, 'rank_probes', { case_handle: initial.handle, bindings, budget: 2 });
  assert.equal(planned.summary.next_probe_id, 'restart');
  const observation = { probe_id: 'restart', outcome: 'retained', source: 'Owned model report', authority: 'reported', bindings, partial: false };
  const observed = await call(client, 'record_observation', { case_handle: initial.handle, expected_revision: 2, observation }); assert.equal(observed.summary.revision, 3);
  const receipts = await call(client, 'read_artifact', { handle: initial.handle, section: 'observations' }); assert.equal(receipts.items[0].authority, 'reported');
  const filtered = await call(client, 'rank_probes', { case_handle: initial.handle, bindings, budget: 2 });
  assert.deepEqual(filtered.summary.surviving_ids, ['local', 'unknown']); assert.equal(filtered.summary.status, 'no_discriminating_probe');
  const exportResult = await call(client, 'export_artifact', { handle: initial.handle, output_path: 'saved-case.json', format: 'json' });
  assert.equal(exportResult.path, 'saved-case.json'); const document = JSON.parse(readFileSync(join(directory, exportResult.path), 'utf8'));
  assert.equal(document.revision, 3); assert.equal(document.target.sha256, bindings.target_sha256);
  const imported = await call(client, 'import_case', { path: 'saved-case.json' }); assert.notEqual(imported.handle, initial.handle); assert.equal(imported.summary.revision, 3);
  const html = await call(client, 'export_artifact', { handle: filtered.handle, output_path: 'plan.html', format: 'html' });
  const markup = readFileSync(join(directory, html.path), 'utf8'); const embedded = markup.match(/<script type="application\/json" id="rpm-data">([\s\S]*?)<\/script>/u);
  const payload = JSON.parse(embedded[1]); assert.equal(payload.case.revision, 3); assert.deepEqual(payload.planner.surviving_ids, ['local', 'unknown']);
});

test('finite pass, fail and unknown remain successful domain results across the protocol', async t => {
  const directory = workspace(t); const client = await connect(t, directory, true); save(directory, 'reference.json', behavior());
  for (const status of ['pass', 'fail', 'unknown']) {
    const candidate = behavior('f');
    if (status === 'fail') candidate.cases[0].state = [];
    if (status === 'unknown') candidate.complete = false;
    save(directory, 'candidate.json', candidate);
    const result = await call(client, 'verify_behavior', { reference_path: 'reference.json', candidate_path: 'candidate.json' });
    assert.equal(result.summary.status, status); assert.ok(result.summary.receipt_sha256.reference);
  }
});

test('owned lab delivers real kernel artifacts and task prompts paginate with explicit scope', async t => {
  const directory = workspace(t); const client = await connect(t, directory);
  const lab = await call(client, 'run_owned_lab'); assert.equal(lab.summary.verification, 'fail');
  assert.equal(lab.summary.reduction.retained_actions, 3); assert.equal(lab.summary.reduction.minimality, 'one-minimal');
  const reduced = await call(client, 'read_artifact', { handle: lab.handle, section: '/reduction/sequence' });
  assert.deepEqual(reduced.items.map(action => action.type), ['save', 'restart', 'read']);
  const output = await call(client, 'export_artifact', { handle: lab.handle, output_path: 'owned-lab.html', format: 'html' }); assert.ok(output.bytes > 1000);
  const first = await call(client, 'list_task_prompts', { target: 'mv3', limit: 2 });
  assert.equal(first.catalog_total, 36); assert.equal(first.items.length, 2); assert.equal(first.next_offset, 2);
  const next = await call(client, 'list_task_prompts', { target: 'mv3', offset: first.next_offset, limit: 2 });
  assert.equal(next.items.every(item => item.target === 'mv3'), true); assert.notEqual(next.items[0].id, first.items[0].id);
});

test('large records remain pageable without claiming a whole-record response', async t => {
  const directory = workspace(t); const client = await connect(t, directory);
  const inspected = await call(client, 'inspect_artifact', { path: 'target' }); const initial = await call(client, 'create_case', { inspection_handle: inspected.handle, goal: 'Large declared model' });
  const target = { ...initial.summary.target, notes: Array.from({ length: 100 }, (_, index) => `${index} ` + 'An owned metadata record. '.repeat(38)) };
  await call(client, 'revise_case', { case_handle: initial.handle, expected_revision: 1, patch: { target } });
  const full = await client.callTool({ name: 'read_artifact', arguments: { handle: initial.handle, section: 'full' } }); assert.equal(full.isError, true); assert.equal(full.structuredContent.error.code, 'response_bounds');
  const first = await call(client, 'read_artifact', { handle: initial.handle, section: '/target/notes', limit: 50 });
  const second = await call(client, 'read_artifact', { handle: initial.handle, section: '/target/notes', offset: first.next_offset, limit: 50 });
  assert.equal(first.returned + second.returned, 100); assert.equal(second.next_offset, null);
});

test('MCP model budgets reject oversized revisions/imports without changing the existing case', async t => {
  const directory = workspace(t); const client = await connect(t, directory);
  const inspected = await call(client, 'inspect_artifact', { path: 'target' }); const initial = await call(client, 'create_case', { inspection_handle: inspected.handle, goal: 'Bound an explicit model' });
  const patches = [
    { hypotheses: Array.from({ length: 33 }, (_, index) => ({ id: `h${index}`, label: 'Declared alternative', predictions: {} })) },
    { probes: [{ id: 'p', label: 'Owned probe', cost: 1, requires: [], effects: [], reset: 'Empty owned state', steps: Array.from({ length: 65 }, (_, index) => `Read owned state ${index}`) }] },
    { target: { ...initial.summary.target, metadata: 'x'.repeat(1024 * 1024) } },
  ];
  for (const patch of patches) {
    const result = await client.callTool({ name: 'revise_case', arguments: { case_handle: initial.handle, expected_revision: 1, patch } });
    assert.equal(result.isError, true); assert.equal(result.structuredContent.error.code, 'model_bounds');
    assert.equal((await call(client, 'read_artifact', { handle: initial.handle })).summary.revision, 1);
  }
  const record = (await call(client, 'read_artifact', { handle: initial.handle, section: 'full' })).data;
  record.hypotheses = patches[0].hypotheses; save(directory, 'oversized-case.json', record);
  const imported = await client.callTool({ name: 'import_case', arguments: { path: 'oversized-case.json' } });
  assert.equal(imported.isError, true); assert.equal(imported.structuredContent.error.code, 'model_bounds');
  assert.equal((await call(client, 'read_artifact', { handle: initial.handle })).summary.revision, 1);
});

test('concurrent real inspections have a bounded heavy-work admission limit and recover after busy errors', async t => {
  const directory = workspace(t); const client = await connect(t, directory);
  const results = await Promise.all(Array.from({ length: 12 }, () => client.callTool({ name: 'inspect_artifact', arguments: { path: 'target' } })));
  const busy = results.filter(result => result.isError && result.structuredContent?.error?.code === 'server_busy');
  assert.ok(busy.length > 0); assert.ok(results.some(result => !result.isError));
  assert.equal(results.every(result => !result.isError || result.structuredContent?.error?.code === 'server_busy'), true);
  const caps = await call(client, 'get_capabilities'); assert.equal(caps.limits.maxConcurrentHeavy, 2);
  assert.match(caps.cache.measurement, /excludes in-flight/u);
  const next = await call(client, 'inspect_artifact', { path: 'target' }); assert.ok(next.handle);
});

test('session cache evicts oldest artifacts and failed oversized replacement retains the old value', () => {
  const limits = { ...MCP_LIMITS, maxArtifacts: 2, maxCacheBytes: 1000 }; const store = new SessionStore(limits);
  const oldest = store.put('case', { revision: 1 }), retained = store.put('case', { revision: 2 });
  store.put('case', { revision: 3 }); assert.throws(() => store.get(oldest), { code: 'unknown_handle' }); assert.equal(store.get(retained).data.revision, 2);
  assert.throws(() => store.replace(retained, { revision: 4, large: 'x'.repeat(2000) }), { code: 'artifact_too_large' });
  assert.equal(store.get(retained).data.revision, 2); assert.ok(store.stats().serialized_json_bytes <= 1000);
  const exported = store.get(retained); exported.data.revision = 99; assert.equal(store.get(retained).data.revision, 2);
});

test('standalone entry fails promptly with missing workspace and exits on stdin EOF', t => {
  const directory = workspace(t);
  const invalid = spawnSync(process.execPath, [entry], { encoding: 'utf8', timeout: 10000 }); assert.equal(invalid.status, 1); assert.equal(invalid.stdout, ''); assert.equal(JSON.parse(invalid.stderr).error, 'arguments');
  const eof = spawnSync(process.execPath, [entry, '--workspace', directory], { input: '', encoding: 'utf8', timeout: 10000 }); assert.equal(eof.status, 0); assert.equal(eof.stdout, ''); assert.equal(eof.stderr, '');
});


test('MCP current bindings follow the revised case target before historical observations are applied', async t => {
  const directory = workspace(t); const client = await connect(t, directory);
  const inspected = await call(client,'inspect_artifact',{path:'target'});
  const record = await call(client,'create_case',{inspection_handle:inspected.handle,goal:'Target-bound inference',capabilities:['owned-model']});
  const patch = {hypotheses:[{id:'memory',label:'Memory',predictions:{restart:'lost'}},{id:'local',label:'Storage',predictions:{restart:'retained'}}],probes:[{id:'restart',label:'Restart',cost:1,requires:['owned-model'],effects:[],reset:'Empty fixture storage',steps:['Save','Restart','Read']}]};
  await call(client,'revise_case',{case_handle:record.handle,expected_revision:1,patch});
  const bindings={target_sha256:inspected.summary.artifact.sha256,scenario_sha256:hash('b'),reset_sha256:hash('c'),toolchain_sha256:hash('d')};
  await call(client,'record_observation',{case_handle:record.handle,expected_revision:2,observation:{probe_id:'restart',outcome:'retained',source:'Prior target report',authority:'reported',bindings,partial:false}});
  await call(client,'revise_case',{case_handle:record.handle,expected_revision:3,patch:{target:{kind:'manifest-v3',sha256:hash('f')}}});
  const stale=await client.callTool({name:'rank_probes',arguments:{case_handle:record.handle,bindings}});
  assert.equal(stale.isError,true);assert.equal(stale.structuredContent.error.code,'binding_mismatch');
  const current=await call(client,'rank_probes',{case_handle:record.handle,bindings:{...bindings,target_sha256:hash('f')}});
  assert.deepEqual(current.summary.surviving_ids,['local','memory']);
  const ignored=await call(client,'read_artifact',{handle:current.handle,section:'ignored_observations'});assert.equal(ignored.total,1);
});
