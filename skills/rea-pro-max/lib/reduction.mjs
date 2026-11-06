import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RpmError, canonical, digest } from './common.mjs';

const copy = value => JSON.parse(canonical(value));
const ISOLATED_RESET = Symbol('isolated-reset');

/** Bounded in-process reduction for an oracle the caller already controls. */
export async function minimizeSequence(sequence, oracle, { maxTests = 100, stabilityRuns = 2, reset } = {}) {
  if (!Array.isArray(sequence) || sequence.length > 10000) throw new RpmError('invalid_sequence', 'Use an array of at most 10000 events.');
  if (typeof oracle !== 'function' || (reset !== undefined && typeof reset !== 'function')) throw new RpmError('invalid_oracle', 'Provide an oracle function and optional reset function.');
  if (!Number.isSafeInteger(maxTests) || maxTests < 1 || maxTests > 10000 || !Number.isSafeInteger(stabilityRuns) || stabilityRuns < 1 || stabilityRuns > 20) throw new RpmError('invalid_reduction_budget', 'Use maxTests1–10000 and stabilityRuns1–20.');
  if (canonical(sequence).length > 4 * 1024 * 1024) throw new RpmError('sequence_bounds', 'Sequence JSON must be at most4MiB.');
  let current = copy(sequence); const original = copy(sequence); let tests = 0; let oracleCalls = 0; let resetCalls = 0; const receipts = []; let fingerprint = null;
  const finish = (status, minimality = 'not-established', reason = null) => ({ schema_version: 1, sequence: current, tests, status, minimality, fingerprint, original_length: original.length, reduced_length: current.length,
    reset_applied: reset !== undefined && receipts.every(receipt => receipt.reset_applied), reset_configured: reset !== undefined, oracle_calls: oracleCalls, reset_calls: resetCalls, stability_runs: stabilityRuns, budget: maxTests, reason, receipts });
  async function trial(input, stage) {
    if (tests >= maxTests) return { status: 'budget_exhausted' };
    const attempt = ++tests; let result; let resetApplied = false;
    try {
      if (reset) { resetCalls++; await reset(); resetApplied = true; }
      oracleCalls++; result = await oracle(copy(input));
      if (result?.[ISOLATED_RESET] === true) { resetCalls++; resetApplied = true; }
      if (!result || typeof result !== 'object' || !['mismatch', 'equivalent', 'invalid', 'unknown'].includes(result.status) || (result.status === 'mismatch' && (typeof result.fingerprint !== 'string' || !result.fingerprint.trim() || result.fingerprint.length > 1024))) {
        result = { status: 'unknown', detail: 'Oracle returned an unsupported result.' };
      }
    } catch (error) { result = { status: 'unknown', detail: `Oracle/reset failed: ${String(error?.message ?? error).slice(0, 500)}` }; }
    const receipt = { attempt, stage, sequence_sha256: digest(input), length: input.length, status: result.status, fingerprint: typeof result.fingerprint === 'string' ? result.fingerprint : null, reset_applied: resetApplied };
    if (result.detail) receipt.detail = String(result.detail).slice(0, 500);
    receipts.push(receipt); return receipt;
  }
  async function stable(input, stage) {
    let first;
    for (let i = 0; i < stabilityRuns; i++) {
      const result = await trial(input, stage);
      if (result.status === 'budget_exhausted') return result;
      if (result.status === 'unknown') return result;
      if (!first) first = result;
      else if (first.status !== result.status || (result.status === 'mismatch' && first.fingerprint !== result.fingerprint)) return { status: 'flaky_oracle' };
    }
    return first;
  }
  const initial = await stable(current, 'baseline');
  if (initial.status === 'budget_exhausted') return finish('budget_exhausted', 'not-established', 'The baseline did not complete its stability repetitions.');
  if (initial.status === 'flaky_oracle') return finish('flaky_oracle', 'not-established', 'The initial failure is not stable.');
  if (initial.status !== 'mismatch') return finish('unknown', 'not-established', 'The initial sequence is not a qualified stable mismatch.');
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

/**
 * Run a caller-selected oracle in a fresh child process for every trial. This is
 * an execution boundary, not a sandbox: the oracle still has the user's local
 * permissions, but a hung process can be terminated and its output is bounded.
 */
export async function minimizeSequenceIsolated(sequence, modulePath, options = {}) {
  if (typeof modulePath !== 'string' || !modulePath.trim()) throw new RpmError('invalid_oracle', 'Provide an oracle module path.');
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new RpmError('invalid_oracle_timeout', 'Use an oracle timeout from 100 to 120000 milliseconds.');
  const runner = fileURLToPath(new URL('../scripts/oracle-runner.mjs', import.meta.url));
  const oracle = async input => {
    const result = spawnSync(process.execPath, [runner, modulePath], {
      input: canonical(input), encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 256 * 1024,
      cwd: process.cwd(), windowsHide: true,
    });
    if (result.error) return { status: 'unknown', detail: `Isolated oracle failed: ${String(result.error.message).slice(0, 500)}` };
    if (result.signal) return { status: 'unknown', detail: `Isolated oracle terminated by ${result.signal}.` };
    if (result.status !== 0) return { status: 'unknown', detail: `Isolated oracle exited ${result.status}: ${String(result.stderr).slice(0, 400)}` };
    try {
      const envelope = JSON.parse(result.stdout);
      if (!envelope || typeof envelope !== 'object' || typeof envelope.reset_applied !== 'boolean') throw new Error('Invalid oracle envelope');
      return { ...envelope.result, [ISOLATED_RESET]: envelope.reset_applied };
    }
    catch { return { status: 'unknown', detail: 'Isolated oracle returned invalid JSON.' }; }
  };
  const result = await minimizeSequence(sequence, oracle, options);
  result.reset_applied = result.receipts.length > 0 && result.receipts.every(receipt => receipt.reset_applied);
  result.reset_configured = result.reset_calls > 0;
  result.execution = { boundary: 'fresh child process per trial', timeout_ms: timeoutMs, sandbox: false, note: 'Fresh process state does not reset external files, databases or services; the supplied module reset() owns those effects.' };
  return result;
}
