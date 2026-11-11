import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CraftAnythingProvider, CRAFT_ANYTHING_MANIFEST } from '../skills/rea-pro-max/lib/providers/craft-anything.mjs';
import { MCP_PROTOCOL_VERSION } from '../skills/rea-pro-max/lib/providers/provider.mjs';

const fakeSource = `
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';
const mode = process.argv[2] || 'ok';
const marker = process.argv[3];
if (mode === 'timeout') setTimeout(() => {}, 100000);
if (mode === 'malformed') { process.stdout.write('not-json\\n'); setTimeout(() => {}, 100000); }
if (mode === 'large') { process.stdout.write('x'.repeat(5000)); setTimeout(() => {}, 100000); }
const server = { name: 'craft-anything', version: mode === 'drift' ? '0.5.0' : '0.4.0', commit: '${CRAFT_ANYTHING_MANIFEST.commit}' };
const tools = [{ name: 'js_app_map' }, { name: 'web_site_capture' }, { name: 'app_graphs_compare' }];
const line = readline.createInterface({ input: process.stdin });
line.on('line', raw => {
  let request; try { request = JSON.parse(raw); } catch { return; }
  if (mode === 'timeout') return;
  if (request.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '${MCP_PROTOCOL_VERSION}', capabilities: { tools: {} }, serverInfo: server } }) + '\\n');
  } else if (request.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools } }) + '\\n');
  } else if (request.method === 'tools/call') {
    if (mode === 'provider-error') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { isError: true, content: [{ type: 'text', text: 'fixture failure' }] } }) + '\\n');
    else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { structuredContent: { ok: true, tool: request.params.name, input: request.params.arguments } } }) + '\\n');
    if (mode !== 'hang') process.stdin.pause();
  }
});
process.on('SIGTERM', () => { if (marker) appendFileSync(marker, 'terminated\\n'); process.exit(0); });
`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'rpm-craft-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'fake-provider.mjs');
  await writeFile(script, fakeSource);
  return { root, script };
}

function provider(root, script, mode = 'ok', options = {}) {
  return new CraftAnythingProvider({ executablePath: process.execPath, args: [script, mode, ...(options.marker ? [options.marker] : [])], workspace: root, ...options });
}

test('Craft provider performs pinned MCP handshake, typed tool call and provenance', async t => {
  const { root, script } = await fixture(t);
  const result = await provider(root, script).inspect({ input_path: 'fixture.js' });
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(result.data.structuredContent.tool, 'js_app_map');
  assert.equal(result.data.structuredContent.input.input_path, join(await realpath(root), 'fixture.js'));
  assert.equal(result.provenance.provider.commit, CRAFT_ANYTHING_MANIFEST.commit);
  assert.equal(result.provenance.provider.license, 'MIT OR Apache-2.0');
  assert.equal(result.provenance.cleanup.process_spawned, true);
  assert.equal(result.provenance.cleanup.process_terminated, true);
  assert.equal(result.provenance.cleanup.stdin_closed, true);
  const doctor = await provider(root, script).doctor();
  assert.equal(doctor.status, 'ok');
  assert.deepEqual(doctor.data.capabilities.sort(), ['app_graphs_compare', 'js_app_map', 'web_site_capture']);
});

test('Craft provider fails closed for malformed output and unsupported pinned version', async t => {
  const { root, script } = await fixture(t);
  const malformed = await provider(root, script, 'malformed', { timeoutMs: 500 }).doctor();
  assert.equal(malformed.status, 'unknown');
  assert.equal(malformed.error.code, 'provider_protocol');
  const drift = await provider(root, script, 'drift').doctor();
  assert.equal(drift.status, 'unknown');
  assert.equal(drift.error.code, 'provider_drift');
});

test('Craft provider returns bounded provider errors and cleans up timed out workers', async t => {
  const { root, script } = await fixture(t);
  const marker = join(root, 'terminated.log');
  const timed = await provider(root, script, 'timeout', { timeoutMs: 150, marker }).doctor();
  assert.equal(timed.status, 'provider_error');
  assert.equal(timed.error.code, 'provider_timeout');
  assert.equal(timed.provenance.cleanup.process_terminated, true);
  const failed = await provider(root, script, 'provider-error').inspect({ input_path: 'fixture.js' });
  assert.equal(failed.status, 'provider_error');
  assert.equal(failed.error.code, 'provider_tool');
});

test('Craft provider cancellation is an unknown result with confirmed process cleanup', async t => {
  const { root, script } = await fixture(t);
  const control = new AbortController();
  const pending = provider(root, script, 'timeout', { timeoutMs: 5_000 }).doctor({ signal: control.signal });
  setTimeout(() => control.abort(), 50);
  const result = await pending;
  assert.equal(result.status, 'unknown');
  assert.equal(result.error.code, 'request_cancelled');
  assert.equal(result.provenance.cleanup.process_terminated, true);
});

test('Craft provider bounds stdout before parsing an oversized response', async t => {
  const { root, script } = await fixture(t);
  const result = await provider(root, script, 'large', { maxBytes: 1024 }).doctor();
  assert.equal(result.status, 'unknown');
  assert.equal(result.error.code, 'provider_bounds');
  assert.equal(result.provenance.cleanup.process_terminated, true);
});

test('Craft provider rejects path escapes and arbitrary tool strings before spawning', async t => {
  const { root, script } = await fixture(t);
  assert.throws(() => new CraftAnythingProvider({ executablePath: 'node', workspace: root }), { code: 'provider_path' });
  assert.throws(() => new CraftAnythingProvider({ executablePath: process.execPath, workspace: 'relative' }), { code: 'provider_path' });
  assert.throws(() => new CraftAnythingProvider({ executablePath: process.execPath, workspace: join(root, 'missing') }), { code: 'provider_path' });
  const instance = provider(root, script);
  await assert.rejects(() => instance.execute('shell', {}), { code: 'provider_command' });
  await assert.rejects(() => instance.inspect({ input_path: '../outside.js' }), { code: 'provider_scope' });
});

