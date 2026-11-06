import { compareBehavior } from '../verification.mjs';
import { canonical, digest, RpmError } from '../common.mjs';
import { captureMv3, validateScenario } from './mv3.mjs';

export async function replayFeature({ referencePath, candidatePath, executablePath, scenario: input, timeoutMs, signal, onProgress } = {}) {
  const scenario = validateScenario(input);
  const reference = await captureMv3({ extensionPath: referencePath, executablePath, scenario, timeoutMs, signal, onProgress: value => onProgress?.({ target: 'reference', ...value }) });
  const candidate = await captureMv3({ extensionPath: candidatePath, executablePath, scenario, timeoutMs, signal, onProgress: value => onProgress?.({ target: 'candidate', ...value }) });
  const verification = compareBehavior(reference.receipt, candidate.receipt);
  const failures = verification.cases.filter(item => item.status === 'fail');
  const mismatch = failures.length ? { fingerprint: digest(failures.map(item => ({ id: item.id, paths: item.differences.map(diff => diff.path) }))), first_action: failures[0].id, failing_actions: failures.map(item => item.id), differences: failures[0].differences } : null;
  return { schema_version: 1, kind: 'feature-replay', status: verification.status, scenario, reference, candidate, verification, mismatch,
    scope: 'Actual executions of the declared rpm-kv-v1 message/reset scenario in separate disposable profiles. Boot IDs remain evidence and are excluded from message comparison by the declared protocol. No unobserved UI/network/file effects or whole-program equivalence is established.' };
}

/** Evaluate an independently authored public acceptance scenario against a capture. */
export function checkExpected(capture, expected) {
  if (!capture || capture.kind !== 'runtime-capture' || !Array.isArray(expected)) throw new RpmError('invalid_acceptance', 'Provide a runtime capture and expected action outputs.');
  const cases = expected.map(item => {
    const actual = capture.receipt.cases.find(value => value.id === item.id);
    if (!actual || actual.complete === false || capture.complete !== true) return { id: item.id, status: 'unknown' };
    return { id: item.id, status: canonical(actual.output) === canonical(item.output) ? 'pass' : 'fail', ...(canonical(actual.output) !== canonical(item.output) ? { expected: item.output, actual: actual.output } : {}) };
  });
  return { status: cases.some(item => item.status === 'fail') ? 'fail' : cases.some(item => item.status === 'unknown') || !cases.length ? 'unknown' : 'pass', cases };
}
