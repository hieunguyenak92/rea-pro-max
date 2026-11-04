import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer, z } from '../../assets/vendor/mcp-sdk.mjs';
import { VERSION } from '../version.mjs';
import { RpmError, canonical, pointer } from '../common.mjs';
import { createCase, reviseCase, addObservation, validateCase } from '../case.mjs';
import { rankProbes } from '../planner.mjs';
import { compareBehavior } from '../verification.mjs';
import { minimizeSequence } from '../reduction.mjs';
import { inspectArtifact } from '../analysis/inspect.mjs';
import { DEFAULT_LIMITS } from '../analysis/inventory.mjs';
import { renderReport } from '../report.mjs';
import { DEFAULT_SEQUENCE, FIXTURE_BINDINGS, demonstrationCase, simulateWorker, behaviorDocument, mismatchOracle } from '../lab.mjs';
import { WorkspacePolicy, checkedMcpLimits, checkCancelled } from './policy.mjs';
import { SessionStore } from './store.mjs';

const fixture = fileURLToPath(new URL('../../assets/labs/mv3/reference', import.meta.url));
const prompts = JSON.parse(readFileSync(new URL('../../assets/prompts.json', import.meta.url), 'utf8'));
export const SERVER_INSTRUCTIONS = 'Start with get_capabilities, then inspect_artifact and read_artifact pages. Use explicit case handles for hypotheses/probes, verify comparable behavior receipts, and export important work. All selected files stay inside the configured workspace. Static candidates are not runtime observations; supplied observations keep their authority. The host agent implements the requested feature and obtains runtime evidence. Only run_owned_lab executes bundled trusted fixtures; no arbitrary target code runs.';
const pathSchema = z.string().min(1).max(4096);
const handleSchema = z.string().min(1).max(128);
const textList = z.array(z.string().min(1).max(256)).max(2000);
const objectSchema = z.record(z.string(), z.unknown());
const emptySchema = z.object({}).strict();
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const sessionWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const short = text => typeof text === 'string' ? text.slice(0, 240) : text;
export const MODEL_LIMITS = Object.freeze({ maxHypotheses: 32, maxProbes: 64, maxObservations: 256, maxProbeSteps: 64, maxCapabilities: 64, maxPredictionOutcomes: 16, maxCaseBytes: 1024 * 1024 });
function checkModel(record) {
  if (record.hypotheses.length > MODEL_LIMITS.maxHypotheses || record.probes.length > MODEL_LIMITS.maxProbes || record.observations.length > MODEL_LIMITS.maxObservations || record.capabilities.length > MODEL_LIMITS.maxCapabilities || Buffer.byteLength(canonical(record)) > MODEL_LIMITS.maxCaseBytes) throw new RpmError('model_bounds', 'MCP case exceeds its model budget:32 hypotheses,64 probes,256 observations,64 capabilities or1MiB JSON. Use a narrower case; the CLI has its own scope.');
  for (const probe of record.probes) if (probe.steps.length > MODEL_LIMITS.maxProbeSteps || probe.requires.length > MODEL_LIMITS.maxCapabilities || probe.effects.length > MODEL_LIMITS.maxCapabilities) throw new RpmError('model_bounds', 'MCP probes support at most64 steps, requirements and effects each.');
  for (const hypothesis of record.hypotheses) for (const prediction of Object.values(hypothesis.predictions)) if (Array.isArray(prediction) && prediction.length > MODEL_LIMITS.maxPredictionOutcomes) throw new RpmError('model_bounds', 'MCP predictions support at most16 alternative outcomes per probe.');
  return record;
}

