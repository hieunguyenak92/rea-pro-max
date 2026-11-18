import { basename, dirname, relative, sep } from 'node:path';
import { compareApiContract } from './analysis/api-contract.mjs';
import { compareArtifactSnapshots, COMPARISON_LIMITS } from './analysis/artifact-diff.mjs';
import { inventory } from './analysis/inventory.mjs';
import { compareDeploymentTargets } from './analysis/deployment-targets.mjs';
import { inspectPlaywrightEvidence } from './analysis/playwright-evidence.mjs';
import { compareWasmInterfaces, WASM_INTERFACE_LIMITS } from './analysis/wasm-interface.mjs';
import { digest, hashBytes, parseJsonBytes, RpmError } from './common.mjs';
import { WorkspacePolicy } from './mcp/policy.mjs';
import { VERSION } from './version.mjs';

export const RELEASE_LIMITS = Object.freeze({
  plan_bytes: 64 * 1024,
  har_bytes: 4 * 1024 * 1024,
  trace_bytes: 8 * 1024 * 1024,
  wasm_interfaces: 8,
  deployment_targets: 16,
  allowed_changes: 256,
  repack_only: COMPARISON_LIMITS.max_archive_pairs,
  required_operations: 64,
  required_files: 64,
  expected_categories: 128,
});

const CHANGE_TYPES = new Set(['added', 'modified', 'removed']);
const CATEGORIES = new Set(['navigation', 'interaction', 'read', 'wait', 'verification', 'lifecycle', 'test-step', 'other']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const memberKey = (first, second) => JSON.stringify([first, second]);

function need(condition, message) {
  if (!condition) throw new RpmError('release_policy', message);
}

function fields(value, label, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  need(record(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key)), `${label} has missing or unsupported fields.`);
}

function releasePath(path, label) {
  need(typeof path === 'string' && path.length > 0 && path.length <= 512 && path === path.trim() &&
      path.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\:\x00-\x1f\x7f]/u.test(part)),
    `${label} must be a bounded forward-slash path relative to the policy directory or build, as applicable.`);
  return path;
}

function list(value, label, limit, parse, identity = item => item, min = 0) {
  need(Array.isArray(value) && value.length <= limit && value.length >= min, `${label} requires between ${min} and ${limit} entries.`);
  const items = value.map(parse);
  need(new Set(items.map(identity)).size === items.length, `${label} contains duplicate entries.`);
  return items;
}

