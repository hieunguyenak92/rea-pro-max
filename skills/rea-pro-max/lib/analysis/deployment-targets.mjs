import { digest, hashBytes, RpmError } from '../common.mjs';
import { VERSION } from '../version.mjs';
import { parseJvmTargets } from './jvm-targets.mjs';
import { parseMachTargets } from './macho-targets.mjs';

export const TARGET_LIMITS = Object.freeze({ max_file_bytes: 16 * 1024 * 1024 });
const machMagic = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'bebafeca', 'cafebabf', 'bfbafeca']);
const unresolved = (format, issues) => ({ format, complete: false, targets: [], issues });

// Universal Mach-O and JVM class files share an on-disk magic. Ask both
// readers to qualify the structure before assigning that signature a format.
export function parseDeploymentTargets(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > TARGET_LIMITS.max_file_bytes) {
    throw new RpmError('target_input', 'Use at most 16 MiB of binary input.');
  }
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = data.subarray(0, 4).toString('hex');
  if (machMagic.has(magic)) return parseMachTargets(data);
  if (magic !== 'cafebabe') return unresolved('unknown', ['unsupported_target_format']);
  const mach = parseMachTargets(data), jvm = parseJvmTargets(data);
  if (!jvm.complete && mach.targets.length) return mach;
  if (jvm.complete && mach.targets.length === 0) return jvm;
  return unresolved('undetermined', ['shared_magic_undetermined', ...mach.issues, ...jvm.issues]);
}

export function inspectDeploymentTargets(bytes) {
  const parsed = parseDeploymentTargets(bytes);
  const report = {
    schema_version: 1, kind: 'deployment-targets', engine_version: VERSION,
    status: parsed.complete ? 'complete' : 'unknown', authority: 'bounded-static',
    format: parsed.format, targets: parsed.targets, issues: parsed.issues,
    bytes: bytes.byteLength, sha256: hashBytes(bytes),
  };
  return { ...report, receipt_sha256: digest(report) };
}

function compareVersions(before, after) {
  const a = before.split('.').map(Number), b = after.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (b[i] ?? 0) - (a[i] ?? 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

const targetKey = target => JSON.stringify([target.architecture, target.variant, target.kind, target.platform]);
const change = (effect, reason, reference, candidate) => ({ effect, reason, reference, candidate });

function compareApple(reference, candidate) {
  const changes = [];
  const remaining = new Map(candidate.map(row => [targetKey(row), row]));
  for (const row of reference) {
    const key = targetKey(row), next = remaining.get(key);
    if (!next) {
      changes.push(change('loss', 'target_removed', row, null));
      continue;
    }
    remaining.delete(key);
    const delta = compareVersions(row.minimumOS, next.minimumOS);
    if (delta > 0) changes.push(change('loss', 'minimum_os_raised', row, next));
    if (delta < 0) changes.push(change('gain', 'minimum_os_lowered', row, next));
  }
  for (const row of remaining.values()) changes.push(change('gain', 'target_added', null, row));
  return changes;
}

function compareJava(before, after) {
  const changes = [];
  const delta = compareVersions(before.minimumJavaVersion, after.minimumJavaVersion);
  if (before.kind !== after.kind) changes.push(change('loss', 'class_kind_changed', before, after));
  if (after.preview && (!before.preview || delta !== 0)) {
    changes.push(change('loss', before.preview ? 'preview_release_changed' : 'preview_required', before, after));
  } else if (delta > 0) {
    changes.push(change('loss', 'minimum_java_raised', before, after));
  } else if (before.preview && !after.preview) {
    changes.push(change('gain', 'preview_requirement_removed', before, after));
  } else if (delta < 0) {
    changes.push(change('gain', 'minimum_java_lowered', before, after));
  }
  return changes;
}

export function compareDeploymentTargets(before, after) {
  const reference = inspectDeploymentTargets(before), candidate = inspectDeploymentTargets(after);
  let changes = [], status = 'unknown';
  if (reference.status === 'complete' && candidate.status === 'complete') {
    if (reference.format !== candidate.format) {
      changes = [change('loss', 'format_replaced', reference.format, candidate.format)];
    } else if (reference.format === 'mach-o') {
      changes = compareApple(reference.targets, candidate.targets);
    } else {
      changes = compareJava(reference.targets[0], candidate.targets[0]);
    }
    status = changes.some(row => row.effect === 'loss') ? 'narrowed' : 'preserved';
  }
  const result = {
    schema_version: 1, kind: 'deployment-target-comparison', engine_version: VERSION,
    authority: 'bounded-static', status, reference, candidate, changes,
    scope: 'Declared targets and artifact kinds only. Loading, linking, dependencies, signatures and runtime behavior require separate evidence.',
  };
  return { ...result, receipt_sha256: digest(result) };
}
