import { createServer } from 'node:http';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest, hashBytes } from '../../../lib/common.mjs';

const [, , mode, suppliedState, requestedPort = '0'] = process.argv;
const modes = ['reference', 'recovered', 'stale'];
if (!modes.includes(mode) || !suppliedState || !/^\d{1,5}$/u.test(requestedPort)) {
  throw new Error('Usage: node server.mjs reference|recovered|stale STATE_FILE [PORT]');
}
const directory = new URL('.', import.meta.url);
const stateFile = resolve(suppliedState);
const content = readFileSync(new URL('preferences.mjs', directory), 'utf8');
// The served build inserts one generated line and embeds an external map.
const bundle = Buffer.from('/* Generated preference fixture */\n' + content + '\n//# sourceMappingURL=/app.mjs.map\n');
const lines = content.trimEnd().split('\n').length;
const sourceMap = Buffer.from(JSON.stringify({
  version: 3, file: 'app.mjs', names: [],
  sources: ['preferences.mjs'], sourcesContent: [content],
  mappings: ';AAAA' + ';AACA'.repeat(lines - 1),
}));
const assets = new Map([
  ['/', { bytes: readFileSync(new URL('index.html', directory)), type: 'text/html; charset=utf-8' }],
  ['/app.mjs', { bytes: bundle, type: 'text/javascript; charset=utf-8' }],
  ['/app.mjs.map', { bytes: sourceMap, type: 'application/json; charset=utf-8' }],
]);
const build = {
  file_sha256: Object.fromEntries([...assets].map(([path, { bytes }]) => [path, hashBytes(bytes)])),
  server_sha256: hashBytes(readFileSync(fileURLToPath(import.meta.url))),
  mode,
};
const build_sha256 = digest(build);
const session_id = randomUUID();

function readState() {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function shouldApply(previous, input) {
  if (mode === 'stale') return false;
  if (mode === 'reference') return previous === null || previous.revision < input.revision;
  return input.revision >= (previous?.revision ?? 0) + 1;
}

function reply(response, status, { method, path, revision, disposition, value } = {}) {
  const row = {
    session_id, build_sha256, operation_id: randomUUID(), method, path, status,
    ...(revision === undefined ? {} : { revision }), disposition,
    ...(value === undefined ? {} : { value }),
  };
  response.setHeader('X-REA-Operation-Id', row.operation_id);
  process.send?.({ kind: 'operation', row });
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(method === 'GET' && status === 200 ? { value } : { accepted: status === 200 }));
}

async function readInput(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024) throw new Error('Request exceeds fixture byte limit.');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!input || typeof input.value !== 'string' || input.value.length > 80 ||
      !Number.isSafeInteger(input.revision) || input.revision < 1 ||
      typeof input.defer !== 'boolean') throw new Error('Invalid preference input.');
  return input;
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const path = request.url;
  const method = request.method;
  const asset = assets.get(path);
  if (method === 'GET' && asset) {
    response.writeHead(200, { 'Content-Type': asset.type }).end(asset.bytes);
    return;
  }
  if (path !== '/api/preferences' || !['GET', 'POST'].includes(method)) {
    response.writeHead(404).end();
    return;
  }
  try {
    if (method === 'GET') {
      const state = readState();
      reply(response, state ? 200 : 404, { method, path, revision: state?.revision, disposition: 'read', value: state?.value });
      return;
    }
    const input = await readInput(request);
    if (input.defer) await new Promise(done => setTimeout(done, 180));
    const apply = shouldApply(readState(), input);
    if (apply) {
      const staged = stateFile + '.tmp';
      writeFileSync(staged, JSON.stringify({ value: input.value, revision: input.revision }));
      renameSync(staged, stateFile);
    }
    reply(response, 200, { method, path, revision: input.revision, disposition: apply ? 'written' : 'ignored' });
  } catch {
    reply(response, 400, { method, path, disposition: 'invalid' });
  }
});
server.once('error', error => { console.error(error.message); process.exitCode = 1; process.disconnect?.(); });
server.listen(Number(requestedPort), '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  if (process.send) process.send({ kind: 'ready', url, session_id, build_sha256, build, source_map: JSON.parse(sourceMap) });
  else console.log(url);
});
process.on('disconnect', () => server.close());
