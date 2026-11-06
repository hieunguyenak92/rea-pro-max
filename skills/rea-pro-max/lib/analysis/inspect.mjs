import { extname } from 'node:path';
import { digest, RpmError } from '../common.mjs';
import { analyzeJavascript, parserVersion } from './javascript.mjs';
import { classifyBytes, compareText, decodeText, inventory, resolveLocal } from './inventory.mjs';

const jsExtensions = new Set(['.js', '.mjs', '.cjs']);
const htmlExtensions = new Set(['.html', '.htm']);
const unsupportedSourceExtensions = new Set(['.ts', '.tsx', '.jsx', '.mts', '.cts', '.mjsx', '.cjsx']);
const id = (prefix, value) => `${prefix}_${digest(value)}`;

function htmlScripts(text) {
  // Bounded source scanning, not a browser HTML parser. Comments are blanked while preserving offsets.
  const scan = text.replace(/<!--[\s\S]*?-->/gu, match => ' '.repeat(match.length));
  const scripts = [];
  const pattern = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/giu;
  for (const match of scan.matchAll(pattern)) {
    const attrs = {};
    for (const attr of match[1].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)) if (!Object.hasOwn(attrs, attr[1].toLowerCase())) attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    const type = attrs.type?.toLowerCase();
    if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
    const start = match.index;
    const contentStart = start + 8 + match[1].length;
    const src = attrs.src?.replace(/&amp;/gu, '&').replace(/&#39;/gu, "'").replace(/&quot;/gu, '"');
    scripts.push({ src, start, end: start + match[0].length, content: match[2], contentStart });
  }
  return scripts;
}

