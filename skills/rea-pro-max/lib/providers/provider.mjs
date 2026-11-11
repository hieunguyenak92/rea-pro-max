import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest, RpmError } from '../common.mjs';
import { VERSION } from '../version.mjs';

/** Newline-delimited JSON-RPC 2.0 transport used by optional local providers. */
export const JSON_RPC_VERSION = '2.0';
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const PROVIDER_MAX_TIMEOUT_MS = 240_000;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;
const MAX_INPUT_BYTES = 1024 * 1024;
const SECRET_ENV_KEYS = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|AUTH)/iu;

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function boundedText(value, label, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new RpmError('provider_config', `${label} must be a nonempty bounded string.`);
  return value;
}
function absolute(value, label) {
  boundedText(value, label, 4096);
  if (!isAbsolute(value)) throw new RpmError('provider_path', `${label} must be an absolute path.`);
  return value;
}
function selectedWorkspace(value) {
  const path = absolute(value, 'Provider workspace');
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RpmError('provider_path', 'Provider workspace must be an existing regular directory, not a symlink.');
  } catch (error) {
    if (error instanceof RpmError) throw error;
    throw new RpmError('provider_path', `Provider workspace is unavailable: ${error.message}`);
  }
  return path;
}
function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RpmError('provider_config', `${label} must be an integer from${minimum}to${maximum}.`);
  return value;
}
function checkArgs(args) {
  if (args === undefined) return [];
  if (!Array.isArray(args) || args.length > MAX_ARGS || args.some(value => typeof value !== 'string' || value.length > MAX_ARG_LENGTH || value.includes('\0'))) throw new RpmError('provider_config', 'Provider args must be at most64 bounded strings without NUL bytes.');
  return [...args];
}
function errorRecord(code, message, details = {}) { return { code, message: String(message).slice(0, 1000), details }; }
function failure(status, error, provenance) { return { status, error, provenance }; }
function contained(root, path) {
  const location = relative(root, path);
  return location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location);
}

// Path-bearing arguments may be absolute aliases, but only when they resolve to
// the selected workspace. This remains an admission policy, not an OS sandbox.
const PATH_FIELDS = new Set(['path', 'target_path', 'artifact_path', 'source_path', 'input_path', 'output_path', 'output_directory', 'project_path', 'workspace_path']);
function checkPayloadPaths(root, value, key = '') {
  if (Array.isArray(value)) { for (const item of value) checkPayloadPaths(root, item, key); return; }
  if (!object(value)) {
    if (PATH_FIELDS.has(key)) {
      if (typeof value !== 'string' || !value || value.includes('\0')) throw new RpmError('provider_scope', 'Provider input paths must be nonempty strings without NUL bytes.');
      if (!contained(root, resolve(root, value))) throw new RpmError('provider_scope', 'Provider input paths must stay inside the selected workspace.');
    }
    return;
  }
  for (const [name, item] of Object.entries(value)) checkPayloadPaths(root, item, name);
}

function normalizePayloadPaths(root, value, key = '') {
  if (Array.isArray(value)) return value.map(item => normalizePayloadPaths(root, item, key));
  if (!object(value)) return PATH_FIELDS.has(key) ? resolve(root, value) : value;
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, normalizePayloadPaths(root, item, name)]));
}

function safeEnvironment() {
  // Never inherit the caller environment: it may contain credentials. An
  // absolute executable is used, so PATH is only a conventional child setting.
  const env = { PATH: typeof process.env.PATH === 'string' ? process.env.PATH : '', LANG: 'C', LC_ALL: 'C', RPM_PROVIDER_WORKSPACE: '.' };
  for (const key of Object.keys(env)) if (SECRET_ENV_KEYS.test(key)) delete env[key];
  return env;
}

async function admitPaths(executablePath, workspace) {
  const executableInput = await lstat(executablePath);
  if (executableInput.isSymbolicLink() || !executableInput.isFile()) throw new RpmError('provider_path', 'Provider executable must be a regular file, not a symlink.');
  const executable = await realpath(executablePath);
  const workspaceInput = await lstat(workspace);
  if (workspaceInput.isSymbolicLink() || !workspaceInput.isDirectory()) throw new RpmError('provider_path', 'Provider workspace must be a regular directory, not a symlink.');
  const selectedWorkspace = await realpath(workspace);
  return { executable, workspace: selectedWorkspace };
}

