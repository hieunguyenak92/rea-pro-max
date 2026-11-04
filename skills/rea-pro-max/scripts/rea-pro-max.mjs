#!/usr/bin/env node
import { mkdirSync, cpSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve, join, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { RpmError, pathExists, readJson, writeJsonAtomic } from '../lib/common.mjs';
import { createCase, reviseCase, addObservation, validateCase } from '../lib/case.mjs';
import { rankProbes } from '../lib/planner.mjs';
import { compareBehavior } from '../lib/verification.mjs';
import { minimizeSequence } from '../lib/reduction.mjs';
import { inspectArtifact } from '../lib/analysis/inspect.mjs';
import { writeReport } from '../lib/report.mjs';
import { DEFAULT_SEQUENCE, FIXTURE_BINDINGS, demonstrationCase, simulateWorker, behaviorDocument, mismatchOracle } from '../lib/lab.mjs';
const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import { VERSION } from '../lib/version.mjs';
function argumentsOf(tokens) {
  const positionals = [], flags = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('--')) positionals.push(token);
    else {
      const name = token.slice(2);
      if (Object.hasOwn(flags, name)) throw new RpmError('arguments', `Repeated option --${name}.`);
      flags[name] = tokens[i + 1] && !tokens[i + 1].startsWith('--') ? tokens[++i] : true;
    }
  }
  return { positionals, flags };
}
function requireValue(value, name) { if (typeof value !== 'string' || !value.trim()) throw new RpmError('arguments', `Provide ${name}.`); return value; }
function output(value, path) {
  if (path) { requireValue(path, '--out FILE'); if (pathExists(path)) throw new RpmError('output_exists', 'Choose a new output path.'); writeJsonAtomic(path, value); }
  console.log(JSON.stringify(value, null, 2));
}
function accepted(flags, names) { for (const name of Object.keys(flags)) if (!names.includes(name)) throw new RpmError('arguments', `Unknown option --${name}.`); }
function loadCase(path) { return validateCase(readJson(requireValue(path, 'CASE.json'))); }
export async function generateDemo(directory) {
  const out = resolve(directory); if (pathExists(out)) throw new RpmError('output_exists', 'Choose a new lab directory.');
  mkdirSync(dirname(out), { recursive: true }); mkdirSync(out); cpSync(join(skill, 'assets/labs'), join(out, 'fixtures'), { recursive: true });
  const inspection = await inspectArtifact(join(out, 'fixtures/mv3/reference'));
  const specimen = demonstrationCase({ kind: inspection.artifact.kind, sha256: inspection.artifact.sha256 });
  let record = createCase({ goal: specimen.goal, target: specimen.target, capabilities: ['owned-model'] });
  record = reviseCase(record, { hypotheses: specimen.hypotheses, probes: specimen.probes }, record.revision);
  const bindings = { target_sha256: specimen.target.sha256, scenario_sha256: FIXTURE_BINDINGS.scenario_sha256, reset_sha256: FIXTURE_BINDINGS.reset_sha256, toolchain_sha256: FIXTURE_BINDINGS.toolchain_sha256 };
  const planner = rankProbes({ ...record, budget: 5, bindings });
  const original = await simulateWorker('reference', DEFAULT_SEQUENCE);
  const faulty = await simulateWorker('regression', DEFAULT_SEQUENCE);
  const ref = behaviorDocument(original);
  const cand = behaviorDocument(faulty);
  const verification = compareBehavior(ref, cand, { schema_version: 1, trace_order: 'total', volatile_paths: [] });
  const reduction = await minimizeSequence(structuredClone(DEFAULT_SEQUENCE), mismatchOracle, { maxTests: 80, stabilityRuns: 2 });
  const narrative = { label: 'Owned synthetic lab / controlled JavaScript model', description: 'Artifact inspection, conservative probe ranking and a real execution of our owned worker scripts under simulated Chrome APIs. This model does not establish real Chromium suspension; see the release verification record for separately observed browser cases.', reference: original, regression: faulty };
  const payload = { schema_version: 1, title: 'A decision that survives', kind: 'lab', inspection, case: record, planner, verification, reduction, narrative };
  for (const [name, data] of Object.entries({ inspection, case: record, planner, reference: ref, candidate: cand, verification, reduction, lab: payload })) writeJsonAtomic(join(out, `${name}.json`), data);
  writeReport(payload, join(out, 'report.html'));
  return { version: VERSION, output: out, report: join(out, 'report.html'), artifacts: ['inspection.json', 'case.json', 'planner.json', 'reference.json', 'candidate.json', 'verification.json', 'reduction.json'], verification: verification.status, reduction: { status: reduction.status, original_actions: DEFAULT_SEQUENCE.length, reduced_actions: reduction.sequence.length }, scope: narrative.description };
}
async function main(tokens) {
  const { positionals: p, flags: f } = argumentsOf(tokens); const command = p.shift();
  const expected = { inspect: 1, report: 1, plan: 1, verify: 0, shrink: 0, demo: 0, prompts: 0, version: 0 };
  if (Object.hasOwn(expected, command) && p.length !== expected[command]) throw new RpmError('arguments', `Command ${command} expects ${expected[command]} positional arguments.`);
  for (const [key, value] of Object.entries(f)) if (value === true && key !== 'help') throw new RpmError('arguments', `Provide a value for --${key}.`);
  if (!command || command === 'help' || command === '--help') {
    console.log(`REA Pro Max ${VERSION}\n\ninspect TARGET --out inspection.json\nreport DATA.json --out report.html\ncase init --inspection inspection.json --goal TEXT --out case.json\ncase revise CASE.json --patch patch.json --revision NUMBER\ncase observe CASE.json --receipt observation.json --revision NUMBER\nplan CASE.json [--bindings bindings.json] [--budget NUMBER] [--out plan.json]\nverify --reference reference.json --candidate candidate.json [--contract contract.json] [--out verdict.json]\nshrink --input actions.json --oracle ./owned-oracle.mjs [--max-tests NUMBER] [--out reduction.json]\ndemo --out NEW_DIRECTORY\nprompts [--target TARGET]\nmcp --workspace ABSOLUTE_DIRECTORY\n\nInspect reads artifacts without executing them. Shrink explicitly executes the supplied oracle module. Reports are local standalone HTML. Cases support one writer at a time.`); return;
  }
  if (command === 'mcp') { accepted(f, ['workspace']); if (p.length) throw new RpmError('arguments', 'mcp takes --workspace DIRECTORY.'); const { startServer } = await import('./mcp-server.mjs'); await startServer(requireValue(f.workspace, '--workspace DIRECTORY')); return; }
  if (command === 'version') { accepted(f, []); console.log(VERSION); return; }
  if (command === 'inspect') { accepted(f, ['out']); output(await inspectArtifact(resolve(requireValue(p[0], 'TARGET'))), f.out); return; }
  if (command === 'report') { accepted(f, ['out']); const data = readJson(requireValue(p[0], 'DATA.json')); const payload = data.artifact ? { schema_version: 1, kind: 'inspection', title: 'Artifact boundaries', inspection: data } : data; console.log(writeReport(payload, resolve(requireValue(f.out, '--out REPORT.html')))); return; }
  if (command === 'demo') { accepted(f, ['out']); output(await generateDemo(requireValue(f.out, '--out NEW_DIRECTORY'))); return; }
  if (command === 'case') {
    const action = p.shift();
    if (!['init', 'revise', 'observe'].includes(action) || p.length !== (action === 'init' ? 0 : 1)) throw new RpmError('arguments', 'Use case init or case revise/observe CASE.json.');
    if (action === 'init') { accepted(f, ['inspection', 'goal', 'out']); const inspected = readJson(requireValue(f.inspection, '--inspection FILE')); output(createCase({ goal: requireValue(f.goal, '--goal TEXT'), target: { kind: inspected.artifact.kind, sha256: inspected.artifact.sha256 }, capabilities: [] }), requireValue(f.out, '--out FILE')); return; }
    accepted(f, action === 'revise' ? ['patch', 'revision'] : ['receipt', 'revision']);
    const file = requireValue(p[0], 'CASE.json'), before = loadCase(file), revision = Number(requireValue(f.revision, '--revision NUMBER'));
    const after = action === 'revise' ? reviseCase(before, readJson(requireValue(f.patch, '--patch FILE')), revision) : action === 'observe' ? addObservation(before, readJson(requireValue(f.receipt, '--receipt FILE')), revision) : null;
    if (!after) throw new RpmError('arguments', 'Use case init/revise/observe.'); writeJsonAtomic(file, after); output(after); return;
  }
  if (command === 'plan') { accepted(f, ['bindings', 'budget', 'out']); const record = loadCase(p[0]); const bindings = f.bindings ? readJson(f.bindings) : undefined; output(rankProbes({ ...record, bindings, budget: f.budget ? Number(f.budget) : Infinity }), f.out); return; }
  if (command === 'verify') { accepted(f, ['reference', 'candidate', 'contract', 'out']); const result = compareBehavior(readJson(requireValue(f.reference, '--reference FILE')), readJson(requireValue(f.candidate, '--candidate FILE')), f.contract ? readJson(f.contract) : {}); output(result, f.out); process.exitCode = result.status === 'fail' ? 2 : result.status === 'unknown' ? 3 : 0; return; }
  if (command === 'shrink') {
    accepted(f, ['input', 'oracle', 'max-tests', 'out']); const file = resolve(requireValue(f.oracle, '--oracle MODULE.mjs')); const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || extname(file) !== '.mjs' || stat.size > 1024 * 1024) throw new RpmError('oracle_input', 'Use a regular owned .mjs oracle module up to1MiB.');
    const module = await import(pathToFileURL(file).href); if (typeof module.oracle !== 'function') throw new RpmError('oracle_input', 'The module must export async oracle(sequence).');
    const result = await minimizeSequence(readJson(requireValue(f.input, '--input FILE')), module.oracle, { maxTests: f['max-tests'] ? Number(f['max-tests']) : 100, stabilityRuns: 2, reset: module.reset });
    output(result, f.out); process.exitCode = ['reduced', 'unchanged'].includes(result.status) && result.minimality === 'one-minimal' ? 0 : 3; return;
  }
  if (command === 'prompts') { accepted(f, ['target']); const data = readJson(join(skill, 'assets/prompts.json')); output(f.target ? data.filter(item => item.target === f.target) : data); return; }
  throw new RpmError('arguments', `Unknown command ${command}; use help.`);
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ error: error.code || 'operation_failed', message: error.message, details: error.details || {} })); process.exitCode = 1; });
}