function summary(entry) {
  const data = entry.data;
  if (entry.kind === 'inspection') return { artifact: data.artifact, counts: Object.fromEntries(['contexts', 'nodes', 'edges', 'evidence', 'findings', 'unknowns'].map(key => [key, data[key].length])), authority: 'bounded-static; target not executed', limits: data.limits };
  if (entry.kind === 'case') return { id: data.id, revision: data.revision, goal: short(data.goal), target: { kind: data.target.kind, sha256: data.target.sha256 }, hypotheses: data.hypotheses.length, probes: data.probes.length, observations: data.observations.length };
  if (entry.kind === 'plan') return { status: data.status, surviving_ids: data.surviving_ids.slice(0, 50), surviving_count: data.surviving_ids.length, next_probe_id: data.next_probe_id, ranked_count: data.ranked.length, scope: data.scope };
  if (entry.kind === 'verification') return { status: data.status, summary: data.summary, comparability: { status: data.comparability.status, reasons: data.comparability.reasons.slice(0, 20).map(short), reason_count: data.comparability.reasons.length, reasons_truncated: data.comparability.reasons.length > 20 || data.comparability.reasons.some(item => item.length > 240) }, receipt_sha256: data.receipt_sha256, scope: data.scope };
  if (entry.kind === 'lab') return { evidence_kind: 'controlled-javascript-model', verification: data.verification.status, reduction: { status: data.reduction.status, minimality: data.reduction.minimality, original_actions: DEFAULT_SEQUENCE.length, retained_actions: data.reduction.sequence.length }, limits: 'Only bundled owned worker scripts and simulated Chrome APIs; no real browser lifecycle claim.' };
  throw new RpmError('unknown_artifact_kind', 'Unsupported session artifact kind.');
}
function sections(entry) {
  const known = {
    inspection: ['schema_version', 'artifact', 'contexts', 'nodes', 'edges', 'evidence', 'findings', 'unknowns', 'capabilities', 'limits'],
    case: ['schema_version', 'id', 'revision', 'goal', 'target', 'capabilities', 'hypotheses', 'probes', 'observations', 'created_at'],
    plan: ['status', 'surviving_ids', 'ranked', 'ignored_observations', 'applied_observations', 'excluded', 'next_probe_id', 'scope'],
    verification: ['schema_version', 'status', 'cases', 'summary', 'contract', 'comparability', 'receipt_sha256', 'bindings', 'scope', '/comparability/reasons'],
    lab: ['schema_version', 'title', 'kind', 'inspection', 'case', 'planner', 'verification', 'reduction', 'narrative', '/inspection/contexts', '/inspection/nodes', '/inspection/edges', '/inspection/evidence', '/inspection/unknowns', '/reduction/sequence', '/reduction/receipts'],
  };
  return ['summary', 'full', ...known[entry.kind]];
}
function receipt(store, handle) {
  const entry = store.get(handle);
  return { handle, kind: entry.kind, summary: summary(entry), sections: sections(entry) };
}
function descriptor(kind, data, handle) { return { handle, kind, summary: summary({ kind, data }), sections: sections({ kind, data }) }; }
function publicError(error) {
  if (error instanceof RpmError) return { code: error.code, message: String(error.message).slice(0, 1000) };
  if (error?.code && /^[A-Z_]+$/u.test(error.code)) return { code: 'filesystem_error', message: `Local filesystem operation failed (${error.code}). Check the workspace path and permissions.` };
  return { code: 'operation_failed', message: 'Operation failed. Check the supplied input and retry with a smaller stable fixture.' };
}
function reportPayload(entry, store) {
  if (entry.kind === 'lab') return entry.data;
  if (entry.kind === 'inspection') return { schema_version: 1, title: 'Artifact boundaries', kind: 'inspection', inspection: entry.data };
  if (entry.kind === 'verification') return { schema_version: 1, title: 'Finite behavior verification', kind: 'verification', verification: entry.data };
  if (entry.kind === 'plan') {
    const inspected = store.peek(entry.context.inspection_handle);
    return { schema_version: 1, title: 'Distinguishing experiments', kind: 'case', case: entry.context.case, planner: entry.data, ...(inspected ? { inspection: inspected.data } : {}) };
  }
  const inspected = store.peek(entry.context.inspection_handle), plan = store.peek(entry.context.plan_handle);
  return { schema_version: 1, title: 'Investigation case', kind: 'case', case: entry.data, ...(inspected ? { inspection: inspected.data } : {}), ...(plan?.context.case?.revision === entry.data.revision ? { planner: plan.data } : {}) };
}

