import { randomUUID } from 'node:crypto';
import { RpmError, canonical, digest } from './common.mjs';

const BINDING_KEYS = ['target_sha256', 'scenario_sha256', 'reset_sha256', 'toolchain_sha256'];
const MAX_ITEMS = 2000;

function problem(code, message, details = {}) { throw new RpmError(code, message, details); }
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) problem('invalid_case', `${label} must be an object.`);
}
function text(value, label, maximum = 1024) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) problem('invalid_case', `${label} must be a nonempty string of at most ${maximum} characters.`);
}
function identifier(value, label) {
  text(value, label, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value)) problem('invalid_case', `${label} contains unsupported identifier characters.`);
}
function list(value, label, maximum = MAX_ITEMS) {
  if (!Array.isArray(value) || value.length > maximum) problem('invalid_case', `${label} must be an array of at most ${maximum} entries.`);
}
function strings(value, label) {
  list(value, label);
  for (const item of value) text(item, label, 256);
  if (new Set(value).size !== value.length) problem('invalid_case', `${label} contains duplicates.`);
}
function jsonCopy(value) { return JSON.parse(canonical(value)); }
function unique(items, label) {
  const ids = new Set();
  for (const item of items) {
    identifier(item.id, `${label} ID`);
    if (ids.has(item.id)) problem('duplicate_identity', `${label} has duplicate ID ${item.id}.`);
    ids.add(item.id);
  }
}

export function validateBindings(value, required = BINDING_KEYS) {
  record(value, 'Bindings');
  const result = jsonCopy(value);
  for (const key of required) {
    if (typeof result[key] !== 'string' || !/^[a-fA-F0-9]{64}$/u.test(result[key])) problem('invalid_bindings', `${key} must be a SHA-256 hex digest.`);
  }
  for (const [key, item] of Object.entries(result)) {
    if (key.endsWith('_sha256')) {
      if (typeof item !== 'string' || !/^[a-fA-F0-9]{64}$/u.test(item)) problem('invalid_bindings', `${key} must be a SHA-256 hex digest.`);
      result[key] = item.toLowerCase();
    }
  }
  return result;
}

export function validateHypotheses(value) {
  list(value, 'Hypotheses');
  const result = jsonCopy(value);
  for (const item of result) {
    record(item, 'Hypothesis'); identifier(item.id, 'Hypothesis ID'); text(item.label, 'Hypothesis label'); record(item.predictions, 'Predictions');
    for (const [probe, prediction] of Object.entries(item.predictions)) {
      identifier(probe, 'Prediction probe ID');
      if (prediction === null) continue;
      if (typeof prediction === 'string') text(prediction, 'Predicted outcome');
      else {
        strings(prediction, 'Predicted outcomes');
        if (!prediction.length) problem('invalid_case', 'Use null for unknown predictions, not an empty outcome set.');
      }
    }
  }
  unique(result, 'Hypothesis'); return result;
}

export function validateProbes(value) {
  list(value, 'Probes');
  const result = jsonCopy(value);
  for (const item of result) {
    record(item, 'Probe'); identifier(item.id, 'Probe ID'); text(item.label, 'Probe label');
    if (!Number.isFinite(item.cost) || item.cost <= 0) problem('invalid_case', 'Probe cost must be finite and greater than zero.');
    item.requires ??= []; item.effects ??= [];
    strings(item.requires, 'Required capabilities'); strings(item.effects, 'Probe effects');
    text(item.reset, 'Probe reset', 4096); strings(item.steps, 'Probe steps');
    if (!item.steps.length) problem('invalid_case', 'A probe needs at least one explicit action step.');
  }
  unique(result, 'Probe'); return result;
}

