import { RpmError, digest } from '../common.mjs';
import { captureWebScenario } from './web.mjs';
import { captureToWebIR } from '../web-recovery/schema.mjs';
import { compareWebRecovery, compareBehavior, compareVisual } from '../web-recovery/compare.mjs';
import { compileContract, validateContract } from '../web-recovery/contract.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireUrl(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new RpmError('web_replay_input', `${label} must be a nonempty URL.`);
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsupported URL');
    return url.toString();
  } catch {
    throw new RpmError('web_replay_input', `${label} must be an absolute http(s) URL without embedded credentials.`);
  }
}

function scenarioFor(scenario, url) {
  if (!object(scenario)) throw new RpmError('web_replay_input', 'Web replay requires a bounded scenario object.');
  return { ...scenario, url };
}

function samePageIdentity(value) {
  if (typeof value !== 'string') return value;
  try { const url = new URL(value); return `${url.pathname}${url.search}${url.hash}`; } catch { return value; }
}

function normalizeEnvironment(ir) {
  for (const observation of ir.observations) {
    if (observation.dom?.summary && typeof observation.dom.summary === 'object' && !Array.isArray(observation.dom.summary) && typeof observation.dom.summary.url === 'string') observation.dom.summary.url = samePageIdentity(observation.dom.summary.url);
    if (observation.storage?.summary && typeof observation.storage.summary === 'object' && !Array.isArray(observation.storage.summary) && typeof observation.storage.summary.url === 'string') observation.storage.summary.url = samePageIdentity(observation.storage.summary.url);
  }
  ir.metadata = { ...(ir.metadata ?? {}), environment_normalization: 'Origin and port are excluded from bounded URL observations; path/query/hash remain compared.' };
  return ir;
}

/**
 * Run two independently served web targets through the same finite action
 * sequence and compare DOM/state/network/storage observations separately from
 * screenshot hashes. This is a browser provider, not a general network
 * sandbox and does not claim whole-application equivalence.
 */
export async function replayWebFeature({ referenceUrl, candidateUrl, executablePath, scenario, contract, timeoutMs, signal, onProgress } = {}) {
  const referenceInput = scenarioFor(scenario, requireUrl(referenceUrl, 'referenceUrl'));
  const candidateInput = scenarioFor(scenario, requireUrl(candidateUrl, 'candidateUrl'));
  const reference = await captureWebScenario({ executablePath, scenario: referenceInput, timeoutMs, signal, onProgress: value => onProgress?.({ target: 'reference', ...value }) });
  if (signal?.aborted) throw new RpmError('request_cancelled', 'Web replay was cancelled after the reference capture.');
  const candidate = await captureWebScenario({ executablePath, scenario: candidateInput, timeoutMs, signal, onProgress: value => onProgress?.({ target: 'candidate', ...value }) });
  const referenceIr = normalizeEnvironment(captureToWebIR(reference, { id: 'web-reference', route: new URL(referenceUrl).pathname }));
  const candidateIr = normalizeEnvironment(captureToWebIR(candidate, { id: 'web-candidate', route: new URL(candidateUrl).pathname }));
  const compiled = contract === undefined ? compileContract(referenceIr, candidateIr) : validateContract(contract);
  const verification = compareWebRecovery(referenceIr, candidateIr, compiled);
  const failures = verification.behavior.cases.filter(item => item.status === 'fail');
  const mismatch = failures.length ? {
    fingerprint: digest(failures.map(item => ({ id: item.id, paths: item.differences.map(diff => `${diff.channel}:${diff.path}`) }))),
    first_action: failures[0].id,
    failing_actions: failures.map(item => item.id),
    differences: failures[0].differences,
  } : null;
  const status = verification.behavior.status === 'fail' || verification.visual.status === 'fail' ? 'fail' : verification.behavior.status === 'unknown' || verification.visual.status === 'unknown' ? 'unknown' : 'pass';
  return {
    schema_version: 1,
    kind: 'web-feature-replay',
    status,
    scenario,
    reference,
    candidate,
    reference_ir: referenceIr,
    candidate_ir: candidateIr,
    contract: compiled,
    verification,
    mismatch,
    scope: 'Finite actions executed against two explicit URLs in fresh disposable Chromium profiles. DOM/state/storage/network summaries and visual hashes are compared in separate verdicts; raw pixels, hidden effects and whole-program equivalence are not established.',
  };
}

export function summarizeWebReplay(result) {
  return {
    status: result.status,
    behavior: result.verification?.behavior?.status ?? null,
    visual: result.verification?.visual?.status ?? null,
    first_mismatch: result.mismatch?.first_action ?? null,
    reference_complete: result.reference?.complete === true,
    candidate_complete: result.candidate?.complete === true,
  };
}

export { compareBehavior, compareVisual };
