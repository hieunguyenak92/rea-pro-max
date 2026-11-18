import { randomUUID } from 'node:crypto';
import { constants, lstatSync, renameSync } from 'node:fs';
import { lstat, open, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { replayFeature } from './runtime/replay.mjs';
import { replayWebFeature } from './runtime/web-replay.mjs';
import { digest, hashBytes, RpmError } from './common.mjs';

const MAX_PATCHES = 64;
const MAX_PATCH_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 8;
const HASH = /^[a-f0-9]{64}$/u;
const PATH_SEGMENT = /^[^<>:"/\\|?*\u0000-\u001f]+$/u;
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(code, message, details = {}) { throw new RpmError(code, message, details); }
function boundedString(value, label, max = 4096) {
  if (typeof value !== 'string' || value.length > max) fail('recovery_plan', `${label} must be a bounded string.`);
  return value;
}
function relativePath(value, label) {
  boundedString(value, label, 4096);
  if (isAbsolute(value) || value.split('/').some(part => !PATH_SEGMENT.test(part) || DEVICE_NAME.test(part) || part !== part.trim() || part.endsWith('.'))) {
    fail('recovery_scope', `${label} must be a portable relative path without traversal.`);
  }
  return value;
}
function ensureRoot(root) {
  if (typeof root !== 'string' || root.length > 4096 || !isAbsolute(root) || root.includes('\0')) fail('recovery_scope', 'Recovery roots must be absolute directories.');
  return resolve(root);
}
function contains(root, path) {
  const suffix = relative(root, path);
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}
function disjoint(left, right) {
  if (contains(left, right) || contains(right, left)) fail('recovery_scope', 'MV3 reference and receiving directories must be disjoint.');
}
function validatePatches(input) {
  if (!Array.isArray(input) || input.length > MAX_PATCHES) fail('recovery_plan', `patches must contain at most ${MAX_PATCHES} entries.`);
  const patches = input.map((patch, index) => {
    if (!object(patch)) fail('recovery_plan', `patches[${index}] must be an object.`);
    const path = relativePath(patch.path, `patches[${index}].path`);
    if (typeof patch.expected_sha256 !== 'string' || !HASH.test(patch.expected_sha256)) fail('recovery_plan', `patches[${index}].expected_sha256 must be a lowercase SHA-256 digest.`);
    const search = boundedString(patch.search, `patches[${index}].search`, MAX_PATCH_BYTES);
    const replace = boundedString(patch.replace, `patches[${index}].replace`, MAX_PATCH_BYTES);
    if (!search || !search.isWellFormed() || !replace.isWellFormed() || Buffer.byteLength(search) > MAX_PATCH_BYTES || Buffer.byteLength(replace) > MAX_PATCH_BYTES) {
      fail('recovery_plan', `patches[${index}] requires nonempty search text and bounded UTF-8 replacements.`);
    }
    const expectedMatches = patch.expected_matches ?? 1;
    if (!Number.isSafeInteger(expectedMatches) || expectedMatches < 1 || expectedMatches > 32) fail('recovery_plan', `patches[${index}].expected_matches must be between 1 and 32.`);
    return { path, expected_sha256: patch.expected_sha256, search, replace, expected_matches: expectedMatches };
  });
  const paths = patches.map(({ path }) => process.platform === 'win32' ? path.toLowerCase() : path);
  if (new Set(paths).size !== patches.length) fail('recovery_plan', 'Each patch path must occur once.');
  return patches;
}
function urlForReplay(value, label) {
  boundedString(value, label);
  let url;
  try { url = new URL(value); } catch { fail('recovery_plan', `${label} must be an absolute HTTP(S) URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('recovery_plan', `${label} must use HTTP(S) without credentials.`);
  return url.href;
}

/**
 * Validate a declarative recovery plan. The plan deliberately contains no
 * executable callback: patches are hash-bound text replacements and runtime
 * execution is delegated to the selected, typed provider.
 */
export function validateRecoveryPlan(input) {
  if (!object(input) || input.schema_version !== 1) fail('recovery_plan', 'Recovery plans require schema_version 1.');
  const kind = input.kind;
  if (!['mv3', 'web'].includes(kind)) fail('recovery_plan', 'Recovery plans support only the typed mv3 and web providers.');
  const candidateRoot = ensureRoot(input.candidate_root);
  const browserExecutable = boundedString(input.browser_executable, 'browser_executable', 4096);
  if (!isAbsolute(browserExecutable) || browserExecutable.includes('\0')) fail('recovery_plan', 'browser_executable must be an absolute path.');
  const maxAttempts = input.max_attempts ?? 4;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) fail('recovery_plan', `max_attempts must be between 1 and ${MAX_ATTEMPTS}.`);
  if (!object(input.scenario)) fail('recovery_plan', 'Recovery plans require a typed scenario object.');
  const patches = validatePatches(input.patches);
  const base = { schema_version: 1, kind, candidate_root: candidateRoot, browser_executable: browserExecutable, max_attempts: maxAttempts, patches, scenario: input.scenario };
  if (kind === 'mv3') {
    const referencePath = relativePath(input.reference_path, 'reference_path');
    const candidatePath = relativePath(input.candidate_path, 'candidate_path');
    const candidate = resolve(candidateRoot, candidatePath);
    disjoint(resolve(candidateRoot, referencePath), candidate);
    for (const patch of patches) {
      const file = resolve(candidateRoot, patch.path);
      if (!relative(candidate, file) || !contains(candidate, file)) fail('recovery_scope', 'MV3 patches must address files inside the receiving directory.', { path: patch.path });
    }
    return { ...base, reference_path: referencePath, candidate_path: candidatePath };
  }
  const referenceUrl = urlForReplay(input.reference_url, 'reference_url');
  const candidateUrl = urlForReplay(input.candidate_url, 'candidate_url');
  if (referenceUrl === candidateUrl) fail('recovery_scope', 'Web replay requires distinct reference and receiving URLs.');
  return { ...base, reference_url: referenceUrl, candidate_url: candidateUrl, ...(input.contract === undefined ? {} : { contract: input.contract }) };
}

const statOptions = { bigint: true };
const noFollow = constants.O_NOFOLLOW || 0;
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameFile = (left, right) => sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;

async function admitRoot(path) {
  const selected = await lstat(path, statOptions);
  if (!selected.isDirectory() || selected.isSymbolicLink()) fail('recovery_scope', 'Recovery requires a regular workspace directory.');
  // Resolve the caller's workspace alias once, as static inventory does.
  const canonical = await realpath(path);
  const stat = await lstat(canonical, statOptions);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameIdentity(selected, stat)) fail('recovery_scope', 'Recovery workspace changed during admission.');
  return { path: canonical, stat };
}

function checkPath(root, name, directory = false) {
  if (root.workspace) {
    const entry = checkPath(root.workspace, root.name, true);
    if (!sameIdentity(entry.stat, root.stat)) fail('recovery_scope', 'The admitted replay target changed.', { path: root.name });
  }
  const currentRoot = lstatSync(root.path, statOptions);
  if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink() || !sameIdentity(currentRoot, root.stat)) fail('recovery_scope', 'The admitted directory changed.');
  let path = root.path;
  let parent = currentRoot;
  const parts = name.split('/');
  for (const part of parts.slice(0, -1)) {
    path = join(path, part);
    parent = lstatSync(path, statOptions);
    if (!parent.isDirectory() || parent.isSymbolicLink()) fail('recovery_scope', 'Recovery paths must use regular directory components.', { path: name });
  }
  path = join(path, parts.at(-1));
  const stat = lstatSync(path, statOptions);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail('recovery_scope', directory ? 'Replay targets must be regular directories.' : 'Patch targets must be regular files.', { path: name });
  return { path, stat, parent };
}

async function admitDirectory(root, name) {
  const entry = checkPath(root, name, true);
  const path = await realpath(entry.path);
  const current = checkPath(root, name, true);
  const stat = await lstat(path, statOptions);
  if (!contains(root.path, path) || !stat.isDirectory() || stat.isSymbolicLink() || !sameIdentity(entry.stat, stat) || !sameIdentity(stat, current.stat)) fail('recovery_scope', 'Replay directory changed during admission.', { path: name });
  return { path, stat, workspace: root, name };
}

async function safeRead(root, name) {
  const entry = checkPath(root, name);
  if (entry.stat.size > BigInt(MAX_PATCH_BYTES)) fail('recovery_input', 'Patch target exceeds the 1 MiB file limit.', { path: name });
  const { path } = entry;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat(statOptions);
    if (!before.isFile() || !sameFile(before, entry.stat)) fail('recovery_input_changed', 'Patch target changed during admission.', { path: name });
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat(statOptions);
    if (BigInt(offset) !== before.size || !sameFile(after, before)) fail('recovery_input_changed', 'Patch target changed during reading.', { path: name });
    return { ...entry, bytes: bytes.subarray(0, offset) };
  } finally { await handle.close(); }
}

function checkCancelled(signal) {
  if (signal?.aborted) fail('request_cancelled', 'Recovery was cancelled.');
}

async function safeWrite(root, name, original, content, signal) {
  const checkOriginal = () => {
    const current = checkPath(root, name);
    if (!sameIdentity(current.parent, original.parent) || !sameFile(current.stat, original.stat)) fail('recovery_input_changed', 'Patch target or its parent changed before replacement.', { path: name });
  };
  checkCancelled(signal);
  checkOriginal();
  const temporary = join(dirname(original.path), `.rpm-recovery-${randomUUID()}.tmp`);
  let staged = false;
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
    staged = true;
    try {
      await handle.writeFile(content);
      if (process.platform !== 'win32') await handle.chmod(Number(original.stat.mode & 0o777n));
      await handle.sync();
    } finally { await handle.close(); }
    // No event-loop turn between the final checks and the atomic replacement.
    checkCancelled(signal);
    checkOriginal();
    renameSync(temporary, original.path);
    staged = false;
  } finally {
    if (staged) {
      const parent = await lstat(dirname(temporary), statOptions).catch(() => null);
      if (parent?.isDirectory() && sameIdentity(parent, original.parent)) await rm(temporary, { force: true });
    }
  }
}

async function applyPatch(root, name, patch, signal) {
  checkCancelled(signal);
  const current = await safeRead(root, name);
  const before = hashBytes(current.bytes);
  if (before !== patch.expected_sha256) fail('recovery_stale_patch', 'Patch digest does not match the current candidate file.', { path: patch.path, expected_sha256: patch.expected_sha256, actual_sha256: before });
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(current.bytes); }
  catch { fail('recovery_input', 'Patch target is not valid UTF-8.', { path: patch.path }); }
  let matches = 0;
  for (let position = text.indexOf(patch.search); position !== -1; position = text.indexOf(patch.search, position + patch.search.length)) matches++;
  if (matches !== patch.expected_matches) fail('recovery_patch_match', 'Patch search count differs from the declared count.', { path: patch.path, expected_matches: patch.expected_matches, actual_matches: matches });
  const size = current.bytes.length + matches * (Buffer.byteLength(patch.replace) - Buffer.byteLength(patch.search));
  if (size > MAX_PATCH_BYTES) fail('recovery_patch_bounds', 'Patched file exceeds the bounded patch size.', { path: patch.path });
  const bytes = Buffer.from(text.replaceAll(patch.search, () => patch.replace), 'utf8');
  const after = hashBytes(bytes);
  await safeWrite(root, name, current, bytes, signal);
  return { path: patch.path, before_sha256: before, after_sha256: after, replacements: matches };
}

export async function applyRecoveryPatches(rootInput, patches, { signal } = {}) {
  const checked = validatePatches(patches);
  const root = await admitRoot(ensureRoot(rootInput));
  const applied = [];
  for (const patch of checked) {
    try { applied.push(await applyPatch(root, patch.path, patch, signal)); }
    catch (error) {
      if (!applied.length) throw error;
      throw new RpmError(error.code || 'recovery_io', error.message, { ...error.details, applied });
    }
  }
  return { root: root.path, applied, digest: digest(applied) };
}

async function runProvider(plan, signal, onProgress, directories) {
  if (plan.kind === 'mv3') {
    return replayFeature({
      referencePath: directories.reference.path,
      candidatePath: directories.candidate.path,
      executablePath: plan.browser_executable,
      scenario: plan.scenario,
      signal,
      onProgress,
    });
  }
  return replayWebFeature({ referenceUrl: plan.reference_url, candidateUrl: plan.candidate_url, executablePath: plan.browser_executable, scenario: plan.scenario, contract: plan.contract, signal, onProgress });
}

/**
 * Execute a bounded inspect/patch/replay loop. The candidate is changed only
 * by explicit hash-bound patches, and every attempt retains its replay result.
 */
export async function runRecoveryPlan(input, { replay = runProvider, signal, onProgress } = {}) {
  const plan = validateRecoveryPlan(input);
  const attempts = [];
  const planHash = digest(plan);
  const finish = (status, stopReason, failure) => ({
    schema_version: 1,
    kind: 'recovery-run',
    status,
    stop_reason: stopReason,
    attempts,
    patches: attempts.flatMap(item => item.patch ? [item.patch] : []),
    plan_sha256: planHash,
    ...(failure ? { failure } : {}),
    scope: 'Typed provider replay with explicit hash-bound candidate patches. A pass covers the declared finite scenario.',
  });
  const issue = (phase, error) => finish('unknown', signal?.aborted || error?.code === 'request_cancelled' ? 'cancelled' : `${phase}_error`, {
    phase,
    code: error?.code || 'recovery_failed',
    message: String(error?.message ?? error).slice(0, 1000),
    ...(error instanceof RpmError ? { details: error.details } : {}),
  });
  let workspace, directories;
  try {
    checkCancelled(signal);
    workspace = await admitRoot(plan.candidate_root);
    if (plan.kind === 'mv3') {
      const reference = await admitDirectory(workspace, plan.reference_path);
      const candidate = await admitDirectory(workspace, plan.candidate_path);
      disjoint(reference.path, candidate.path);
      if (sameIdentity(reference.stat, candidate.stat)) fail('recovery_scope', 'The MV3 reference and receiving directories must have distinct identities.');
      directories = { reference, candidate };
    }
  } catch (error) { return issue('admission', error); }

  for (let attempt = 1; ; attempt++) {
    let result;
    try {
      checkCancelled(signal);
      if (directories) {
        for (const [name, saved] of [[plan.reference_path, directories.reference], [plan.candidate_path, directories.candidate]]) {
          const current = checkPath(workspace, name, true);
          if (!sameIdentity(current.stat, saved.stat)) fail('recovery_scope', 'Replay directory changed between attempts.', { path: name });
        }
      }
      result = await replay(plan, signal, value => onProgress?.({ ...value, attempt }), directories);
      if (!object(result) || !['pass', 'fail', 'unknown'].includes(result.status)) fail('recovery_replay', 'Replay returned an invalid verdict.');
      attempts.push({ attempt, replay: result });
      checkCancelled(signal);
    } catch (error) { return issue('replay', error); }
    if (result.status === 'unknown' || result.reference?.complete === false || result.candidate?.complete === false) return finish('unknown', 'unknown_replay');
    if (result.status === 'pass') return finish('pass', 'passed');
    if (attempt >= plan.max_attempts) return finish('fail', 'attempt_budget');
    const patch = plan.patches[attempt - 1];
    if (!patch) return finish('fail', 'patch_budget');
    try {
      const file = directories ? relative(resolve(workspace.path, plan.candidate_path), resolve(workspace.path, patch.path)).split(sep).join('/') : patch.path;
      attempts.at(-1).patch = await applyPatch(directories?.candidate ?? workspace, file, patch, signal);
    } catch (error) { return issue('patch', error); }
  }
}

