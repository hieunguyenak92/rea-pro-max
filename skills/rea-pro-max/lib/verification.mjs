import { RpmError, canonical, digest } from './common.mjs';

const REQUIRED_BINDINGS = ['target_sha256', 'scenario_sha256', 'reset_sha256', 'toolchain_sha256', 'verifier_sha256'];
const COMPARABLE_BINDINGS = REQUIRED_BINDINGS.filter(key => key !== 'target_sha256');
const HASH = /^[a-fA-F0-9]{64}$/u;
const textOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const copy = value => JSON.parse(canonical(value));
const same = (a, b) => canonical(a) === canonical(b);
const own = (value, key) => Object.hasOwn(value, key);
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RpmError('invalid_receipt', `${label} must be an object.`);
}
function name(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new RpmError('invalid_receipt', `${label} must be a nonempty bounded string.`);
}
function validateReceipt(value, label) {
  object(value, label); const result = copy(value);
  if (result.schema_version !== 1) throw new RpmError('receipt_version', `${label} must use receipt schema_version 1.`);
  if (result.complete !== undefined && typeof result.complete !== 'boolean') throw new RpmError('invalid_receipt', `${label}.complete must be boolean.`);
  if (!Array.isArray(result.cases) || result.cases.length > 10000) throw new RpmError('invalid_receipt', `${label}.cases must be a bounded array.`);
  const reasons = []; const ids = new Set();
  if (result.complete !== true) reasons.push(`${label}:incomplete_receipt`);
  if (!result.bindings || typeof result.bindings !== 'object' || Array.isArray(result.bindings)) {
    result.bindings = {}; reasons.push(`${label}:missing_bindings`);
  }
  for (const key of REQUIRED_BINDINGS) {
    if (typeof result.bindings[key] !== 'string' || !HASH.test(result.bindings[key])) reasons.push(`${label}:missing_or_invalid_${key}`);
    else result.bindings[key] = result.bindings[key].toLowerCase();
  }
  for (const item of result.cases) {
    object(item, `${label} case`); name(item.id, 'Case ID');
    if (Object.keys(item).some(key => !['id', 'input', 'output', 'state', 'effects', 'trace', 'metadata', 'complete'].includes(key))) throw new RpmError('invalid_receipt', 'Case fields are id, input, output, state, effects, trace, metadata and optional complete.');
    if (ids.has(item.id)) throw new RpmError('duplicate_case', `${label} repeats case ID ${item.id}.`);
    ids.add(item.id);
    if (item.complete !== undefined && typeof item.complete !== 'boolean') throw new RpmError('invalid_receipt', 'Per-case complete must be boolean.');
    if (item.trace !== undefined) {
      if (!Array.isArray(item.trace) || item.trace.length > 100000) throw new RpmError('invalid_trace', 'Trace must be a bounded event array.');
      for (const event of item.trace) {
        object(event, 'Trace event'); name(event.channel, 'Trace channel'); name(event.name, 'Trace name');
        if (!own(event, 'value')) throw new RpmError('invalid_trace', 'Every event needs an explicit value, including null when appropriate.');
        if (Object.keys(event).some(key => !['channel', 'name', 'value'].includes(key))) throw new RpmError('invalid_trace', 'Put compared event data in value; event fields are channel, name and value.');
      }
    }
  }
  return { receipt: result, reasons };
}
function validateContract(value) {
  object(value, 'Contract'); const contract = copy(value);
  if (contract.schema_version !== undefined && contract.schema_version !== 1) throw new RpmError('contract_version', 'Use contract schema_version 1.');
  if (Object.keys(contract).some(key => !['schema_version', 'trace_order', 'volatile_paths', 'expected_bindings'].includes(key))) throw new RpmError('invalid_contract', 'Unknown behavioral contract field.');
  contract.schema_version = 1; contract.trace_order ??= 'total'; contract.volatile_paths ??= [];
  if (!['total', 'per-channel'].includes(contract.trace_order)) throw new RpmError('invalid_contract', 'Trace order is total or per-channel.');
  if (!Array.isArray(contract.volatile_paths) || contract.volatile_paths.length > 100 || new Set(contract.volatile_paths).size !== contract.volatile_paths.length) throw new RpmError('invalid_contract', 'Use a bounded, unique volatile_paths array.');
  for (const path of contract.volatile_paths) {
    if (typeof path !== 'string' || !path.startsWith('/metadata/') || path.length > 1024 || /~(?![01])/u.test(path)) throw new RpmError('unsafe_normalization', 'Only explicit RFC6901 paths below /metadata/ may be volatile.');
  }
  if (contract.expected_bindings !== undefined) {
    object(contract.expected_bindings, 'Expected bindings');
    for (const [side, bindings] of Object.entries(contract.expected_bindings)) {
      if (!['reference', 'candidate'].includes(side)) throw new RpmError('invalid_contract', 'Expected bindings use reference or candidate keys.');
      object(bindings, 'Expected side bindings');
      for (const [key, value] of Object.entries(bindings)) {
        if (!key.endsWith('_sha256') || typeof value !== 'string' || !HASH.test(value)) throw new RpmError('invalid_contract', 'Expected bindings are explicit SHA-256 identity fields.');
        bindings[key] = value.toLowerCase();
      }
    }
  }
  return contract;
}
function normalizedCase(value, paths) {
  const item = copy(value);
  for (const path of paths) {
    const parts = path.slice(1).split('/').map(part => part.replace(/~1/gu, '/').replace(/~0/gu, '~'));
    let parent = item;
    for (const key of parts.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !own(parent, key)) { parent = null; break; }
      parent = parent[key];
    }
    if (parent && typeof parent === 'object') delete parent[parts.at(-1)];
  }
  return item;
}
function channelTrace(trace) {
  const groups = new Map();
  for (const event of trace) {
    if (!groups.has(event.channel)) groups.set(event.channel, []);
    groups.get(event.channel).push({ name: event.name, value: event.value });
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => textOrder(a, b)));
}
function compareCase(reference, candidate, contract, globalReasons) {
  const reasons = [...globalReasons]; const differences = [];
  const missingFields = ['input', 'output', 'state', 'effects'].filter(key => !own(reference, key) || !own(candidate, key));
  if (missingFields.length) reasons.push(...missingFields.map(key => `missing_${key}`));
  if (reference.complete === false || candidate.complete === false) reasons.push('incomplete_case');
  if (own(reference, 'input') && own(candidate, 'input') && !same(reference.input, candidate.input)) reasons.push('incomparable_input');
  if (own(reference, 'trace') !== own(candidate, 'trace')) reasons.push('missing_trace');
  if (reasons.length) return { id: reference.id, status: 'unknown', reasons: [...new Set(reasons)], differences };
  const left = normalizedCase(reference, contract.volatile_paths); const right = normalizedCase(candidate, contract.volatile_paths);
  for (const key of ['output', 'state', 'effects']) if (!same(left[key], right[key])) differences.push({ path: `/${key}`, reference: left[key], candidate: right[key] });
  if (own(left, 'metadata') || own(right, 'metadata')) {
    const a = own(left, 'metadata') ? left.metadata : null; const b = own(right, 'metadata') ? right.metadata : null;
    if (own(left, 'metadata') !== own(right, 'metadata') || !same(a, b)) differences.push({ path: '/metadata', reference: a, candidate: b, reference_present: own(left, 'metadata'), candidate_present: own(right, 'metadata') });
  }
  if (left.trace !== undefined) {
    const a = contract.trace_order === 'per-channel' ? channelTrace(left.trace) : left.trace;
    const b = contract.trace_order === 'per-channel' ? channelTrace(right.trace) : right.trace;
    if (!same(a, b)) differences.push({ path: '/trace', reference: a, candidate: b });
  }
  return { id: reference.id, status: differences.length ? 'fail' : 'pass', reasons: differences.length ? ['behavior_mismatch'] : [], differences };
}

