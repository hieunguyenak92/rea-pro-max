import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, digest, hashBytes, RpmError } from './common.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SEQUENCE = Object.freeze([{ type: 'read' }, { type: 'save', text: 'Café · 東京 · a decision that survives' }, { type: 'read' }, { type: 'restart' }, { type: 'read' }]);
const bytes = path => readFileSync(new URL(path, import.meta.url));
export const FIXTURE_BINDINGS = Object.freeze({
  scenario_sha256: digest(DEFAULT_SEQUENCE),
  reset_sha256: digest({ state: { storage: {}, worker: 'new context' }, implementation_sha256: hashBytes(bytes('./lab.mjs')) }),
  toolchain_sha256: digest({ versions: process.versions, facade_sha256: hashBytes(bytes('./lab.mjs')), common_sha256: hashBytes(bytes('./common.mjs')) }),
  verifier_sha256: digest({ verification_sha256: hashBytes(bytes('./verification.mjs')), common_sha256: hashBytes(bytes('./common.mjs')) }),
});
// Only this product's two owned fixtures are executed here. Inspect never calls this module.
export async function simulateWorker(kind, sequence) {
  if (!['reference', 'regression'].includes(kind)) throw new RpmError('lab_fixture', 'Choose reference or regression owned fixture.');
  if (!Array.isArray(sequence) || sequence.length > 100) throw new RpmError('lab_sequence', 'Use up to100 owned lab actions.');
  const source = readFileSync(join(root, 'assets/labs/mv3', kind, 'worker.js'), 'utf8');
  let storage = {}, listener, boots = 0;
  const effects = [];
  function boot() {
    boots++;
    const chrome = {
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
      storage: { local: {
        async get(defaults) { return structuredClone({ ...defaults, ...storage }); },
        async set(values) { storage = structuredClone(values); effects.push({ channel: 'modeled-chrome-storage-local', name: 'set', value: structuredClone(values) }); },
      } },
    };
    const context = createContext({ chrome, crypto: { randomUUID }, console });
    runInContext(source, context, { timeout: 1000, filename: `owned-${kind}-worker.js` });
  }
  boot();
  const observations = [];
  for (const action of sequence) {
    if (!action || !['read', 'save', 'reset', 'restart'].includes(action.type)) throw new RpmError('lab_action', 'Use read/save/reset/restart.');
    if (action.type === 'restart') { boot(); observations.push({ action: 'restart', model_boot: boots }); continue; }
    const result = await new Promise((resolveMessage, reject) => {
      const timer = setTimeout(() => reject(new RpmError('lab_response', 'Owned fixture did not reply.')), 1000);
      let replied = false;
      const respond = value => { replied = true; clearTimeout(timer); resolveMessage(structuredClone(value)); };
      try {
        const asynchronous = listener({ lab: 'rpm-owned-lab', type: action.type, text: action.text }, {}, respond);
        if (!asynchronous && !replied) { clearTimeout(timer); reject(new RpmError('lab_response', 'Message channel closed without response.')); }
      } catch (error) { clearTimeout(timer); reject(error); }
    });
    observations.push({ action: action.type, ok: result.ok, ...(result.clips ? { clips: result.clips } : { error: result.error }), model_boot: boots });
  }
  return { sequence: structuredClone(sequence), effects, bindings: { ...FIXTURE_BINDINGS, scenario_sha256: digest(sequence), target_sha256: hashBytes(Buffer.from(source)) }, observations, final: observations.filter(item => item.action !== 'restart').at(-1) ?? null, evidence_kind: 'controlled-javascript-model', limits: ['Chrome APIs are simulated; this does not prove real Chromium worker suspension.'] };
}
export function demonstrationCase(target) {
  return {
    goal: 'Find which declared persistence mechanism retains clips across a worker restart.', target,
    hypotheses: [
      { id: 'memory', label: 'Worker memory only', predictions: { reopen: 'retained', restart: 'lost' } },
      { id: 'local', label: 'Persistent extension-local storage', predictions: { reopen: 'retained', restart: 'retained' } },
      { id: 'unknown', label: 'Another unmodeled mechanism', predictions: { reopen: null, restart: null } },
    ],
    probes: [
      { id: 'reopen', label: 'Reopen the popup', cost: 1, requires: ['owned-model'], effects: [], reset: 'empty owned fixture storage', steps: ['Save one synthetic clip.', 'Close and reopen only the popup.', 'Read clips.'] },
      { id: 'restart', label: 'Restart the worker context', cost: 2, requires: ['owned-model'], effects: [], reset: 'empty owned fixture storage', steps: ['Save one synthetic clip.', 'Replace the owned worker context while retaining modeled storage.', 'Read clips.'] },
    ],
  };
}
export function behaviorDocument(result, caseId = 'retained-clips') {
  const final = result.final;
  return {
    schema_version: 1, bindings: structuredClone(result.bindings), complete: true,
    cases: [{ id: caseId, input: result.sequence, output: final ? { ok: final.ok, clips: final.clips ?? null, error: final.error ?? null } : null, state: final?.clips ?? null, effects: result.effects, metadata: { evidence_kind: result.evidence_kind } }],
  };
}
export async function mismatchOracle(sequence) {
  if (!sequence.length || sequence.at(-1).type !== 'read') return { status: 'invalid', fingerprint: 'requires-final-read' };
  const [left, right] = await Promise.all([simulateWorker('reference', sequence), simulateWorker('regression', sequence)]);
  const observed = x => ({ ok: x.final?.ok, clips: x.final?.clips ?? null, error: x.final?.error ?? null });
  return { status: canonical(observed(left)) === canonical(observed(right)) ? 'equivalent' : 'mismatch', fingerprint: 'retained-clips-after-worker-context-reset' };
}
