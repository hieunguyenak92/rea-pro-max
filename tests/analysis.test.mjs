import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectArtifact } from '../skills/rea-pro-max/lib/analysis/inspect.mjs';

async function fixture(t, files) {
  const folder = await mkdtemp(join(tmpdir(), 'rpm-analysis-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(files)) {
    const path = join(folder, name); await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  }
  return folder;
}
const manifest = { manifest_version: 3, name: 'Owned fixture', version: '1.0.0', permissions: ['storage'], background: { service_worker: 'worker.js' }, action: { default_popup: 'popup.html' }, content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }] };
const extensionFiles = () => ({
  'manifest.json': manifest,
  'worker.js': "let notes = []; chrome.runtime.onMessage.addListener((message, sender, reply) => { if (message.type === 'capture') { chrome.storage.local.set({notes: message.text}); } if (message.type === 'read') reply(notes); });",
  'popup.html': '<script src="popup.js"></script>',
  'popup.js': "const rt = chrome.runtime; rt.sendMessage({type: 'capture', text: location.hash});",
  'content.js': "browser.runtime.sendMessage({type: 'capture', text: document.title});",
});

function operation(result, kind, channel) { return result.nodes.filter(node => node.kind === kind && (channel === undefined || node.channel === channel)); }

test('MV3 contexts and candidate message routes preserve static authority and exact ranges', async t => {
  const folder = await fixture(t, extensionFiles());
  const result = await inspectArtifact(folder);
  assert.equal(result.artifact.kind, 'manifest-v3');
  assert.equal(result.limits.target_executed, false);
  assert.deepEqual(new Set(result.contexts.map(context => context.kind)), new Set(['extension-manifest', 'service-worker', 'popup', 'content-script']));
  assert.equal(operation(result, 'message-send', 'capture').length, 2);
  assert.equal(operation(result, 'message-listener', 'capture').length, 1);
  assert.equal(result.edges.filter(edge => edge.kind === 'candidate-message-route').length, 2);
  assert.ok(result.edges.every(edge => ['candidate', 'declared'].includes(edge.authority)));
  assert.ok(result.findings.some(finding => finding.title.includes('persistence')));
  for (const source of result.evidence) {
    const text = await readFile(join(folder, source.file), 'utf8');
    assert.ok(source.start >= 0 && source.end <= text.length);
    assert.equal(source.line, text.slice(0, source.start).split('\n').length);
    assert.equal(source.range_unit, 'utf16-code-unit');
    assert.match(source.sha256, /^[a-f0-9]{64}$/u);
  }
});

test('same source and channel in isolated and MAIN worlds remain separate contexts', async t => {
  const files = extensionFiles();
  files['manifest.json'] = { ...manifest, content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }, { matches: ['http://127.0.0.1/*'], js: ['content.js'], world: 'MAIN' }] };
  files['content.js'] = "chrome.runtime.onMessage.addListener(message => { if(message.type === 'capture') return true; });";
  files['popup.js'] = "chrome.runtime.sendMessage({type:'capture'}); chrome.tabs.sendMessage(1,{type:'capture'});";
  const result = await inspectArtifact(await fixture(t, files));
  const declarations = result.contexts.filter(context => ['content-script', 'page-world-content'].includes(context.kind));
  assert.equal(declarations.length, 2); assert.notEqual(declarations[0].id, declarations[1].id);
  const routes = result.edges.filter(edge => edge.kind === 'candidate-message-route');
  const byId = new Map(result.nodes.map(node => [node.id, node]));
  for (const route of routes) {
    const sender = byId.get(route.from), receiver = byId.get(route.to);
    const target = result.contexts.find(context => context.id === receiver.context_id);
    if (sender.api.includes('tabs')) assert.equal(target.kind, 'content-script');
    else assert.notEqual(target.kind, 'content-script');
    assert.notEqual(target.kind, 'page-world-content');
  }
});

