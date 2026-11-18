import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceMap } from 'node:module';
import { digest, hashBytes } from '../../../lib/common.mjs';
import { captureWebScenario } from '../../../lib/runtime/web.mjs';

const serverModule = fileURLToPath(new URL('server.mjs', import.meta.url));
const expectedValue = 'violet';
const browser = process.env.RPM_BROWSER_EXECUTABLE;
if (!browser) throw new Error('Set RPM_BROWSER_EXECUTABLE to an absolute Chromium executable.');

async function runPhase(mode, storage, actions) {
  const child = fork(serverModule, [mode, storage], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const serverObservations = [];
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('The loopback fixture did not start in 5 seconds.'));
    }, 5_000);
    child.on('message', message => {
      if (message.kind === 'ready') { clearTimeout(timeout); resolve(message); }
      else if (message.kind === 'operation') serverObservations.push(message.row);
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Fixture child exited: ' + code)); });
  });
  try {
    if (digest(ready.build) !== ready.build_sha256) throw new Error('Unexpected fixture build digest.');
    let mappedSource;
    for (const [path, sha] of Object.entries(ready.build.file_sha256)) {
      const response = await fetch(new URL(path, ready.url), { signal: globalThis.AbortSignal.timeout(5000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok || hashBytes(bytes) !== sha) throw new Error('Fixture served bytes outside its build manifest.');
      if (path === '/app.mjs.map') mappedSource = new SourceMap(JSON.parse(bytes.toString('utf8')));
    }
    const capture = await captureWebScenario({
      executablePath: browser, timeoutMs: 20_000,
      scenario: { schema_version: 1, name: 'Preference recovery lab', url: ready.url, actions, network: { correlation: true } },
    });
    if (!capture.complete) throw new Error('Browser did not finish this finite phase: ' + JSON.stringify(capture.failure ?? capture.unknowns));
    const browserOperations = capture.receipt.cases.flatMap(action => {
      if (!action.network.complete) throw new Error('Incomplete browser network observation for ' + action.id);
      return action.network.requests.map(row => ({ ...row, action_id: action.id }));
    });
    const joins = browserOperations.map(operation => {
      const matches = serverObservations.filter(row => row.operation_id === operation.operation_id &&
        row.session_id === ready.session_id && row.build_sha256 === ready.build_sha256 &&
        row.method === operation.method && row.path === operation.path && row.status === operation.status);
      const location = operation.source;
      const entry = location?.path === '/app.mjs' && mappedSource?.findEntry(location.line, location.column);
      if (matches.length !== 1 || operation.outcome !== 'finished' || entry?.originalSource !== 'preferences.mjs') {
        throw new Error('Operation cannot be linked to a unique server receipt and the fixture source map: ' + JSON.stringify(operation));
      }
      return {
        browser: operation,
        server: matches[0],
        source: { path: entry.originalSource, line: entry.originalLine + 1 },
      };
    });
    if (serverObservations.length !== joins.length || new Set(joins.map(row => row.server.operation_id)).size !== joins.length) {
      throw new Error('Browser and server operation evidence is incomplete.');
    }
    return {
      browser: capture.provenance.toolchain,
      browser_session_id: capture.provenance.session_id,
      server_session_id: ready.session_id,
      build_sha256: ready.build_sha256,
      bundle_sha256: ready.build.file_sha256['/app.mjs'],
      map_sha256: ready.build.file_sha256['/app.mjs.map'],
      receipts_in_response_order: serverObservations.map(row => row.operation_id),
      observations: capture.receipt.cases.map(action => ({ id: action.id, text: action.output.text })),
      joins,
    };
  } finally {
    const exited = new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once('exit', resolve);
    });
    child.kill();
    await exited;
  }
}

const scratch = await mkdtemp(join(tmpdir(), 'rpm-web-persistence-'));
try {
  const cases = [];
  for (const mode of ['reference', 'recovered', 'stale']) {
    const storage = join(scratch, mode + '.json');
    const write = await runPhase(mode, storage, [
      { id: 'save', kind: 'click', selector: '#save' },
      { id: 'race', kind: 'click', selector: '#race' },
      { id: 'settle-writes', kind: 'wait', milliseconds: 650 },
    ]);
    const read = await runPhase(mode, storage, [
      { id: 'read', kind: 'click', selector: '#read' },
      { id: 'settle-read', kind: 'wait', milliseconds: 200 },
    ]);
    const stored = read.joins[0]?.server;
    const readText = read.observations.at(-1)?.text.split('\n').includes(expectedValue);
    const restarted = write.server_session_id !== read.server_session_id &&
      write.browser_session_id !== read.browser_session_id && write.build_sha256 === read.build_sha256;
    const revisionInResponseOrder = write.receipts_in_response_order.map(id => write.joins.find(row => row.server.operation_id === id).server.revision);
    const latestWins = write.joins.find(row => row.server.revision === 3)?.server.disposition === 'written' &&
      write.joins.find(row => row.server.revision === 2)?.server.disposition === 'ignored';
    const oldResponseArrivedLast = revisionInResponseOrder.indexOf(3) !== -1 &&
      revisionInResponseOrder.indexOf(3) < revisionInResponseOrder.indexOf(2);
    const verdict = restarted && oldResponseArrivedLast && latestWins && stored?.value === expectedValue &&
      stored.revision === 3 && readText ? 'pass' : 'fail';
    cases.push({ mode, verdict, restarted, oldResponseArrivedLast, revision_in_response_order: revisionInResponseOrder, write, read });
  }
  const [reference, recovered, stale] = cases;
  const provedDefect = stale.restarted && stale.oldResponseArrivedLast &&
    stale.write.joins.length === 3 && stale.read.joins[0]?.server.status === 404;
  const status = reference.verdict === 'pass' && recovered.verdict === 'pass' && stale.verdict === 'fail' && provedDefect ? 'pass' : 'fail';
  console.log(JSON.stringify({ kind: 'web-persistence-lab', status, cases }, null, 2));
  if (status !== 'pass') process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
