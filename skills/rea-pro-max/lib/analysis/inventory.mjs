import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { digest, hashBytes, RpmError } from '../common.mjs';

export const DEFAULT_LIMITS = Object.freeze({ maxFiles: 256, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024, maxAstNodes: 100_000, maxDepth: 32, maxContexts: 128, maxNodes: 5000, maxEdges: 10000, maxEvidence: 5000, maxAnalysisOccurrences: 1024, maxDiagnostics: 2000 });
export const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const posix = path => path.split(sep).join('/');

function checkedLimits(options) {
  const result = { ...DEFAULT_LIMITS };
  for (const name of Object.keys(result)) {
    if (options[name] !== undefined) {
      const value = options[name];
      if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[name] * 16) throw new RpmError('invalid_limits', `${name} must be a positive bounded integer.`);
      result[name] = value;
    }
  }
  return result;
}


async function readRegularFile(absolute, expected, name) {
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expected.size || before.ino !== expected.ino || before.dev !== expected.dev) throw new RpmError('input_changed', 'Artifact identity changed during admission.', { file: name });
    // Read at most the admitted length plus one byte, even if another process grows the file.
    const body = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < body.length) {
      const { bytesRead } = await handle.read(body, offset, body.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new RpmError('input_changed', 'Artifact content changed during reading; retry against a stable copy.', { file: name });
    return body.subarray(0, offset);
  } finally { await handle.close(); }
}

export async function inventory(inputPath, options = {}) {
  if (typeof inputPath !== 'string' || !inputPath) throw new RpmError('missing_target', 'Supply an artifact file or extracted application directory.');
  const selectedPath = resolve(inputPath);
  const limits = checkedLimits(options);
  const initial = await lstat(selectedPath);
  if (initial.isSymbolicLink()) throw new RpmError('symlink_input', 'A selected artifact symlink is not followed.');
  // The selected artifact establishes the scope; canonicalize OS/user parent aliases once.
  const path = await realpath(selectedPath);
  if (!initial.isDirectory() && !initial.isFile()) throw new RpmError('unsupported_input', 'Use a regular artifact file or directory.');
  const root = initial.isDirectory() ? path : dirname(path);
  const files = new Map();
  let bytes = 0;
  async function visit(absolute, depth) {
    if (depth > limits.maxDepth) throw new RpmError('artifact_bounds', 'Artifact directory depth exceeds the admitted bound.', { max_depth: limits.maxDepth });
    const stat = await lstat(absolute);
    const name = posix(relative(root, absolute));
    if (stat.isSymbolicLink()) throw new RpmError('symlink_input', 'Artifact symlinks are not followed.', { file: name });
    if (stat.isDirectory()) {
      const children = await readdir(absolute);
      for (const child of children.sort(compareText)) await visit(resolve(absolute, child), depth + 1);
      return;
    }
    if (!stat.isFile()) throw new RpmError('unsupported_input', 'Special files are not admitted.', { file: name });
    if (files.size >= limits.maxFiles || stat.size > limits.maxFileBytes || bytes + stat.size > limits.maxTotalBytes) throw new RpmError('artifact_bounds', 'Artifact exceeds file-count or byte limits; select a narrower extracted scope.', { file: name, max_files: limits.maxFiles, max_file_bytes: limits.maxFileBytes, max_total_bytes: limits.maxTotalBytes });
    const body = await readRegularFile(absolute, stat, name);
    if (body.byteLength > limits.maxFileBytes || bytes + body.byteLength > limits.maxTotalBytes) throw new RpmError('artifact_bounds', 'Artifact changed beyond the admitted byte bound during reading.', { file: name });
    bytes += body.byteLength;
    files.set(name, { path: name, absolute, bytes: body, sha256: hashBytes(body), size: body.byteLength });
  }
  await visit(path, 0);
  const entries = [...files.values()].sort((a, b) => compareText(a.path, b.path));
  const sha256 = initial.isFile() ? entries[0].sha256 : digest(entries.map(file => ({ path: file.path, sha256: file.sha256, bytes: file.size })));
  return { path, root, inputFile: initial.isFile() ? basename(path) : null, files, entries, sha256, bytes, limits };
}

export function decodeText(file) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
  catch { throw new RpmError('invalid_encoding', 'Static source must be valid UTF-8.', { file: file.path }); }
}

export function resolveLocal(fromFile, request, fileMap) {
  if (typeof request !== 'string' || !request) return { error: 'dynamic_location', request: null };
  if (/^[a-z][a-z0-9+.-]*:/iu.test(request) || request.startsWith('//')) return { error: 'external_location', request };
  if (request.includes('\\') || request.includes('\0') || isAbsolute(request)) return { error: 'outside_scope', request };
  let clean;
  try { clean = decodeURIComponent(request.split(/[?#]/u, 1)[0]); }
  catch { return { error: 'invalid_location', request }; }
  const virtualRoot = resolve('/rpm-artifact');
  const destination = resolve(virtualRoot, dirname(fromFile), clean);
  const name = posix(relative(virtualRoot, destination));
  if (name === '..' || name.startsWith('../') || isAbsolute(name)) return { error: 'outside_scope', request };
  const attempts = [name];
  if (!extname(name)) attempts.push(`${name}.js`, `${name}.mjs`, `${name}.cjs`, `${name}/index.js`);
  const matches = attempts.filter(attempt => fileMap.has(attempt));
  if (matches.length === 1) return { path: matches[0] };
  if (matches.length > 1) return { error: 'ambiguous_location', request };
  return { error: 'missing_location', request, path: name };
}

export function classifyBytes(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes.subarray(1, 4).toString() === 'ELF') return 'elf';
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString() === 'MZ') return 'pe-candidate';
  if (bytes.length >= 4 && ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(bytes.subarray(0, 4).toString('hex'))) return 'mach-o-candidate';
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) return 'wasm';
  if (bytes.length >= 4 && ['504b0304', '504b0506', '504b0708'].includes(bytes.subarray(0, 4).toString('hex'))) return 'zip-container';
  return null;
}
