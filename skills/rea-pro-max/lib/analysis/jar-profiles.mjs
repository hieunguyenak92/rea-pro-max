import { digest, hashBytes, RpmError } from '../common.mjs';
import { VERSION } from '../version.mjs';
import { parseJvmTargets } from './jvm-targets.mjs';
import { inspectZip, zipVerificationBudget } from './zip.mjs';

export const JAR_PROFILE_LIMITS = Object.freeze({
  max_file_bytes: 16 * 1024 * 1024, max_members: 512, max_manifest_bytes: 64 * 1024,
  min_java: 8, max_java: 27, max_profiles: 8,
});
const MANIFEST = 'META-INF/MANIFEST.MF';
const VERSIONS = 'META-INF/versions/';
const BASE = JAR_PROFILE_LIMITS.min_java;
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isManifest = name => name?.toUpperCase() === MANIFEST;

function manifestFlag(bytes) {
  if (!bytes || bytes.length > JAR_PROFILE_LIMITS.max_manifest_bytes) return null;
  // A manifest writer can fold a UTF-8 value between bytes of one character.
  // Unfold at the byte level before testing the value's encoding.
  const raw = bytes.toString('latin1');
  const lines = raw.split(/\r\n|\r|\n/u);
  if (raw.includes('\0') || lines.at(-1) !== '') return null;
  let section = 0;
  let field;
  let multiRelease = false;
  const names = new Set();
  function commit() {
    if (!field) return true;
    let value;
    try { value = UTF8.decode(Buffer.from(field.value, 'latin1')); }
    catch { return false; }
    if (section === 0 && field.name === 'manifest-version' && !/^\d+(?:\.\d+)*$/u.test(value)) return false;
    if (section === 0 && field.name === 'multi-release') multiRelease = value.toLowerCase() === 'true';
    field = undefined;
    return true;
  }
  for (const line of lines) {
    if (line.startsWith(' ')) {
      if (!field) return null;
      field.value += line.slice(1);
      continue;
    }
    if (!commit()) return null;
    if (line === '') {
      if (names.size > 0) { section++; names.clear(); }
      continue;
    }
    const match = /^([A-Za-z0-9][A-Za-z0-9_-]{0,69}): (.*)$/u.exec(line);
    if (!match) return null;
    const name = match[1].toLowerCase();
    if (names.has(name) || (section === 0 && name === 'name')) return null;
    if (names.size === 0 && name !== (section === 0 ? 'manifest-version' : 'name')) return null;
    names.add(name);
    field = { name, value: match[2] };
  }
  return section > 0 ? multiRelease : null;
}

function classEntry(path) {
  const name = path?.endsWith('/') ? path.slice(0, -1) : path;
  if (!name?.endsWith('.class')) return null;
  if (!name.startsWith('META-INF/')) return { name, release: BASE, overlay: false };
  if (!name.startsWith(VERSIONS)) return null;
  const remainder = name.slice(VERSIONS.length);
  const separator = remainder.indexOf('/');
  if (separator === -1) return null;
  const version = remainder.slice(0, separator);
  const logicalName = remainder.slice(separator + 1);
  if (!/^[1-9][0-9]*$/u.test(version) || logicalName.startsWith('META-INF/')) return null;
  const release = Number(version);
  if (!Number.isSafeInteger(release) || release < BASE || release > JAR_PROFILE_LIMITS.max_java) return null;
  return { name: logicalName, release, overlay: true };
}

function readArchive(input) {
  if (!(input instanceof Uint8Array) || input.byteLength > JAR_PROFILE_LIMITS.max_file_bytes) {
    throw new RpmError('jar_input', 'Use at most 16 MiB of JAR bytes per input.');
  }
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const report = { bytes: bytes.length, sha256: hashBytes(bytes), multi_release: null, manifest: null, coverage: null, issues: [] };
  const parsedClasses = new Map();
  const manifests = new Map();
  const zip = inspectZip(bytes, JAR_PROFILE_LIMITS.max_members, zipVerificationBudget(), (name, contents) => {
    if (isManifest(name)) manifests.set(name, manifestFlag(contents));
    if (classEntry(name)) parsedClasses.set(name, parseJvmTargets(contents));
  });
  const entries = new Map();
  function unresolved(code) {
    report.issues.push(code);
    return { report, entries };
  }
  if (!zip) return unresolved('not_zip_archive');
  report.coverage = zip.metadata.coverage;
  if (!report.coverage.content_complete) {
    report.issues.push(...zip.unknowns.map(row => row.code));
    return unresolved('jar_incomplete_archive');
  }
  if (!['jar-container', 'zip-container'].includes(zip.format)) return unresolved('unsupported_jar_container');
  const members = zip.metadata.listed_members;
  // Current JDK JarFile accepts stored or deflated members. ZIP support for
  // additional compression methods does not qualify a file as a readable JAR.
  if (members.some(member => ![0, 8].includes(member.compression_method))) return unresolved('jar_zip_method_unsupported');
  const manifestMembers = members.filter(member => isManifest(member.name));
  if (manifestMembers.length > 1) return unresolved('jar_manifest_ambiguous');
  const manifest = manifestMembers[0];
  if (manifest) {
    report.manifest = { path: manifest.name, sha256: manifest.content_sha256 };
    const enabled = manifests.get(manifest.name);
    if (typeof enabled !== 'boolean') return unresolved('jar_manifest_invalid_or_unsupported');
    report.multi_release = enabled;
  } else {
    if (parsedClasses.size === 0) return unresolved('jar_no_manifest_or_class_entries');
    report.multi_release = false;
  }
  for (const member of members) {
    const entry = classEntry(member.name);
    if (!entry) continue;
    const rows = entries.get(entry.name) ?? [];
    const parsed = parsedClasses.get(member.name);
    rows.push({
      ...entry, path: member.name, sha256: member.content_sha256,
      class_target: parsed?.targets[0] ?? null, issues: parsed?.issues ?? ['jar_class_entry_not_regular'],
    });
    entries.set(entry.name, rows);
  }
  for (const rows of entries.values()) rows.sort((a, b) => b.release - a.release || Number(b.overlay) - Number(a.overlay));
  return { report, entries };
}

