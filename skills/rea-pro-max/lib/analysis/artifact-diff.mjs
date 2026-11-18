import { digest, RpmError } from '../common.mjs';
import { inventory, compareText } from './inventory.mjs';
import { inventoryFormats } from './formats.mjs';

export const COMPARISON_LIMITS = Object.freeze({ max_file_bytes: 16 * 1024 * 1024, max_archive_pairs: 8, max_members_per_archive: 128 });
const ZIP_SIGNATURES = new Set(['504b0304', '504b0506', '504b0708']);
const zipCandidate = file => ZIP_SIGNATURES.has(file.bytes.subarray(0, 4).toString('hex'));
const fileFact = file => ({ sha256: file.sha256, bytes: file.size });
const byPath = (a, b) => compareText(a.path, b.path);

function indexByHash(files) {
  const index = new Map();
  for (const file of files.values()) {
    const matches = index.get(file.sha256) ?? [];
    matches.push(file.path);
    index.set(file.sha256, matches);
  }
  return index;
}

function compareArchive(path, reference, candidate) {
  const complete = reference?.metadata?.coverage?.content_complete === true && candidate?.metadata?.coverage?.content_complete === true;
  const memberMap = artifact => new Map((artifact?.metadata?.listed_members ?? [])
    .filter(member => member.content_status === 'verified' && member.content_sha256)
    .map(member => [member.name, member.content_sha256]));
  const before = memberMap(reference), after = memberMap(candidate);
  const changes = [];
  let unchanged = 0;
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort(compareText)) {
    if (before.has(name) && after.has(name)) {
      if (before.get(name) === after.get(name)) unchanged++;
      else changes.push({ name, status: 'modified', reference_sha256: before.get(name), candidate_sha256: after.get(name) });
    } else if (complete) {
      changes.push(before.has(name)
        ? { name, status: 'removed', reference_sha256: before.get(name) }
        : { name, status: 'added', candidate_sha256: after.get(name) });
    }
  }
  return {
    path,
    status: complete ? (changes.length ? 'changed-file-content' : 'same-file-content') : 'partial',
    reference: archiveCoverage(reference),
    candidate: archiveCoverage(candidate),
    verified_unchanged_files: unchanged,
    changes,
    ...(complete ? {} : { reason: 'incomplete_archive_member_coverage' }),
  };
}

function archiveCoverage(artifact) {
  if (!artifact) return { status: 'unrecognized' };
  return {
    format: artifact.format,
    ...artifact.metadata.coverage,
    member_count: artifact.metadata.member_count,
    unknown_codes: [...new Set(artifact.unknowns.map(row => row.code))].sort(compareText),
  };
}

function describe(snapshot) {
  return {
    sha256: snapshot.inputFile === null ? snapshot.sha256 : snapshot.entries[0].sha256,
    kind: snapshot.inputFile === null ? 'directory' : 'file',
    file_count: snapshot.entries.length,
    bytes: snapshot.bytes,
    omitted: snapshot.scope.omitted,
  };
}

/** Compare two local snapshots with one shared scope. Only admitted file bytes carry identity. */
export async function compareArtifacts(referencePath, candidatePath, { include, exclude } = {}) {
  const limits = { maxFileBytes: COMPARISON_LIMITS.max_file_bytes, include, exclude };
  const reference = await inventory(referencePath, limits);
  const candidate = await inventory(candidatePath, limits);
  return compareArtifactSnapshots(reference, candidate);
}

export function compareArtifactSnapshots(reference, candidate, { archivePaths = [] } = {}) {
  if (reference.scope.policy_sha256 !== candidate.scope.policy_sha256) {
    throw new RpmError('artifact_comparison_scope', 'Compare snapshots admitted under the same scope policy.');
  }
  if ((reference.inputFile === null) !== (candidate.inputFile === null)) {
    throw new RpmError('artifact_comparison_input', 'Compare two regular files or two artifact directories.');
  }
  const filePair = reference.inputFile !== null;
  const before = filePair ? new Map([['.', reference.entries[0]]]) : reference.files;
  const after = filePair ? new Map([['.', candidate.entries[0]]]) : candidate.files;
  const referenceHashes = indexByHash(before), candidateHashes = indexByHash(after);
  const changes = [];
  const archiveCandidates = archivePaths.filter(path => before.has(path) && after.has(path)).map(path => ({ path, file: before.get(path), next: after.get(path) }));
  const explicitArchives = new Set(archivePaths);
  const counts = { unchanged: 0, modified: 0, removed: 0, added: 0, relocated: 0 };

  for (const [path, file] of before) {
    const next = after.get(path);
    if (next?.sha256 === file.sha256) {
      counts.unchanged++;
    } else if (next) {
      counts.modified++;
      changes.push({ path, status: 'modified', reference: fileFact(file), candidate: fileFact(next) });
      if (!explicitArchives.has(path) && zipCandidate(file) && zipCandidate(next)) archiveCandidates.push({ path, file, next });
    } else {
      const candidatePaths = candidateHashes.get(file.sha256) ?? [];
      const relocatedTo = candidatePaths[0];
      if (referenceHashes.get(file.sha256).length === 1 && candidatePaths.length === 1 && !before.has(relocatedTo)) {
        counts.relocated++;
        changes.push({ path, status: 'relocated', candidate_path: relocatedTo, reference: fileFact(file) });
      } else {
        counts.removed++;
        changes.push({ path, status: 'removed', reference: fileFact(file) });
      }
    }
  }
  const relocated = new Set(changes.filter(row => row.status === 'relocated').map(row => row.candidate_path));
  for (const [path, file] of after) {
    if (before.has(path) || relocated.has(path)) continue;
    counts.added++;
    changes.push({ path, status: 'added', candidate: fileFact(file) });
  }
  const inspected = archiveCandidates.slice(0, COMPARISON_LIMITS.max_archive_pairs);
  const formatInputs = inspected.flatMap(({ file, next }, index) => [
    { ...file, path: `reference/${index}` },
    { ...next, path: `candidate/${index}` },
  ]);
  const formats = new Map(inventoryFormats(formatInputs.filter(zipCandidate), { maxMembers: COMPARISON_LIMITS.max_members_per_archive }).map(row => [row.path, row]));
  const archives = inspected.map(({ path }, index) => compareArchive(path, formats.get(`reference/${index}`), formats.get(`candidate/${index}`)));
  const result = {
    schema_version: 1,
    kind: 'artifact-comparison',
    status: changes.length ? 'different' : 'same-admitted-bytes',
    authority: 'bounded-static',
    reference: describe(reference),
    candidate: describe(candidate),
    scope: { include: reference.scope.include, exclude: reference.scope.exclude, policy_sha256: reference.scope.policy_sha256 },
    counts,
    changes: changes.sort(byPath),
    archives,
    coverage: { both_snapshots_unfiltered: !reference.scope.omitted.length && !candidate.scope.omitted.length, archive_pairs: archiveCandidates.length, archive_pairs_inspected: inspected.length, archive_pairs_with_complete_content: archives.filter(row => row.status !== 'partial').length },
  };
  return { ...result, receipt_sha256: digest(result) };
}
