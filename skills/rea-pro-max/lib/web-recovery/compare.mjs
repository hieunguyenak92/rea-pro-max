import { RpmError, canonical, digest } from '../common.mjs';
import { compileContract, validateContract } from './contract.mjs';
import {
  captureToWebIR,
  OBSERVATION_CHANNELS,
  cloneJson,
  normalizeObservation,
  normalizeWebRecoveryIR,
} from './schema.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const textOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pointerToken = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const pathJoin = (path, key) => `${path}/${pointerToken(key)}`;

function fail(code, message, details = {}) { throw new RpmError(code, message, details); }

function boundedPreview(value, maxBytes = 1024) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { return '[unserializable]'; }
  if (encoded === undefined) return value;
  if (Buffer.byteLength(encoded, 'utf8') <= maxBytes) return value;
  return `${encoded.slice(0, Math.max(0, maxBytes - 1))}…`;
}

/** Deterministic, bounded JSON diff used by behavior and visual diagnostics. */
export function deepDiff(reference, candidate, options = {}) {
  const maxDepth = options.maxDepth ?? options.max_depth ?? 32;
  const maxNodes = options.maxNodes ?? options.max_nodes ?? 10000;
  const maxDifferences = options.maxDifferences ?? options.max_differences ?? options.maxDiffs ?? 128;
  const maxBytes = options.maxBytes ?? options.max_bytes ?? 2 * 1024 * 1024;
  for (const [name, value, minimum, maximum] of [['maxDepth', maxDepth, 0, 128], ['maxNodes', maxNodes, 1, 100000], ['maxDifferences', maxDifferences, 1, 10000], ['maxBytes', maxBytes, 1, 8 * 1024 * 1024]]) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('web_diff_bounds', `${name} is outside its supported bound.`);
  }
  const left = cloneJson(reference, 'reference value'); const right = cloneJson(candidate, 'candidate value');
  const differences = []; let nodes = 0; let truncated = false;
  const add = (path, kind, a, b, detail = undefined) => {
    if (differences.length >= maxDifferences) { truncated = true; return; }
    differences.push({ path, kind, reference: boundedPreview(a), candidate: boundedPreview(b), ...(detail ? { detail } : {}) });
  };
  const visit = (a, b, path, depth) => {
    if (truncated || differences.length >= maxDifferences) { truncated = true; return; }
    nodes++;
    if (nodes > maxNodes) { truncated = true; add(path, 'bounds', a, b, 'diff node budget exceeded'); return; }
    if (depth > maxDepth) { truncated = true; add(path, 'bounds', a, b, 'diff depth budget exceeded'); return; }
    const aArray = Array.isArray(a); const bArray = Array.isArray(b);
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || aArray !== bArray) {
      if (a !== b) add(path || '/', 'value', a, b);
      return;
    }
    if (aArray) {
      const length = Math.max(a.length, b.length);
      for (let index = 0; index < length; index++) {
        const child = pathJoin(path, index);
        if (!own(a, index)) add(child, 'extra', undefined, b[index]);
        else if (!own(b, index)) add(child, 'missing', a[index], undefined);
        else visit(a[index], b[index], child, depth + 1);
      }
      return;
    }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(textOrder);
    for (const key of keys) {
      const child = pathJoin(path, key);
      if (!own(a, key)) add(child, 'extra', undefined, b[key]);
      else if (!own(b, key)) add(child, 'missing', a[key], undefined);
      else visit(a[key], b[key], child, depth + 1);
    }
  };
  const leftBytes = Buffer.byteLength(JSON.stringify(left), 'utf8');
  const rightBytes = Buffer.byteLength(JSON.stringify(right), 'utf8');
  if (leftBytes > maxBytes || rightBytes > maxBytes) {
    truncated = true;
    add('/', 'bounds', left, right, 'diff input byte budget exceeded');
    return { equal: false, differences, mismatches: differences, truncated, nodes: 0, limits: { maxDepth, maxNodes, maxDifferences, maxBytes } };
  }
  visit(left, right, '', 0);
  return { equal: differences.length === 0 && !truncated, differences, mismatches: differences, truncated, nodes, limits: { maxDepth, maxNodes, maxDifferences, maxBytes } };
}