function observationPayload(value) {
  const result = jsonCopy(value);
  delete result.id; delete result.content_sha256;
  return result;
}
export function validateObservation(value) {
  record(value, 'Observation');
  const result = jsonCopy(value);
  identifier(result.probe_id, 'Observation probe ID'); text(result.outcome, 'Observed outcome'); text(result.source, 'Observation source', 4096);
  if (!['reported', 'captured'].includes(result.authority)) problem('invalid_observation', 'Observation authority must be reported or captured.');
  if (typeof result.partial !== 'boolean') problem('invalid_observation', 'Observation partial must be explicitly true or false.');
  result.bindings = validateBindings(result.bindings);
  if (result.id !== undefined) identifier(result.id, 'Observation ID');
  const content = digest(observationPayload(result));
  if (result.content_sha256 !== undefined && result.content_sha256 !== content) problem('observation_integrity', 'The observation content digest no longer matches.');
  result.id ??= `obs_${content}`; result.content_sha256 = content;
  return result;
}

export function validateCase(value) {
  record(value, 'Case');
  const result = jsonCopy(value);
  if (result.schema_version !== 1) problem('case_version', 'This runtime supports case schema version 1.');
  identifier(result.id, 'Case ID');
  if (!Number.isSafeInteger(result.revision) || result.revision < 1) problem('invalid_case', 'Case revision must be a positive integer.');
  text(result.goal, 'Case goal', 4096); record(result.target, 'Target'); text(result.target.kind, 'Target kind', 128);
  if (typeof result.target.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/u.test(result.target.sha256)) problem('invalid_case', 'Target sha256 must be a SHA-256 hex digest.');
  result.target.sha256 = result.target.sha256.toLowerCase();
  if (typeof result.created_at !== 'string' || !Number.isFinite(Date.parse(result.created_at)) || new Date(result.created_at).toISOString() !== result.created_at) problem('invalid_case', 'Case created_at must be a canonical UTC ISO date string.');
  strings(result.capabilities, 'Capabilities');
  result.hypotheses = validateHypotheses(result.hypotheses); result.probes = validateProbes(result.probes);
  const probeIds = new Set(result.probes.map(item => item.id));
  for (const hypothesis of result.hypotheses) for (const probe of Object.keys(hypothesis.predictions)) {
    if (!probeIds.has(probe)) problem('unknown_probe', `Prediction references missing probe ${probe}.`);
  }
  list(result.observations, 'Observations', 10000);
  result.observations = result.observations.map(validateObservation); unique(result.observations, 'Observation');
  for (const observation of result.observations) if (!probeIds.has(observation.probe_id)) problem('unknown_probe', `Observation references missing probe ${observation.probe_id}.`);
  return result;
}

export function createCase({ goal, target, capabilities = [] }) {
  return validateCase({ schema_version: 1, id: `rpm_${randomUUID()}`, revision: 1, created_at: new Date().toISOString(), goal, target, capabilities, hypotheses: [], probes: [], observations: [] });
}
function requireRevision(value, expected) {
  if (!Number.isSafeInteger(expected) || value.revision !== expected) problem('revision_conflict', 'The case revision changed; load the latest case before editing.', { expected, actual: value.revision });
}
export function reviseCase(value, patch, expectedRevision) {
  const current = validateCase(value); requireRevision(current, expectedRevision); record(patch, 'Case patch');
  const allowed = new Set(['goal', 'target', 'capabilities', 'hypotheses', 'probes']);
  for (const key of Object.keys(patch)) if (!allowed.has(key)) problem('invalid_case_patch', `Case field ${key} cannot be patched.`);
  if (!Object.keys(patch).length) problem('invalid_case_patch', 'Provide at least one case field to update.');
  return validateCase({ ...current, ...jsonCopy(patch), revision: current.revision + 1 });
}
export function addObservation(value, observation, expectedRevision) {
  const current = validateCase(value); requireRevision(current, expectedRevision);
  const checked = validateObservation(observation);
  if (!current.probes.some(item => item.id === checked.probe_id)) problem('unknown_probe', `Observation references missing probe ${checked.probe_id}.`);
  const existing = current.observations.find(item => item.id === checked.id);
  if (existing) {
    if (canonical(existing) !== canonical(checked)) problem('observation_conflict', 'This observation ID already refers to different content.');
    return current;
  }
  return validateCase({ ...current, observations: [...current.observations, checked], revision: current.revision + 1 });
}