function checkRpc(value, id) {
  if (!object(value) || value.jsonrpc !== JSON_RPC_VERSION || value.id !== id) throw new RpmError('provider_protocol', 'Provider returned an invalid JSON-RPC response envelope.');
  if (value.error !== undefined) {
    if (!object(value.error) || typeof value.error.code !== 'number' || typeof value.error.message !== 'string') throw new RpmError('provider_protocol', 'Provider JSON-RPC errors must include a numeric code and message.');
    throw new RpmError('provider_error', value.error.message, { rpc_code: value.error.code, data: value.error.data });
  }
  if (!Object.hasOwn(value, 'result')) throw new RpmError('provider_protocol', 'Provider JSON-RPC response has no result.');
  return value.result;
}

function provenance({ manifest, command, tool, executable, workspace, requestId, startedAt, finishedAt, handshake, capabilities, cleanup, bytes, exitCode, signalCode }) {
  return {
    authority: 'external-provider', protocol: JSON_RPC_VERSION, mcp_protocol_version: MCP_PROTOCOL_VERSION,
    request_id: requestId, command, tool: tool || null, provider: manifest, executable, workspace,
    handshake: handshake ? { serverInfo: handshake.serverInfo, protocolVersion: handshake.protocolVersion } : null,
    capabilities: capabilities || [], started_at: startedAt, finished_at: finishedAt, output_bytes: bytes,
    exit_code: exitCode, signal: signalCode, cleanup,
  };
}

/**
 * Bounded JSON-RPC MCP child-process adapter. Every call gets a fresh process;
 * no arbitrary shell command or provider tool name can be supplied by a caller.
 */
export class JsonRpcProvider {
  constructor({ executablePath, args = [], workspace, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, provider = 'external-provider', manifest = {}, commands = {}, expectedServer = {} } = {}) {
    this.executablePath = absolute(executablePath, 'Provider executable');
    this.args = checkArgs(args);
    this.workspace = selectedWorkspace(workspace);
    this.timeoutMs = integer(timeoutMs, 'Provider timeout', 100, PROVIDER_MAX_TIMEOUT_MS);
    this.maxBytes = integer(maxBytes, 'Provider byte limit', 1024, 64 * 1024 * 1024);
    this.provider = boundedText(provider, 'Provider name', 128);
    this.manifest = object(manifest) ? JSON.parse(canonical(manifest)) : {};
    const commandMap = Array.isArray(commands) ? Object.fromEntries(commands.map(command => [command, command])) : commands;
    if (!object(commandMap) || !Object.keys(commandMap).length || Object.keys(commandMap).some(command => !/^[a-z][a-z0-9_-]{0,63}$/u.test(command) || (commandMap[command] !== null && (typeof commandMap[command] !== 'string' || !/^[a-z][a-z0-9_-]{0,127}$/u.test(commandMap[command]))))) throw new RpmError('provider_config', 'Provider commands must map simple names to approved tool names.');
    this.commands = Object.freeze({ ...commandMap });
    this.expectedServer = object(expectedServer) ? JSON.parse(canonical(expectedServer)) : {};
  }