function asCapture(value, label) {
  if (!object(value)) fail('web_compare_type', `${label} capture must be an object.`);
  if (value.kind === 'web-runtime-capture' || value.receipt?.cases || value.receipt?.bindings) return captureToWebIR(value, { id: label });
  if (value.kind === 'web-recovery-ir' || value.schema_version !== undefined || value.actions || value.observations) return normalizeWebRecoveryIR(value);
  if (value.capture) return asCapture(value.capture, label);
  return normalizeWebRecoveryIR({ id: label, ...value });
}

function actionMap(capture) { return new Map(capture.actions.map(item => [item.id, item])); }
function observationMap(capture) {
  const map = new Map();
  for (const [index, item] of capture.observations.entries()) map.set(item.action_id ?? capture.actions[index]?.id ?? item.id, normalizeObservation(item, index));
  return map;
}
function expectedMap(contract) { return new Map(contract.expected.map(item => [item.action_id, item])); }
function firstIncompatibleAction(capture, contract) {
  const index = capture.actions.findIndex((action, offset) => !contract.actions[offset] ||
    canonical(action) !== canonical(contract.actions[offset]));
  return index === -1 ? Infinity : index;
}

function hasCoveredChannel(observation, channel) {
  return Boolean(observation && own(observation, channel) &&
    (observation.coverage.channels === undefined || observation.coverage.channels.includes(channel)));
}

function staleBaselineChannels(expected, reference, channels) {
  if (expected?.coverage.complete !== true || reference?.coverage.complete !== true) return [];
  const frozen = expected.observation;
  return channels.filter(channel => {
    // Runtime v0.8 contracts recorded an empty network summary without a
    // collector or per-channel coverage. Do not freeze that placeholder.
    if (channel === 'network' && frozen?.coverage.channels === undefined) return false;
    return hasCoveredChannel(frozen, channel) && hasCoveredChannel(reference, channel) &&
      canonical(frozen[channel]) !== canonical(reference[channel]);
  });
}

function coverageUnknowns(observation) {
  const reasons = [];
  if (!observation) reasons.push('missing_observation');
  else {
    if (observation.coverage.complete !== true) reasons.push('incomplete_coverage');
    if (observation.unknowns.length) reasons.push(...observation.unknowns.map(item => `unknown:${item.code}`));
    if (observation.authority.level === 'unknown' || observation.authority.level === 'inferred') reasons.push(`weak_authority:${observation.authority.level}`);
  }
  return [...new Set(reasons)];
}

function identityReasons(reference, candidate, contract) {
  const reasons = [];
  const expectedTarget = contract.identities?.target;
  const expectedCandidate = contract.identities?.candidate;
  if (expectedTarget && canonical(reference.identities.target) !== canonical(expectedTarget)) reasons.push('stale_target_identity');
  if (expectedCandidate && canonical(candidate.identities.candidate ?? candidate.identities.target) !== canonical(expectedCandidate)) reasons.push('stale_candidate_identity');
  return reasons;
}

function compareCase(action, referenceObservation, candidateObservation, expected, requiredChannels, counts, options) {
  const reasons = [...coverageUnknowns(referenceObservation), ...coverageUnknowns(candidateObservation)];
  const differences = [];
  if (referenceObservation && candidateObservation && reasons.length === 0) {
    for (const channel of requiredChannels) {
      if (!hasCoveredChannel(referenceObservation, channel) || !hasCoveredChannel(candidateObservation, channel)) {
        reasons.push(`missing_channel:${channel}`);
        if (channel === 'network') for (const observation of [referenceObservation, candidateObservation]) {
          const issues = observation.metadata?.network_issues;
          if (!hasCoveredChannel(observation, channel) && Array.isArray(issues)) for (const issue of issues) reasons.push(`network:${issue}`);
        }
        continue;
      }
      const result = deepDiff(referenceObservation[channel], candidateObservation[channel], options);
      if (result.truncated) reasons.push(`diff_bounds:${channel}`);
      for (const difference of result.differences) if (difference.kind !== 'bounds') differences.push({ channel, ...difference });
      if (channel === 'network' && counts.length) {
        for (const [side, observation] of [['reference', referenceObservation], ['candidate', candidateObservation]]) {
          const starts = observation.network.summary;
          if (!Array.isArray(starts) || starts.some(row => typeof row?.method !== 'string' || typeof row?.path !== 'string')) {
            reasons.push(`unsupported_network_count_shape:${side}`);
            continue;
          }
          for (const { method, path, count } of counts) {
            const actual = starts.filter(row => row.method === method && row.path === path).length;
            if (actual !== count) differences.push({
              channel, path: `/count/${side}/${method}/${pointerToken(path)}`, kind: 'value', reference: count, candidate: actual,
            });
          }
        }
      }
    }
    for (const field of ['route', 'state', 'viewport']) {
      if (own(referenceObservation, field) || own(candidateObservation, field)) {
        const result = deepDiff(referenceObservation[field] ?? null, candidateObservation[field] ?? null, options);
        if (result.truncated) reasons.push(`diff_bounds:${field}`);
        for (const difference of result.differences) if (difference.kind !== 'bounds') differences.push({ channel: field, ...difference });
      }
    }
  }
  return { id: action.id, status: differences.length ? 'fail' : reasons.length ? 'unknown' : 'pass', reasons: [...new Set(reasons)], differences, expected: expected ? cloneJson(expected) : null };
}