/** Compare finite supplied receipts. Integrity and comparability are not runtime attestation. */
export function compareBehavior(reference, candidate, contract = {}) {
  const rule = validateContract(contract);
  const left = validateReceipt(reference, 'reference'); const right = validateReceipt(candidate, 'candidate');
  const reasons = [...left.reasons, ...right.reasons];
  for (const key of COMPARABLE_BINDINGS) if (left.receipt.bindings[key] !== right.receipt.bindings[key]) reasons.push(`binding_mismatch:${key}`);
  for (const [side, expected] of Object.entries(rule.expected_bindings ?? {})) {
    const actual = side === 'reference' ? left.receipt.bindings : right.receipt.bindings;
    for (const [key, value] of Object.entries(expected)) if (actual[key] !== value) reasons.push(`stale_${side}:${key}`);
  }
  const a = new Map(left.receipt.cases.map(item => [item.id, item])); const b = new Map(right.receipt.cases.map(item => [item.id, item]));
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort(textOrder); const cases = [];
  const summary = { pass: 0, fail: 0, unknown: 0, missing: 0, extra: 0 };
  for (const id of ids) {
    let result;
    if (!b.has(id)) { summary.missing++; result = { id, status: 'unknown', reasons: ['missing_candidate_case', ...reasons], differences: [] }; }
    else if (!a.has(id)) { summary.extra++; result = { id, status: 'unknown', reasons: ['unexpected_candidate_case', ...reasons], differences: [] }; }
    else result = compareCase(a.get(id), b.get(id), rule, reasons);
    summary[result.status]++; cases.push(result);
  }
  if (!ids.length) reasons.push('no_cases');
  const status = summary.fail ? 'fail' : summary.unknown || reasons.length || !ids.length ? 'unknown' : 'pass';
  return { schema_version: 1, status, cases, summary, contract: rule, comparability: { status: reasons.length ? 'unknown' : 'comparable', reasons: [...new Set(reasons)] },
    receipt_sha256: { reference: digest(left.receipt), candidate: digest(right.receipt) },
    bindings: { reference: left.receipt.bindings, candidate: right.receipt.bindings },
    scope: 'Finite supplied receipts under the declared contract. Passing does not attest runtime execution or establish whole-program equivalence.' };
}
