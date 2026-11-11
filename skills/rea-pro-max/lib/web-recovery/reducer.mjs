import { RpmError, digest } from '../common.mjs';
import { LIMITS, cloneJson, normalizeAction } from './schema.mjs';

const ISOLATED_RESET = Symbol('web-recovery-isolated-reset');
const validStatuses = new Set(['mismatch', 'equivalent', 'pass', 'invalid', 'unknown', 'fail']);

function fail(code, message, details = {}) { throw new RpmError(code, message, details); }
const copy = value => cloneJson(value, 'action sequence');

function normalizeSequence(value) {
  if (!Array.isArray(value) || value.length > LIMITS.maxActions) fail('web_reduction_type', `Use an action array of at most ${LIMITS.maxActions} items.`);
  const result = value.map((item, index) => normalizeAction(item, index));
  if (new Set(result.map(item => item.id)).size !== result.length) fail('duplicate_action', 'Action IDs must be unique during reduction.');
  return result;
}

function dependencyGraph(actions) {
  const all = new Map(actions.map(action => [action.id, new Set(action.requires ?? [])]));
  let latestNavigate = null;
  for (const action of actions) {
    if (action.kind === 'navigate') latestNavigate = action.id;
    else if (latestNavigate && ['click', 'input', 'reload'].includes(action.kind) && !(action.requires?.length)) all.get(action.id).add(latestNavigate);
  }
  return all;
}

function dependencySafe(actions, graph) {
  const ids = new Set(actions.map(item => item.id));
  for (const action of actions) for (const dependency of graph.get(action.id) ?? []) if (!ids.has(dependency)) return { ok: false, missing: dependency, action: action.id };
  return { ok: true };
}

function outcome(value) {
  if (!value || typeof value !== 'object' || !validStatuses.has(value.status)) return { status: 'unknown', detail: 'Oracle returned an unsupported result.' };
  const status = value.status === 'pass' || value.status === 'fail' ? (value.status === 'pass' ? 'equivalent' : 'mismatch') : value.status;
  if (status === 'mismatch') {
    let fingerprint = value.fingerprint;
    if (fingerprint === undefined && value.mismatches !== undefined) fingerprint = digest(value.mismatches);
    if (typeof fingerprint !== 'string' || !fingerprint.trim() || fingerprint.length > 1024) return { status: 'unknown', detail: 'Mismatch oracle results require a bounded fingerprint.' };
    return { ...value, status, fingerprint };
  }
  return { ...value, status };
}

/**
 * Shrink a finite web action sequence while retaining setup dependencies and
 * the exact initial mismatch fingerprint.  The oracle is caller controlled;
 * this module never launches a browser or imports a provider.
 */
