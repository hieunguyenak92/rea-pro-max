import { RpmError, digest } from '../common.mjs';

/**
 * The web recovery modules deliberately use a small JSON IR.  Providers may
 * attach richer data to the summaries, but the envelope stays stable and
 * bounded so a fixture can be copied between a local project and a verifier.
 */
export const WEB_RECOVERY_SCHEMA_VERSION = 1;
export const WEB_RECOVERY_KIND = 'web-recovery-ir';
export const CONTRACT_KIND = 'web-recovery-contract';
export const ACTION_KINDS = Object.freeze(['navigate', 'click', 'input', 'wait', 'reload']);
export const OBSERVATION_CHANNELS = Object.freeze(['dom', 'visual', 'network', 'storage']);
export const AUTHORITY_LEVELS = Object.freeze(['observed', 'controlled', 'reported', 'declared', 'inferred', 'unknown']);

export const LIMITS = Object.freeze({
  maxActions: 256,
  maxObservations: 256,
  maxUnknowns: 512,
  maxString: 16 * 1024,
  maxJsonBytes: 2 * 1024 * 1024,
  maxDepth: 32,
  maxArray: 512,
  maxObjectKeys: 256,
});

const HASH = /^[a-f0-9]{64}$/iu;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const textOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function fail(code, message, details = {}) { throw new RpmError(code, message, details); }

