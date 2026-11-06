// Owned regression fixture: intentionally loses data and request history when its worker stops.
const bootId = crypto.randomUUID();
let pending = Promise.resolve();
const emptyState = () => ({ schema_version: 1, revision: 0, entries: [], requests: [] });
let memory = emptyState();
async function readState() { return structuredClone(memory); }
async function writeState(state) { memory = structuredClone(state); }
const reject = code => ({ ok: false, error: { code }, boot_id: bootId });
const accept = result => ({ ok: true, result, boot_id: bootId });

function invalid(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return 'invalid_message';
  const fields = { put: ['type', 'key', 'value', 'requestId'], remove: ['type', 'key', 'requestId'], get: ['type', 'key'], snapshot: ['type'], boot: ['type'] };
  if (typeof message.type !== 'string' || !Object.hasOwn(fields, message.type)) return 'unsupported_operation';
  if (Object.keys(message).some(key => !fields[message.type].includes(key))) return 'invalid_message';
  if (['put', 'remove', 'get'].includes(message.type) && (typeof message.key !== 'string' || message.key.length < 1 || message.key.length > 128)) return 'invalid_key';
  if (message.type === 'put' && (typeof message.value !== 'string' || message.value.length > 4096)) return 'invalid_value';
  if (['put', 'remove'].includes(message.type) && (typeof message.requestId !== 'string' || message.requestId.length < 1 || message.requestId.length > 128)) return 'invalid_request_id';
  return null;
}
async function execute(message) {
  const error = invalid(message);
  if (error) return reject(error);
  if (message.type === 'boot') return accept({ protocol: 'rpm-kv-v1' });
  const state = await readState();
  if (message.type === 'snapshot') return accept({ revision: state.revision, entries: state.entries.slice().sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) });
  const index = state.entries.findIndex(entry => entry.key === message.key);
  if (message.type === 'get') return accept({ revision: state.revision, found: index >= 0, value: index >= 0 ? state.entries[index].value : null });
  const fingerprint = JSON.stringify([message.type, message.key, message.type === 'put' ? message.value : null]);
  const prior = state.requests.find(request => request.id === message.requestId);
  if (prior) return prior.fingerprint === fingerprint ? accept(prior.result) : reject('request_conflict');
  if (state.requests.length >= 256) return reject('request_limit');
  if (message.type === 'put' && index < 0 && state.entries.length >= 128) return reject('entry_limit');
  const revision = state.revision + 1;
  let result;
  if (message.type === 'put') {
    const entry = { key: message.key, value: message.value };
    if (index < 0) state.entries.push(entry); else state.entries[index] = entry;
    result = { revision, key: message.key, value: message.value };
  } else {
    if (index >= 0) state.entries.splice(index, 1);
    result = { revision, key: message.key, removed: index >= 0 };
  }
  state.revision = revision;
  state.requests.push({ id: message.requestId, fingerprint, result });
  await writeState(state);
  return accept(result);
}
// Warm-session semantics are correct; this intentionally does not provide durable storage.
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  pending = pending.catch(() => {}).then(() => execute(message)).then(respond, () => respond(reject('storage_failure')));
  return true;
});
