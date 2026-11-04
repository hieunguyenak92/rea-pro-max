import * as acorn from '../../assets/vendor/acorn.mjs';
import { posix } from './inventory.mjs';
import { dirname, join } from 'node:path';
import { RpmError } from '../common.mjs';

export const parserVersion = acorn.version;
const UNKNOWN = Symbol('unknown');
const globals = new Set(['chrome', 'browser', 'window', 'navigator', 'fetch', 'localStorage', 'sessionStorage']);
const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const apiSuffixes = new Set(['sendMessage', 'addListener', 'invoke', 'handle', 'exposeInMainWorld']);

function children(node) {
  return Object.entries(node).filter(([key]) => !['loc', 'start', 'end'].includes(key)).flatMap(([, value]) => Array.isArray(value) ? value.filter(item => item && typeof item.type === 'string') : value && typeof value.type === 'string' ? [value] : []);
}
function property(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return null;
}
function declare(pattern, entry, scope) {
  if (!pattern) return;
  if (pattern.type === 'Identifier') { scope.bindings.set(pattern.name, entry); return; }
  if (pattern.type === 'ObjectPattern') {
    for (const part of pattern.properties) {
      if (part.type === 'Property' && !part.computed) {
        const key = part.key.type === 'Identifier' ? part.key.name : part.key.value;
        declare(part.value, typeof key === 'string' ? { ...entry, suffix: [...(entry.suffix || []), key] } : { kind: 'unknown' }, scope);
      } else declare(part.argument, { kind: 'unknown' }, scope);
    }
  } else if (pattern.type === 'ArrayPattern') for (const part of pattern.elements) declare(part, { kind: 'unknown' }, scope);
  else if (pattern.type === 'AssignmentPattern') declare(pattern.left, { kind: 'unknown' }, scope);
  else if (pattern.type === 'RestElement') declare(pattern.argument, { kind: 'unknown' }, scope);
}
function lookup(scope, name) {
  for (let current = scope; current; current = current.parent) if (current.bindings.has(name)) return current.bindings.get(name);
  return null;
}
function normalizePath(path) { return path?.[0] === 'window' && ['chrome', 'browser'].includes(path[1]) ? path.slice(1) : path; }

