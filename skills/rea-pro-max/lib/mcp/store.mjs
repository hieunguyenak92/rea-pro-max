import { randomUUID } from 'node:crypto';
import { RpmError, canonical } from '../common.mjs';
import { MCP_LIMITS } from './policy.mjs';

/** FIFO session cache measured in serialized JSON bytes; no hidden persistent state. */
export class SessionStore {
  constructor(limits = MCP_LIMITS) { this.limits = limits; this.entries = new Map(); this.bytes = 0; }
  encode(data, context) {
    const json = canonical(data), metadata = canonical(context); const bytes = Buffer.byteLength(json) + Buffer.byteLength(metadata);
    if (bytes > this.limits.maxCacheBytes) throw new RpmError('artifact_too_large', 'This artifact exceeds the session cache byte budget. Select a narrower target.');
    return { json, metadata, bytes };
  }
  put(kind, data, context = {}) {
    const encoded = this.encode(data, context); const handle = `rpm_${kind}_${randomUUID()}`;
    this.entries.set(handle, { kind, ...encoded }); this.bytes += encoded.bytes; this.trim(handle); return handle;
  }
  get(handle, expectedKind) {
    const entry = this.entries.get(handle);
    if (!entry) throw new RpmError('unknown_handle', 'Handle is unknown, expired or evicted. Inspect/import again, or export important work before opening more artifacts.');
    if (expectedKind && entry.kind !== expectedKind) throw new RpmError('wrong_handle_kind', `This operation requires a ${expectedKind} handle.`);
    return { handle, kind: entry.kind, data: JSON.parse(entry.json), context: JSON.parse(entry.metadata), bytes: entry.bytes };
  }
  peek(handle) { return this.entries.has(handle) ? this.get(handle) : null; }
  replace(handle, data, context = {}) {
    const before = this.get(handle); const encoded = this.encode(data, context);
    this.entries.delete(handle); this.entries.set(handle, { kind: before.kind, ...encoded }); this.bytes += encoded.bytes - before.bytes; this.trim(handle); return handle;
  }
  trim(preserve) {
    for (const [handle, entry] of this.entries) {
      if (this.entries.size <= this.limits.maxArtifacts && this.bytes <= this.limits.maxCacheBytes) break;
      if (handle === preserve) continue;
      this.entries.delete(handle); this.bytes -= entry.bytes;
    }
  }
  stats() { return { artifacts: this.entries.size, serialized_json_bytes: this.bytes, measurement: 'retained serialized JSON; excludes in-flight work, VM and process memory', eviction: 'oldest committed artifact first', persistence: 'process lifetime only; explicit export/import for resume' }; }
}
