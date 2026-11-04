import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { RpmError, hashBytes } from '../common.mjs';

export const MCP_LIMITS = Object.freeze({ maxArtifacts: 16, maxCacheBytes: 32 * 1024 * 1024, maxJsonBytes: 4 * 1024 * 1024, maxResponseBytes: 64 * 1024, maxPage: 50, maxPromptPage: 10, maxQueryChars: 200, maxToolInputElements: 50_000, maxInputBufferBytes: 4 * 1024 * 1024, maxConcurrentHeavy: 2 });
export function checkCancelled(context) {
  if (context?.signal?.aborted) throw new RpmError('request_cancelled', 'The request was cancelled; retry explicitly if the result is still needed.');
}
export function checkedMcpLimits(overrides = {}) {
  const result = { ...MCP_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(result, key) || !Number.isSafeInteger(value) || value < 1 || value > MCP_LIMITS[key]) throw new RpmError('invalid_limits', 'MCP limits must be known positive integers no greater than the release defaults.');
    result[key] = value;
  }
  return Object.freeze(result);
}
function contained(root, path) {
  const location = relative(root, path);
  return location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location);
}

/** Explicit workspace policy, not an OS sandbox against another process mutating directories. */
export class WorkspacePolicy {
  constructor(workspace, limits = MCP_LIMITS) {
    if (typeof workspace !== 'string' || !isAbsolute(workspace) || workspace.includes('\0')) throw new RpmError('invalid_workspace', 'Supply an absolute existing workspace directory.');
    const selected = lstatSync(workspace);
    if (!selected.isDirectory() || selected.isSymbolicLink()) throw new RpmError('invalid_workspace', 'Workspace must be an existing regular directory, not a symlink.');
    // OS parent aliases such as /var -> /private/var are resolved once at admission.
    this.selectedRoot = resolve(workspace); this.root = realpathSync(workspace); this.limits = limits;
  }
  resolveInput(request, type = 'artifact') {
    if (typeof request !== 'string' || !request.trim() || request.length > 4096 || request.includes('\0')) throw new RpmError('invalid_path', 'Supply a nonempty local path of at most4096 characters.');
    let path = resolve(this.root, request);
    if (isAbsolute(request) && contained(this.selectedRoot, path)) path = resolve(this.root, relative(this.selectedRoot, path));
    // Permit a client to use its originally selected OS alias, without following links inside the root.
    if (!contained(this.root, path)) throw new RpmError('outside_workspace', 'The requested path is outside the configured workspace. Use a relative workspace path.');
    this.checkComponents(path);
    const stat = lstatSync(path);
    if (type === 'json' ? !stat.isFile() : !stat.isFile() && !stat.isDirectory()) throw new RpmError('unsupported_input', 'Use a regular local file or artifact directory; special files are not admitted.');
    if (!contained(this.root, realpathSync(path))) throw new RpmError('outside_workspace', 'The requested path no longer belongs to the workspace.');
    return path;
  }
  checkComponents(path) {
    if (!contained(this.root, path)) throw new RpmError('outside_workspace', 'Path leaves the configured workspace.');
    let current = this.root;
    if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink()) throw new RpmError('workspace_changed', 'Workspace changed; restart the server against a stable directory.');
    for (const part of relative(this.root, path).split(sep).filter(Boolean)) {
      current = resolve(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new RpmError('symlink_input', 'Symlink components inside the workspace are not followed.');
    }
  }
  readJson(request) {
    const path = this.resolveInput(request, 'json');
    const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const before = fstatSync(descriptor);
      if (!before.isFile() || before.size > this.limits.maxJsonBytes) throw new RpmError('input_bounds', 'JSON input exceeds the admitted regular-file byte limit.');
      const buffer = Buffer.alloc(before.size + 1); let length = 0;
      while (length < buffer.length) { const count = readSync(descriptor, buffer, length, buffer.length - length, length); if (!count) break; length += count; }
      const after = fstatSync(descriptor);
      if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new RpmError('input_changed', 'JSON input changed during reading. Retry against a stable copy.');
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))); }
      catch { throw new RpmError('invalid_json', 'Input must contain valid UTF-8 JSON.'); }
    } finally { closeSync(descriptor); }
  }
  writeNew(request, content, context) {
    if (typeof request !== 'string' || !request.trim() || request.length > 4096 || isAbsolute(request) || request.includes('\0')) throw new RpmError('invalid_output_path', 'Use a relative new output filename within the configured workspace.');
    const path = resolve(this.root, request);
    if (!contained(this.root, path) || path === this.root) throw new RpmError('outside_workspace', 'Output must stay within the configured workspace.');
    this.checkComponents(dirname(path));
    if (!lstatSync(dirname(path)).isDirectory()) throw new RpmError('invalid_output_path', 'Output parent must be an existing regular directory.');
    checkCancelled(context);
    let descriptor;
    try { descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new RpmError('output_exists', 'Output already exists, including symlinks. Choose a new filename.'); throw error; }
    const bytes = Buffer.from(content, 'utf8'); let completed = false;
    try {
      checkCancelled(context);
      let offset = 0;
      while (offset < bytes.length) { const written = writeSync(descriptor, bytes, offset, bytes.length - offset); if (!written) throw new RpmError('output_write', 'Output write made no progress.'); offset += written; }
      completed = true;
    } finally {
      closeSync(descriptor);
      if (!completed) { try { unlinkSync(path); } catch {} }
    }
    return { path: relative(this.root, path).split(sep).join('/'), bytes: bytes.length, sha256: hashBytes(bytes) };
  }
}