function validate(source) {
  fields(source, 'release policy', ['schema_version', 'reference_path', 'candidate_path'], ['required_files', 'allowed_changes', 'repack_only', 'wasm_interfaces', 'deployment_targets', 'api', 'playwright']);
  need(source.schema_version === 1, 'Release policy requires schema_version 1.');
  const plan = {
    schema_version: 1,
    reference_path: releasePath(source.reference_path, 'reference_path'),
    candidate_path: releasePath(source.candidate_path, 'candidate_path'),
    required_files: list(Object.hasOwn(source, 'required_files') ? source.required_files : [], 'required_files', RELEASE_LIMITS.required_files, path => releasePath(path, 'required file path')),
    allowed_changes: list(Object.hasOwn(source, 'allowed_changes') ? source.allowed_changes : [], 'allowed_changes', RELEASE_LIMITS.allowed_changes, row => {
      fields(row, 'allowed change', ['path', 'status']);
      need(CHANGE_TYPES.has(row.status), 'Allowed changes use added, modified or removed.');
      return { path: releasePath(row.path, 'allowed change path'), status: row.status };
    }, row => memberKey(row.path, row.status)),
    repack_only: list(Object.hasOwn(source, 'repack_only') ? source.repack_only : [], 'repack_only', RELEASE_LIMITS.repack_only, path => releasePath(path, 'repack path')),
    wasm_interfaces: list(Object.hasOwn(source, 'wasm_interfaces') ? source.wasm_interfaces : [], 'wasm_interfaces', RELEASE_LIMITS.wasm_interfaces, path => releasePath(path, 'Wasm module path')),
  };
  need(!plan.allowed_changes.some(row => plan.repack_only.includes(row.path)), 'Repack-only paths cannot also be allowed by an unconditional file rule.');
  if (Object.hasOwn(source, 'deployment_targets')) {
    plan.deployment_targets = list(source.deployment_targets, 'deployment_targets', RELEASE_LIMITS.deployment_targets, path => releasePath(path, 'deployment target path'), path => path, 1);
  }
  if (Object.hasOwn(source, 'api')) {
    const api = source.api;
    fields(api, 'api', ['contract_path', 'har_path', 'origin', 'required_operations'], ['reject_unmatched']);
    need(!Object.hasOwn(api, 'reject_unmatched') || typeof api.reject_unmatched === 'boolean', 'reject_unmatched must be boolean.');
    let origin;
    try { if (typeof api.origin === 'string' && api.origin.length <= 512) origin = new URL(api.origin); } catch { /* Checked below. */ }
    need(origin && ['http:', 'https:'].includes(origin.protocol) && !origin.username && !origin.password && origin.href === origin.origin + '/', 'api.origin must be an HTTP(S) origin without a path, query, fragment or credentials.');
    plan.api = {
      contract_path: releasePath(api.contract_path, 'contract path'),
      har_path: releasePath(api.har_path, 'HAR path'),
      origin: origin.origin,
      required_operations: list(api.required_operations, 'required_operations', RELEASE_LIMITS.required_operations, row => {
        fields(row, 'required operation', ['method', 'path'], ['expected_status']);
        need(typeof row.method === 'string' && /^[!#$%&'*+.\^_`|~0-9a-zA-Z-]{1,32}$/u.test(row.method), 'Operation method must be a short HTTP token.');
        need(typeof row.path === 'string' && row.path.length <= 1024 && row.path.startsWith('/') && !/[?#\x00-\x1f\x7f]/u.test(row.path), 'Operation path must name a declared OpenAPI path.');
        const status = row.expected_status;
        need(!Object.hasOwn(row, 'expected_status') || (Number.isInteger(status) && status >= 100 && status <= 599), 'expected_status must be a recorded HTTP status code.');
        return { method: row.method, path: row.path, expected_status: status ?? null };
      }, row => JSON.stringify([row.method, row.path, row.expected_status]), 1),
      reject_unmatched: api.reject_unmatched ?? false,
    };
  }
  if (Object.hasOwn(source, 'playwright')) {
    const trace = source.playwright;
    fields(trace, 'playwright', ['trace_path', 'expected_categories'], ['network_path', 'max_action_duration_ms']);
    need(Array.isArray(trace.expected_categories) && trace.expected_categories.length > 0 &&
      trace.expected_categories.length <= RELEASE_LIMITS.expected_categories && trace.expected_categories.every(category => CATEGORIES.has(category)), 'expected_categories must name a bounded action sequence.');
    need(!Object.hasOwn(trace, 'max_action_duration_ms') || (Number.isFinite(trace.max_action_duration_ms) &&
      trace.max_action_duration_ms >= 0 && trace.max_action_duration_ms <= 3_600_000), 'max_action_duration_ms must be between 0 and 3600000.');
    plan.playwright = {
      trace_path: releasePath(trace.trace_path, 'trace path'),
      expected_categories: [...trace.expected_categories],
      ...(Object.hasOwn(trace, 'network_path') ? { network_path: releasePath(trace.network_path, 'network path') } : {}),
      ...(Object.hasOwn(trace, 'max_action_duration_ms') ? { max_action_duration_ms: trace.max_action_duration_ms } : {}),
    };
  }
  return plan;
}

function checkBuild(plan, comparison, reference, candidate) {
  const permitted = new Set(plan.allowed_changes.map(row => memberKey(row.path, row.status)));
  const repack = new Set(plan.repack_only);
  const findings = [];
  if (!reference.entries.length || !candidate.entries.length) findings.push({ status: 'fail', reason: 'empty_build', reference_files: reference.entries.length, candidate_files: candidate.entries.length });
  for (const path of new Set([...plan.required_files, ...plan.repack_only])) {
    const reference_present = reference.files.has(path), candidate_present = candidate.files.has(path);
    if (!reference_present || !candidate_present) findings.push({ path, status: 'fail', reason: 'required_file_missing', reference_present, candidate_present });
  }
  for (const archive of comparison.archives.filter(row => repack.has(row.path))) {
    if (archive.status === 'same-file-content') continue;
    const changed = archive.changes.length > 0;
    findings.push({
      path: archive.path,
      status: changed ? 'fail' : 'unknown',
      reason: changed ? 'archive_member_changed' : 'archive_member_comparison_incomplete',
    });
  }
  for (const row of comparison.changes) {
    const changes = row.status === 'relocated'
      ? [{ path: row.path, status: 'removed' }, { path: row.candidate_path, status: 'added' }]
      : [{ path: row.path, status: row.status }];
    for (const change of changes) {
      if (change.status === 'modified' && repack.has(change.path)) continue;
      if (!permitted.has(memberKey(change.path, change.status))) {
        findings.push({ path: change.path, change: change.status, status: 'fail', reason: 'unexpected_file_change' });
      }
    }
  }
  return findings;
}

function verdict(rows) {
  if (rows.some(row => row.status === 'fail')) return 'fail';
  if (rows.some(row => row.status === 'unknown')) return 'unknown';
  return 'pass';
}

function wasmCheck(path, before, after) {
  const reference = before.files.get(path), candidate = after.files.get(path);
  if (!reference || !candidate) return { id: 'wasm-interface', path, status: 'fail', reason: 'required_module_missing', reference_present: Boolean(reference), candidate_present: Boolean(candidate) };
  if (Math.max(reference.size, candidate.size) > WASM_INTERFACE_LIMITS.max_file_bytes) {
    return { id: 'wasm-interface', path, status: 'unknown', reason: 'wasm_interface_limit', reference_sha256: reference.sha256, candidate_sha256: candidate.sha256 };
  }
  const result = compareWasmInterfaces(reference.bytes, candidate.bytes);
  const status = result.status === 'same-interface' ? 'pass' : result.status === 'changed-interface' ? 'fail' : 'unknown';
  return {
    id: 'wasm-interface', path, status,
    reference_sha256: reference.sha256, candidate_sha256: candidate.sha256,
    comparison_sha256: result.receipt_sha256, counts: result.counts,
    changes: result.changes.slice(0, 16), omitted_change_rows: Math.max(0, result.changes.length - 16),
    unknowns: result.unknowns.slice(0, 16),
  };
}

function deploymentCheck(path, before, after) {
  const reference = before.files.get(path), candidate = after.files.get(path);
  const evidence = { id: 'deployment-targets', path, authority: 'bounded-static',
    reference_sha256: reference?.sha256 ?? null, candidate_sha256: candidate?.sha256 ?? null };
  if (!reference || !candidate) return { ...evidence, status: 'fail', reason: 'required_target_missing' };
  const diff = compareDeploymentTargets(reference.bytes, candidate.bytes);
  return {
    ...evidence, status: { preserved: 'pass', narrowed: 'fail', unknown: 'unknown' }[diff.status],
    comparison_sha256: diff.receipt_sha256, changes: diff.changes.slice(0, 16),
    omitted_changes: Math.max(0, diff.changes.length - 16),
    reference_issues: diff.reference.issues, candidate_issues: diff.candidate.issues,
  };
}

function savedEvidenceCheck(id, fn, sources = {}) {
  try { return fn(); }
  catch (error) {
    if (!(error instanceof RpmError) && !/^[A-Z][A-Z0-9_]*$/u.test(error?.code ?? '')) throw error;
    return { id, authority: 'reported', status: 'unknown', reason: error instanceof RpmError ? error.code : 'evidence_unavailable', ...sources };
  }
}

function apiCheck(plan, candidate, policy) {
  const contract = candidate.files.get(plan.contract_path);
  if (!contract) return { id: 'api-coverage', authority: 'reported', status: 'fail', reason: 'required_contract_missing' };
  if (contract.size > RELEASE_LIMITS.har_bytes) return { id: 'api-coverage', authority: 'reported', status: 'unknown', reason: 'contract_byte_limit' };
  const har = policy.readBytes(plan.har_path, RELEASE_LIMITS.har_bytes);
  const sources = { contract_sha256: contract.sha256, har_sha256: hashBytes(har), origin_sha256: digest(plan.origin) };
  return savedEvidenceCheck('api-coverage', () => matchApiEvidence(plan, contract.bytes, har, sources), sources);
}

function matchApiEvidence(plan, contract, har, sources) {
  const document = parseJsonBytes(har);
  const all = document?.log?.entries;
  if (!Array.isArray(all) || all.length > 5000) throw new RpmError('har_input', 'Release checks expect a saved HAR with at most 5000 entries.');
  let unattributed = 0;
  const entries = all.filter(entry => {
    const url = entry?.request?.url;
    try {
      if (typeof url === 'string' && url.length <= 8192) {
        const parsed = new URL(url);
        if (['http:', 'https:'].includes(parsed.protocol)) return parsed.origin === plan.origin;
      }
    } catch { /* Unattributed rows are retained as a coverage gap. */ }
    unattributed++;
    return false;
  });
  const result = compareApiContract(parseJsonBytes(contract), { log: { entries } });
  const complete = result.status === 'complete' && unattributed === 0;
  const indexed = result.operations.map(() => ({ statuses: new Set(), missing_status: false }));
  const byOperation = new Map(result.operations.map((row, index) => [memberKey(row.method, row.path), indexed[index]]));
  for (const row of result.observations) {
    if (row.status !== 'observed') continue;
    const value = entries[row.entry_index]?.response?.status;
    const operation = indexed[row.operation_index];
    if (Number.isInteger(value) && value >= 100 && value <= 599) operation.statuses.add(value);
    else operation.missing_status = true;
  }
  const operations = plan.required_operations.map(row => {
    const found = byOperation.get(memberKey(row.method, row.path));
    const responses = [...found?.statuses ?? []].sort((a, b) => a - b);
    const expected = responses.some(status => row.expected_status === null ? status >= 200 && status < 300 : status === row.expected_status);
    const status = expected ? 'pass' : found?.missing_status || !complete ? 'unknown' : 'fail';
    return { ...row, status, observed_statuses: responses };
  });
  const unmatched = result.coverage.observations.unmatched;
  const checks = [...operations, { status: complete ? 'pass' : 'unknown' }];
  if (plan.reject_unmatched && unmatched) checks.push({ status: result.status === 'complete' ? 'fail' : 'unknown' });
  return {
    id: 'api-coverage', authority: 'reported', status: verdict(checks), operations,
    ...sources, out_of_scope_requests: all.length - entries.length - unattributed, unattributed_requests: unattributed,
    reject_unmatched: plan.reject_unmatched, coverage: result.coverage,
  };
}

function playwrightCheck(plan, policy) {
  const trace = policy.readBytes(plan.trace_path, RELEASE_LIMITS.trace_bytes);
  return savedEvidenceCheck('playwright-trace', () => verifyTrace(plan, trace, plan.network_path ? policy.readBytes(plan.network_path, RELEASE_LIMITS.trace_bytes) : undefined),
    { sources: { trace: { sha256: hashBytes(trace), bytes: trace.length }, network: null } });
}

function verifyTrace(plan, trace, network) {
  const result = inspectPlaywrightEvidence(trace, network);
  const rows = result.timeline.filter(row => row.type === 'action');
  let reached = 0;
  for (const row of rows) {
    if (row.status === 'completed' && row.category === plan.expected_categories[reached]) reached++;
  }
  const complete = result.status === 'complete' && (!plan.network_path || ['complete', 'empty'].includes(result.network.coverage.status));
  const duration = rows.reduce((max, row) => row.duration_ms === null ? max : Math.max(max ?? 0, row.duration_ms), null);
  const withinDuration = plan.max_action_duration_ms === undefined || (duration !== null && duration <= plan.max_action_duration_ms);
  const failed = result.coverage.actions.failed > 0 || result.coverage.trace.trace_errors > 0 || result.coverage.pages?.error_events > 0;
  const matched = reached === plan.expected_categories.length;
  return {
    id: 'playwright-trace', authority: 'reported',
    status: failed ? 'fail' : !complete ? 'unknown' : matched && withinDuration ? 'pass' : 'fail',
    trace_status: result.status, sources: result.sources, coverage: result.coverage,
    expected_count: plan.expected_categories.length, matched_count: reached,
    max_observed_action_ms: duration, configured_action_ceiling_ms: plan.max_action_duration_ms ?? null,
  };
}

function nested(parent, child) {
  const suffix = relative(parent, child);
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`));
}

export async function checkRelease(planPath, { signal } = {}) {
  const policy = new WorkspacePolicy(dirname(planPath));
  const policyBytes = policy.readBytes(basename(planPath), RELEASE_LIMITS.plan_bytes);
  const plan = validate(parseJsonBytes(policyBytes));
  const options = { maxFileBytes: COMPARISON_LIMITS.max_file_bytes };
  if (signal?.aborted) throw new RpmError('request_cancelled', 'Release check cancelled.');
  const reference = await inventory(policy.resolveInput(plan.reference_path), options);
  const candidate = await inventory(policy.resolveInput(plan.candidate_path), options);
  need(reference.inputFile === null && candidate.inputFile === null, 'Reference and candidate must be build directories.');
  need(!nested(reference.path, candidate.path) && !nested(candidate.path, reference.path), 'Reference and candidate must be disjoint build directories.');
  if (signal?.aborted) throw new RpmError('request_cancelled', 'Release check cancelled.');
  const artifacts = compareArtifactSnapshots(reference, candidate, { archivePaths: plan.repack_only });
  const findings = checkBuild(plan, artifacts, reference, candidate);
  const checks = [{ id: 'build-files', authority: 'bounded-static', status: verdict(findings), findings }];
  for (const path of plan.wasm_interfaces) checks.push(wasmCheck(path, reference, candidate));
  for (const path of plan.deployment_targets ?? []) checks.push(deploymentCheck(path, reference, candidate));
  if (plan.api) checks.push(savedEvidenceCheck('api-coverage', () => apiCheck(plan.api, candidate, policy)));
  if (plan.playwright) checks.push(savedEvidenceCheck('playwright-trace', () => playwrightCheck(plan.playwright, policy)));

  const result = {
    schema_version: 1,
    kind: 'release-check',
    status: verdict(checks),
    engine_version: VERSION,
    policy_sha256: digest(plan),
    policy_file_sha256: hashBytes(policyBytes),
    artifacts,
    checks,
    authority: { files: 'bounded-static', saved_observations: 'reported' },
    scope: 'Finite policy over regular build files, declared deployment targets, Wasm interfaces and supplied observations. Bytes and policy are content-bound. The operator supplies the origin of saved observations.',
  };
  return { ...result, receipt_sha256: digest(result) };
}