test('scoped aliases resolve literal calls while shadowed globals and mutable values stay unresolved', async t => {
  const files = extensionFiles();
  files['popup.js'] = "const {runtime: rt}=chrome; const kind='cap'+'ture'; rt.sendMessage({type:kind}); function fake(chrome){ chrome.runtime.sendMessage({type:'bogus'}); } let channel='capture'; browser.runtime.sendMessage({type:channel});";
  const result = await inspectArtifact(await fixture(t, files));
  assert.equal(operation(result, 'message-send', 'capture').length, 2);
  assert.equal(operation(result, 'message-send', 'bogus').length, 0);
  assert.equal(operation(result, 'message-send', null).length, 1);
  assert.ok(result.unknowns.some(item => item.code === 'dynamic_message'));
});

test('self-referential constant messages do not recurse forever', async t => {
  const folder = await fixture(t, { 'input.js': 'const a=b,b=a; chrome.runtime.sendMessage(a);' });
  const result = await inspectArtifact(join(folder, 'input.js'));
  assert.equal(operation(result, 'message-send', null).length, 1);
});

test('artifact inspection parses without executing even explicitly throwing target code', async t => {
  const folder = await fixture(t, { 'input.js': "globalThis.__rpmNeverExecute='executed'; throw new Error('target executed'); fetch('/owned');" });
  delete globalThis.__rpmNeverExecute;
  const result = await inspectArtifact(join(folder, 'input.js'));
  assert.equal(globalThis.__rpmNeverExecute, undefined);
  assert.equal(operation(result, 'network-request').length, 1);
  assert.equal(result.limits.target_executed, false);
});

test('unsupported or malformed syntax is explicit instead of an empty successful analysis', async t => {
  const folder = await fixture(t, { 'broken.js': 'const broken = ;' });
  const result = await inspectArtifact(join(folder, 'broken.js'));
  assert.ok(result.unknowns.some(item => item.code === 'parse_error'));
  assert.ok(result.unknowns.some(item => item.code === 'no_javascript_entrypoint'));
  assert.equal(operation(result, 'message-send').length, 0);
});

test('HTML inline scripts preserve Unicode positions, skip data scripts/comments and keep discovery limits', async t => {
  const source = '😀 prefix\n<!-- <script>fetch("/comment")</script> -->\n<script type="application/json">{"x":1}</script>\n<script data-note=">">fetch("/live");</script>';
  const folder = await fixture(t, { 'index.html': source });
  const result = await inspectArtifact(folder);
  const requests = operation(result, 'network-request'); assert.equal(requests.length, 1);
  assert.equal(requests[0].label, 'fetch');
  const evidence = result.evidence.find(item => requests[0].evidence_ids.includes(item.id));
  assert.equal(source.slice(evidence.start, evidence.end), 'fetch("/live")');
  assert.ok(result.unknowns.some(item => item.code === 'html_discovery_bounded'));
  assert.ok(!result.unknowns.some(item => item.code === 'no_javascript_entrypoint'));
});

test('out-of-root and remote script locations are not followed', async t => {
  const folder = await fixture(t, { 'index.html': '<script src="../secret.js"></script><script src="https://example.invalid/external.js"></script>', 'inside.js': "import '../secret.js'; import(dynamicLocation);" });
  const result = await inspectArtifact(folder);
  assert.ok(result.unknowns.some(item => item.code === 'location_outside_scope'));
  assert.ok(result.unknowns.some(item => item.code === 'location_external_location'));
  assert.ok(result.unknowns.some(item => item.code === 'dynamic_import'));
  assert.ok(result.evidence.every(item => !item.file.includes('secret')));
});

test('relative module imports retain one scoped source occurrence through a cycle', async t => {
  const folder = await fixture(t, { 'index.html': '<script src="a.js"></script>', 'a.js': "import './b.js'; fetch('/a');", 'b.js': "import './a.js'; fetch('/b');" });
  const result = await inspectArtifact(folder);
  assert.equal(operation(result, 'network-request').length, 2);
  assert.equal(result.nodes.filter(node => node.kind === 'source-module' && node.file.endsWith('.js')).length, 2);
  assert.equal(result.edges.filter(edge => edge.kind === 'declares-import').length, 2);
});