export async function shrinkActions(sequence, oracle, { maxTests = 100, stabilityRuns = 2, reset } = {}) {
  const original = normalizeSequence(sequence);
  if (typeof oracle !== 'function' || (reset !== undefined && typeof reset !== 'function')) fail('web_reduction_oracle', 'Provide an oracle and optional reset function.');
  if (!Number.isSafeInteger(maxTests) || maxTests < 1 || maxTests > 10000 || !Number.isSafeInteger(stabilityRuns) || stabilityRuns < 1 || stabilityRuns > 20) fail('web_reduction_budget', 'Use maxTests 1–10000 and stabilityRuns 1–20.');
  if (Buffer.byteLength(JSON.stringify(original), 'utf8') > LIMITS.maxJsonBytes) fail('web_reduction_bounds', 'Action sequence JSON exceeds the bounded size.');
  const graph = dependencyGraph(original); let current = copy(original); const receipts = []; let tests = 0; let oracleCalls = 0; let resetCalls = 0; let fingerprint = null;
  const finish = (status, minimality = 'not-established', reason = null) => ({
    schema_version: 1, kind: 'web-recovery-reduction', status, minimality, fingerprint, actions: current, sequence: current,
    tests, oracle_calls: oracleCalls, reset_calls: resetCalls, reset_configured: reset !== undefined,
    reset_applied: reset !== undefined && receipts.length > 0 && receipts.every(item => item.reset_applied),
    original_length: original.length, reduced_length: current.length, budget: maxTests, stability_runs: stabilityRuns, reason, receipts,
  });
  async function trial(input, stage, dependency = null) {
    if (dependency && !dependency.ok) {
      const receipt = { attempt: tests, stage, sequence_sha256: digest(input), length: input.length, status: 'invalid', fingerprint: null, reset_applied: false, detail: `Action ${dependency.action} requires retained action ${dependency.missing}.` };
      receipts.push(receipt); return receipt;
    }
    if (tests >= maxTests) return { status: 'budget_exhausted' };
    const attempt = ++tests; let result; let resetApplied = false;
    try {
      if (reset) { resetCalls++; await reset(); resetApplied = true; }
      oracleCalls++; result = outcome(await oracle(copy(input)));
      if (result?.[ISOLATED_RESET] === true) { resetCalls++; resetApplied = true; }
    } catch (error) { result = { status: 'unknown', detail: `Oracle/reset failed: ${String(error?.message ?? error).slice(0, 500)}` }; }
    const receipt = { attempt, stage, sequence_sha256: digest(input), length: input.length, status: result.status, fingerprint: result.fingerprint ?? null, reset_applied: resetApplied };
    if (result.detail) receipt.detail = String(result.detail).slice(0, 500);
    receipts.push(receipt); return receipt;
  }
  async function stable(input, stage) {
    let first;
    for (let run = 0; run < stabilityRuns; run++) {
      const result = await trial(input, stage, dependencySafe(input, graph));
      if (result.status === 'budget_exhausted' || result.status === 'unknown' || result.status === 'invalid') return result;
      if (!first) first = result;
      else if (first.status !== result.status || (result.status === 'mismatch' && first.fingerprint !== result.fingerprint)) return { status: 'flaky_oracle' };
    }
    return first;
  }
  const initial = await stable(current, 'baseline');
  if (initial.status === 'budget_exhausted') return finish('budget_exhausted', 'not-established', 'The baseline exceeded the oracle budget.');
  if (initial.status === 'flaky_oracle') return finish('flaky_oracle', 'not-established', 'The initial mismatch was unstable.');
  if (initial.status !== 'mismatch') return finish('unknown', 'not-established', 'The initial action sequence is not a qualified stable mismatch.');
  fingerprint = initial.fingerprint;
  let granularity = Math.min(2, current.length);
  while (current.length) {
    const chunks = Math.max(1, Math.min(granularity, current.length)); let accepted = false;
    for (let index = 0; index < chunks; index++) {
      const start = Math.floor(index * current.length / chunks); const end = Math.floor((index + 1) * current.length / chunks);
      const candidate = [...current.slice(0, start), ...current.slice(end)];
      const result = await stable(candidate, 'remove');
      if (result.status === 'budget_exhausted') return finish('budget_exhausted', 'not-established', 'Reduction stopped at the oracle-call budget.');
      if (result.status === 'flaky_oracle') return finish('flaky_oracle', 'not-established', 'A proposed reduction produced inconsistent outcomes.');
      if (result.status === 'unknown') return finish('unknown', 'not-established', 'A proposed reduction could not be qualified.');
      if (result.status === 'mismatch' && result.fingerprint === fingerprint) {
        current = candidate; granularity = Math.min(current.length, Math.max(2, chunks - 1)); accepted = true; break;
      }
    }
    if (accepted) continue;
    if (chunks >= current.length) return finish(current.length < original.length ? 'reduced' : 'unchanged', 'one-minimal');
    granularity = Math.min(current.length, chunks * 2);
  }
  return finish(current.length < original.length ? 'reduced' : 'unchanged', 'one-minimal');
}

export const reduceActions = shrinkActions;
export const minimizeWebSequence = shrinkActions;
export const shrinkSequence = shrinkActions;
export const reduceWebActions = shrinkActions;

