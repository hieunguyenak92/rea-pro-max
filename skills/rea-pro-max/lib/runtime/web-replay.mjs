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

function scenarioFor(scenario, url, replayOrigins) {
  if (!object(scenario)) throw new RpmError('web_replay_input', 'Web replay requires a bounded scenario object.');
  const origins = new Set(replayOrigins);
  if (scenario.url !== undefined) origins.add(new URL(requireUrl(scenario.url, 'scenario.url')).origin);
  const actions = Array.isArray(scenario.actions) ? scenario.actions.map(action => {
    if (action?.kind !== 'navigate') return action;
    const authored = new URL(requireUrl(action.url, 'action.url'));
    if (!origins.has(authored.origin)) throw new RpmError('web_replay_input', 'Paired navigate actions must use the scenario or one of the replay origins.');
    const rebound = new URL(url);
    rebound.pathname = authored.pathname;
    rebound.search = authored.search;
    rebound.hash = authored.hash;
    return { ...action, url: rebound.href };
  }) : scenario.actions;
  return { ...scenario, url, actions };
}

function samePageIdentity(value) {
  if (typeof value !== 'string') return value;
  try { const url = new URL(value); return `${url.pathname}${url.search}${url.hash}`; } catch { return value; }
}

function normalizeActionLocators(actions) {
  for (const action of actions) if (action.kind === 'navigate' && action.url !== undefined) action.url = samePageIdentity(action.url);
}

function normalizeEnvironment(ir, origin) {
  normalizeActionLocators(ir.actions);
  for (const observation of ir.observations) {
    const observed = observation.dom?.summary?.url;
    if (typeof observed === 'string' && new URL(observed).origin !== origin) {
      observation.coverage.complete = false;
      observation.unknowns.push({ code: 'unexpected_page_origin', detail: 'The observed document is outside this replay side origin.', action_id: observation.action_id });
    }
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
  const referenceLocator = new URL(requireUrl(referenceUrl, 'referenceUrl'));
  const candidateLocator = new URL(requireUrl(candidateUrl, 'candidateUrl'));
  if (referenceLocator.origin === candidateLocator.origin && referenceLocator.href !== candidateLocator.href &&
      Array.isArray(scenario?.actions) && scenario.actions.some(action => action?.kind === 'navigate')) {
    throw new RpmError('web_replay_input', 'Distinct replay URLs on the same origin cannot share an explicit navigate action.');
  }
  const origins = [referenceLocator.origin, candidateLocator.origin];
  const referenceInput = scenarioFor(scenario, referenceLocator.href, origins);
  const candidateInput = scenarioFor(scenario, candidateLocator.href, origins);
  const reference = await captureWebScenario({ executablePath, scenario: referenceInput, timeoutMs, signal, onProgress: value => onProgress?.({ target: 'reference', ...value }) });
  if (signal?.aborted) throw new RpmError('request_cancelled', 'Web replay was cancelled after the reference capture.');
  const candidate = await captureWebScenario({ executablePath, scenario: candidateInput, timeoutMs, signal, onProgress: value => onProgress?.({ target: 'candidate', ...value }) });
  const referenceIr = normalizeEnvironment(captureToWebIR(reference, { id: 'web-reference', route: referenceLocator.pathname }), referenceLocator.origin);
  const candidateIr = normalizeEnvironment(captureToWebIR(candidate, { id: 'web-candidate', route: candidateLocator.pathname }), candidateLocator.origin);
  const compiled = contract === undefined ? compileContract(referenceIr, candidateIr) : validateContract(contract);
  normalizeActionLocators(compiled.actions);
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
    scope: 'Finite actions in disposable Chromium profiles. Behavior covers DOM, storage keys and same-origin HTTP effects in attached page-session windows. Visual hashes have a separate verdict.',
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