test('extracted Electron maps main/preload/renderer and exact invoke candidates without launching', async t => {
  const folder = await fixture(t, {
    'package.json': { main: 'main.cjs', dependencies: { electron: 'verified-external' } },
    'main.cjs': "const {BrowserWindow,ipcMain}=require('electron'); const path=require('node:path'); const win=new BrowserWindow({webPreferences:{preload:path.join(__dirname,'preload.cjs')}}); win.loadFile('index.html'); ipcMain.handle('save',(_,text)=>text);",
    'preload.cjs': "const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('owned',{save:text=>ipcRenderer.invoke('save',text)});",
    'index.html': '<script src="renderer.js"></script>',
    'renderer.js': "window.owned.save('hello');",
  });
  const result = await inspectArtifact(folder);
  assert.equal(result.artifact.kind, 'electron-extracted');
  assert.ok(result.contexts.some(context => context.kind === 'main'));
  assert.ok(result.contexts.some(context => context.kind === 'preload'));
  assert.ok(result.contexts.some(context => context.kind === 'renderer'));
  const routes = result.edges.filter(edge => edge.kind === 'candidate-message-route'); assert.equal(routes.length, 1);
  assert.equal(operation(result, 'bridge-expose').length, 1);
  assert.ok(result.unknowns.some(item => item.code === 'window_instance_unknown'));
  assert.equal(result.limits.target_executed, false);
});

test('native/package signatures are detected-only, not advertised semantic providers', async t => {
  const folder = await fixture(t, { 'native.bin': Buffer.from([0x7f, 69, 76, 70, 2, 1, 1, 0]) });
  const result = await inspectArtifact(join(folder, 'native.bin'));
  assert.equal(result.artifact.kind, 'elf');
  assert.deepEqual(result.capabilities, ['bounded-static-inventory']);
  assert.ok(result.unknowns.some(item => item.code === 'provider_required'));
});

test('regular input/file/AST bounds fail or expose exact limits', async t => {
  const folder = await fixture(t, { 'a.js': 'fetch("/a");', 'b.js': 'fetch("/b");' });
  await assert.rejects(inspectArtifact(folder, { maxFiles: 1 }), error => error.code === 'artifact_bounds');
  await assert.rejects(inspectArtifact(folder, { maxFileBytes: 3 }), error => error.code === 'artifact_bounds');
  const result = await inspectArtifact(join(folder, 'a.js'), { maxAstNodes: 2 });
  assert.ok(result.unknowns.some(item => item.code === 'ast_bounds'));
  await assert.rejects(inspectArtifact(folder, { maxFiles: -1 }), error => error.code === 'invalid_limits');
});

