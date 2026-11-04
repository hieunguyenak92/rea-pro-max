import test from 'node:test';
import assert from 'node:assert/strict';
import { rankProbes } from '../skills/rea-pro-max/lib/planner.mjs';

const hash = character => character.repeat(64);
const bindings = { target_sha256: hash('a'), scenario_sha256: hash('b'), reset_sha256: hash('c'), toolchain_sha256: hash('d') };
const recipe = (id, cost = 1) => ({ id, label: id, cost, requires: [], effects: [], reset: 'Restore initial fixture state', steps: ['Perform the named fixture action'] });
const alternatives = [
  { id: 'memory', label: 'Worker memory', predictions: { reload: 'retained', cold: 'lost', browser: 'lost' } },
  { id: 'session', label: 'Session storage', predictions: { reload: 'retained', cold: 'retained', browser: 'lost' } },
  { id: 'local', label: 'Local storage', predictions: { reload: 'retained', cold: 'retained', browser: 'retained' } },
];
const probes = [recipe('reload'), recipe('cold', 2), recipe('browser', 4)];
const observed = extra => ({ probe_id: 'cold', outcome: 'lost', source: 'Fixture screenshot receipt', authority: 'reported', bindings, partial: false, ...extra });

test('minimax ranks informative persistence probes by conservative gain per declared cost', () => {
  const result = rankProbes({ hypotheses: alternatives, probes });
  assert.equal(result.next_probe_id, 'cold'); assert.equal(result.status, 'open');
  assert.equal(result.ranked[0].gain, 1); assert.equal(result.ranked[0].worst_survivors, 2); assert.equal(result.ranked[0].score, 0.5);
  assert.equal(result.ranked.find(probe => probe.id === 'reload').gain, 0);
});

test('missing predictions count against every outcome rather than disappearing', () => {
  const hypotheses = structuredClone(alternatives); delete hypotheses[2].predictions.cold;
  const result = rankProbes({ hypotheses, probes }); const cold = result.ranked.find(probe => probe.id === 'cold');
  assert.equal(cold.worst_survivors, 2); assert.deepEqual(cold.unknown_prediction_ids, ['local']);
  const after = rankProbes({ hypotheses, probes, bindings, observations: [observed()] });
  assert.deepEqual(after.surviving_ids, ['local', 'memory']);
});

test('overlapping nondeterministic outcome sets are not treated as certain partitions', () => {
  const hypotheses = [{ id: 'a', label: 'Either outcome', predictions: { p: ['lost', 'retained'] } }, { id: 'b', label: 'Retained', predictions: { p: 'retained' } }];
  const result = rankProbes({ hypotheses, probes: [recipe('p')] });
  assert.equal(result.ranked[0].gain, 0); assert.equal(result.status, 'no_discriminating_probe'); assert.equal(result.next_probe_id, null);
});

test('only complete, current-bound observations eliminate explicit contradicted predictions', () => {
  const partial = rankProbes({ hypotheses: alternatives, probes, bindings, observations: [observed({ partial: true })] });
  assert.equal(partial.surviving_ids.length, 3); assert.equal(partial.ignored_observations[0].reason, 'partial_observation');
  const stale = rankProbes({ hypotheses: alternatives, probes, bindings: { ...bindings, reset_sha256: hash('e') }, observations: [observed()] });
  assert.equal(stale.surviving_ids.length, 3); assert.equal(stale.ignored_observations[0].reason, 'incompatible_bindings');
  const current = rankProbes({ hypotheses: alternatives, probes, bindings, observations: [observed()] });
  assert.equal(current.status, 'resolved'); assert.deepEqual(current.surviving_ids, ['memory']);
  assert.equal(current.applied_observations[0].authority, 'reported');
});

test('observations without current provenance cannot silently resolve a case', () => {
  const result = rankProbes({ hypotheses: alternatives, probes, observations: [observed()] });
  assert.equal(result.surviving_ids.length, 3); assert.equal(result.ignored_observations[0].reason, 'current_bindings_missing');
});

test('a contradiction outside all declared hypotheses produces an incomplete model', () => {
  const result = rankProbes({ hypotheses: alternatives, probes, bindings, observations: [observed({ outcome: 'corrupted' })] });
  assert.equal(result.status, 'model_incomplete'); assert.deepEqual(result.surviving_ids, []); assert.equal(result.next_probe_id, null);
});

test('capability, effect and budget admission happens before choosing any probe', () => {
  const gated = [ { ...recipe('reload'), requires: ['browser'] }, { ...recipe('cold', 2), effects: ['restart'] }, recipe('browser', 4) ];
  const result = rankProbes({ hypotheses: alternatives, probes: gated, budget: 3 });
  assert.equal(result.status, 'no_discriminating_probe');
  assert.deepEqual(result.excluded, [{ id: 'browser', reason: 'over_budget' }, { id: 'cold', reason: 'effect_not_allowed' }, { id: 'reload', reason: 'missing_capability' }]);
});

test('equal-cost ties have deterministic identifier ordering across input permutations', () => {
  const hypotheses = [{ id: 'a', label: 'A', predictions: { y: 'yes', x: 'yes' } }, { id: 'b', label: 'B', predictions: { x: 'no', y: 'no' } }];
  const a = rankProbes({ hypotheses, probes: [recipe('y'), recipe('x')] });
  const b = rankProbes({ hypotheses: hypotheses.toReversed(), probes: [recipe('x'), recipe('y')] });
  assert.deepEqual(a.ranked, b.ranked); assert.equal(a.next_probe_id, 'x');
});

test('qualified repeated probes are not proposed as fresh distinguishing operations', () => {
  const result = rankProbes({ hypotheses: alternatives, probes, bindings, observations: [observed({ probe_id: 'reload', outcome: 'retained' })] });
  assert.equal(result.ranked.some(probe => probe.id === 'reload'), false);
  assert.equal(result.excluded.find(probe => probe.id === 'reload').reason, 'already_observed');
  assert.throws(() => rankProbes({ hypotheses: alternatives, probes, budget: NaN }), { code: 'invalid_budget' });
});

test('extreme heuristic costs cannot produce non-JSON infinite scores', () => {
  assert.throws(() => rankProbes({ hypotheses: alternatives, probes: probes.map(probe => ({ ...probe, cost: Number.MIN_VALUE })) }), { code: 'invalid_cost' });
});
