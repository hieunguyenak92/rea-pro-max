import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { RpmError } from '../common.mjs';
import { DEFAULT_LIMITS, decodeText, inventory } from './inventory.mjs';

function contained(root, path) {
  const name = relative(root, path);
  return name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name);
}

/** Re-read an inspected source range only after checking its current content hash. */
export async function readEvidenceSource(inspection, evidenceId, { maxChars = 4000 } = {}) {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 16000) throw new RpmError('source_bounds', 'Source excerpts require maxChars from1 to16000.');
  if (!inspection?.artifact || !Array.isArray(inspection.evidence) || typeof evidenceId !== 'string') throw new RpmError('invalid_evidence', 'Select an inspection and its evidence ID.');
  const evidence = inspection.evidence.find(item => item.id === evidenceId);
  if (!evidence) throw new RpmError('unknown_evidence', 'The selected inspection has no such evidence ID.');
  if (typeof evidence.file !== 'string' || !evidence.file || evidence.file.includes('\\') || evidence.file.includes('\0') || evidence.file.startsWith('/') || /^[a-z]:/iu.test(evidence.file) || evidence.file.split('/').some(part => !part || part === '.' || part === '..')) throw new RpmError('invalid_evidence', 'Evidence source paths must stay inside the inspected artifact.');
  if (evidence.range_unit !== 'utf16-code-unit' || !Number.isSafeInteger(evidence.start) || !Number.isSafeInteger(evidence.end) || evidence.start < 0 || evidence.end < evidence.start || !/^[a-f0-9]{64}$/iu.test(evidence.sha256)) throw new RpmError('invalid_evidence', 'Evidence must contain a supported source range and content digest.');
  const selected = inspection.artifact.path;
  if (typeof selected !== 'string' || !isAbsolute(selected)) throw new RpmError('invalid_evidence', 'Inspection artifact path must be absolute.');
  const before = await lstat(selected);
  if (before.isSymbolicLink() || !before.isFile() && !before.isDirectory()) throw new RpmError('source_changed', 'The inspected artifact is no longer a regular source.');
  const selectedPath = await realpath(selected); const after = await lstat(selectedPath);
  if (selectedPath !== resolve(selected) || before.dev !== after.dev || before.ino !== after.ino || before.isDirectory() !== after.isDirectory() || before.isFile() !== after.isFile()) throw new RpmError('source_changed', 'The inspected artifact changed identity or canonical location.');
  const root = before.isDirectory() ? selectedPath : dirname(selectedPath);
  const path = resolve(root, evidence.file);
  if (!contained(root, path) || before.isFile() && path !== selectedPath) throw new RpmError('invalid_evidence', 'Evidence does not belong to the inspected artifact.');
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new RpmError('symlink_input', 'Source symlink components are not followed.');
  }
  const maxFileBytes = inspection.limits?.max_file_bytes ?? DEFAULT_LIMITS.maxFileBytes;
  const source = await inventory(path, { maxFileBytes });
  const file = source.entries[0];
  if (file.sha256.toLowerCase() !== evidence.sha256.toLowerCase()) throw new RpmError('source_changed', 'Source content no longer matches the inspected evidence. Inspect the artifact again.');
  const text = decodeText(file);
  if (evidence.end > text.length) throw new RpmError('invalid_evidence', 'Evidence range exceeds the inspected source.');
  const end = Math.min(evidence.end, evidence.start + maxChars);
  return { evidence_id: evidence.id, file: evidence.file, sha256: file.sha256, line: evidence.line, column: evidence.column, range_unit: 'utf16-code-unit', start: evidence.start, end, requested_end: evidence.end, truncated: end < evidence.end, source: text.slice(evidence.start, end), scope: 'Current source bytes matching the inspected evidence hash; static source is not runtime execution proof.' };
}
