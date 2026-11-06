import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inventory } from '../analysis/inventory.mjs';
import { canonical, digest, hashBytes, RpmError } from '../common.mjs';
import { CdpConnection } from './cdp.mjs';

export const RUNTIME_PROVIDER = 'rpm-chromium-mv3-v1';
const MAX_ACTIONS = 64, MAX_MESSAGE_BYTES = 16 * 1024;
const kinds = new Set(['message', 'page-reopen', 'worker-stop', 'idle', 'storage-snapshot']);
const own = (value, key) => Object.hasOwn(value, key);
function fail(message) { throw new RpmError('invalid_scenario', message); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

export function validateScenario(input) {
  const value = JSON.parse(canonical(input));
  if (!object(value) || value.schema_version !== 1 || Object.keys(value).some(key => !['schema_version', 'name', 'page', 'actions'].includes(key))) fail('Use a v1 scenario with name, page and actions.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) fail('Scenario name must be 1–200 characters.');
  if (typeof value.page !== 'string' || !/^[a-zA-Z0-9_./-]+\.html?$/u.test(value.page) || value.page.startsWith('/') || value.page.split('/').some(part => !part || part === '.' || part === '..')) fail('Scenario page must be a relative HTML path inside the extension.');
  if (!Array.isArray(value.actions) || !value.actions.length || value.actions.length > MAX_ACTIONS) fail('Use 1–64 scenario actions.');
  const ids = new Set(); let idleMs = 0;
  for (const action of value.actions) {
    if (!object(action) || typeof action.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(action.id) || ids.has(action.id) || !kinds.has(action.kind)) fail('Actions require unique simple IDs and a supported kind.');
    ids.add(action.id);
    const permitted = ['id', 'kind', ...(action.kind === 'message' ? ['message'] : action.kind === 'idle' ? ['milliseconds'] : [])];
    if (Object.keys(action).some(key => !permitted.includes(key))) fail('Unknown action field.');
    if (action.kind === 'message' && (!own(action, 'message') || Buffer.byteLength(canonical(action.message)) > MAX_MESSAGE_BYTES)) fail('Message action requires a JSON value of at most16KiB.');
    if (action.kind === 'idle') {
      if (!Number.isSafeInteger(action.milliseconds) || action.milliseconds < 30000 || action.milliseconds > 60000) fail('Idle interval must be 30000–60000ms.');
      idleMs += action.milliseconds;
    }
  }
  if (idleMs > 120000) fail('Total idle intervals must not exceed120000ms.');
  return value;
}

function check(signal) { if (signal?.aborted) throw new RpmError('request_cancelled', 'Runtime capture was cancelled or reached its total deadline.'); }
function pause(ms, signal) {
  check(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new RpmError('request_cancelled', 'Runtime capture was cancelled or reached its total deadline.')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
async function waitUntil(read, { timeoutMs = 10000, signal, interval = 100 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { check(signal); const value = await read(); if (value) return value; await pause(interval, signal); }
  throw new RpmError('runtime_timeout', 'Expected Chromium state was not observed before the deadline.');
}
function waitForExit(child, milliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); child.removeListener('exit', done); resolve(); };
    const timer = setTimeout(done, milliseconds); child.once('exit', done);
  });
}
export async function runtimeDoctor(executablePath) {
  if (typeof executablePath !== 'string' || !isAbsolute(executablePath) || executablePath.includes('\0')) throw new RpmError('browser_required', 'Provide an absolute Chromium/Chrome for Testing executable path.');
  const path = await realpath(executablePath); const stat = await lstat(path);
  if (!stat.isFile()) throw new RpmError('browser_required', 'Browser executable must be a regular local file.');
  return { provider: RUNTIME_PROVIDER, executable: path, node: process.version, websocket: typeof globalThis.WebSocket === 'function', supported: typeof globalThis.WebSocket === 'function', note: 'Filesystem prerequisite only. A successful actual capture is required to verify this browser build.' };
}

/** Executes an explicitly selected extension in a disposable profile. This is not an OS/network sandbox. */
export async function captureMv3({ extensionPath, executablePath, scenario: input, timeoutMs = 180000, signal, onProgress } = {}) {
  const scenario = validateScenario(input); const doctor = await runtimeDoctor(executablePath);
  if (!doctor.supported) throw new RpmError('browser_required', 'This runtime requires Node with built-in WebSocket support (Node22+).');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 240000) throw new RpmError('runtime_bounds', 'Runtime deadline must be5000–240000ms.');
  const source = await inventory(extensionPath);
  if (source.inputFile || !source.files.has('manifest.json') || !source.files.has(scenario.page)) throw new RpmError('runtime_target', 'Select an extracted extension directory containing manifest.json and the scenario page.');
  let manifest;
  try { manifest = JSON.parse(source.files.get('manifest.json').bytes.toString('utf8')); } catch { throw new RpmError('runtime_target', 'Extension manifest must contain JSON.'); }
  if (manifest.manifest_version !== 3 || typeof manifest.background?.service_worker !== 'string' || !source.files.has(manifest.background.service_worker)) throw new RpmError('runtime_target', 'Runtime provider requires a Manifest V3 worker present inside the selected artifact.');
  const providerSha = digest(await Promise.all(['mv3.mjs', 'cdp.mjs'].map(async file => ({ file, sha256: hashBytes(await readFile(new URL(file, import.meta.url))) }))));
  const verifierSha = hashBytes(await readFile(new URL('../verification.mjs', import.meta.url)));
  const scratch = await mkdtemp(join(tmpdir(), 'rpm-runtime-')); const extension = join(scratch, 'extension'), profile = join(scratch, 'profile');
  await mkdir(extension); await mkdir(profile);
  const control = new AbortController(); const externalAbort = () => control.abort(); signal?.addEventListener('abort', externalAbort, { once: true });
  const deadline = setTimeout(() => control.abort(), timeoutMs); if (signal?.aborted) control.abort();
  const started = new Date().toISOString(); const events = [], lifecycle = [], unknowns = [], cases = [];
  let child, connection, sessionId, pageId, extensionId, browserVersion, complete = true, stderr = '', failure = null;
  const cleanup = { browser_terminated: true, profile_removed: false };
  const event = (kind, detail) => { if (events.length >= 2000) throw new RpmError('runtime_bounds', 'Runtime event budget exceeded.'); events.push({ index: events.length, kind, ...detail }); };
  const progress = phase => { if (onProgress) onProgress({ phase, completed_actions: cases.length, total_actions: scenario.actions.length }); };
  const versions = new Map();
  async function evaluate(expression) {
    const response = await connection.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (response.exceptionDetails || response.result?.subtype === 'error') throw new RpmError('runtime_evaluation', 'The extension page could not complete the selected action.', { description: String(response.exceptionDetails?.text || response.result?.description || '').slice(0, 500) });
    if (!own(response.result || {}, 'value')) throw new RpmError('runtime_result', 'The selected action returned no serializable value.');
    const value = response.result.value;
    if (Buffer.byteLength(canonical(value)) > 256 * 1024) throw new RpmError('runtime_bounds', 'Extension result exceeded256KiB.');
    return value;
  }
  async function message(payload) {
    return evaluate(`new Promise(resolve => { chrome.runtime.sendMessage(JSON.parse(${JSON.stringify(JSON.stringify(payload))}), value => { const error = chrome.runtime.lastError; resolve(error ? {__rpm_transport_error: error.message} : (value === undefined ? {__rpm_transport_error: 'No response'} : value)); }); })`);
  }
  async function boot() {
    const value = await message({ type: 'boot' });
    if (!object(value) || value.ok !== true || typeof value.boot_id !== 'string' || !value.boot_id || value.boot_id.length > 200 || value.result?.protocol !== 'rpm-kv-v1') throw new RpmError('runtime_protocol', 'The extension must expose the documented rpm-kv-v1 boot receipt.');
    return value.boot_id;
  }
  async function openPage() {
    const page = await connection.send('Target.createTarget', { url: `chrome-extension://${extensionId}/${scenario.page}` }); pageId = page.targetId;
    ({ sessionId } = await connection.send('Target.attachToTarget', { targetId: pageId, flatten: true }));
    let last;
    try {
      await waitUntil(async () => {
        try { last = await evaluate(`({ready:document.readyState, runtime:globalThis.chrome?.runtime?.id || null, url:location.href})`); return last.ready === 'complete' && last.runtime; } catch (error) { last = { error: error.message, details: error.details }; return false; }
      }, { signal: control.signal });
    } catch (error) { throw new RpmError(error.code || 'runtime_page', 'Extension scenario page did not become ready.', { page: scenario.page, last }); }
  }
  try {
    for (const file of source.entries) { const destination = join(extension, file.path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, file.bytes, { flag: 'wx' }); }
    check(control.signal); progress('launch');
    child = spawn(doctor.executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child.on('error', error => { failure = new RpmError('browser_launch', String(error.message).slice(0, 500)); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
    const active = await waitUntil(async () => {
      if (failure) throw failure;
      if (child.exitCode !== null || child.signalCode !== null) throw new RpmError('browser_launch', 'Disposable Chromium exited before debugging became available.', { exit_code: child.exitCode, signal: child.signalCode, stderr: stderr.slice(-2000) });
      try { const lines = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); return /^\d+$/u.test(lines[0]) && lines[1]?.startsWith('/devtools/browser/') ? lines : null; } catch { return null; }
    }, { signal: control.signal, timeoutMs: 20000 });
    connection = await CdpConnection.connect(`ws://127.0.0.1:${active[0]}${active[1]}`, { signal: control.signal });
    browserVersion = await connection.send('Browser.getVersion');
    const worker = await waitUntil(async () => (await connection.send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\//u.test(target.url) && new URL(target.url).pathname === `/${manifest.background.service_worker}`), { signal: control.signal });
    extensionId = new URL(worker.url).hostname;
    await openPage();
    const loadedManifest = await evaluate('chrome.runtime.getManifest()');
    if (Object.entries(manifest).some(([key, value]) => !own(loadedManifest, key) || canonical(loadedManifest[key]) !== canonical(value))) throw new RpmError('runtime_identity', 'The loaded extension manifest does not match the admitted snapshot.');
    const initialBoot = await boot(); event('boot', { boot_id: initialBoot, stage: 'initial' });
    let currentBoot = initialBoot;
    connection.on('ServiceWorker.workerVersionUpdated', params => { for (const version of params.versions || []) { if (versions.size < 128 || versions.has(version.versionId)) versions.set(version.versionId, version); } });
    progress('capture');
    for (const action of scenario.actions) {
      check(control.signal); const input = structuredClone(action); let output, actionComplete = true;
      if (action.kind === 'message') {
        const response = await message(action.message);
        if (!object(response) || typeof response.boot_id !== 'string' || own(response, '__rpm_transport_error')) throw new RpmError('runtime_protocol', 'Message response must include the documented boot_id.', { action_id: action.id });
        currentBoot = response.boot_id; output = { ...response }; delete output.boot_id;
        event('message-response', { action_id: action.id, request: action.message, response });
      } else if (action.kind === 'storage-snapshot') {
        output = await evaluate('chrome.storage.local.get(null)'); event('storage-local', { action_id: action.id, value: output });
      } else if (action.kind === 'page-reopen') {
        const before = currentBoot; await connection.send('Target.closeTarget', { targetId: pageId }); await openPage(); const after = await boot(); currentBoot = after;
        output = { reset: 'page-reopen', reopened: true }; lifecycle.push({ action_id: action.id, reset: 'page-reopen', before_boot_id: before, after_boot_id: after, boot_changed: before !== after, qualified: true });
      } else {
        const before = await boot(); let stopped = false, absentBeforeWake = false;
        if (action.kind === 'worker-stop') {
          await connection.send('ServiceWorker.enable', {}, sessionId);
          const version = await waitUntil(() => [...versions.values()].find(value => value.scriptURL === `chrome-extension://${extensionId}/${manifest.background.service_worker}` && value.runningStatus === 'running'), { signal: control.signal, timeoutMs: 5000 });
          await connection.send('ServiceWorker.stopWorker', { versionId: version.versionId }, sessionId);
          await waitUntil(() => versions.get(version.versionId)?.runningStatus === 'stopped', { signal: control.signal, timeoutMs: 10000 }); stopped = true;
          await connection.send('ServiceWorker.disable', {}, sessionId);
        } else {
          // No worker evaluation, message, debugger attachment or polling in this interval.
          await pause(action.milliseconds, control.signal);
          absentBeforeWake = !(await connection.send('Target.getTargets')).targetInfos.some(target => target.type === 'service_worker' && target.url === `chrome-extension://${extensionId}/${manifest.background.service_worker}`);
        }
        const after = await boot(); currentBoot = after;
        const qualified = before !== after && (action.kind === 'idle' ? absentBeforeWake : stopped);
        lifecycle.push({ action_id: action.id, reset: action.kind === 'idle' ? 'natural-idle' : 'forced-worker-stop', before_boot_id: before, after_boot_id: after, boot_identity_authority: 'target-reported rpm-kv-v1', boot_changed: before !== after, stopped_observed: stopped, worker_absent_before_wake: absentBeforeWake, idle_ms: action.milliseconds || null, worker_debugger_attached: false, qualified });
        output = { reset: action.kind === 'idle' ? 'natural-idle' : 'forced-worker-stop', qualified };
        if (!qualified) { actionComplete = false; complete = false; unknowns.push({ code: 'restart_not_observed', action_id: action.id, detail: 'The requested reset did not produce distinct boot receipts; persistence across that reset is unverified.' }); }
      }
      cases.push({ id: action.id, input, output, state: null, effects: [], complete: actionComplete });
      progress('capture');
    }
  } catch (error) {
    complete = false; failure = error; unknowns.push({ code: error.code || 'runtime_failed', detail: String(error.message).slice(0, 1000), after_actions: cases.length });
  } finally {
    clearTimeout(deadline); signal?.removeEventListener('abort', externalAbort);
    connection?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await waitForExit(child, 2000);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await waitForExit(child, 2000); }
    }
    cleanup.browser_terminated = !child || child.exitCode !== null || child.signalCode !== null;
    try { await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); cleanup.profile_removed = true; }
    catch { complete = false; unknowns.push({ code: 'runtime_cleanup', detail: 'Temporary profile cleanup failed; remove the retained temporary directory.', path: scratch }); }
    if (!cleanup.browser_terminated) { complete = false; unknowns.push({ code: 'runtime_cleanup', detail: 'Browser termination was not confirmed.', pid: child.pid }); }
  }
  const toolchain = { provider: RUNTIME_PROVIDER, provider_sha256: providerSha, browser: browserVersion || null, node: process.version, platform: process.platform, architecture: process.arch };
  const bindings = { target_sha256: source.sha256, scenario_sha256: digest(scenario), reset_sha256: digest({ profile: 'fresh-disposable', resets: scenario.actions.filter(action => action.kind !== 'message' && action.kind !== 'storage-snapshot') }), toolchain_sha256: digest(toolchain), verifier_sha256: verifierSha };
  const receipt = { schema_version: 1, complete, bindings, cases };
  return { schema_version: 1, kind: 'runtime-capture', complete, receipt, events, lifecycle, unknowns,
    provenance: { authority: 'provider-captured', session_id: randomUUID(), started_at: started, finished_at: new Date().toISOString(), toolchain, target: { sha256: source.sha256, file_count: source.entries.length }, scenario, extension_id: extensionId || null, execution: 'Explicit local extension execution in a fresh disposable Chromium profile; not an OS or network sandbox.', instrumentation: 'Page Runtime domain only; no service-worker debugger attached. ServiceWorker domain enabled only for forced-stop actions.', observables: 'Declared message outputs (top-level boot_id retained separately as runtime evidence), explicit storage-local snapshots and qualified reset outcomes. state:null/effects:[] do not attest unobserved side effects.', cleanup },
    ...(failure ? { failure: { code: failure.code || 'runtime_failed', message: String(failure.message).slice(0, 1000), details: failure.details || {} } } : {}),
  };
}
