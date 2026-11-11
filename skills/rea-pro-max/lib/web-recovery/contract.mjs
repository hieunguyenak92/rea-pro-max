import { RpmError, canonical, digest } from '../common.mjs';
import {
  CONTRACT_KIND,
  LIMITS,
  OBSERVATION_CHANNELS,
  cloneJson,
  normalizeAction,
  normalizeAuthority,
  normalizeCoverage,
  normalizeObservation,
  normalizeState,
  normalizeViewport,
  normalizeRoute,
  normalizeUnknown,
  normalizeWebRecoveryIR,
  WEB_RECOVERY_SCHEMA_VERSION,
} from './schema.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const textOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
const copy = value => JSON.parse(canonical(value));

function fail(code, message, details = {}) { throw new RpmError(code, message, details); }

function unknown(code, detail, action_id = undefined) {
  return { code, detail, ...(action_id ? { action_id } : {}) };
}

function asCapture(value, label, defaults = {}) {
  if (!object(value)) fail('web_contract_type', `${label} must be a capture or web recovery IR object.`);
  // A normalized IR is accepted directly.  A plain fixture is wrapped in the
  // same envelope, keeping the compiler useful for local projects and tests.
  return normalizeWebRecoveryIR({ ...defaults, ...value, id: value.id ?? defaults.id ?? label });
}

function resolveInputs(source, candidateArg, optionsArg) {
  let options = optionsArg ?? {};
  let reference = source;
  let candidate = candidateArg;
  const looksCapture = value => object(value) && ['actions', 'observations', 'route', 'state', 'viewport', 'coverage', 'capture'].some(key => own(value, key));
  if (candidateArg && object(candidateArg) && !Array.isArray(candidateArg.actions) && (candidateArg.reference || candidateArg.target || candidateArg.candidate || candidateArg.options)) {
    options = { ...(candidateArg.options ?? {}), ...(optionsArg ?? {}) };
    candidate = candidateArg.candidate;
    reference = candidateArg.reference ?? candidateArg.target ?? source;
  }
  if (object(source) && (source.reference || looksCapture(source.target) || looksCapture(source.candidate))) {
    reference = source.reference ?? source.target ?? source;
    candidate = source.candidate ?? candidate;
    options = { ...(source.options ?? {}), ...options };
  }
  return { reference, candidate, options };
}

function observationsByAction(capture, actions, side, unknowns) {
  const map = new Map();
  for (const [index, item] of capture.observations.entries()) {
    const actionId = item.action_id ?? actions[index]?.id;
    if (!actionId) {
      unknowns.push(unknown('observation_without_action', `${side} observation ${item.id} is not attached to an action.`));
      continue;
    }
    if (map.has(actionId)) {
      unknowns.push(unknown('duplicate_action_observation', `${side} has multiple observations for action ${actionId}.`, actionId));
      continue;
    }
    map.set(actionId, item);
  }
  return map;
}

function actionSignature(action) {
  return canonical(action);
}

/**
 * Compile finite action/observation captures into a frozen behavioral
 * contract.  The compiler never invokes a browser and never treats visual
 * hashes as behavioral output.
 */
