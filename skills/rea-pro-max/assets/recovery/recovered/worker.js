const protocol = 'rpm-kv-v1';
const storageKey = 'rpm-kv-v1-state';
const bootId = crypto.randomUUID();
const fields = new Map([
  ['boot', new Set(['type'])],
  ['put', new Set(['type', 'key', 'value', 'requestId'])],
  ['get', new Set(['type', 'key'])],
  ['remove', new Set(['type', 'key', 'requestId'])],
  ['snapshot', new Set(['type'])],
]);
let state;
let queue = Promise.resolve();

function success(result) { return { ok: true, result, boot_id: bootId }; }
function failure(code) { return { ok: false, error: { code }, boot_id: bootId }; }
function boundedString(value, minimum, maximum) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function validate(message) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return 'invalid_message';
  if (!Object.hasOwn(message, 'type') || !fields.has(message.type)) return 'unsupported_operation';
  if (Object.keys(message).some(field => !fields.get(message.type).has(field))) return 'invalid_message';
  if (['put', 'get', 'remove'].includes(message.type) && !boundedString(message.key, 1, 128)) return 'invalid_key';
  if (message.type === 'put' && !boundedString(message.value, 0, 4096)) return 'invalid_value';
  if (['put', 'remove'].includes(message.type) && !boundedString(message.requestId, 1, 128)) return 'invalid_request_id';
  return null;
}

async function loadState() {
  if (state) return state;
  const stored = (await chrome.storage.local.get(storageKey))[storageKey];
  if (stored === undefined) {
    state = { revision: 0, values: new Map(), receipts: new Map() };
  } else {
    // A version marker prevents silently treating an unrelated value as our state.
    // Corruption and migration are outside the recovery contract.
    if (stored.format !== 1 || !Number.isSafeInteger(stored.revision) || stored.revision < 0 ||
        !Array.isArray(stored.values) || !Array.isArray(stored.receipts)) throw new Error('Invalid stored state');
    state = { revision: stored.revision, values: new Map(stored.values), receipts: new Map(stored.receipts) };
  }
  return state;
}

function sameMutation(receipt, message) {
  return receipt.type === message.type && receipt.key === message.key &&
    (message.type !== 'put' || receipt.value === message.value);
}

async function mutate(current, message) {
  const previous = current.receipts.get(message.requestId);
  if (previous) return sameMutation(previous, message) ? success(previous.result) : failure('request_conflict');
  if (current.receipts.size >= 256) return failure('request_limit');
  if (message.type === 'put' && !current.values.has(message.key) && current.values.size >= 128) return failure('entry_limit');

  const next = { revision: current.revision + 1, values: new Map(current.values), receipts: new Map(current.receipts) };
  let result;
  if (message.type === 'put') {
    next.values.set(message.key, message.value);
    result = { revision: next.revision, key: message.key, value: message.value };
  } else {
    result = { revision: next.revision, key: message.key, removed: next.values.delete(message.key) };
  }
  const receipt = { type: message.type, key: message.key, result };
  if (message.type === 'put') receipt.value = message.value;
  next.receipts.set(message.requestId, receipt);

  // One storage item commits the data and the receipt together. Publish the new
  // in-memory state and acknowledge only after the durable write completes.
  await chrome.storage.local.set({ [storageKey]: {
    format: 1,
    revision: next.revision,
    values: [...next.values],
    receipts: [...next.receipts],
  } });
  state = next;
  return success(result);
}

async function execute(message) {
  const error = validate(message);
  if (error) return failure(error);
  if (message.type === 'boot') return success({ protocol });
  const current = await loadState();
  if (message.type === 'put' || message.type === 'remove') return mutate(current, message);
  if (message.type === 'get') {
    const found = current.values.has(message.key);
    return success({ revision: current.revision, found, value: found ? current.values.get(message.key) : null });
  }
  const entries = [...current.values]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => ({ key, value }));
  return success({ revision: current.revision, entries });
}

// Register synchronously so waking the worker can deliver its first message.
// A failed write must not poison later messages or let another mutation overtake it.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const response = queue.then(() => execute(message));
  queue = response.catch(() => undefined);
  response.then(sendResponse, () => sendResponse(failure('storage_failure')));
  return true;
});
