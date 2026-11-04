import { RpmError } from './common.mjs';
import { validateBindings, validateHypotheses, validateObservation, validateProbes } from './case.mjs';

const matches = (prediction, outcome) => prediction === null || prediction === undefined || (Array.isArray(prediction) ? prediction.includes(outcome) : prediction === outcome);
const orderText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Rank declared experiments; this does not run them or attest reported observations. */
export function rankProbes({ hypotheses, probes, observations = [], capabilities = [], budget = Infinity, bindings, allowedEffects = [] }) {
  const alternatives = validateHypotheses(hypotheses); const recipes = validateProbes(probes);
  if (!Array.isArray(observations) || observations.length > 10000) throw new RpmError('invalid_observation', 'Provide at most 10000 observations.');
  for (const [label, values] of [['capabilities', capabilities], ['allowedEffects', allowedEffects]]) {
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new RpmError('invalid_planner', `${label} must be a string array.`);
  }
  if (!(budget === Infinity || (Number.isFinite(budget) && budget >= 0))) throw new RpmError('invalid_budget', 'Budget must be nonnegative.');
  const currentBindings = bindings === undefined ? null : validateBindings(bindings);
  const known = new Set(recipes.map(probe => probe.id));
  for (const alternative of alternatives) for (const probe of Object.keys(alternative.predictions)) if (!known.has(probe)) throw new RpmError('unknown_probe', `Prediction references missing probe ${probe}.`);
  const ignored = []; const qualified = [];
  for (const raw of observations) {
    const observation = validateObservation(raw);
    let reason;
    if (!known.has(observation.probe_id)) reason = 'unknown_probe';
    else if (observation.partial) reason = 'partial_observation';
    else if (!currentBindings) reason = 'current_bindings_missing';
    else if (Object.entries(currentBindings).some(([key, value]) => observation.bindings[key] !== value)) reason = 'incompatible_bindings';
    if (reason) ignored.push({ id: observation.id, probe_id: observation.probe_id, reason, authority: observation.authority });
    else qualified.push(observation);
  }
  const surviving = alternatives.filter(hypothesis => qualified.every(observation => matches(hypothesis.predictions[observation.probe_id], observation.outcome)));
  const observed = new Set(qualified.map(observation => observation.probe_id));
  const ranked = []; const excluded = [];
  if (surviving.length > 1) for (const probe of recipes) {
    let reason;
    if (observed.has(probe.id)) reason = 'already_observed';
    else if (probe.requires.some(value => !capabilities.includes(value))) reason = 'missing_capability';
    else if (probe.effects.some(value => !allowedEffects.includes(value))) reason = 'effect_not_allowed';
    else if (probe.cost > budget) reason = 'over_budget';
    if (reason) { excluded.push({ id: probe.id, reason }); continue; }
    const unknown = []; const partitions = new Map();
    for (const hypothesis of surviving) {
      const prediction = hypothesis.predictions[probe.id];
      if (prediction === null || prediction === undefined) { unknown.push(hypothesis.id); continue; }
      for (const outcome of Array.isArray(prediction) ? prediction : [prediction]) {
        if (!partitions.has(outcome)) partitions.set(outcome, []);
        partitions.get(outcome).push(hypothesis.id);
      }
    }
    const largest = partitions.size ? Math.max(...[...partitions.values()].map(value => value.length)) : 0;
    const worst = Math.min(surviving.length, largest + unknown.length);
    const gain = surviving.length - worst;
    if (!Number.isFinite(gain / probe.cost)) throw new RpmError('invalid_cost', 'Probe cost is too small for a finite ranking score.');
    ranked.push({ id: probe.id, label: probe.label, cost: probe.cost, gain, worst_survivors: worst, score: gain / probe.cost,
      unknown_prediction_ids: unknown.sort(orderText), partitions: [...partitions.entries()].sort(([a], [b]) => orderText(a, b)).map(([outcome, ids]) => ({ outcome, hypothesis_ids: ids.sort(orderText) })) });
  }
  ranked.sort((a, b) => b.score - a.score || a.cost - b.cost || orderText(a.id, b.id));
  excluded.sort((a, b) => orderText(a.id, b.id));
  const status = !surviving.length ? 'model_incomplete' : surviving.length === 1 ? 'resolved' : ranked.some(probe => probe.gain > 0) ? 'open' : 'no_discriminating_probe';
  return { status, surviving_ids: surviving.map(item => item.id).sort(orderText), ranked, ignored_observations: ignored,
    applied_observations: qualified.map(item => ({ id: item.id, probe_id: item.probe_id, authority: item.authority, source: item.source })), excluded,
    next_probe_id: status === 'open' ? ranked.find(item => item.gain > 0).id : null,
    scope: 'Declared finite hypotheses and predicted outcomes; ranking is a heuristic, not a calibrated probability or independent attestation.' };
}