export function createReaMcpServer({ workspace, limits: overrides = {} }) {
  const limits = checkedMcpLimits(overrides), policy = new WorkspacePolicy(workspace, limits), store = new SessionStore(limits);
  let heavyOperations = 0;
  const server = new McpServer({ name: 'rea-pro-max', version: VERSION }, { instructions: SERVER_INSTRUCTIONS, maxToolInputElements: limits.maxToolInputElements });
  function preflight(data) {
    if (Buffer.byteLength(canonical(data)) > limits.maxResponseBytes) throw new RpmError('response_bounds', 'Result exceeds the response budget. Read a narrower section/page or explicitly export the artifact.');
    return data;
  }
  function commit(kind, data, context = {}) {
    preflight(descriptor(kind, data, `rpm_${kind}_${'0'.repeat(36)}`));
    return receipt(store, store.put(kind, data, context));
  }
  function response(data, text) {
    preflight(data);
    return { content: [{ type: 'text', text: text.slice(0, 1000) }], structuredContent: data };
  }
  function tool(name, description, inputSchema, operation, annotations = readOnly, heavy = false) {
    server.registerTool(name, { description, inputSchema, annotations }, async (args, context) => {
      let acquired = false;
      try {
        checkCancelled(context);
        if (Buffer.byteLength(canonical(args)) > limits.maxJsonBytes) throw new RpmError('input_bounds', 'Arguments exceed the admitted JSON byte limit.');
        if (heavy) {
          if (heavyOperations >= limits.maxConcurrentHeavy) throw new RpmError('server_busy', 'The concurrent inspection/lab limit is reached. Retry after an active operation completes.');
          heavyOperations++; acquired = true;
        }
        const result = await operation(args, context);
        return response(result, `${name} completed. ${result.handle ? `Artifact ${result.handle}; read summary/sections or export explicitly.` : 'Inspect structuredContent for the exact result.'}`);
      } catch (error) {
        const issue = publicError(error);
        return { isError: true, content: [{ type: 'text', text: `${issue.code}: ${issue.message}` }], structuredContent: { error: issue } };
      } finally { if (acquired) heavyOperations--; }
    });
  }
  tool('get_capabilities', 'Read the exact server scope, configured workspace, limits and execution policy before choosing tools.', emptySchema, () => ({
    version: VERSION, transport: 'stdio', workspace: policy.root, implemented_targets: ['JavaScript', 'extracted web', 'Manifest V3', 'extracted Electron'],
    limits: { ...limits, model: MODEL_LIMITS, inspection: DEFAULT_LIMITS }, cache: store.stats(),
    execution_policy: { target_execution: false, shell: false, arbitrary_oracle: false, browser_control: false, native_mobile_provider: false, owned_lab: 'bundled trusted worker scripts only; controlled Chrome API model' },
    state: 'Handles live only in this server process. Export/import cases to resume. Root restrictions are application policy, not an operating-system sandbox.',
  }));
  tool('inspect_artifact', 'Statically inspect a workspace artifact without executing it. Returns a session handle and counts; page source evidence with read_artifact.', z.object({ path: pathSchema }).strict(), async ({ path }, context) => {
    const result = await inspectArtifact(policy.resolveInput(path)); checkCancelled(context);
    return commit('inspection', result);
  }, sessionWrite, true);
  tool('read_artifact', 'Read a bounded session section/page. Use summary, full, a top-level field or RFC6901 pointer such as /inspection/contexts. Export large individual records explicitly.', z.object({ handle: handleSchema, section: z.string().min(1).max(256).default('summary'), offset: z.number().int().nonnegative().max(1_000_000).default(0), limit: z.number().int().min(1).max(limits.maxPage).default(Math.min(20, limits.maxPage)), query: z.string().max(limits.maxQueryChars).optional() }).strict(), ({ handle, section, offset, limit, query }) => {
    const entry = store.get(handle);
    if (section === 'summary') return receipt(store, handle);
    if (section === 'full') return { handle, kind: entry.kind, data: entry.data };
    let value;
    if (section.startsWith('/')) value = pointer(entry.data, section);
    else if (Object.hasOwn(entry.data, section)) value = entry.data[section];
    else throw new RpmError('unknown_section', 'Unknown section. Read summary to discover available sections.');
    if (!value || typeof value !== 'object') return { handle, kind: entry.kind, section, value };
    const isList = Array.isArray(value), records = isList ? value : Object.keys(value).sort().map(key => ({ key, value: value[key] }));
    const needle = query?.normalize('NFKC').toLowerCase();
    const selected = needle ? records.filter(item => canonical(item).normalize('NFKC').toLowerCase().includes(needle)) : records;
    const page = selected.slice(offset, offset + limit);
    const result = () => ({ handle, kind: entry.kind, section, offset, requested_limit: limit, returned: page.length, total: selected.length, unfiltered_total: records.length, next_offset: offset + page.length < selected.length ? offset + page.length : null, [isList ? 'items' : 'entries']: page });
    while (page.length && Buffer.byteLength(canonical(result())) > limits.maxResponseBytes) page.pop();
    if (!page.length && offset < selected.length) throw new RpmError('record_too_large', 'An individual record exceeds the page budget. Select a nested section or export the complete artifact.');
    return result();
  });
  tool('create_case', 'Create a case bound to an actual inspected artifact digest; capabilities are explicitly supplied declarations.', z.object({ inspection_handle: handleSchema, goal: z.string().min(1).max(4000), capabilities: textList.default([]) }).strict(), ({ inspection_handle, goal, capabilities }) => {
    const inspection = store.get(inspection_handle, 'inspection').data;
    const record = checkModel(createCase({ goal, target: { kind: inspection.artifact.kind, sha256: inspection.artifact.sha256 }, capabilities }));
    return commit('case', record, { inspection_handle });
  }, sessionWrite);
  tool('revise_case', 'Validate and commit a case patch only at the expected current revision. Invalid/stale mutations preserve the prior case.', z.object({ case_handle: handleSchema, expected_revision: z.number().int().positive(), patch: objectSchema }).strict(), ({ case_handle, expected_revision, patch }) => {
    const before = store.get(case_handle, 'case');
    const after = checkModel(reviseCase(before.data, patch, expected_revision)); preflight(descriptor('case', after, case_handle));
    store.replace(case_handle, after, before.context.inspection_handle ? { inspection_handle: before.context.inspection_handle } : {});
    return receipt(store, case_handle);
  }, sessionWrite);
  tool('record_observation', 'Append a bound observation at the expected revision without upgrading its reported/captured authority.', z.object({ case_handle: handleSchema, expected_revision: z.number().int().positive(), observation: objectSchema }).strict(), ({ case_handle, expected_revision, observation }) => {
    const before = store.get(case_handle, 'case'); const after = checkModel(addObservation(before.data, observation, expected_revision)); preflight(descriptor('case', after, case_handle));
    store.replace(case_handle, after, before.context.inspection_handle ? { inspection_handle: before.context.inspection_handle } : {});
    return receipt(store, case_handle);
  }, sessionWrite);
  tool('rank_probes', 'Rank declared hypotheses/probes against current bindings, declared effects and budget. Does not execute any probe or attest observations.', z.object({ case_handle: handleSchema, bindings: objectSchema, budget: z.number().nonnegative().finite().optional(), allowed_effects: textList.default([]) }).strict(), ({ case_handle, bindings, budget, allowed_effects }) => {
    const record = store.get(case_handle, 'case'); checkModel(record.data);
    if (typeof bindings.target_sha256 !== 'string' || bindings.target_sha256.toLowerCase() !== record.data.target.sha256) throw new RpmError('binding_mismatch', 'Current bindings must use the case target digest. Read the case target and supply current scenario/reset/toolchain bindings.');
    const plan = rankProbes({ ...record.data, bindings, ...(budget === undefined ? {} : { budget }), allowedEffects: allowed_effects });
    // The plan retains its exact case snapshot; no post-commit rewrite can evict the returned plan.
    return commit('plan', plan, { case: record.data, ...(record.context.inspection_handle ? { inspection_handle: record.context.inspection_handle } : {}) });
  }, sessionWrite);
  tool('verify_behavior', 'Compare bounded workspace JSON receipts. A valid finite fail/unknown is a successful tool result; supplied receipts do not independently attest execution.', z.object({ reference_path: pathSchema, candidate_path: pathSchema, contract_path: pathSchema.optional() }).strict(), ({ reference_path, candidate_path, contract_path }) => {
    const result = compareBehavior(policy.readJson(reference_path), policy.readJson(candidate_path), contract_path ? policy.readJson(contract_path) : {});
    return commit('verification', result);
  }, sessionWrite);
  tool('export_artifact', 'Explicitly write a new JSON or standalone HTML file inside the workspace. JSON cases remain compatible with the CLI. Existing files/symlinks are never overwritten.', z.object({ handle: handleSchema, output_path: pathSchema, format: z.enum(['json', 'html']) }).strict(), ({ handle, output_path, format }, context) => {
    const entry = store.get(handle); const content = format === 'json' ? canonical(entry.data) + '\n' : renderReport(reportPayload(entry, store));
    checkCancelled(context); return { handle, kind: entry.kind, format, ...policy.writeNew(output_path, content, context) };
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
  tool('run_owned_lab', 'Execute only bundled owned fixture workers in a controlled Chrome API model, inspect/rank/verify and reduce the known persistence mismatch. No target path, shell, browser or arbitrary oracle is accepted.', emptySchema, async (_args, context) => {
    const inspection = await inspectArtifact(fixture); checkCancelled(context);
    const specimen = demonstrationCase({ kind: inspection.artifact.kind, sha256: inspection.artifact.sha256 });
    let record = createCase({ goal: specimen.goal, target: specimen.target, capabilities: ['owned-model'] });
    record = reviseCase(record, { hypotheses: specimen.hypotheses, probes: specimen.probes }, record.revision);
    const bindings = { target_sha256: specimen.target.sha256, scenario_sha256: FIXTURE_BINDINGS.scenario_sha256, reset_sha256: FIXTURE_BINDINGS.reset_sha256, toolchain_sha256: FIXTURE_BINDINGS.toolchain_sha256 };
    const planner = rankProbes({ ...record, budget: 5, bindings });
    const original = await simulateWorker('reference', DEFAULT_SEQUENCE), regression = await simulateWorker('regression', DEFAULT_SEQUENCE);
    checkCancelled(context);
    const verification = compareBehavior(behaviorDocument(original), behaviorDocument(regression));
    const reduction = await minimizeSequence(structuredClone(DEFAULT_SEQUENCE), mismatchOracle, { maxTests: 80, stabilityRuns: 2 }); checkCancelled(context);
    const data = { schema_version: 1, title: 'A decision that survives', kind: 'lab', inspection, case: record, planner, verification, reduction, narrative: { label: 'Owned synthetic lab / controlled JavaScript model', description: 'Only owned worker scripts are executed under simulated Chrome APIs; this does not establish Chromium suspension.', reference: original, regression } };
    return commit('lab', data);
  }, sessionWrite, true);
  tool('list_task_prompts', 'Page the36 bundled task templates by target. Templates require appropriate host tools and do not certify provider/native/mobile support.', z.object({ target: z.string().min(1).max(64).optional(), offset: z.number().int().nonnegative().max(1_000_000).default(0), limit: z.number().int().min(1).max(limits.maxPromptPage).default(Math.min(5, limits.maxPromptPage)) }).strict(), ({ target, offset, limit }) => {
    const selected = target ? prompts.filter(item => item.target === target) : prompts;
    return { total: selected.length, catalog_total: prompts.length, offset, items: selected.slice(offset, offset + limit), next_offset: offset + limit < selected.length ? offset + limit : null, scope: 'Task templates only; deeper investigation requires appropriate external host tools and prerequisites.' };
  });
  tool('import_case', 'Validate a bounded regular workspace case JSON file and create a new session handle. Import does not attest saved observations.', z.object({ path: pathSchema }).strict(), ({ path }) => commit('case', checkModel(validateCase(policy.readJson(path)))) , sessionWrite);
  return server;
}