function bounded(value, label = 'value', depth = 0, seen = new Set()) {
  if (depth > LIMITS.maxDepth) fail('web_ir_bounds', `${label} exceeds the maximum JSON depth.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.length > LIMITS.maxString) fail('web_ir_bounds', `${label} exceeds the string limit.`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('web_ir_type', `${label} must contain finite numbers.`);
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) fail('web_ir_type', `${label} must contain plain JSON values.`);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('web_ir_type', `${label} must contain plain JSON objects.`);
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (value.length > LIMITS.maxArray) fail('web_ir_bounds', `${label} exceeds the array limit.`);
    result = value.map((item, index) => bounded(item, `${label}[${index}]`, depth + 1, seen));
  } else {
    const keys = Object.keys(value);
    if (keys.length > LIMITS.maxObjectKeys) fail('web_ir_bounds', `${label} exceeds the object-key limit.`);
    result = Object.fromEntries(keys.sort(textOrder).map(key => [key, bounded(value[key], `${label}.${key}`, depth + 1, seen)]));
  }
  seen.delete(value);
  return result;
}

export function cloneJson(value, label = 'value') {
  const result = bounded(value, label);
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > LIMITS.maxJsonBytes) fail('web_ir_bounds', `${label} exceeds the JSON byte limit.`);
  return result;
}

function string(value, label, { max = LIMITS.maxString, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max) fail('web_ir_type', `${label} must be a bounded ${allowEmpty ? '' : 'non-empty '}string.`);
  return value;
}

function id(value, label = 'id') {
  const result = string(value, label, { max: 256 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)) fail('web_ir_type', `${label} contains unsupported characters.`);
  return result;
}

export function normalizeRoute(value = '/') {
  if (typeof value === 'string') value = { path: value };
  if (!object(value)) fail('web_ir_type', 'route must be a path string or object.');
  const allowed = ['path', 'query', 'hash'];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('web_ir_type', 'route fields are path, query and hash.');
  const path = string(value.path ?? '/', 'route.path', { max: 2048 });
  if (!path.startsWith('/')) fail('web_ir_type', 'route.path must start with /.');
  return {
    path,
    query: string(value.query ?? '', 'route.query', { max: 4096, allowEmpty: true }),
    hash: string(value.hash ?? '', 'route.hash', { max: 2048, allowEmpty: true }),
  };
}

export function normalizeState(value = {}) {
  return cloneJson(value, 'state');
}

export function normalizeViewport(value = { width: 1280, height: 720, dpr: 1 }) {
  if (!object(value)) fail('web_ir_type', 'viewport must be an object.');
  const allowed = ['width', 'height', 'dpr', 'orientation'];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('web_ir_type', 'viewport fields are width, height, dpr and orientation.');
  const width = value.width; const height = value.height;
  if (!Number.isSafeInteger(width) || width < 1 || width > 10000 || !Number.isSafeInteger(height) || height < 1 || height > 10000) fail('web_ir_type', 'viewport width and height must be integers from 1 to 10000.');
  const dpr = value.dpr ?? 1;
  if (typeof dpr !== 'number' || !Number.isFinite(dpr) || dpr <= 0 || dpr > 8) fail('web_ir_type', 'viewport.dpr must be finite and between 0 and 8.');
  const result = { width, height, dpr };
  if (value.orientation !== undefined) {
    if (!['portrait', 'landscape'].includes(value.orientation)) fail('web_ir_type', 'viewport.orientation must be portrait or landscape.');
    result.orientation = value.orientation;
  }
  return result;
}

function target(value, label) {
  if (typeof value === 'string') return value;
  if (!object(value)) fail('web_ir_type', `${label} must be a selector string or object.`);
  const result = cloneJson(value, label);
  if (!Object.keys(result).length) fail('web_ir_type', `${label} cannot be empty.`);
  return result;
}

export function normalizeAction(value, index = 0) {
  if (!object(value)) fail('web_action_type', `actions[${index}] must be an object.`);
  const kind = value.kind;
  if (!ACTION_KINDS.includes(kind)) fail('web_action_type', `actions[${index}] has unsupported kind.`);
  const result = { id: id(value.id ?? `action-${index + 1}`, `actions[${index}].id`), kind };
  const allowed = new Set(['id', 'kind', 'route', 'url', 'target', 'selector', 'value', 'milliseconds', 'hard', 'requires', 'label', 'metadata']);
  if (Object.keys(value).some(key => !allowed.has(key))) fail('web_action_type', `Unknown field on ${kind} action.`);
  if (value.label !== undefined) result.label = string(value.label, `${result.id}.label`, { max: 512 });
  if (value.metadata !== undefined) result.metadata = cloneJson(value.metadata, `${result.id}.metadata`);
  if (value.requires !== undefined) {
    if (!Array.isArray(value.requires) || value.requires.length > LIMITS.maxActions) fail('web_action_type', `${result.id}.requires must be a bounded array.`);
    result.requires = value.requires.map((item, dependencyIndex) => id(item, `${result.id}.requires[${dependencyIndex}]`));
  }
  if (kind === 'navigate') {
    if (value.route === undefined && value.url === undefined) fail('web_action_type', `${result.id} navigate action requires route or url.`);
    if (value.route !== undefined) result.route = normalizeRoute(value.route);
    if (value.url !== undefined) result.url = string(value.url, `${result.id}.url`, { max: 4096 });
  } else if (kind === 'click') {
    result.target = target(value.target ?? value.selector, `${result.id}.target`);
  } else if (kind === 'input') {
    result.target = target(value.target ?? value.selector, `${result.id}.target`);
    if (typeof value.value !== 'string' || value.value.length > LIMITS.maxString) fail('web_action_type', `${result.id}.value must be a bounded string.`);
    result.value = value.value;
  } else if (kind === 'wait') {
    if (!Number.isSafeInteger(value.milliseconds) || value.milliseconds < 0 || value.milliseconds > 120000) fail('web_action_type', `${result.id}.milliseconds must be an integer from 0 to 120000.`);
    result.milliseconds = value.milliseconds;
  } else if (kind === 'reload') {
    if (value.hard !== undefined && typeof value.hard !== 'boolean') fail('web_action_type', `${result.id}.hard must be boolean.`);
    if (value.hard !== undefined) result.hard = value.hard;
  }
  return result;
}

function summary(value, label) {
  if (value === undefined) return undefined;
  return cloneJson(value, label);
}

function normalizeChannel(value, label, fields) {
  if (value === undefined) return undefined;
  if (!object(value)) fail('web_observation_type', `${label} must be an object.`);
  const result = {};
  for (const field of fields) if (value[field] !== undefined) result[field] = summary(value[field], `${label}.${field}`);
  if (!Object.keys(result).length) fail('web_observation_type', `${label} must contain an observation value.`);
  return result;
}

export function normalizeAuthority(value = 'observed', label = 'authority') {
  if (typeof value === 'string') {
    if (!AUTHORITY_LEVELS.includes(value)) fail('web_authority_type', `${label} has an unsupported level.`);
    return { level: value };
  }
  if (!object(value)) fail('web_authority_type', `${label} must be a level string or object.`);
  const result = cloneJson(value, label);
  const level = result.level ?? 'observed';
  if (!AUTHORITY_LEVELS.includes(level)) fail('web_authority_type', `${label}.level has an unsupported value.`);
  result.level = level;
  return result;
}

export function normalizeCoverage(value = {}) {
  if (!object(value)) fail('web_coverage_type', 'coverage must be an object.');
  const result = cloneJson(value, 'coverage');
  if (result.complete !== undefined && typeof result.complete !== 'boolean') fail('web_coverage_type', 'coverage.complete must be boolean.');
  if (result.action_ids !== undefined && (!Array.isArray(result.action_ids) || result.action_ids.some(item => typeof item !== 'string'))) fail('web_coverage_type', 'coverage.action_ids must be string IDs.');
  if (result.channels !== undefined && (!Array.isArray(result.channels) || result.channels.some(item => !OBSERVATION_CHANNELS.includes(item)))) fail('web_coverage_type', 'coverage.channels contains an unsupported channel.');
  result.complete ??= true;
  return result;
}

export function normalizeUnknown(value, index = 0) {
  if (!object(value)) fail('web_unknown_type', `unknowns[${index}] must be an object.`);
  const result = cloneJson(value, `unknowns[${index}]`);
  result.code = id(result.code ?? `unknown-${index + 1}`, `unknowns[${index}].code`);
  result.detail = string(result.detail ?? 'Coverage is incomplete.', `unknowns[${index}].detail`, { max: 4096 });
  if (result.action_id !== undefined) result.action_id = id(result.action_id, `unknowns[${index}].action_id`);
  return result;
}

export function normalizeObservation(value, index = 0) {
  if (!object(value)) fail('web_observation_type', `observations[${index}] must be an object.`);
  const allowed = ['id', 'action_id', 'route', 'state', 'viewport', 'dom', 'visual', 'network', 'storage', 'dom_summary', 'dom_text', 'visual_artifact_hash', 'network_summary', 'storage_summary', 'authority', 'coverage', 'unknowns', 'complete', 'metadata'];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('web_observation_type', `Unknown observation field at index ${index}.`);
  const result = { id: id(value.id ?? value.action_id ?? `observation-${index + 1}`, `observations[${index}].id`) };
  if (value.action_id !== undefined) result.action_id = id(value.action_id, `observations[${index}].action_id`);
  if (value.route !== undefined) result.route = normalizeRoute(value.route);
  if (value.state !== undefined) result.state = normalizeState(value.state);
  if (value.viewport !== undefined) result.viewport = normalizeViewport(value.viewport);
  const dom = normalizeChannel(value.dom, `observations[${index}].dom`, ['summary', 'text']) ?? {};
  if (value.dom_summary !== undefined) dom.summary = summary(value.dom_summary, `observations[${index}].dom_summary`);
  if (value.dom_text !== undefined) dom.text = string(value.dom_text, `observations[${index}].dom_text`, { max: LIMITS.maxString, allowEmpty: true });
  if (Object.keys(dom).length) result.dom = dom;
  let visual = normalizeChannel(value.visual, `observations[${index}].visual`, ['artifact_hash', 'alt']) ?? {};
  if (value.visual_artifact_hash !== undefined) visual.artifact_hash = string(value.visual_artifact_hash, `observations[${index}].visual_artifact_hash`, { max: 512 });
  if (Object.keys(visual).length) result.visual = visual;
  const network = normalizeChannel(value.network, `observations[${index}].network`, ['summary']) ?? {};
  if (value.network_summary !== undefined) network.summary = summary(value.network_summary, `observations[${index}].network_summary`);
  if (Object.keys(network).length) result.network = network;
  const storage = normalizeChannel(value.storage, `observations[${index}].storage`, ['summary']) ?? {};
  if (value.storage_summary !== undefined) storage.summary = summary(value.storage_summary, `observations[${index}].storage_summary`);
  if (Object.keys(storage).length) result.storage = storage;
  result.authority = normalizeAuthority(value.authority ?? 'observed', `observations[${index}].authority`);
  result.coverage = normalizeCoverage({ ...(value.coverage ?? {}), ...(value.complete === undefined ? {} : { complete: value.complete }) });
  if (value.unknowns !== undefined) {
    if (!Array.isArray(value.unknowns) || value.unknowns.length > LIMITS.maxUnknowns) fail('web_unknown_type', `observations[${index}].unknowns must be a bounded array.`);
    result.unknowns = value.unknowns.map((item, unknownIndex) => normalizeUnknown(item, unknownIndex));
  } else result.unknowns = [];
  if (value.metadata !== undefined) result.metadata = cloneJson(value.metadata, `observations[${index}].metadata`);
  if (value.complete !== undefined && typeof value.complete !== 'boolean') fail('web_observation_type', `observations[${index}].complete must be boolean.`);
  return result;
}

function normalizeIdentity(value, label) {
  if (value === undefined || value === null) return null;
  if (!object(value)) fail('web_identity_type', `${label} must be an object.`);
  const result = cloneJson(value, label);
  if (result.id !== undefined) result.id = id(result.id, `${label}.id`);
  if (result.sha256 !== undefined && (typeof result.sha256 !== 'string' || !HASH.test(result.sha256))) fail('web_identity_type', `${label}.sha256 must be a SHA-256 hex string.`);
  return result;
}

function normalizeActions(value) {
  if (!Array.isArray(value) || value.length > LIMITS.maxActions) fail('web_action_type', `actions must be an array of at most ${LIMITS.maxActions} items.`);
  const actions = value.map(normalizeAction);
  const ids = new Set();
  for (const action of actions) {
    if (ids.has(action.id)) fail('duplicate_action', `Action ID ${action.id} is repeated.`);
    ids.add(action.id);
  }
  for (const action of actions) for (const dependency of action.requires ?? []) if (!ids.has(dependency)) fail('web_action_dependency', `${action.id} requires missing action ${dependency}.`);
  return actions;
}

/** Normalize the versioned web recovery IR without running a browser. */
export function normalizeWebRecoveryIR(value = {}) {
  if (!object(value)) fail('web_ir_type', 'Web recovery IR must be an object.');
  const source = cloneJson(value, 'web recovery IR');
  if (source.schema_version !== undefined && source.schema_version !== WEB_RECOVERY_SCHEMA_VERSION) fail('web_ir_version', `Use web recovery schema_version ${WEB_RECOVERY_SCHEMA_VERSION}.`);
  const scenario = object(source.scenario) ? source.scenario : {};
  const result = {
    schema_version: WEB_RECOVERY_SCHEMA_VERSION,
    kind: source.kind ?? WEB_RECOVERY_KIND,
    id: id(source.id ?? source.case_id ?? 'web-recovery-case', 'id'),
    route: normalizeRoute(source.route ?? scenario.route ?? '/'),
    state: normalizeState(source.state ?? scenario.state ?? {}),
    viewport: normalizeViewport(source.viewport ?? scenario.viewport ?? { width: 1280, height: 720, dpr: 1 }),
    actions: normalizeActions(source.actions ?? scenario.actions ?? []),
    observations: [],
    identities: {
      target: normalizeIdentity(source.identities?.target ?? source.target_identity ?? source.target, 'identities.target'),
      candidate: normalizeIdentity(source.identities?.candidate ?? source.candidate_identity ?? source.candidate, 'identities.candidate'),
    },
    authority: normalizeAuthority(source.authority ?? 'observed', 'authority'),
    coverage: normalizeCoverage(source.coverage ?? {}),
    unknowns: [],
  };
  if (result.kind !== WEB_RECOVERY_KIND) fail('web_ir_type', `kind must be ${WEB_RECOVERY_KIND}.`);
  const observations = source.observations ?? source.capture?.observations ?? [];
  if (!Array.isArray(observations) || observations.length > LIMITS.maxObservations) fail('web_observation_type', `observations must be an array of at most ${LIMITS.maxObservations} items.`);
  result.observations = observations.map(normalizeObservation);
  const observationIds = new Set();
  for (const observation of result.observations) {
    if (observationIds.has(observation.id)) fail('duplicate_observation', `Observation ID ${observation.id} is repeated.`);
    observationIds.add(observation.id);
  }
  if (source.unknowns !== undefined) {
    if (!Array.isArray(source.unknowns) || source.unknowns.length > LIMITS.maxUnknowns) fail('web_unknown_type', 'unknowns must be a bounded array.');
    result.unknowns = source.unknowns.map(normalizeUnknown);
  }
  if (source.metadata !== undefined) result.metadata = cloneJson(source.metadata, 'metadata');
  // Coverage is explicit.  An omitted observation for an action is therefore
  // an unknown during comparison instead of an implicit pass.
  if (source.coverage === undefined && result.actions.length) {
    result.coverage = { complete: result.observations.length >= result.actions.length, action_ids: result.observations.flatMap(item => item.action_id ? [item.action_id] : []), channels: [...OBSERVATION_CHANNELS] };
  }
  return result;
}

export const validateWebRecoveryIR = normalizeWebRecoveryIR;
export const assertWebRecoveryIR = normalizeWebRecoveryIR;
export const createWebRecoveryIR = normalizeWebRecoveryIR;
export const normalizeIR = normalizeWebRecoveryIR;
export const parseWebRecoveryIR = normalizeWebRecoveryIR;
export const webRecoveryDigest = value => digest(normalizeWebRecoveryIR(value));

/**
 * Adapt a finite local runtime receipt to the web IR.  This is intentionally a
 * loss-aware adapter: output/state/effects become bounded observable summaries
 * and incomplete receipt cases remain unknown.  It does not claim that a
 * receipt came from a browser or that screenshot hashes prove behavior.
 */
export function captureToWebIR(capture, options = {}) {
  if (!object(capture)) fail('web_capture_type', 'Runtime capture must be an object.');
  const receipt = object(capture.receipt) ? capture.receipt : capture;
  const cases = Array.isArray(receipt.cases) ? receipt.cases : Array.isArray(capture.cases) ? capture.cases : [];
  const actions = cases.map((item, index) => {
    const input = object(item?.input) ? item.input : {};
    const kind = ACTION_KINDS.includes(input.kind) ? input.kind : 'wait';
    const action = { id: item?.id ?? `action-${index + 1}`, kind };
    if (kind === 'wait') action.milliseconds = Number.isSafeInteger(input.milliseconds) && input.milliseconds >= 0 ? Math.min(input.milliseconds, 120000) : 0;
    if (kind === 'navigate') { if (input.route !== undefined) action.route = input.route; else if (typeof input.url === 'string') action.url = input.url; else action.route = '/'; }
    if (kind === 'click' || kind === 'input') { action.target = input.target ?? input.selector ?? `runtime:${action.id}`; if (kind === 'input') action.value = typeof input.value === 'string' ? input.value : ''; }
    return action;
  });
  const observations = cases.map((item, index) => {
    const output = own(item, 'output') ? item.output : null;
    const state = own(item, 'state') ? item.state : null;
    const effects = own(item, 'effects') ? item.effects : [];
    const screenshot = item.screenshot_sha256 ?? item.output?.screenshot_sha256 ?? capture.screenshot_sha256 ?? options.screenshot_sha256;
    return {
      id: item.id ?? `observation-${index + 1}`,
      action_id: item.id ?? actions[index]?.id,
      dom: { summary: output },
      network: { summary: effects },
      storage: { summary: state },
      ...(screenshot === undefined ? {} : { visual: { artifact_hash: screenshot } }),
      complete: item.complete !== false,
      authority: options.authority ?? 'controlled',
      unknowns: item.complete === false ? [{ code: 'runtime_case_incomplete', detail: 'The runtime receipt did not complete this action.', action_id: item.id ?? actions[index]?.id }] : [],
    };
  });
  const unknowns = Array.isArray(capture.unknowns) ? capture.unknowns : [];
  const target = capture.provenance?.target ?? (receipt.bindings?.target_sha256 ? { sha256: receipt.bindings.target_sha256 } : null);
  const result = {
    schema_version: WEB_RECOVERY_SCHEMA_VERSION,
    kind: WEB_RECOVERY_KIND,
    id: options.id ?? capture.provenance?.session_id ?? 'web-runtime-capture',
    route: options.route ?? '/', state: options.state ?? {}, viewport: options.viewport ?? { width: 1280, height: 720, dpr: 1 },
    actions, observations, identities: { target, candidate: options.candidate_identity ?? null },
    authority: options.authority ?? 'controlled',
    coverage: { complete: capture.complete !== false && receipt.complete !== false && observations.every(item => item.complete), action_ids: actions.map(item => item.id), channels: [...OBSERVATION_CHANNELS] },
    unknowns,
  };
  return normalizeWebRecoveryIR(result);
}

