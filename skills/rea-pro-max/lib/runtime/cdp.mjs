import { RpmError } from '../common.mjs';

/** Small, bounded transport for our disposable Chromium session, not a public CDP proxy. */
export class CdpConnection {
  constructor(socket, { timeoutMs = 10000, signal } = {}) {
    this.socket = socket; this.timeoutMs = timeoutMs; this.pending = new Map(); this.listeners = new Map(); this.nextId = 0; this.closed = false;
    this.abort = () => this.close(new RpmError('request_cancelled', 'Runtime capture was cancelled.'));
    this.signal = signal; signal?.addEventListener('abort', this.abort, { once: true });
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > 4 * 1024 * 1024) { this.close(new RpmError('runtime_bounds', 'Chromium response exceeded the transport budget.')); return; }
      let message;
      try { message = JSON.parse(event.data); } catch { this.close(new RpmError('runtime_protocol', 'Chromium returned invalid protocol JSON.')); return; }
      if (message.id !== undefined) {
        const waiting = this.pending.get(message.id); if (!waiting) return;
        this.pending.delete(message.id); clearTimeout(waiting.timer);
        if (message.error) waiting.reject(new RpmError('runtime_protocol', `${waiting.method}: ${String(message.error.message).slice(0, 500)}`, { method: waiting.method }));
        else waiting.resolve(message.result || {});
      } else for (const listener of this.listeners.get(message.method) || []) listener(message.params || {}, message.sessionId);
    });
    socket.addEventListener('close', () => this.close(new RpmError('runtime_disconnected', 'Chromium connection closed.')));
    socket.addEventListener('error', () => this.close(new RpmError('runtime_disconnected', 'Chromium connection failed.')));
  }
  static async connect(url, options = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1') throw new RpmError('runtime_endpoint', 'Use the disposable browser loopback WebSocket.');
    const socket = new globalThis.WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new RpmError('runtime_timeout', 'Chromium WebSocket did not open.')); }, options.timeoutMs || 10000);
      const done = callback => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); callback(); };
      const abort = () => done(() => { socket.close(); reject(new RpmError('request_cancelled', 'Runtime capture was cancelled.')); });
      socket.addEventListener('open', () => done(resolve), { once: true });
      socket.addEventListener('error', () => done(() => reject(new RpmError('runtime_connection', 'Could not connect to disposable Chromium.'))), { once: true });
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
    });
    return new CdpConnection(socket, options);
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }
  send(method, params = {}, sessionId, timeoutMs = this.timeoutMs) {
    if (this.closed) return Promise.reject(new RpmError('runtime_disconnected', 'Chromium connection is closed.'));
    if (this.pending.size >= 32) return Promise.reject(new RpmError('runtime_bounds', 'Too many pending Chromium requests.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new RpmError('runtime_timeout', `Chromium ${method} exceeded its deadline.`, { method })); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new RpmError('runtime_disconnected', 'Could not send Chromium request.')); }
    });
  }
  close(error = new RpmError('runtime_disconnected', 'Chromium connection closed.')) {
    if (this.closed) return; this.closed = true;
    this.signal?.removeEventListener('abort', this.abort);
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear(); this.listeners.clear(); this.socket.close();
  }
}