export function analyzeJavascript(text, { file, maxAstNodes = 100_000 }) {
  let ast;
  const profiles = file.endsWith('.mjs') ? ['module'] : file.endsWith('.cjs') ? ['script'] : ['module', 'script'];
  let sourceType;
  let lastError;
  for (const profile of profiles) {
    try { ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: profile, locations: true, allowHashBang: true }); sourceType = profile; break; }
    catch (error) { lastError = error; }
  }
  if (!ast) return { operations: [], imports: [], unknowns: [{ code: 'parse_error', detail: `Acorn could not parse source: ${lastError.message}`, file }], source_type: null, globals: [] };
  const scopes = new WeakMap();
  const parents = new WeakMap();
  const nodes = [];
  const topScope = { parent: null, kind: 'program', bindings: new Map() };
  function build(node, scope, parent, depth) {
    if (nodes.length >= maxAstNodes || depth > 512) throw new RpmError('ast_bounds', 'JavaScript AST exceeds its node/depth bound.', { file, max_ast_nodes: maxAstNodes });
    if (functionTypes.has(node.type)) {
      if (node.type === 'FunctionDeclaration' && node.id) declare(node.id, { kind: 'function', node }, scope);
      scope = { parent: scope, kind: 'function', bindings: new Map(), owner: node };
      if (node.type === 'FunctionExpression' && node.id) declare(node.id, { kind: 'function', node }, scope);
      for (const parameter of node.params) declare(parameter, { kind: 'parameter', node: parameter }, scope);
    } else if (node.type === 'BlockStatement' || node.type === 'CatchClause' || node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      scope = { parent: scope, kind: 'block', bindings: new Map() };
      if (node.type === 'CatchClause') declare(node.param, { kind: 'unknown' }, scope);
    }
    nodes.push(node); scopes.set(node, scope); if (parent) parents.set(node, parent);
    if (node.type === 'VariableDeclaration') {
      let bindingScope = scope;
      if (node.kind === 'var') while (bindingScope.parent && !['function', 'program'].includes(bindingScope.kind)) bindingScope = bindingScope.parent;
      for (const declaration of node.declarations) declare(declaration.id, node.kind === 'const' ? { kind: 'constant', init: declaration.init, scope } : { kind: 'unknown' }, bindingScope);
    }
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) {
        const path = [node.source.value];
        if (specifier.type === 'ImportSpecifier') path.push(specifier.imported.name || specifier.imported.value);
        declare(specifier.local, { kind: 'symbol', path }, scope);
      }
    }
    if (node.type === 'ClassDeclaration' && node.id) declare(node.id, { kind: 'unknown' }, scope);
    for (const child of children(node)) build(child, scope, node, depth + 1);
  }
  build(ast, topScope, null, 0);
  const unknowns = [];
  const operations = [];
  const imports = [];
  const mutatedEntries = new Set();
  function origin(entry, seen = new Set()) {
    if (!entry || entry.kind !== 'constant' || seen.has(entry)) return entry;
    let base = entry.init;
    while (base?.type === 'MemberExpression') base = base.object;
    if (base?.type !== 'Identifier') return entry;
    const other = lookup(entry.scope, base.name);
    return other ? origin(other, new Set([...seen, entry])) : entry;
  }
  for (const node of nodes) if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression' || (node.type === 'UnaryExpression' && node.operator === 'delete')) {
    let base = node.left || node.argument;
    while (base?.type === 'MemberExpression') base = base.object;
    if (base?.type === 'Identifier') {
      const entry = lookup(scopes.get(node), base.name);
      if (entry?.kind === 'constant') mutatedEntries.add(origin(entry));
    }
  }
  const mutated = entry => mutatedEntries.has(origin(entry));
  function value(node, scope, seen = new Set()) {
    if (!node) return UNKNOWN;
    if (node.type === 'Literal' && ['string', 'number', 'boolean'].includes(typeof node.value)) return node.value;
    if (node.type === 'Literal' && node.value === null) return null;
    if (node.type === 'Identifier') {
      const entry = lookup(scope, node.name);
      if (!entry && node.name === '__dirname') return { localDirectory: posix(dirname(file)) };
      if (!entry || entry.kind !== 'constant' || entry.suffix?.length || seen.has(entry) || mutated(entry)) return UNKNOWN;
      return value(entry.init, entry.scope, new Set([...seen, entry]));
    }
    if (node.type === 'TemplateLiteral') {
      let result = node.quasis[0].value.cooked;
      for (let i = 0; i < node.expressions.length; i++) {
        const part = value(node.expressions[i], scope, seen);
        if (!['string', 'number', 'boolean'].includes(typeof part)) return UNKNOWN;
        result += String(part) + node.quasis[i + 1].value.cooked;
      }
      return result;
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      const left = value(node.left, scope, seen), right = value(node.right, scope, seen);
      if (['string', 'number'].includes(typeof left) && ['string', 'number'].includes(typeof right)) return left + right;
    }
    if (node.type === 'ObjectExpression') {
      const result = {};
      for (const part of node.properties) {
        if (part.type !== 'Property' || part.computed || part.kind !== 'init' || part.method) return UNKNOWN;
        const key = part.key.type === 'Identifier' ? part.key.name : part.key.value;
        if (typeof key !== 'string') return UNKNOWN;
        const item = value(part.value, scope, seen);
        if (item === UNKNOWN) return UNKNOWN;
        Object.defineProperty(result, key, { value: item, enumerable: true });
      }
      return result;
    }
    if (node.type === 'CallExpression') {
      const path = symbol(node.callee, scope, seen);
      if (path && ['node:path.join', 'path.join', 'node:path.resolve', 'path.resolve'].includes(path.join('.'))) {
        const parts = node.arguments.map(arg => value(arg, scope, seen));
        if (parts[0]?.localDirectory !== undefined && parts.slice(1).every(part => typeof part === 'string')) return { localPath: posix(join(parts[0].localDirectory, ...parts.slice(1))) };
      }
    }
    return UNKNOWN;
  }
  function symbol(node, scope, seen = new Set()) {
    if (!node) return null;
    if (node.type === 'ChainExpression') return symbol(node.expression, scope, seen);
    if (node.type === 'Identifier') {
      const entry = lookup(scope, node.name);
      if (!entry) return globals.has(node.name) ? [node.name] : null;
      if (entry.kind === 'symbol') return entry.path;
      if (entry.kind !== 'constant' || seen.has(entry) || mutated(entry)) return null;
      const path = symbol(entry.init, entry.scope, new Set([...seen, entry]));
      return path ? [...path, ...(entry.suffix || [])] : null;
    }
    if (node.type === 'MemberExpression') {
      const base = symbol(node.object, scope, seen), part = property(node);
      return base && part !== null ? normalizePath([...base, part]) : null;
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && !lookup(scope, 'require')) {
      const name = value(node.arguments[0], scope, seen);
      return typeof name === 'string' ? [name] : null;
    }
    return null;
  }
  function at(node, extra) { return { ...extra, start: node.start, end: node.end, line: node.loc.start.line, column: node.loc.start.column }; }
  function unknown(node, code, detail) { unknowns.push(at(node, { code, detail, file })); }
  function primitive(node, scope) {
    const result = value(node, scope);
    return typeof result === 'string' ? result : null;
  }
  function messageType(node, scope, seen = new Set()) {
    if (node?.type === 'ObjectExpression') {
      for (const part of node.properties) if (part.type === 'Property' && !part.computed && ['type', 'action', 'kind'].includes(part.key.name || part.key.value)) return primitive(part.value, scope);
    }
    if (node?.type === 'Identifier') {
      const entry = lookup(scope, node.name);
      if (entry?.kind === 'constant' && !seen.has(entry) && !mutated(entry)) return messageType(entry.init, entry.scope, new Set([...seen, entry]));
    }
    return primitive(node, scope);
  }
  function handlerChannels(callback) {
    if (!callback || !functionTypes.has(callback.type) || callback.params[0]?.type !== 'Identifier') return [];
    const parameter = lookup(scopes.get(callback), callback.params[0].name);
    const result = new Set();
    for (const node of nodes) {
      let parent = node;
      while (parent && parent !== callback) parent = parents.get(parent);
      if (!parent) continue;
      const scope = scopes.get(node);
      function messageField(member) {
        return member?.type === 'MemberExpression' && ['type', 'action', 'kind'].includes(property(member)) && member.object.type === 'Identifier' && lookup(scope, member.object.name) === parameter;
      }
      if (node.type === 'BinaryExpression' && ['===', '=='].includes(node.operator)) {
        const text = messageField(node.left) ? primitive(node.right, scope) : messageField(node.right) ? primitive(node.left, scope) : null;
        if (text !== null) result.add(text);
      }
      if (node.type === 'SwitchStatement' && messageField(node.discriminant)) for (const branch of node.cases) {
        const text = primitive(branch.test, scope); if (text !== null) result.add(text);
      }
    }
    return [...result].sort();
  }
  for (const node of nodes) {
    const scope = scopes.get(node);
    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      if (node.source) imports.push(at(node, { request: node.source.value, dynamic: false }));
    }
    if (node.type === 'ImportExpression') {
      const request = primitive(node.source, scope);
      imports.push(at(node, { request, dynamic: request === null }));
      if (request === null) unknown(node, 'dynamic_import', 'The import target is not a statically resolved literal.');
    }
    if (node.type === 'NewExpression') {
      const path = symbol(node.callee, scope);
      if (path?.join('.') === 'electron.BrowserWindow') {
        const options = node.arguments[0];
        if (options?.type === 'ObjectExpression') {
          const preferences = options.properties.find(part => part.type === 'Property' && (part.key.name || part.key.value) === 'webPreferences')?.value;
          const preload = preferences?.type === 'ObjectExpression' && preferences.properties.find(part => part.type === 'Property' && (part.key.name || part.key.value) === 'preload')?.value;
          if (preload) {
            const resolved = value(preload, scope);
            const location = typeof resolved === 'string' ? resolved : resolved?.localPath;
            operations.push(at(preload, { kind: 'preload-declaration', api: 'electron.BrowserWindow.webPreferences.preload', location: location || null, module_relative: typeof resolved?.localPath === 'string' }));
            if (!location) unknown(preload, 'dynamic_preload', 'Preload location requires runtime or additional source authority.');
          }
        }
      }
    }
    if (node.type !== 'CallExpression') continue;
    if (node.callee.type === 'Identifier' && node.callee.name === 'require' && !lookup(scope, 'require')) {
      const request = primitive(node.arguments[0], scope);
      imports.push(at(node, { request, dynamic: request === null }));
      if (request === null) unknown(node, 'dynamic_import', 'The require target is not a statically resolved literal.');
    }
    if (node.callee.type === 'MemberExpression' && property(node.callee) === 'loadFile') {
      const location = primitive(node.arguments[0], scope);
      if (location) operations.push(at(node, { kind: 'renderer-declaration', api: 'candidate.loadFile', location }));
    }
    const path = symbol(node.callee, scope);
    const api = path?.join('.');
    if (!api) {
      if (node.callee.type === 'MemberExpression' && apiSuffixes.has(property(node.callee)) && /^(chrome|browser|electron)$/u.test(node.callee.object?.name || '')) unknown(node, 'unresolved_api', 'A possible boundary call is shadowed or unresolved.');
      continue;
    }
    const extension = ['chrome', 'browser'].includes(path[0]);
    if (extension && ['runtime.sendMessage', 'tabs.sendMessage'].includes(path.slice(1).join('.'))) {
      let argument = node.arguments[path[1] === 'tabs' ? 1 : 0];
      if (path[1] === 'runtime' && typeof value(argument, scope) === 'string' && /^[a-p]{32}$/u.test(value(argument, scope)) && node.arguments[1]) argument = node.arguments[1];
      const channel = messageType(argument, scope);
      operations.push(at(node, { kind: 'message-send', api, channel, transport: path[1] === 'tabs' ? 'extension-tabs' : 'extension-runtime' }));
      if (channel === null) unknown(node, 'dynamic_message', 'Message type is unresolved; no channel match is inferred.');
    } else if (extension && ['runtime.connect', 'tabs.connect', 'runtime.onConnect.addListener', 'scripting.executeScript', 'scripting.registerContentScripts', 'offscreen.createDocument'].includes(path.slice(1).join('.'))) {
      operations.push(at(node, { kind: 'additional-extension-boundary', api, label: api }));
      unknown(node, 'extension_boundary_not_modeled', `${api} is declared but its port/injection/offscreen lifecycle is outside this release's exact message-route model.`);
    } else if (extension && path.slice(1).join('.') === 'runtime.onMessage.addListener') {
      const channels = handlerChannels(node.arguments[0]);
      for (const channel of channels.length ? channels : [null]) operations.push(at(node, { kind: 'message-listener', api, channel, transport: 'extension-runtime' }));
      if (!channels.length) unknown(node, 'unresolved_message_handler', 'Listener exists, but its handled message types are unresolved.');
      let enclosing = scope;
      while (enclosing && enclosing.kind !== 'function') enclosing = enclosing.parent;
      if (enclosing) operations.push(at(node, { kind: 'deferred-listener', api, label: 'Listener registration is inside a function; cold-start registration needs runtime verification.' }));
    } else if (extension && path[1] === 'storage' && ['get', 'set', 'remove', 'clear'].includes(path[3]) && path.length === 4) {
      const argument = node.arguments[0];
      const keys = argument?.type === 'ObjectExpression' ? argument.properties.filter(part => part.type === 'Property' && !part.computed).map(part => part.key.name || part.key.value).filter(key => typeof key === 'string') : typeof value(argument, scope) === 'string' ? [value(argument, scope)] : [];
      operations.push(at(node, { kind: path[3] === 'get' ? 'storage-read' : 'storage-write', api, area: path[2], keys: [...new Set(keys)].sort() }));
    } else if (['electron.ipcRenderer.send', 'electron.ipcRenderer.invoke', 'electron.ipcRenderer.on', 'electron.ipcRenderer.once', 'electron.ipcMain.on', 'electron.ipcMain.handle', 'electron.ipcMain.once'].includes(api)) {
      const channel = primitive(node.arguments[0], scope);
      const sending = ['send', 'invoke'].includes(path[2]);
      const transport = path[1] === 'ipcMain' ? path[2] === 'handle' ? 'electron-invoke' : 'electron-send' : path[2] === 'invoke' ? 'electron-invoke' : path[2] === 'send' ? 'electron-send' : 'electron-reply';
      operations.push(at(node, { kind: sending ? 'ipc-send' : 'ipc-handler', api, channel, transport }));
      if (channel === null) unknown(node, 'dynamic_channel', 'IPC channel is unresolved; no channel pair is inferred.');
    } else if (api === 'electron.contextBridge.exposeInMainWorld') {
      operations.push(at(node, { kind: 'bridge-expose', api, channel: primitive(node.arguments[0], scope) }));
    } else if (['navigator.serviceWorker.register', 'window.navigator.serviceWorker.register'].includes(api)) {
      operations.push(at(node, { kind: 'worker-declaration', api, location: primitive(node.arguments[0], scope) }));
    } else if (api === 'fetch' || api === 'window.fetch') {
      operations.push(at(node, { kind: 'network-request', api, location: primitive(node.arguments[0], scope) }));
    } else if (['localStorage.getItem', 'localStorage.setItem', 'sessionStorage.getItem', 'sessionStorage.setItem', 'window.localStorage.getItem', 'window.localStorage.setItem', 'window.sessionStorage.getItem', 'window.sessionStorage.setItem'].includes(api)) {
      operations.push(at(node, { kind: api.endsWith('.getItem') ? 'storage-read' : 'storage-write', api, area: path.find(part => part.endsWith('Storage')), keys: typeof value(node.arguments[0], scope) === 'string' ? [value(node.arguments[0], scope)] : [] }));
    }
  }
  const mutableGlobals = [];
  for (const node of ast.body) if (node.type === 'VariableDeclaration' && node.kind !== 'const') for (const declaration of node.declarations) if (declaration.id.type === 'Identifier') mutableGlobals.push(at(declaration, { name: declaration.id.name }));
  return { operations, imports, unknowns, source_type: sourceType, globals: mutableGlobals };
}