test('symlinks inside the artifact and in the input path are refused', async t => {
  const folder = await fixture(t, { 'a.js': 'fetch("/a");' });
  try { await symlink(join(folder, 'a.js'), join(folder, 'linked.js')); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Host cannot create symlinks'); return; } throw error; }
  await assert.rejects(inspectArtifact(folder), error => error.code === 'symlink_input');
  await assert.rejects(inspectArtifact(join(folder, 'linked.js')), error => error.code === 'symlink_input');
});

test('empty and malformed manifest input cannot silently certify a target', async t => {
  const empty = await fixture(t, {});
  const report = await inspectArtifact(empty); assert.ok(report.unknowns.some(item => item.code === 'no_javascript_entrypoint'));
  const broken = await fixture(t, { 'manifest.json': '{not json' });
  await assert.rejects(inspectArtifact(broken), error => error.code === 'invalid_manifest');
});

test('inspection is deterministic and artifact digest changes when the admitted bytes change', async t => {
  const folder = await fixture(t, extensionFiles());
  const first = await inspectArtifact(folder), second = await inspectArtifact(folder);
  assert.deepEqual(first, second);
  await writeFile(join(folder, 'popup.js'), "chrome.runtime.sendMessage({type:'new-kind'});");
  const next = await inspectArtifact(folder); assert.notEqual(first.artifact.sha256, next.artifact.sha256);
});

test('mutated object aliases do not produce a misleading resolved message channel', async t => {
  const folder = await fixture(t, { 'input.js': "const data={type:'save'}; const alias=data; alias.type='erase'; chrome.runtime.sendMessage(data);" });
  const result = await inspectArtifact(join(folder, 'input.js'));
  assert.equal(operation(result, 'message-send', 'save').length, 0);
  assert.equal(operation(result, 'message-send', null).length, 1);
});

test('ports, injected scripts and offscreen APIs are explicit unmodeled boundaries', async t => {
  const folder = await fixture(t, { 'input.js': "chrome.runtime.connect({name:'port'}); chrome.scripting.executeScript({target:{tabId:1},files:['injected.js']}); chrome.offscreen.createDocument({url:'offscreen.html'});" });
  const result = await inspectArtifact(join(folder, 'input.js'));
  assert.equal(operation(result, 'additional-extension-boundary').length, 3);
  assert.equal(result.unknowns.filter(item => item.code === 'extension_boundary_not_modeled').length, 3);
});

test('valid CSS-only content script declarations remain distinct from message contexts', async t => {
  const files = extensionFiles();
  files['manifest.json'] = { ...manifest, content_scripts: [{ matches: ['http://127.0.0.1/*'], css: ['style.css'] }] };
  files['style.css'] = 'body { color: green; }';
  const result = await inspectArtifact(await fixture(t, files));
  assert.ok(result.contexts.some(context => context.kind === 'content-style'));
  assert.ok(!result.contexts.some(context => context.kind === 'content-script'));
});

test('duplicate HTML attributes retain the first source declaration', async t => {
  const folder = await fixture(t, { 'index.html': '<script src="first.js" src="second.js"></script>', 'first.js': "fetch('/first')", 'second.js': "fetch('/second')" });
  const result = await inspectArtifact(folder);
  const first = result.nodes.find(node => node.kind === 'source-module' && node.file === 'first.js');
  const second = result.nodes.find(node => node.kind === 'source-module' && node.file === 'second.js');
  assert.equal(result.contexts.find(context => context.id === first.context_id).kind, 'web-page');
  assert.equal(result.contexts.find(context => context.id === second.context_id).kind, 'unassigned-script');
});

test('shipped Electron package without development dependencies is classified from its declared main import', async t => {
  const folder = await fixture(t, {
    'package.json': { main: 'main.cjs' },
    'main.cjs': "const {BrowserWindow,ipcMain}=require('electron'); new BrowserWindow({}); ipcMain.handle('export',()=>[]);",
    'index.html': '<p>Owned app</p>',
  });
  const result = await inspectArtifact(folder);
  assert.equal(result.artifact.kind, 'electron-extracted');
  assert.ok(result.contexts.some(context => context.kind === 'main'));
  assert.equal(result.limits.target_executed, false);
  const plain = await fixture(t, { 'package.json': { main: 'server.cjs' }, 'server.cjs': "const fs=require('node:fs');", 'index.html': '<p>Web</p>' });
  assert.equal((await inspectArtifact(plain)).artifact.kind, 'web-extracted');
});

test('context and candidate-link expansion is stopped by explicit global graph limits', async t => {
  const folder = await fixture(t, extensionFiles());
  await assert.rejects(inspectArtifact(folder, { maxContexts: 2 }), error => error.code === 'analysis_bounds');
  await assert.rejects(inspectArtifact(folder, { maxNodes: 3 }), error => error.code === 'analysis_bounds');
  await assert.rejects(inspectArtifact(folder, { maxEdges: 3 }), error => error.code === 'analysis_bounds');
  await assert.rejects(inspectArtifact(folder, { maxEvidence: 1 }), error => error.code === 'analysis_bounds');
  await assert.rejects(inspectArtifact(folder, { maxAnalysisOccurrences: 1 }), error => error.code === 'analysis_bounds');
  const many = await fixture(t, { 'manifest.json': { manifest_version:3, name:'Owned expansion', version:'1', content_scripts:Array.from({length:80},()=>({matches:['http://127.0.0.1/*'],js:['content.js']})) }, 'content.js': "chrome.tabs.sendMessage(1,{type:'ping'}); chrome.runtime.onMessage.addListener(m=>{if(m.type==='ping')return true;});" });
  await assert.rejects(inspectArtifact(many, { maxEdges: 300 }), error => error.code === 'analysis_bounds' && error.details.limit === 'maxEdges');
});
