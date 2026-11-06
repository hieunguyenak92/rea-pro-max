import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class RpmError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'RpmError'; this.code = code; this.details = details;
  }
}
export function canonical(value) {
  const seen = new Set();
  function visit(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || seen.has(item)) throw new RpmError('invalid_json', 'Use finite JSON values without circular references.');
    seen.add(item);
    let result;
    if (Array.isArray(item)) result = item.map(visit);
    else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new RpmError('invalid_json', 'Use plain JSON objects.');
      result = Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(item[key])]));
    }
    seen.delete(item); return result;
  }
  return JSON.stringify(visit(value));
}
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = value => hashBytes(canonical(value));
export function readJson(path, maxBytes = 4 * 1024 * 1024) {
  if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RpmError('input_bounds', 'JSON byte limit must be a positive safe integer.');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new RpmError('input_bounds', 'Use a bounded regular JSON file.');
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > maxBytes) throw new RpmError('input_bounds', 'Use a bounded regular JSON file.');
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(descriptor);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino || after.dev !== before.dev) {
      throw new RpmError('input_changed', 'JSON input changed during reading. Retry against a stable copy.');
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))); }
    catch (error) { throw new RpmError('invalid_json', `Cannot read JSON: ${error.message}`); }
  } catch (error) {
    if (error instanceof RpmError) throw error;
    throw new RpmError(error.code === 'ELOOP' ? 'input_bounds' : 'invalid_json', `Cannot read JSON: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
export function writeJsonAtomic(path, value) {
  const temporary = join(dirname(path), `.rpm-${randomUUID()}.tmp`);
  try { writeFileSync(temporary, JSON.stringify(JSON.parse(canonical(value)), null, 2) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(temporary, path); }
  finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
export function pointer(value, path) {
  if (path === '') return value;
  if (typeof path !== 'string' || !path.startsWith('/') || /~(?![01])/u.test(path)) throw new RpmError('invalid_pointer', 'Use an RFC6901 JSON pointer.');
  for (const token of path.slice(1).split('/').map(part => part.replace(/~1/gu, '/').replace(/~0/gu, '~'))) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, token) || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/u.test(token))) throw new RpmError('missing_pointer', `No value at ${path}.`);
    value = value[token];
  }
  return value;
}

export function pathExists(path) {
  try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
