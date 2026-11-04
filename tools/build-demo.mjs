import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateDemo } from '../skills/rea-pro-max/scripts/rea-pro-max.mjs';
import { compareBehavior } from '../skills/rea-pro-max/lib/verification.mjs';
import { addObservation } from '../skills/rea-pro-max/lib/case.mjs';
import { renderReport } from '../skills/rea-pro-max/lib/report.mjs';
import { rankProbes } from '../skills/rea-pro-max/lib/planner.mjs';
const temp = mkdtempSync(join(tmpdir(), 'rpm-demo-build-'));
try {
  const out = join(temp, 'run'); await generateDemo(out);
  const payload = JSON.parse(readFileSync(join(out, 'lab.json'), 'utf8'));
  payload.inspection.artifact.path = 'owned-fixture/mv3/reference';
  const base = { schema_version: 1, title: payload.title, kind: 'lab', narrative: payload.narrative };
  const bindings = { ...payload.narrative.reference.bindings, target_sha256: payload.case.target.sha256 };
  const updated = addObservation(payload.case, { probe_id: 'restart', outcome: 'retained', source: 'owned worker script / simulated Chrome API model', authority: 'reported', partial: false, bindings }, payload.case.revision);
  const filtered = rankProbes({ ...updated, bindings, budget: 5 });
  const repaired = compareBehavior(JSON.parse(readFileSync(join(out, 'reference.json'), 'utf8')), JSON.parse(readFileSync(join(out, 'reference.json'), 'utf8')));
  const states = [
    { id: 'inspect', label: 'Read the boundaries', description: 'Static MV3 artifact analysis. Source positions and context identity are retained; execution is not inferred.', data: { ...base, inspection: payload.inspection } },
    { id: 'plan', label: 'Ask the useful question', description: 'Reopening the popup predicts the same outcome. A worker-context reset separates the two known storage hypotheses.', data: { ...base, case: payload.case, planner: payload.planner } },
    { id: 'plan-observed', label: 'Keep the unknown alive', description: 'A reported model observation excludes worker-only memory, while an unmodeled explanation still survives. This is not a confidence percentage.', data: { ...base, case: updated, planner: filtered } },
    { id: 'verify', label: 'Catch the lost write', description: 'The owned regression loses saved clips. Final state and modeled persistent writes differ under the same declared sequence.', data: { ...base, verification: payload.verification } },
    { id: 'reduce', label: 'Shrink the reproduction', description: 'Stable mismatch: save → restart → read. One-minimal under tested removals; no global-shortest claim.', data: { ...base, reduction: payload.reduction } },
    { id: 'verify-control', label: 'Inspect a passing control', description: 'A self-comparison checks the positive verifier path for this finite receipt. It is a control, not proof of an independently rebuilt app.', data: { ...base, verification: repaired } },
  ];
  mkdirSync(resolve('docs/demo'), { recursive: true });
  writeFileSync('docs/demo/states.json', JSON.stringify({ schema_version: 1, generated_at: new Date().toISOString(), evidence_kind: 'recorded-owned-controlled-model', states }, null, 2) + '\n');
  writeFileSync('docs/demo/workbench.html', renderReport(payload));
  console.log(`Recorded ${states.length} engine states in docs/demo/states.json`);
} finally { rmSync(temp, { recursive: true, force: true }); }