function selectedClasses(archive, java) {
  const selected = new Map();
  for (const choices of archive.entries.values()) {
    const row = choices.find(choice => !choice.overlay || (archive.report.multi_release && java > BASE && choice.release <= java));
    if (!row) continue;
    const { class_target: target, release } = row;
    let target_status = 'declared-compatible';
    const issues = [...row.issues];
    if (row.overlay && release === BASE) {
      // The specification excludes this directory, but OpenJDK 21 JarFile
      // can select it. A malformed JAR cannot certify the base selection.
      target_status = 'unknown';
      issues.push('jar_versioned_directory_below_nine');
    } else if (!target) target_status = 'unknown';
    else if (row.overlay && target.javaRelease > release) {
      target_status = 'unknown';
      issues.push('jar_versioned_class_target_exceeds_directory');
    } else if (target.preview) target_status = target.javaRelease === java ? 'preview-required' : 'preview-release-mismatch';
    else if (target.javaRelease > java) target_status = 'newer-java-required';
    selected.set(row.name, {
      ...row, selection_basis: row.overlay ? 'highest-eligible-overlay' : 'base-entry', target_status, issues,
    });
  }
  return selected;
}

function compareProfile(reference, candidate, java) {
  if (reference.report.issues.length || candidate.report.issues.length) {
    return { java, status: 'unknown', reference: [], candidate: [], changes: [], issues: [{ code: 'jar_profile_archive_unresolved' }] };
  }
  const left = selectedClasses(reference, java);
  const right = selectedClasses(candidate, java);
  const names = [...new Set([...left.keys(), ...right.keys()])].sort(compareText);
  const selectedBefore = [], selectedAfter = [], changes = [], issues = [];
  for (const name of names) {
    const before = left.get(name), after = right.get(name);
    if (before) selectedBefore.push(before);
    if (after) selectedAfter.push(after);
    if (before?.target_status === 'unknown' || after?.target_status === 'unknown') {
      issues.push({ name, code: 'jar_selected_class_unresolved' });
      continue;
    }
    let change;
    if (!before) change = 'added';
    else if (!after) change = 'removed';
    else if (before.sha256 !== after.sha256) change = 'modified';
    else if (before.path !== after.path) change = 'reselected';
    if (change) changes.push({ name, change });
  }
  const status = changes.length ? 'different' : issues.length ? 'unknown' : 'same-selection';
  return { java, status, reference: selectedBefore, candidate: selectedAfter, changes, issues };
}

/** Compare the regular .class entries selected by each explicit Java feature profile. */
export function compareJarProfiles(referenceBytes, candidateBytes, profiles) {
  const { max_profiles, min_java, max_java } = JAR_PROFILE_LIMITS;
  if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > max_profiles
    || new Set(profiles).size !== profiles.length
    || !Array.from(profiles).every(value => Number.isSafeInteger(value) && value >= min_java && value <= max_java)) {
    throw new RpmError('jar_profiles', `Use 1–${max_profiles} unique Java feature versions from ${min_java} to ${max_java}.`);
  }
  const reference = readArchive(referenceBytes), candidate = readArchive(candidateBytes);
  const comparisons = [...profiles].sort((a, b) => a - b).map(java => compareProfile(reference, candidate, java));
  const complete = comparisons.every(result => result.issues.length === 0);
  const status = comparisons.some(result => result.status === 'different') ? 'different' : complete ? 'same-selection' : 'unknown';
  const result = {
    schema_version: 1, kind: 'jar-profile-comparison', engine_version: VERSION, authority: 'bounded-static',
    status, complete, reference: reference.report, candidate: candidate.report, profiles: comparisons,
    scope: 'Regular .class entries selected within one JAR by standard multi-release lookup, and their declared class targets. Custom loaders, dependencies, signatures, resources, actual linking and behavior are outside this result.',
  };
  return { ...result, receipt_sha256: digest(result) };
}