  async execute(command, input = {}, { signal } = {}) {
    if (typeof command !== 'string' || !Object.hasOwn(this.commands, command)) throw new RpmError('provider_command', 'Provider command is not in the typed allowlist.', { command, allowed: Object.keys(this.commands) });
    if (!object(input)) throw new RpmError('provider_input', 'Provider command input must be a JSON object.');
    let serialized;
    try { serialized = canonical(input); } catch (error) { throw new RpmError('provider_input', `Provider input is not finite JSON: ${error.message}`); }
    if (Buffer.byteLength(serialized) > Math.min(MAX_INPUT_BYTES, this.maxBytes)) throw new RpmError('provider_input', 'Provider command input exceeded its byte budget.');
    const requestId = randomUUID(); const startedAt = new Date().toISOString();
    let admitted;
    try { admitted = await admitPaths(this.executablePath, this.workspace); }
    catch (error) {
      const details = error instanceof RpmError ? error.details : {};
      return failure('unknown', errorRecord(error.code || 'provider_unavailable', error.message, details), provenance({ manifest: this.manifest, command, executable: this.executablePath, workspace: this.workspace, requestId, startedAt, finishedAt: new Date().toISOString(), cleanup: { process_spawned: false, process_terminated: true }, bytes: 0, exitCode: null, signalCode: null }));
    }
    checkPayloadPaths(admitted.workspace, input);
    const payload = normalizePayloadPaths(admitted.workspace, input);
    if (Buffer.byteLength(canonical(payload)) > Math.min(MAX_INPUT_BYTES, this.maxBytes)) throw new RpmError('provider_input', 'Provider command input exceeded its byte budget after workspace normalization.');
    const requests = [
      { jsonrpc: JSON_RPC_VERSION, id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'rea-pro-max-provider', version: VERSION } } },
      { jsonrpc: JSON_RPC_VERSION, method: 'notifications/initialized' },
      { jsonrpc: JSON_RPC_VERSION, id: 2, method: 'tools/list', params: {} },
    ];
    const tool = this.commands[command];
    if (tool) requests.push({ jsonrpc: JSON_RPC_VERSION, id: 3, method: 'tools/call', params: { name: tool, arguments: JSON.parse(canonical(payload)) } });
    let child; let stdoutBuffer = ''; let stderr = ''; let stderrBytes = 0; let bytes = 0; let terminalError; let handshake; let capabilities = []; let response; let nextExpected = 1; let timeout; let killTimer; let abortHandler; let closed = false;
    const cleanup = { process_spawned: false, process_terminated: false, stdin_closed: false, forced_kill: false };
    let resolveResult; const resultPromise = new Promise(resolve => { resolveResult = resolve; });
    const finish = result => { if (closed) return; closed = true; resolveResult(result); };
    const terminate = force => { if (!child || child.exitCode !== null || child.signalCode !== null) return; if (force) { cleanup.forced_kill = true; child.kill('SIGKILL'); } else child.kill('SIGTERM'); };
    const gracefulTerminate = () => { terminate(false); killTimer ||= setTimeout(() => terminate(true), 250); };
    try { child = spawn(admitted.executable, this.args, { cwd: admitted.workspace, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: safeEnvironment() }); cleanup.process_spawned = true; }
    catch (error) { return failure('provider_error', errorRecord('provider_spawn', error.message), provenance({ manifest: this.manifest, command, executable: admitted.executable, workspace: admitted.workspace, requestId, startedAt, finishedAt: new Date().toISOString(), cleanup, bytes: 0, exitCode: null, signalCode: null })); }
    const parseLine = line => {
      if (!line.trim()) return;
      let value; try { value = JSON.parse(line); } catch { throw new RpmError('provider_protocol', 'Provider returned a non-JSON line.'); }
      if (!object(value) || value.jsonrpc !== JSON_RPC_VERSION) throw new RpmError('provider_protocol', 'Provider output is not JSON-RPC 2.0.');
      if (value.id === undefined) return; // notification/progress
      if (value.id !== nextExpected) throw new RpmError('provider_protocol', 'Provider response ID was out of sequence.', { expected: nextExpected, received: value.id });
      const result = checkRpc(value, nextExpected);
      if (nextExpected === 1) {
        if (!object(result) || result.protocolVersion !== MCP_PROTOCOL_VERSION || !object(result.serverInfo) || result.serverInfo.name !== this.provider || typeof result.serverInfo.version !== 'string') throw new RpmError('provider_drift', 'Provider initialize response is missing the pinned server identity or protocol version.');
        for (const [key, expected] of Object.entries(this.expectedServer)) if (result.serverInfo[key] !== expected) throw new RpmError('provider_drift', `Provider serverInfo.${key} does not match the pinned manifest.`, { expected, received: result.serverInfo[key] });
        handshake = result;
      } else if (nextExpected === 2) {
        if (!object(result) || !Array.isArray(result.tools) || result.tools.length > 2048) throw new RpmError('provider_protocol', 'Provider tools/list response is not bounded.');
        capabilities = result.tools.map(item => item?.name).filter(name => typeof name === 'string');
        if (!capabilities.includes(tool) && tool) throw new RpmError('provider_capability', `Provider did not advertise approved tool ${tool}.`);
      } else if (nextExpected === 3) response = result;
      nextExpected++;
      if (!tool && nextExpected === 3) gracefulTerminate();
      if (tool && nextExpected === 4) gracefulTerminate();
    };
    child.stdout.on('data', chunk => { bytes += chunk.byteLength; if (bytes > this.maxBytes) { terminalError ||= new RpmError('provider_bounds', 'Provider output exceeded its byte budget.'); terminate(true); return; } stdoutBuffer += chunk.toString('utf8'); if (stdoutBuffer.length > this.maxBytes) { terminalError ||= new RpmError('provider_bounds', 'Provider output exceeded its byte budget.'); terminate(true); return; } while (!closed && !terminalError) { const newline = stdoutBuffer.indexOf('\n'); if (newline < 0) break; const line = stdoutBuffer.slice(0, newline).replace(/\r$/u, ''); stdoutBuffer = stdoutBuffer.slice(newline + 1); try { parseLine(line); } catch (error) { terminalError ||= error instanceof RpmError ? error : new RpmError('provider_protocol', error.message); terminate(true); break; } } });
    child.stderr.on('data', chunk => { stderrBytes += chunk.byteLength; stderr = (stderr + chunk.toString('utf8')).slice(-4096); if (stderrBytes > this.maxBytes) { terminalError ||= new RpmError('provider_bounds', 'Provider diagnostics exceeded its byte budget.'); terminate(true); } });
    child.on('error', error => { terminalError ||= new RpmError('provider_spawn', error.message); });
    child.on('close', (exitCode, signalCode) => {
      cleanup.process_terminated = true;
      const proof = provenance({ manifest: this.manifest, command, tool, executable: admitted.executable, workspace: admitted.workspace, requestId, startedAt, finishedAt: new Date().toISOString(), handshake, capabilities, cleanup, bytes, exitCode, signalCode });
      if (!terminalError && handshake && nextExpected === (tool ? 4 : 3) && (!tool || response !== undefined)) {
        if (!tool) finish({ status: 'ok', data: { server: handshake.serverInfo, protocolVersion: handshake.protocolVersion, capabilities }, provenance: proof });
        else if (response?.isError) finish(failure('provider_error', errorRecord('provider_tool', 'Provider tool reported an error.', { response }), proof));
        else finish({ status: 'ok', data: response, provenance: proof });
      } else {
        const error = terminalError || new RpmError('provider_protocol', 'Provider exited without a complete MCP response.', { stderr });
        const status = ['provider_drift', 'provider_capability', 'provider_protocol', 'provider_bounds', 'request_cancelled'].includes(error.code) ? 'unknown' : 'provider_error';
        finish(failure(status, errorRecord(error.code, error.message, { stderr, rpc_id: nextExpected }), proof));
      }
    });
    timeout = setTimeout(() => { terminalError ||= new RpmError('provider_timeout', 'Provider exceeded its deadline.'); terminate(false); killTimer ||= setTimeout(() => terminate(true), 250); }, this.timeoutMs);
    abortHandler = () => { terminalError ||= new RpmError('request_cancelled', 'Provider execution was cancelled.'); if (child.stdin.writable) { try { child.stdin.write(`${JSON.stringify({ jsonrpc: JSON_RPC_VERSION, method: 'notifications/cancelled', params: { requestId: 3 } })}\n`); } catch {} } terminate(false); killTimer ||= setTimeout(() => terminate(true), 250); };
    signal?.addEventListener('abort', abortHandler, { once: true }); if (signal?.aborted) abortHandler();
    try { child.stdin.write(requests.map(request => JSON.stringify(request)).join('\n') + '\n'); child.stdin.end(); cleanup.stdin_closed = true; } catch (error) { terminalError = new RpmError('provider_io', error.message); terminate(true); }
    const result = await resultPromise; clearTimeout(timeout); clearTimeout(killTimer); signal?.removeEventListener('abort', abortHandler); return result;
  }

  async run(command, input = {}, options = {}) { return this.execute(command, input, options); }
}

export function providerDigest(manifest) { return digest(manifest); }

// Compatibility names make the transport discoverable without exposing a
// second implementation. The wire protocol remains MCP JSON-RPC over lines.
export const JsonLineProvider = JsonRpcProvider;
export const createJsonLineProvider = options => new JsonRpcProvider(options);

