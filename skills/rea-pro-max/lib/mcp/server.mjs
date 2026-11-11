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
import { readEvidenceSource } from '../analysis/source.mjs';
import { captureMv3 } from '../runtime/mv3.mjs';
import { replayFeature } from '../runtime/replay.mjs';
import { captureWebScenario } from '../runtime/web.mjs';
import { replayWebFeature } from '../runtime/web-replay.mjs';
import { CraftAnythingProvider } from '../providers/craft-anything.mjs';
import { DEFAULT_LIMITS } from '../analysis/inventory.mjs';
import { renderReport } from '../report.mjs';
import { DEFAULT_SEQUENCE, FIXTURE_BINDINGS, demonstrationCase, simulateWorker, behaviorDocument, mismatchOracle } from '../lab.mjs';
import { WorkspacePolicy, checkedMcpLimits, checkCancelled } from './policy.mjs';
import { SessionStore } from './store.mjs';

const fixture = fileURLToPath(new URL('../../assets/labs/mv3/reference', import.meta.url));
const prompts = JSON.parse(readFileSync(new URL('../../assets/prompts.json', import.meta.url), 'utf8'));
export const SERVER_INSTRUCTIONS = 'Start with get_capabilities, inspect_artifact and read_artifact pages. The host agent implements the requested feature. Use case handles for hypotheses/probes, export important work, and preserve reported/static authority. Optional capture_feature/replay_feature and capture_web/replay_web require a browser explicitly configured at server startup; they execute selected local or remote targets in disposable profiles and are not OS/network sandboxes. Craft Anything calls are optional, pinned and fail closed on provider drift; the core works without Craft. No shell or arbitrary oracle tool is exposed. Read execution_policy before runtime work.';
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
  if (entry.kind === 'runtime') return { complete: data.complete, actions: data.receipt.cases.length, target_sha256: data.receipt.bindings.target_sha256, authority: data.provenance.authority, unknown_count: data.unknowns.length, lifecycle: data.lifecycle.map(item => ({ action_id: item.action_id, reset: item.reset, qualified: item.qualified })) };
  if (entry.kind === 'replay') return { status: data.status, summary: data.verification.summary, first_mismatch: data.mismatch?.first_action ?? null, fingerprint: data.mismatch?.fingerprint ?? null, scope: data.scope };
  if (entry.kind === 'web-runtime') return { complete: data.complete, actions: data.receipt.cases.length, authority: data.provenance.authority, unknown_count: data.unknowns.length, provider: data.provenance.toolchain?.provider ?? null };
  if (entry.kind === 'web-replay') return { status: data.status, behavior: data.verification.behavior.status, visual: data.verification.visual.status, first_mismatch: data.mismatch?.first_action ?? null, scope: data.scope };
  if (entry.kind === 'provider') return { status: data.status, provider: data.provenance?.provider?.provider ?? null, command: data.provenance?.command ?? null, error: data.error?.code ?? null };
  throw new RpmError('unknown_artifact_kind', 'Unsupported session artifact kind.');
}
function sections(entry) {
  const known = {
    inspection: ['schema_version', 'artifact', 'contexts', 'nodes', 'edges', 'evidence', 'findings', 'unknowns', 'capabilities', 'limits', 'coverage'],
    case: ['schema_version', 'id', 'revision', 'goal', 'target', 'capabilities', 'hypotheses', 'probes', 'observations', 'created_at'],
    plan: ['status', 'surviving_ids', 'ranked', 'ignored_observations', 'applied_observations', 'excluded', 'next_probe_id', 'scope'],
    verification: ['schema_version', 'status', 'cases', 'summary', 'contract', 'comparability', 'receipt_sha256', 'bindings', 'scope', '/comparability/reasons'],
    lab: ['schema_version', 'title', 'kind', 'inspection', 'case', 'planner', 'verification', 'reduction', 'narrative', '/inspection/contexts', '/inspection/nodes', '/inspection/edges', '/inspection/evidence', '/inspection/unknowns', '/reduction/sequence', '/reduction/receipts'],
    runtime: ['schema_version', 'complete', 'receipt', 'events', 'lifecycle', 'unknowns', 'provenance'],
    replay: ['schema_version', 'status', 'scenario', 'reference', 'candidate', 'verification', 'mismatch', 'scope', '/reference/lifecycle', '/candidate/lifecycle', '/verification/cases'],
    'web-runtime': ['schema_version', 'kind', 'complete', 'receipt', 'events', 'unknowns', 'provenance', 'failure'],
    'web-replay': ['schema_version', 'kind', 'status', 'scenario', 'reference', 'candidate', 'reference_ir', 'candidate_ir', 'contract', 'verification', 'mismatch', 'scope'],
    provider: ['status', 'data', 'error', 'provenance'],
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
  if (entry.kind === 'runtime') return { schema_version: 1, title: 'Actual Chromium capture', kind: 'runtime', capture: entry.data, narrative: { label: 'Provider-captured runtime evidence', description: entry.data.provenance.observables } };
  if (entry.kind === 'replay') return { schema_version: 1, title: 'Feature recovery replay', kind: 'verification', verification: entry.data.verification, replay: entry.data, narrative: { label: 'Actual Chromium replay', description: entry.data.scope } };
  if (entry.kind === 'web-runtime') return { schema_version: 1, title: 'Actual web capture', kind: 'runtime', capture: entry.data, narrative: { label: 'Provider-captured web evidence', description: entry.data.provenance.observables } };
  if (entry.kind === 'web-replay') return { schema_version: 1, title: 'Web feature replay', kind: 'verification', verification: entry.data.verification.behavior, replay: entry.data, narrative: { label: 'Actual web replay', description: entry.data.scope } };
  if (entry.kind === 'provider') return { schema_version: 1, title: 'Optional provider result', kind: 'inspection', inspection: entry.data };
  if (entry.kind === 'plan') {
    const inspected = store.peek(entry.context.inspection_handle);
    return { schema_version: 1, title: 'Distinguishing experiments', kind: 'case', case: entry.context.case, planner: entry.data, ...(inspected ? { inspection: inspected.data } : {}) };
  }
  const inspected = store.peek(entry.context.inspection_handle), plan = store.peek(entry.context.plan_handle);
  return { schema_version: 1, title: 'Investigation case', kind: 'case', case: entry.data, ...(inspected ? { inspection: inspected.data } : {}), ...(plan?.context.case?.revision === entry.data.revision ? { planner: plan.data } : {}) };
}

export function createReaMcpServer({ workspace, limits: overrides = {}, browserExecutable }) {
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
    version: VERSION, transport: 'stdio', workspace: policy.root, implemented_targets: ['JavaScript', 'extracted web', 'web action replay', 'Manifest V3', 'extracted Electron'],
    limits: { ...limits, model: MODEL_LIMITS, inspection: DEFAULT_LIMITS }, cache: store.stats(),
    execution_policy: { target_execution: Boolean(browserExecutable), shell: false, arbitrary_oracle: false, browser_control: Boolean(browserExecutable), runtime: browserExecutable ? 'Opt-in MV3 and bounded web action execution in disposable profiles; not an OS/network sandbox.' : 'Disabled. Restart server with --browser ABSOLUTE_CHROMIUM to opt in.', craft_provider: 'Optional pinned Craft Anything MCP adapter; executable is caller supplied, no installation occurs, and unpinned/drifted provider identity remains unknown.', native_mobile_provider: false, owned_lab: 'bundled trusted worker scripts only; controlled Chrome API model' },
    state: 'Handles live only in this server process. Export/import cases to resume. Root restrictions are application policy, not an operating-system sandbox.',
  }));
  tool('inspect_artifact', 'Statically inspect a workspace artifact without executing it. Optional include/exclude are exact relative file/directory prefixes, not globs. Read coverage to see admitted, unparsed and omitted files.', z.object({ path: pathSchema, include: z.array(pathSchema).max(256).optional(), exclude: z.array(pathSchema).max(256).optional() }).strict(), async ({ path, include, exclude }, context) => {
    const result = await inspectArtifact(policy.resolveInput(path), { include, exclude }); checkCancelled(context);
    return commit('inspection', result);
  }, sessionWrite, true);
  tool('read_source_evidence', 'Read a bounded source excerpt for an inspected evidence ID. Rechecks workspace admission and file content hash; changed source must be inspected again.', z.object({ inspection_handle: handleSchema, evidence_id: handleSchema, max_chars: z.number().int().min(1).max(8000).default(2000) }).strict(), async ({ inspection_handle, evidence_id, max_chars }) => {
    const inspection = store.get(inspection_handle, 'inspection').data;
    policy.resolveInput(inspection.artifact.path);
    return readEvidenceSource(inspection, evidence_id, { maxChars: max_chars });
  });
  tool('capture_feature', 'Opt-in execution: capture a declared rpm-kv-v1 MV3 scenario in actual Chromium, using a fresh disposable profile. Requires --browser at server startup. Executes selected extension code; not an OS/network sandbox.', z.object({ extension_path: pathSchema, scenario_path: pathSchema, timeout_ms: z.number().int().min(5000).max(240000).optional() }).strict(), async ({ extension_path, scenario_path, timeout_ms }, context) => {
    if (!browserExecutable) throw new RpmError('runtime_disabled', 'Runtime is disabled. Configure --browser ABSOLUTE_CHROMIUM at server startup to opt in.');
    const capture = await captureMv3({ extensionPath: policy.resolveInput(extension_path), executablePath: browserExecutable, scenario: policy.readJson(scenario_path), timeoutMs: timeout_ms, signal: context?.signal });
    return commit('runtime', capture);
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, true);
  tool('replay_feature', 'Opt-in execution: run a workspace reference and receiving extension in separate fresh Chromium profiles, compare message/reset observations and retain the first mismatch. Host agent edits the receiving implementation and replays after repair.', z.object({ reference_path: pathSchema, candidate_path: pathSchema, scenario_path: pathSchema, timeout_ms: z.number().int().min(5000).max(240000).optional() }).strict(), async ({ reference_path, candidate_path, scenario_path, timeout_ms }, context) => {
    if (!browserExecutable) throw new RpmError('runtime_disabled', 'Runtime is disabled. Configure --browser ABSOLUTE_CHROMIUM at server startup to opt in.');
    const result = await replayFeature({ referencePath: policy.resolveInput(reference_path), candidatePath: policy.resolveInput(candidate_path), executablePath: browserExecutable, scenario: policy.readJson(scenario_path), timeoutMs: timeout_ms, signal: context?.signal });
    return commit('replay', result);
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, true);
  tool('capture_web', 'Opt-in execution: capture a bounded web action scenario in actual Chromium with a fresh disposable profile. Requires --browser at server startup; the URL is executed as supplied and this is not an OS/network sandbox.', z.object({ scenario_path: pathSchema, timeout_ms: z.number().int().min(5000).max(240000).optional() }).strict(), async ({ scenario_path, timeout_ms }, context) => {
    if (!browserExecutable) throw new RpmError('runtime_disabled', 'Runtime is disabled. Configure --browser ABSOLUTE_CHROMIUM at server startup to opt in.');
    const capture = await captureWebScenario({ executablePath: browserExecutable, scenario: policy.readJson(scenario_path), timeoutMs: timeout_ms, signal: context?.signal });
    return commit('web-runtime', capture);
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, true);
  tool('replay_web', 'Opt-in execution: run the same bounded web action scenario against two explicit URLs in separate fresh Chromium profiles, then compare behavioral channels and visual hashes as separate verdicts.', z.object({ reference_url: z.string().url().max(4096), candidate_url: z.string().url().max(4096), scenario_path: pathSchema, contract_path: pathSchema.optional(), timeout_ms: z.number().int().min(5000).max(240000).optional() }).strict(), async ({ reference_url, candidate_url, scenario_path, contract_path, timeout_ms }, context) => {
    if (!browserExecutable) throw new RpmError('runtime_disabled', 'Runtime is disabled. Configure --browser ABSOLUTE_CHROMIUM at server startup to opt in.');
    const result = await replayWebFeature({ referenceUrl: reference_url, candidateUrl: candidate_url, executablePath: browserExecutable, scenario: policy.readJson(scenario_path), contract: contract_path ? policy.readJson(contract_path) : undefined, timeoutMs: timeout_ms, signal: context?.signal });
    return commit('web-replay', result);
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, true);
  const providerArgs = z.array(z.string().max(4096)).max(64).default([]);
  const providerInput = z.record(z.string(), z.unknown()).default({});
  const makeCraftProvider = ({ executable_path, args, timeout_ms }) => new CraftAnythingProvider({ executablePath: executable_path, args, workspace: policy.root, timeoutMs: timeout_ms });
  const craftTool = (name, description, method) => tool(name, description, z.object({ executable_path: z.string().min(1).max(4096), args: providerArgs, input: providerInput, timeout_ms: z.number().int().min(100).max(240000).optional() }).strict(), async ({ executable_path, args, input, timeout_ms }, context) => {
    const provider = makeCraftProvider({ executable_path, args, timeout_ms });
    const result = await provider[method](input, { signal: context?.signal });
    return commit('provider', result);
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, true);
  tool('craft_provider_doctor', 'Run the pinned Craft Anything MCP handshake and tools/list check. The executable is caller supplied; no installation is performed and a missing pinned commit fails closed.', z.object({ executable_path: z.string().min(1).max(4096), args: providerArgs, timeout_ms: z.number().int().min(100).max(240000).optional() }).strict(), async ({ executable_path, args, timeout_ms }, context) => {
    const provider = makeCraftProvider({ executable_path, args, timeout_ms });
    return commit('provider', await provider.doctor({ signal: context?.signal }));
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, true);
  craftTool('craft_provider_inspect', 'Call the pinned, typed Craft Anything JavaScript application map operation and retain provider provenance.', 'inspect');
  craftTool('craft_provider_capture', 'Call the pinned, typed Craft Anything web capture operation and retain provider provenance.', 'capture');
  craftTool('craft_provider_compare', 'Call the pinned, typed Craft Anything application graph comparison operation and retain provider provenance.', 'compare');
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
