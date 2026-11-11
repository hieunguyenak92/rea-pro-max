import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest, hashBytes, RpmError } from '../common.mjs';
import { CdpConnection } from './cdp.mjs';

export const WEB_PROVIDER = 'rpm-chromium-web-v1';
const MAX_ACTIONS = 64, MAX_TEXT = 32 * 1024, MAX_HTML = 512 * 1024;
const kinds = new Set(['navigate', 'click', 'input', 'reload', 'wait']);
const own = (v, k) => Object.hasOwn(v, k);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const fail = message => { throw new RpmError('invalid_web_scenario', message); };

export function validateWebScenario(input) {
  let value;
  try { value = JSON.parse(canonical(input)); } catch { fail('Scenario must be finite JSON.'); }
  if (!object(value) || value.schema_version !== 1 || Object.keys(value).some(key => !['schema_version', 'name', 'url', 'actions'].includes(key))) fail('Use a v1 web scenario with name, url and actions.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) fail('Scenario name must be 1–200 characters.');
  try { const url = new URL(value.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('URL must use http(s) without embedded credentials.'); } catch { fail('URL must be an absolute http(s) address.'); }
  if (!Array.isArray(value.actions) || value.actions.length > MAX_ACTIONS) fail('Use at most64 actions.');
  const ids = new Set();
  for (const action of value.actions) {
    if (!object(action) || typeof action.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(action.id) || ids.has(action.id) || !kinds.has(action.kind)) fail('Actions require unique IDs and a supported kind.');
    ids.add(action.id);
    const allowed = ['id', 'kind', ...(action.kind === 'click' || action.kind === 'input' ? ['selector'] : []), ...(action.kind === 'input' ? ['value'] : []), ...(action.kind === 'navigate' ? ['url'] : []), ...(action.kind === 'wait' ? ['milliseconds'] : [])];
    if (Object.keys(action).some(key => !allowed.includes(key))) fail('Unknown action field.');
    if (['click', 'input'].includes(action.kind) && (typeof action.selector !== 'string' || !action.selector.trim() || action.selector.length > 2000)) fail('Selectors must be bounded nonempty strings.');
    if (action.kind === 'input' && (typeof action.value !== 'string' || action.value.length > 16 * 1024)) fail('Input values must be bounded strings.');
    if (action.kind === 'navigate') { try { const url = new URL(action.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Navigate URLs must use http(s) without credentials.'); } catch { fail('Navigate URL must be absolute http(s).'); } }
    if (action.kind === 'wait' && (!Number.isSafeInteger(action.milliseconds) || action.milliseconds < 0 || action.milliseconds > 30_000)) fail('Wait must be 0–30000 milliseconds.');
  }
  return value;
}

function check(signal) { if (signal?.aborted) throw new RpmError('request_cancelled', 'Web capture was cancelled.'); }
function pause(ms, signal) {
  check(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new RpmError('request_cancelled', 'Web capture was cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
async function waitUntil(read, { signal, timeoutMs = 10_000, interval = 100 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { check(signal); const v = await read(); if (v) return v; await pause(interval, signal); }
  throw new RpmError('runtime_timeout', 'Expected browser state did not arrive before the deadline.');
}
async function doctor(executablePath) {
  if (typeof executablePath !== 'string' || !isAbsolute(executablePath)) throw new RpmError('browser_required', 'Provide an absolute Chromium executable.');
  const path = await realpath(executablePath); const stat = await lstat(path); if (!stat.isFile()) throw new RpmError('browser_required', 'Browser executable must be a regular file.');
  if (typeof globalThis.WebSocket !== 'function') throw new RpmError('browser_required', 'Node22+ built-in WebSocket is required.');
  return path;
}

export async function captureWebScenario({ executablePath, scenario: rawScenario, timeoutMs = 180_000, signal, onProgress } = {}) {
  const scenario = validateWebScenario(rawScenario); const executable = await doctor(executablePath);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 240_000) throw new RpmError('runtime_bounds', 'Web runtime deadline must be5000–240000ms.');
  const scratch = await mkdtemp(join(tmpdir(), 'rpm-web-runtime-')); const profile = join(scratch, 'profile');
  const controller = new AbortController(); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => controller.abort(), timeoutMs); let child, connection, sessionId, targetId, browserVersion = null; let failure = null; let stderr = '';
  const events = [], cases = [], unknowns = [], cleanup = { browser_terminated: true, profile_removed: false };
  const event = (kind, details) => { if (events.length >= 2000) throw new RpmError('runtime_bounds', 'Web event budget exceeded.'); events.push({ index: events.length, kind, ...details }); };
  const progress = phase => onProgress?.({ phase, completed_actions: cases.length, total_actions: scenario.actions.length });
  const evaluate = async expression => {
    const result = await connection.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails || result.result?.subtype === 'error') throw new RpmError('runtime_evaluation', 'The page action failed.', { description: String(result.exceptionDetails?.text || result.result?.description || '').slice(0, 500) });
    if (!own(result.result || {}, 'value')) throw new RpmError('runtime_result', 'The page action returned no serializable value.');
    return result.result.value;
  };
  const snapshot = async () => {
    const value = await evaluate(`({url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,${MAX_TEXT}),html:(document.documentElement?.outerHTML||'').slice(0,${MAX_HTML}),ready:document.readyState,scrollWidth:document.documentElement?.scrollWidth||0,viewportWidth:innerWidth,active:document.activeElement?.getAttribute('aria-label')||document.activeElement?.getAttribute('id')||document.activeElement?.tagName||null})`);
    const screenshot = await connection.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
    const bytes = Buffer.from(screenshot.data || '', 'base64');
    return { ...value, html_truncated: String(value.html || '').length >= MAX_HTML, text_truncated: String(value.text || '').length >= MAX_TEXT, screenshot_sha256: hashBytes(bytes), screenshot_bytes: bytes.length };
  };
  const execute = async action => {
    if (action.kind === 'navigate') { await evaluate(`location.assign(${JSON.stringify(action.url)})`); return; }
    if (action.kind === 'reload') { await connection.send('Page.reload', { ignoreCache: false }, sessionId); return; }
    if (action.kind === 'wait') { await pause(action.milliseconds, controller.signal); return; }
    if (action.kind === 'click') { const sel = JSON.stringify(action.selector); const ok = await evaluate(`(()=>{const e=document.querySelector(${sel}); if(!e) return false; e.click(); return true})()`); if (!ok) throw new RpmError('selector_missing', `No element matched ${action.selector}.`); return; }
    if (action.kind === 'input') { const sel = JSON.stringify(action.selector), val = JSON.stringify(action.value); const ok = await evaluate(`(()=>{const e=document.querySelector(${sel}); if(!e) return false; e.focus(); const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value'); if(d?.set)d.set.call(e,${val}); else e.value=${val}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true})()`); if (!ok) throw new RpmError('selector_missing', `No element matched ${action.selector}.`); }
  };
  try {
    await (await import('node:fs/promises')).mkdir(profile, { recursive: true }); progress('launch');
    child = spawn(executable, ['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio:['ignore','ignore','pipe'], windowsHide:true });
    child.on('error', error => { failure = new RpmError('browser_launch', String(error.message).slice(0,500)); }); child.stderr.on('data', chunk => { stderr=(stderr+chunk.toString()).slice(-16000); });
    const active = await waitUntil(async () => { if (failure) throw failure; if (child.exitCode!==null||child.signalCode!==null) throw new RpmError('browser_launch','Browser exited before debugging.',{stderr:stderr.slice(-2000)}); try { const lines=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n'); return /^\d+$/u.test(lines[0])&&lines[1]?.startsWith('/devtools/browser/')?lines:null; } catch { return null; } }, { signal:controller.signal, timeoutMs:20_000 });
    connection = await CdpConnection.connect(`ws://127.0.0.1:${active[0]}${active[1]}`, { signal: controller.signal }); browserVersion = await connection.send('Browser.getVersion');
    const page = await connection.send('Target.createTarget', { url: scenario.url }); targetId = page.targetId; ({ sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten:true })); await connection.send('Page.enable',{},sessionId); await connection.send('Runtime.enable',{},sessionId);
    await waitUntil(async()=>{ try{return (await evaluate('document.readyState'))==='complete';}catch{return false;} },{signal:controller.signal});
    progress('capture');
    for(const action of scenario.actions){ check(controller.signal); await execute(action); if(action.kind === 'navigate' || action.kind === 'reload') await waitUntil(async()=>{ try { return (await evaluate('document.readyState')) === 'complete'; } catch { return false; } }, { signal: controller.signal, timeoutMs: 20_000 }); await pause(50,controller.signal); const observation=await snapshot(); event('observation',{action_id:action.id,kind:action.kind,observation}); cases.push({id:action.id,input:structuredClone(action),output:{url:observation.url,title:observation.title,text:observation.text,scrollWidth:observation.scrollWidth,viewportWidth:observation.viewportWidth,active:observation.active,screenshot_sha256:observation.screenshot_sha256},state:{url:observation.url,html_sha256:digest(observation.html),local_storage_keys:Object.keys(await evaluate('Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,true]))'))},effects:[],complete:true}); progress('capture'); }
  } catch(error){ failure=error; unknowns.push({code:error.code||'runtime_failed',detail:String(error.message).slice(0,1000),after_actions:cases.length}); }
  finally { clearTimeout(deadline); signal?.removeEventListener('abort',abort); connection?.close(); if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM'); await new Promise(resolve=>{const t=setTimeout(resolve,2000);child.once('exit',()=>{clearTimeout(t);resolve();});}); if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');} cleanup.browser_terminated=!child||child.exitCode!==null||child.signalCode!==null; try{await rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100});cleanup.profile_removed=true;}catch{unknowns.push({code:'runtime_cleanup',path:scratch});} }
  const bindings={target_sha256:digest({url:scenario.url}),scenario_sha256:digest(scenario),reset_sha256:digest({profile:'fresh-disposable'}),toolchain_sha256:digest({provider:WEB_PROVIDER,browser:browserVersion,node:process.version}),verifier_sha256:hashBytes(Buffer.from('web-v1'))};
  const complete=!failure&&unknowns.length===0&&cleanup.browser_terminated&&cleanup.profile_removed; return {schema_version:1,kind:'web-runtime-capture',complete,receipt:{schema_version:1,complete,bindings,cases},events,unknowns,provenance:{authority:'provider-captured',session_id:randomUUID(),started_at:new Date().toISOString(),finished_at:new Date().toISOString(),toolchain:{provider:WEB_PROVIDER,browser:browserVersion,node:process.version,platform:process.platform,architecture:process.arch},scenario,execution:'Explicit local URL execution in fresh disposable Chromium profile; not an OS/network sandbox.',observables:'Bounded DOM/text/layout/storage-key observations and screenshot hashes; raw screenshot pixels are not retained in the receipt.',cleanup},...(failure?{failure:{code:failure.code||'runtime_failed',message:String(failure.message).slice(0,1000),details:failure.details||{}}}:{})};
}