function baseResult(kind, status, cases, unknowns, mismatches, extra = {}) {
  const summary = { pass: 0, fail: 0, unknown: 0, missing: 0, extra: 0 };
  for (const item of cases) summary[item.status]++;
  return { schema_version: 1, kind, status, cases, summary, unknowns: [...new Set(unknowns)], mismatches, ...extra };
}

/** Compare finite behavior channels. Visual artifacts are intentionally ignored. */
export function compareBehavior(referenceInput, candidateInput, contractInput = undefined, options = {}) {
  const reference = asCapture(referenceInput, 'reference'); const candidate = asCapture(candidateInput, 'candidate');
  let requestedContract = contractInput;
  if (requestedContract && requestedContract.kind !== 'web-recovery-contract' && !requestedContract.expected) { options = { ...requestedContract, ...options }; requestedContract = undefined; }
  const contract = validateContract(requestedContract ?? compileContract(reference, candidate));
  const requiredChannels = [...new Set([
    ...(options.required_channels ?? contract.required_channels ?? ['dom', 'network', 'storage']),
    ...(contract.network_counts?.length ? ['network'] : []),
  ])].filter(channel => channel !== 'visual');
  if (!requiredChannels.length || requiredChannels.some(channel => !OBSERVATION_CHANNELS.includes(channel))) fail('web_compare_type', 'required_channels must contain known non-visual channels.');
  const expected = expectedMap(contract); const left = observationMap(reference); const right = observationMap(candidate);
  const actionIds = [...new Set([...contract.actions.map(item => item.id), ...left.keys(), ...right.keys()])].sort(textOrder);
  const staleIdentities = identityReasons(reference, candidate, contract);
  const firstIncompatible = Math.min(firstIncompatibleAction(reference, contract), firstIncompatibleAction(candidate, contract));
  const actionIndexes = new Map(contract.actions.map((action, index) => [action.id, index]));
  const globalUnknowns = [...contract.unknowns, ...staleIdentities];
  if (reference.coverage.complete !== true) globalUnknowns.push('reference_incomplete_coverage');
  if (candidate.coverage.complete !== true) globalUnknowns.push('candidate_incomplete_coverage');
  const actions = actionMap(reference); const cases = [];
  for (const actionId of actionIds) {
    const action = actions.get(actionId) ?? contract.actions.find(item => item.id === actionId) ?? candidate.actions.find(item => item.id === actionId);
    const counts = (contract.network_counts ?? []).filter(clause => clause.action_id === actionId);
    const item = compareCase(action ?? { id: actionId }, left.get(actionId), right.get(actionId), expected.get(actionId), requiredChannels, counts, options);
    if (!left.has(actionId)) { item.status = 'unknown'; item.reasons = [...new Set([...item.reasons, 'missing_reference_observation'])]; }
    if (!right.has(actionId)) { item.status = 'unknown'; item.reasons = [...new Set([...item.reasons, 'missing_candidate_observation'])]; }
    const incompatibleAction = (actionIndexes.get(actionId) ?? Infinity) >= firstIncompatible && firstIncompatible !== Infinity ||
      contract.unknowns.some(unknown => unknown.code === 'action_input_mismatch' && unknown.action_id === actionId);
    const staleChannels = staleBaselineChannels(expected.get(actionId), left.get(actionId), requiredChannels);
    if (incompatibleAction || staleIdentities.length || staleChannels.length) {
      item.status = 'unknown';
      item.reasons.push(...staleIdentities, ...(incompatibleAction ? ['action_input_mismatch'] : []));
      item.reasons.push(...staleChannels.map(channel => `stale_reference_observation:${channel}`));
    } else if (globalUnknowns.length && item.status === 'pass') {
      item.status = 'unknown';
      item.reasons.push('contract_coverage_incomplete');
    }
    cases.push(item);
  }
  const mismatches = cases.flatMap(item => item.status === 'fail' ? item.differences.map(difference => ({ action_id: item.id, ...difference })) : []);
  const status = mismatches.length ? 'fail' : cases.length && cases.every(item => item.status === 'pass') && !globalUnknowns.length ? 'pass' : 'unknown';
  return baseResult('web-recovery-behavior-result', status, cases, globalUnknowns, mismatches, {
    contract_sha256: digest(contract), capture_sha256: { reference: digest(reference), candidate: digest(candidate) },
    compared_channels: requiredChannels, visual_comparison: 'separate',
  });
}