export async function inspectArtifact(inputPath, options = {}) {
  const scope = await inventory(inputPath, options);
  const contexts = new Map(), nodes = new Map(), edges = new Map(), evidence = new Map(), findings = new Map(), unknowns = new Map();
  const parsed = new Map();
  const analyzed = new Set();
  const processedSources = new Set();
  const queued = new Set();
  const queue = [];
  const boundaryOperations = [];
  let artifactKind = 'extracted-javascript';
  const capabilities = new Set(['bounded-static-inventory']);

  function bounded(map, key, value, limitName) {
    if (!map.has(key) && map.size >= scope.limits[limitName]) throw new RpmError('analysis_bounds', `Analysis exceeded ${limitName}; select a narrower artifact.`, { limit: limitName, maximum: scope.limits[limitName] });
    map.set(key, value);
  }
  function unknown(code, detail, file, extra = {}) {
    const value = { code, detail, ...(file ? { file } : {}), ...extra };
    bounded(unknowns, digest(value), value, 'maxDiagnostics');
  }
  function node(value) { if (!nodes.has(value.id)) bounded(nodes, value.id, value, 'maxNodes'); return value.id; }
  function edge(from, to, kind, authority, evidenceIds = []) {
    const value = { from, to, kind, authority, evidence_ids: [...new Set(evidenceIds)].sort(compareText) };
    value.id = id('edge', value); bounded(edges, value.id, value, 'maxEdges'); return value.id;
  }
  function proof(file, start, end, operation) {
    const source = scope.files.get(file);
    let line = 1, column = 0;
    try {
      const prefix = decodeText(source).slice(0, start);
      line = prefix.split('\n').length; column = prefix.length - prefix.lastIndexOf('\n') - 1;
    } catch { /* Binary signatures have byte offsets and no text line authority. */ }
    const value = { file, sha256: source.sha256, start, end, line, column, operation, range_unit: 'utf16-code-unit' };
    value.id = id('ev', value); bounded(evidence, value.id, value, 'maxEvidence'); return value.id;
  }
  function finding(severity, title, detail, evidenceIds = []) {
    const value = { severity, title, detail, evidence_ids: [...new Set(evidenceIds)].sort(compareText) };
    value.id = id('finding', value); bounded(findings, value.id, value, 'maxDiagnostics');
  }
  function context(kind, label, entrypoints, extra = {}) {
    const normalized = [...new Set(entrypoints)].sort(compareText);
    const key = id('ctx', { kind, label, entrypoints: normalized, ...extra });
    if (!contexts.has(key)) bounded(contexts, key, { id: key, kind, label, entrypoints: normalized, ...extra }, 'maxContexts');
    node({ id: key, context_id: key, kind: 'context', label, context_kind: kind });
    return contexts.get(key);
  }
  function enqueue(ctx, file, ownerProof) {
    const key = `${ctx.id}\0${file}`;
    if (!queued.has(key)) { if (queued.size >= scope.limits.maxAnalysisOccurrences) throw new RpmError('analysis_bounds', 'Analysis occurrence limit exceeded; select a narrower artifact.', { maximum: scope.limits.maxAnalysisOccurrences }); queued.add(key); queue.push({ ctx, file }); }
    const moduleId = node({ id: id('module', { context: ctx.id, file }), context_id: ctx.id, kind: 'source-module', label: file, file, sha256: scope.files.get(file).sha256 });
    edge(ctx.id, moduleId, 'declares-entry', 'declared', ownerProof ? [ownerProof] : []);
    return moduleId;
  }
  function location(fromFile, request, operation = 'entrypoint') {
    const result = resolveLocal(fromFile, request, scope.files);
    if (result.error) unknown(`location_${result.error}`, `${operation} was not followed: ${request ?? '(dynamic)'}. Scope remains confined to the supplied artifact.`, fromFile);
    return result.path && !result.error ? result.path : null;
  }
  function json(file) {
    try { return JSON.parse(decodeText(scope.files.get(file))); }
    catch (error) { throw new RpmError('invalid_manifest', `Cannot read ${file}: ${error.message}`, { file }); }
  }
  function entry(ctx, from, request, evidenceId, kind = 'entrypoint') {
    const target = location(from, request, kind);
    if (target) return enqueue(ctx, target, evidenceId);
    return null;
  }

  const manifestFile = scope.files.has('manifest.json') ? 'manifest.json' : null;
  const packageFile = scope.files.has('package.json') ? 'package.json' : null;
  if (manifestFile) {
    const manifest = json(manifestFile);
    const manifestProof = proof(manifestFile, 0, decodeText(scope.files.get(manifestFile)).length, 'extension-manifest');
    if (manifest.manifest_version === 3) {
      artifactKind = 'manifest-v3'; capabilities.add('mv3-declared-contexts');
      const declared = context('extension-manifest', 'Manifest V3 declarations', [manifestFile]); enqueue(declared, manifestFile, manifestProof);
      if (manifest.background?.service_worker) {
        const worker = manifest.background.service_worker;
        if (typeof worker !== 'string') throw new RpmError('invalid_manifest', 'background.service_worker must be a path string.');
        const ctx = context('service-worker', 'Extension service worker', [worker]); entry(ctx, manifestFile, worker, manifestProof);
      }
      if (manifest.action?.default_popup) {
        if (typeof manifest.action.default_popup !== 'string') throw new RpmError('invalid_manifest', 'action.default_popup must be a path string.');
        const ctx = context('popup', 'Extension popup', [manifest.action.default_popup]); entry(ctx, manifestFile, manifest.action.default_popup, manifestProof);
      }
      if (manifest.options_page || manifest.options_ui?.page) {
        const page = manifest.options_page || manifest.options_ui.page;
        if (typeof page !== 'string') throw new RpmError('invalid_manifest', 'The extension options page must be a path string.');
        const ctx = context('extension-page', 'Extension options', [page]); entry(ctx, manifestFile, page, manifestProof);
      }
      if (manifest.content_scripts !== undefined && !Array.isArray(manifest.content_scripts)) throw new RpmError('invalid_manifest', 'content_scripts must be an array.');
      for (const [index, declaration] of (manifest.content_scripts || []).entries()) {
        if (!declaration || typeof declaration !== 'object') throw new RpmError('invalid_manifest', 'A content_script declaration must be an object.');
        const scripts = declaration.js ?? [], styles = declaration.css ?? [];
        if (!Array.isArray(scripts) || !Array.isArray(styles) || ![...scripts, ...styles].every(path => typeof path === 'string')) throw new RpmError('invalid_manifest', 'Content script js/css paths must be arrays of strings.');
        const world = declaration.world || 'ISOLATED';
        if (!['ISOLATED', 'MAIN'].includes(world)) throw new RpmError('invalid_manifest', 'Unsupported content script execution world.');
        const ctx = context(!scripts.length ? 'content-style' : world === 'MAIN' ? 'page-world-content' : 'content-script', `Content script declaration ${index + 1}`, [...scripts, ...styles], { world, matches: Array.isArray(declaration.matches) ? declaration.matches : [], declaration_index: index });
        for (const file of [...scripts, ...styles]) entry(ctx, manifestFile, file, manifestProof);
      }
      if (manifest.permissions !== undefined && (!Array.isArray(manifest.permissions) || !manifest.permissions.every(item => typeof item === 'string'))) throw new RpmError('invalid_manifest', 'permissions must be an array of strings.');
      for (const permission of [...new Set(manifest.permissions || [])].sort(compareText)) {
        const permissionId = node({ id: id('permission', { permission }), context_id: declared.id, kind: 'permission', label: permission });
        edge(declared.id, permissionId, 'declares-permission', 'declared', [manifestProof]);
      }
      unknown('runtime_not_observed', 'Manifest entries and JavaScript calls are static declarations/candidates. Worker lifetime, registration, message delivery and storage effects require qualified runtime observations.');
    } else {
      artifactKind = 'browser-extension'; unknown('unsupported_manifest_version', 'Only Manifest V3 declaration routing is implemented; other manifests receive bounded source inspection.', manifestFile);
    }
  }
  if (artifactKind !== 'manifest-v3' && packageFile) {
    const pkg = json(packageFile);
    const main = typeof pkg.main === 'string' ? pkg.main : 'index.js';
    const mainLocation = resolveLocal(packageFile, main, scope.files);
    const importsElectron = mainLocation.path && !mainLocation.error && jsExtensions.has(extname(mainLocation.path).toLowerCase()) && parse(mainLocation.path).imports.some(item => item.request === 'electron');
    if (pkg.dependencies?.electron || pkg.devDependencies?.electron || pkg.peerDependencies?.electron || importsElectron) {
      artifactKind = 'electron-extracted'; capabilities.add('electron-static-boundaries');
      const ctx = context('main', 'Electron main process declaration', [main]); entry(ctx, packageFile, main, proof(packageFile, 0, decodeText(scope.files.get(packageFile)).length, 'electron-package-main'));
      unknown('electron_runtime_not_observed', 'Extracted Electron source is inspected without launching the application. IPC delivery, preload isolation and native effects remain unverified.');
    }
  }
  if (!['manifest-v3', 'electron-extracted'].includes(artifactKind)) {
    const htmlFiles = scope.entries.filter(file => htmlExtensions.has(extname(file.path).toLowerCase()));
    if (htmlFiles.length) artifactKind = 'web-extracted';
    for (const file of htmlFiles) enqueue(context('web-page', `Page ${file.path}`, [file.path]), file.path);
    if (scope.inputFile && jsExtensions.has(extname(scope.inputFile).toLowerCase())) enqueue(context('javascript-module', `Module ${scope.inputFile}`, [scope.inputFile]), scope.inputFile);
  }

  function parse(file, textOverride, offset = 0) {
    const cacheKey = `${file}\0${offset}`;
    if (parsed.has(cacheKey)) return parsed.get(cacheKey);
    const source = scope.files.get(file);
    const text = textOverride ?? decodeText(source);
    let result;
    try { result = analyzeJavascript(text, { file, maxAstNodes: scope.limits.maxAstNodes }); }
    catch (error) {
      if (!(error instanceof RpmError) || error.code !== 'ast_bounds') throw error;
      result = { operations: [], imports: [], globals: [], unknowns: [{ code: 'ast_bounds', detail: error.message, file }] };
    }
    if (offset) for (const items of [result.operations, result.imports, result.globals, result.unknowns]) for (const item of items) if (Number.isInteger(item.start)) { item.start += offset; item.end += offset; }
    parsed.set(cacheKey, result);
    return result;
  }
  function acceptJavascript(ctx, file, result, moduleId) {
    capabilities.add('javascript-ast');
    for (const item of result.unknowns) unknown(item.code, item.detail, file, Number.isInteger(item.start) ? { start: item.start, end: item.end } : {});
    for (const imported of result.imports) {
      const evidenceId = proof(file, imported.start, imported.end, 'static-import');
      if (!imported.request) continue;
      if (!imported.request.startsWith('.')) { unknown('external_import_not_followed', `External/absolute module ${imported.request} is not read or executed.`, file); continue; }
      const target = location(file, imported.request, 'module import');
      if (target) edge(moduleId, enqueue(ctx, target, evidenceId), 'declares-import', 'declared', [evidenceId]);
    }
    for (const operation of result.operations) {
      const evidenceId = proof(file, operation.start, operation.end, operation.api || operation.kind);
      const operationId = node({ id: id('operation', { context: ctx.id, file, start: operation.start, end: operation.end, kind: operation.kind, channel: operation.channel ?? null }), context_id: ctx.id, kind: operation.kind, label: operation.channel ? `${operation.api}: ${operation.channel}` : operation.api || operation.label || operation.kind, file, api: operation.api || null, channel: operation.channel ?? null, evidence_ids: [evidenceId] });
      edge(moduleId, operationId, 'declares-call', 'declared', [evidenceId]);
      if (['message-send', 'message-listener', 'ipc-send', 'ipc-handler'].includes(operation.kind)) boundaryOperations.push({ ...operation, id: operationId, context: ctx, evidenceId });
      if (operation.kind === 'storage-read' || operation.kind === 'storage-write') {
        const storageId = node({ id: id('storage', { context: ctx.id, area: operation.area, keys: operation.keys }), context_id: ctx.id, kind: 'storage', label: `${operation.area}${operation.keys.length ? `: ${operation.keys.join(', ')}` : ': unresolved keys'}`, area: operation.area, keys: operation.keys });
        edge(operationId, storageId, operation.kind === 'storage-read' ? 'candidate-read' : 'candidate-write', 'candidate', [evidenceId]);
      }
      if (operation.kind === 'network-request') {
        const endpointId = node({ id: id('endpoint', { context: ctx.id, file, start: operation.start }), context_id: ctx.id, kind: 'endpoint', label: operation.location || 'Unresolved fetch target', location: operation.location });
        edge(operationId, endpointId, 'candidate-request', 'candidate', [evidenceId]);
        if (!operation.location) unknown('dynamic_endpoint', 'The request location is unresolved; the existence of fetch syntax does not prove a request ran.', file);
      }
      if (operation.kind === 'preload-declaration' && ctx.kind === 'main' && operation.location) {
        const from = operation.module_relative ? '__artifact_root__.js' : file;
        const target = location(from, operation.location, 'preload declaration');
        if (target) {
          const preload = context('preload', `Preload ${target}`, [target]);
          edge(operationId, enqueue(preload, target, evidenceId), 'declares-preload', 'declared', [evidenceId]);
          unknown('window_instance_unknown', 'A preload source declaration does not establish a unique runtime BrowserWindow instance or observed renderer ownership.', file);
        }
      }
      if (operation.kind === 'renderer-declaration' && ctx.kind === 'main' && operation.location) {
        const target = location(file, operation.location, 'candidate renderer');
        if (target) enqueue(context('renderer', `Candidate renderer ${target}`, [target]), target, evidenceId);
      }
      if (operation.kind === 'worker-declaration' && operation.location) {
        const target = location(file, operation.location, 'worker declaration');
        if (target) enqueue(context('web-service-worker', `Web service worker ${target}`, [target]), target, evidenceId);
      }
      if (operation.kind === 'deferred-listener' && ctx.kind === 'service-worker') finding('warning', 'Potential deferred worker listener registration', operation.label, [evidenceId]);
    }
    if (ctx.kind === 'service-worker') for (const variable of result.globals) {
      finding('warning', 'Worker memory has no persistence guarantee', `Module-scoped mutable binding ${variable.name} is a static persistence question. Verify cold-worker behavior; no data-loss conclusion follows from this declaration alone.`, [proof(file, variable.start, variable.end, 'worker-mutable-binding')]);
    }
  }
  async function drain() {
    while (queue.length) {
      const { ctx, file } = queue.shift();
      const key = `${ctx.id}\0${file}`;
      if (analyzed.has(key)) continue;
      analyzed.add(key);
      const source = scope.files.get(file);
      const moduleId = id('module', { context: ctx.id, file });
      const extension = extname(file).toLowerCase();
      if (htmlExtensions.has(extension)) {
        let text;
        try { text = decodeText(source); } catch (error) { unknown(error.code, error.message, file); continue; }
        processedSources.add(file);
        unknown('html_discovery_bounded', 'HTML source scanning covers declared script tags; it is not a browser parse/execution oracle or a complete dynamic loader model.', file);
        for (const script of htmlScripts(text)) {
          const evidenceId = proof(file, script.start, script.end, 'html-script-declaration');
          if (script.src) {
            const target = location(file, script.src, 'HTML script declaration');
            if (target) edge(moduleId, enqueue(ctx, target, evidenceId), 'declares-script', 'declared', [evidenceId]);
          } else if (script.content.trim()) acceptJavascript(ctx, file, parse(file, script.content, script.contentStart), moduleId);
        }
      } else if (jsExtensions.has(extension)) {
        try { const result = parse(file); acceptJavascript(ctx, file, result, moduleId); if (result.source_type) processedSources.add(file); }
        catch (error) { if (error instanceof RpmError && error.code === 'invalid_encoding') unknown(error.code, error.message, file); else throw error; }
      }
    }
  }
  await drain();

  // Unreferenced shipped JavaScript remains scoped to an unknown context rather than silently disappearing.
  for (const source of scope.entries) if (jsExtensions.has(extname(source.path).toLowerCase()) && ![...analyzed].some(key => key.endsWith(`\0${source.path}`))) {
    const ctx = context(artifactKind === 'electron-extracted' ? 'renderer-candidate' : 'unassigned-script', `Unassigned source ${source.path}`, [source.path]);
    enqueue(ctx, source.path);
    unknown('entrypoint_ownership_unknown', 'This shipped script was not reached from a resolved entrypoint; its runtime context/activation is unknown.', source.path);
  }
  if (artifactKind === 'electron-extracted') for (const source of scope.entries) if (htmlExtensions.has(extname(source.path).toLowerCase()) && ![...analyzed].some(key => key.endsWith(`\0${source.path}`))) {
    enqueue(context('renderer-candidate', `Unassigned renderer ${source.path}`, [source.path]), source.path);
    unknown('entrypoint_ownership_unknown', 'This HTML file is a candidate renderer, without established BrowserWindow activation.', source.path);
  }
  await drain();

  // Resolved imports can point at syntax that the bounded Acorn lane does not parse.
  // Keep the module in the graph, but make the missing semantic coverage explicit.
  const visitedFiles = new Set([...analyzed].map(key => key.slice(key.lastIndexOf('\0') + 1)));
  const unparsedFiles = scope.entries.filter(source => !processedSources.has(source.path)).map(source => source.path);
  for (const file of unparsedFiles) {
    const extension = extname(file).toLowerCase();
    if (unsupportedSourceExtensions.has(extension)) unknown('unsupported_source_extension', `The admitted source ${file} was not parsed. Supported JavaScript extensions are .js, .mjs and .cjs; TypeScript/JSX syntax requires a future bounded parser lane.`, file, { extension, reachable: visitedFiles.has(file), supported_extensions: [...jsExtensions].sort(compareText) });
  }

  for (const sender of boundaryOperations.filter(operation => ['message-send', 'ipc-send'].includes(operation.kind) && operation.channel !== null)) for (const receiver of boundaryOperations.filter(operation => ['message-listener', 'ipc-handler'].includes(operation.kind) && operation.channel === sender.channel)) {
    if (sender.context.id === receiver.context.id) continue;
    let compatible = false;
    if (sender.kind === 'message-send' && receiver.kind === 'message-listener') {
      compatible = sender.transport === 'extension-tabs' ? receiver.context.kind === 'content-script' : ['service-worker', 'popup', 'extension-page'].includes(receiver.context.kind);
    } else if (sender.kind === 'ipc-send' && receiver.kind === 'ipc-handler') compatible = sender.transport === receiver.transport && receiver.context.kind === 'main';
    if (compatible) edge(sender.id, receiver.id, 'candidate-message-route', 'candidate', [sender.evidenceId, receiver.evidenceId]);
  }
  if (![...parsed.values()].some(result => result.source_type)) {
    const detected = scope.inputFile && classifyBytes(scope.files.get(scope.inputFile).bytes);
    if (detected) artifactKind = detected;
    unknown(detected ? 'provider_required' : 'no_javascript_entrypoint', detected ? `Detected ${detected} bytes only. Semantic/native/mobile/package recovery is not provided by this static JavaScript lane.` : 'No supported JavaScript entrypoint was analyzed in the supplied scope.');
  }
  return {
    schema_version: 1,
    artifact: { kind: artifactKind, path: scope.path, source_root: scope.root, input_file: scope.inputFile, sha256: scope.sha256, file_count: scope.files.size, bytes: scope.bytes },
    contexts: [...contexts.values()].sort((a, b) => compareText(a.id, b.id)), nodes: [...nodes.values()].sort((a, b) => compareText(a.id, b.id)), edges: [...edges.values()].sort((a, b) => compareText(a.id, b.id)), evidence: [...evidence.values()].sort((a, b) => compareText(a.id, b.id)), findings: [...findings.values()].sort((a, b) => compareText(a.id, b.id)), unknowns: [...unknowns.values()].sort((a, b) => compareText(digest(a), digest(b))),
    capabilities: [...capabilities].sort(compareText),
    limits: { coverage: 'bounded-static', target_executed: false, max_files: scope.limits.maxFiles, max_file_bytes: scope.limits.maxFileBytes, max_total_bytes: scope.limits.maxTotalBytes, max_ast_nodes: scope.limits.maxAstNodes, max_directory_depth: scope.limits.maxDepth, max_contexts: scope.limits.maxContexts, max_nodes: scope.limits.maxNodes, max_edges: scope.limits.maxEdges, max_evidence: scope.limits.maxEvidence, max_analysis_occurrences: scope.limits.maxAnalysisOccurrences, max_diagnostics: scope.limits.maxDiagnostics, analyzed_occurrences: analyzed.size, parser: `acorn-${parserVersion}` },
    coverage: { admitted_files: scope.entries.map(file => file.path), visited_files: [...visitedFiles].sort(compareText), analyzed_files: [...processedSources].sort(compareText), unparsed_files: unparsedFiles.sort(compareText), omitted_files: scope.scope.omitted, scope: scope.scope, max_visited_entries: scope.limits.maxVisitedEntries, max_omissions: scope.limits.maxOmissions },
  };
}