export function compileContract(source, candidateArg, optionsArg) {
  const { reference: referenceInput, candidate: candidateInput, options } = resolveInputs(source, candidateArg, optionsArg);
  const reference = asCapture(referenceInput, 'reference', options);
  const candidate = candidateInput === undefined ? null : asCapture(candidateInput, 'candidate', options);
  const unknowns = [...reference.unknowns];
  if (candidate) unknowns.push(...candidate.unknowns);
  if (reference.actions.length > LIMITS.maxActions) fail('web_contract_bounds', 'Contract action count exceeds the configured bound.');
  const actions = reference.actions.map((item, index) => normalizeAction(item, index));
  const candidateActions = candidate?.actions ?? [];
  if (candidate && actions.length !== candidateActions.length) unknowns.push(unknown('action_set_mismatch', 'Reference and candidate action counts differ.'));
  for (const action of actions) {
    const other = candidateActions.find(item => item.id === action.id);
    if (!other) unknowns.push(unknown('candidate_action_missing', `Candidate is missing action ${action.id}.`, action.id));
    else if (actionSignature(action) !== actionSignature(other)) unknowns.push(unknown('action_input_mismatch', `Reference and candidate inputs differ for ${action.id}.`, action.id));
  }
  const referenceByAction = observationsByAction(reference, actions, 'reference', unknowns);
  const candidateByAction = candidate ? observationsByAction(candidate, candidate.actions, 'candidate', unknowns) : new Map();
  const expected = actions.map(action => {
    const observation = referenceByAction.get(action.id);
    if (!observation) unknowns.push(unknown('reference_observation_missing', `Reference has no observation for ${action.id}.`, action.id));
    return {
      action_id: action.id,
      observation: observation ? cloneJson(observation) : null,
      channels: observation ? OBSERVATION_CHANNELS.filter(channel => own(observation, channel)) : [],
      authority: observation?.authority ?? normalizeAuthority('unknown'),
      coverage: observation?.coverage ?? normalizeCoverage({ complete: false }),
    };
  });
  for (const action of candidateActions) if (!actions.some(item => item.id === action.id)) unknowns.push(unknown('candidate_action_extra', `Candidate has an unexpected action ${action.id}.`, action.id));
  const requiredChannels = options.required_channels ?? ['dom', 'network', 'storage'];
  if (!Array.isArray(requiredChannels) || requiredChannels.some(channel => !OBSERVATION_CHANNELS.includes(channel))) fail('web_contract_type', 'required_channels must contain known observation channels.');
  for (const item of expected) {
    if (!item.observation) continue;
    const missing = requiredChannels.filter(channel => !own(item.observation, channel));
    if (missing.length) unknowns.push(unknown('reference_channel_missing', `Reference observation is missing ${missing.join(', ')}.`, item.action_id));
    if (item.coverage.complete !== true) unknowns.push(unknown('reference_coverage_incomplete', 'Reference observation is marked incomplete.', item.action_id));
    if (item.authority.level === 'unknown' || item.authority.level === 'inferred') unknowns.push(unknown('reference_authority_weak', `Reference observation authority is ${item.authority.level}.`, item.action_id));
  }
  const requiredActionIds = actions.map(action => action.id);
  const referenceObserved = [...referenceByAction.keys()].sort(textOrder);
  const candidateObserved = [...candidateByAction.keys()].sort(textOrder);
  const coverage = normalizeCoverage({
    required_action_ids: requiredActionIds,
    reference_action_ids: referenceObserved,
    candidate_action_ids: candidateObserved,
    reference_complete: reference.coverage.complete === true && requiredActionIds.every(actionId => referenceByAction.has(actionId)),
    candidate_complete: candidate ? candidate.coverage.complete === true && requiredActionIds.every(actionId => candidateByAction.has(actionId)) : false,
    channels: requiredChannels,
    complete: reference.coverage.complete === true && (!candidate || candidate.coverage.complete === true) && unknowns.length === 0,
  });
  const result = {
    schema_version: WEB_RECOVERY_SCHEMA_VERSION,
    kind: CONTRACT_KIND,
    contract_id: options.contract_id ?? `${reference.id}-contract`,
    route: normalizeRoute(options.route ?? reference.route),
    state: normalizeState(options.state ?? reference.state),
    viewport: normalizeViewport(options.viewport ?? reference.viewport),
    actions,
    expected,
    identities: { target: reference.identities.target, candidate: candidate?.identities.candidate ?? candidate?.identities.target ?? null },
    authority: normalizeAuthority(options.authority ?? reference.authority),
    coverage,
    required_channels: [...requiredChannels],
    unknowns: unknowns.map(normalizeUnknown),
    source: { reference_sha256: digest(reference), ...(candidate ? { candidate_sha256: digest(candidate) } : {}) },
  };
  return validateContract(result);
}

export function validateContract(value) {
  if (!object(value)) fail('web_contract_type', 'Contract must be an object.');
  const result = copy(value);
  if (result.schema_version !== WEB_RECOVERY_SCHEMA_VERSION || result.kind !== CONTRACT_KIND) fail('web_contract_version', `Use ${CONTRACT_KIND} schema_version ${WEB_RECOVERY_SCHEMA_VERSION}.`);
  if (!id(result.contract_id)) fail('web_contract_type', 'contract_id must be a simple ID.');
  result.route = normalizeRoute(result.route);
  result.state = normalizeState(result.state);
  result.viewport = normalizeViewport(result.viewport);
  if (!Array.isArray(result.actions) || result.actions.length > LIMITS.maxActions) fail('web_contract_type', 'Contract actions must be a bounded array.');
  result.actions = result.actions.map(normalizeAction);
  if (new Set(result.actions.map(item => item.id)).size !== result.actions.length) fail('duplicate_action', 'Contract action IDs must be unique.');
  if (!Array.isArray(result.expected) || result.expected.length > LIMITS.maxActions) fail('web_contract_type', 'Contract expected observations must be a bounded array.');
  result.expected = result.expected.map((item, index) => {
    if (!object(item) || !id(item.action_id)) fail('web_contract_type', `expected[${index}] needs an action_id.`);
    const normalized = { action_id: item.action_id, observation: item.observation === null ? null : normalizeObservation(item.observation, index), channels: Array.isArray(item.channels) ? [...item.channels] : [], authority: normalizeAuthority(item.authority ?? 'unknown'), coverage: normalizeCoverage(item.coverage ?? { complete: false }) };
    if (normalized.channels.some(channel => !OBSERVATION_CHANNELS.includes(channel))) fail('web_contract_type', `expected[${index}] has an unsupported channel.`);
    return normalized;
  });
  result.identities ??= { target: null, candidate: null };
  result.authority = normalizeAuthority(result.authority ?? 'observed');
  result.coverage = normalizeCoverage(result.coverage ?? { complete: false });
  result.required_channels ??= ['dom', 'network', 'storage'];
  if (!Array.isArray(result.required_channels) || result.required_channels.some(channel => !OBSERVATION_CHANNELS.includes(channel))) fail('web_contract_type', 'required_channels contains an unsupported channel.');
  if (!Array.isArray(result.unknowns)) fail('web_contract_type', 'unknowns must be an array.');
  result.unknowns = result.unknowns.map(normalizeUnknown);
  return result;
}

export const compileWebContract = compileContract;
export const compileBehaviorContract = compileContract;
export const compileFiniteContract = compileContract;
export const validateWebRecoveryContract = validateContract;