/** Compare visual artifact hashes only. This never contributes to behavior. */
export function compareVisual(referenceInput, candidateInput, contractInput = undefined) {
  const reference = asCapture(referenceInput, 'reference'); const candidate = asCapture(candidateInput, 'candidate');
  const contract = validateContract(contractInput ?? compileContract(reference, candidate));
  const expected = expectedMap(contract); const left = observationMap(reference); const right = observationMap(candidate);
  const actionIds = [...new Set([...contract.actions.map(item => item.id), ...left.keys(), ...right.keys()])].sort(textOrder);
  const cases = []; const unknowns = [
    ...contract.unknowns.filter(item => item.code !== 'reference_channel_missing'),
    ...identityReasons(reference, candidate, contract),
  ];
  const firstIncompatible = Math.min(firstIncompatibleAction(reference, contract), firstIncompatibleAction(candidate, contract));
  const actionIndexes = new Map(contract.actions.map((action, index) => [action.id, index]));
  for (const actionId of actionIds) {
    const a = left.get(actionId); const b = right.get(actionId); const reasons = [];
    if (!a || !b) reasons.push(!a ? 'missing_reference_observation' : 'missing_candidate_observation');
    if (a?.coverage.complete !== true || b?.coverage.complete !== true) reasons.push('incomplete_coverage');
    if (firstIncompatible !== Infinity && (actionIndexes.get(actionId) ?? Infinity) >= firstIncompatible) reasons.push('action_input_mismatch');
    for (const channel of staleBaselineChannels(expected.get(actionId), a, ['visual'])) reasons.push(`stale_reference_observation:${channel}`);
    const hashA = a?.visual?.artifact_hash; const hashB = b?.visual?.artifact_hash;
    if (hashA === undefined || hashB === undefined) reasons.push('missing_visual_artifact');
    const differences = reasons.length ? [] : hashA === hashB ? [] : [{ path: '/visual/artifact_hash', kind: 'value', reference: hashA, candidate: hashB }];
    cases.push({ id: actionId, status: reasons.length ? 'unknown' : differences.length ? 'fail' : 'pass', reasons: [...new Set(reasons)], differences, expected: expected.get(actionId) ? cloneJson(expected.get(actionId)) : null });
  }
  const mismatches = cases.flatMap(item => item.status === 'fail' ? item.differences.map(difference => ({ action_id: item.id, ...difference })) : []);
  const status = mismatches.length && !unknowns.length ? 'fail' : cases.length && cases.every(item => item.status === 'pass') && !unknowns.length ? 'pass' : 'unknown';
  return baseResult('web-recovery-visual-result', status, cases, unknowns, mismatches, { contract_sha256: digest(contract), compared: 'visual.artifact_hash', behavior_comparison: 'separate' });
}

export function compareWebRecovery(reference, candidate, contract, options = {}) {
  return { behavior: compareBehavior(reference, candidate, contract, options), visual: compareVisual(reference, candidate, contract) };
}

export const compareFiniteBehavior = compareBehavior;
export const compareFinite = compareBehavior;
export const compareWebBehavior = compareBehavior;
export const compareVisualArtifacts = compareVisual;
export const diff = deepDiff;

