import * as zlib from 'node:zlib';
import { hashBytes } from '../common.mjs';

// ZIP APPNOTE sections 4.3 and 4.4 (PKWARE 6.3.10). Offsets below refer to
// records in the admitted Buffer. Member paths are evidence labels only.
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const DESCRIPTOR = 0x08074b50;
const ZIP64_LOCATOR = 0x07064b50;
const MAX_CENTRAL_RECORDS = 16_384;
const MAX_NAME_BYTES = 1024;
const MAX_MEMBER_BYTES = 4 * 1024 * 1024;
const MAX_ARCHIVE_OUTPUT_BYTES = 16 * 1024 * 1024;
const ZSTD_WINDOW_LOG_MAX = 22;
const MAX_ZSTD_BLOCKS = 4096;
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value;
});

export function zipVerificationBudget() {
  return { centralRecords: 32_768, listings: 4096, compressedBytes: 32 * 1024 * 1024, outputBytes: 32 * 1024 * 1024 };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parseEndRecord(bytes) {
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  let match;
  let reason = 'zip_central_directory_missing';
  for (let offset = bytes.length - 22; offset >= earliest; offset--) {
    if (bytes.readUInt32LE(offset) !== EOCD || offset + 22 + bytes.readUInt16LE(offset + 20) !== bytes.length) continue;
    const disk = bytes.readUInt16LE(offset + 4);
    const centralDisk = bytes.readUInt16LE(offset + 6);
    const diskEntries = bytes.readUInt16LE(offset + 8);
    const entries = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 12);
    const start = bytes.readUInt32LE(offset + 16);
    const locator = offset >= 20 && bytes.readUInt32LE(offset - 20) === ZIP64_LOCATOR;
    if (diskEntries === 0xffff || entries === 0xffff || [start, size].includes(0xffffffff) || (locator && start + size < offset)) {
      reason = 'zip64_unsupported';
      continue;
    }
    if (start + size !== offset || entries * 46 > size || (entries === 0 && (size !== 0 || start !== 0))) {
      reason = 'zip_central_directory_bounds';
      continue;
    }
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entries) {
      reason = 'zip_multidisk_unsupported';
      continue;
    }
    if (match) return { error: 'zip_end_record_ambiguous' };
    match = { start, end: offset, entries };
  }
  return match ?? { error: reason };
}

function memberName(rawName, flags) {
  if (!rawName.length || rawName.length > MAX_NAME_BYTES) return { name: null, error: 'zip_member_name_bounds' };
  if (!(flags & 0x0800) && rawName.some(byte => byte > 0x7f)) return { name: null, error: 'zip_member_name_encoding' };
  let name;
  try { name = UTF8.decode(rawName); }
  catch { return { name: null, error: 'zip_member_name_encoding' }; }
  const path = name.endsWith('/') ? name.slice(0, -1) : name;
  if (/[\\:\u0000-\u001f\u007f]/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    return { name, error: 'zip_member_unsafe_path' };
  }
  return { name, identity: path.normalize('NFC') };
}

function centralMember(bytes, cursor, end) {
  if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== CENTRAL) return null;
  const nameLength = bytes.readUInt16LE(cursor + 28);
  const next = cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  if (next > end) return null;
  const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
  const flags = bytes.readUInt16LE(cursor + 8);
  const { name, identity, error } = memberName(rawName, flags);
  const creator = bytes[cursor + 5];
  const attributes = bytes.readUInt32LE(cursor + 38);
  const unixType = creator === 3 || creator === 19 ? (attributes >>> 16) & 0xf000 : 0;
  const directory = unixType === 0x4000 || (attributes & 0x10) !== 0 || name?.endsWith('/');
  const kind = unixType === 0xa000 ? 'symlink' : ![0, 0x8000, 0x4000].includes(unixType) ? 'special' : directory ? 'directory' : 'file';
  return {
    next, rawName, name, identity, kind, error, flags,
    disk: bytes.readUInt16LE(cursor + 34), method: bytes.readUInt16LE(cursor + 10), crc: bytes.readUInt32LE(cursor + 16),
    compressed: bytes.readUInt32LE(cursor + 20), size: bytes.readUInt32LE(cursor + 24), offset: bytes.readUInt32LE(cursor + 42),
  };
}

function matchingDescriptor(bytes, offset, upper, member) {
  const candidates = [offset];
  if (offset + 4 <= upper && bytes.readUInt32LE(offset) === DESCRIPTOR) candidates.push(offset + 4);
  const matches = candidates.filter(start => start + 12 <= upper && bytes.readUInt32LE(start) === member.crc
    && bytes.readUInt32LE(start + 4) === member.compressed && bytes.readUInt32LE(start + 8) === member.size);
  return matches.length === 1 ? matches[0] + 12 : null;
}

function localRecord(bytes, centralStart, member) {
  const { offset, flags, method, crc, compressed, size } = member;
  const failure = (error, end = offset < centralStart ? offset + 1 : offset) => ({ error, end });
  if (member.disk === 0xffff || [offset, compressed, size].includes(0xffffffff)) return failure('zip64_unsupported');
  if (member.disk !== 0) return failure('zip_multidisk_unsupported');
  if (offset + 30 > centralStart || bytes.readUInt32LE(offset) !== LOCAL) return failure('zip_local_header_bounds');
  const startName = offset + 30;
  const endName = startName + bytes.readUInt16LE(offset + 26);
  const data = endName + bytes.readUInt16LE(offset + 28);
  const end = data + compressed;
  if (end > centralStart) return failure('zip_local_content_bounds', centralStart);
  if (!bytes.subarray(startName, endName).equals(member.rawName) || bytes.readUInt16LE(offset + 6) !== flags
    || bytes.readUInt16LE(offset + 8) !== method) return failure('zip_local_central_mismatch', end);
  const values = [bytes.readUInt32LE(offset + 14), bytes.readUInt32LE(offset + 18), bytes.readUInt32LE(offset + 22)];
  if (values.slice(1).includes(0xffffffff)) return failure('zip64_unsupported', end);
  const expected = [crc, compressed, size];
  const descriptor = (flags & 0x08) !== 0;
  if (values.some((value, index) => value !== expected[index] && !(descriptor && value === 0))) return failure('zip_local_central_mismatch', end);
  const recordEnd = descriptor ? matchingDescriptor(bytes, end, centralStart, member) : end;
  if (recordEnd === null) return failure('zip_descriptor_invalid', end);
  return { data, end: recordEnd };
}

function markAmbiguities(members, centralStart) {
  const byIdentity = new Map();
  for (const member of members) {
    if (member.identity === undefined) continue;
    const existing = byIdentity.get(member.identity);
    if (existing) existing.duplicate = member.duplicate = true;
    else byIdentity.set(member.identity, member);
  }
  const byOffset = members.filter(member => member.offset < centralStart).sort((a, b) => a.offset - b.offset);
  let farthest;
  for (const member of byOffset) {
    if (farthest && member.offset < farthest.local.end) farthest.overlap = member.overlap = true;
    if (!farthest || member.local.end > farthest.local.end) farthest = member;
  }
}

function zstdFrameError(bytes, expectedSize) {
  // RFC 8878 section 3.1. Node can return completed output from a frame
  // whose trailing checksum is cut short. Admit exactly one whole frame.
  if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfd2fb528) return 'zip_member_stream_invalid';
  const flags = bytes[4];
  if (flags & 0x08) return 'zip_member_stream_invalid';
  if (flags & 0x03) return 'zip_member_zstd_dictionary_unsupported';
  const singleSegment = (flags & 0x20) !== 0;
  const sizeBytes = [Number(singleSegment), 2, 4, 8][flags >>> 6];
  let offset = singleSegment ? 5 : 6;
  if (offset + sizeBytes > bytes.length) return 'zip_member_stream_invalid';
  if (!singleSegment) {
    const windowDescriptor = bytes[5];
    const base = 2 ** (10 + (windowDescriptor >>> 3));
    const window = base + (base / 8) * (windowDescriptor & 7);
    if (window > 2 ** ZSTD_WINDOW_LOG_MAX) return 'zip_member_zstd_window_limit';
  }
  if (sizeBytes) {
    const contentSize = sizeBytes === 8 ? bytes.readBigUInt64LE(offset)
      : BigInt(bytes.readUIntLE(offset, sizeBytes) + (sizeBytes === 2 ? 256 : 0));
    if (contentSize !== BigInt(expectedSize)) return 'zip_member_size_mismatch';
  }
  offset += sizeBytes;
  for (let index = 0; index < MAX_ZSTD_BLOCKS; index++) {
    if (offset + 3 > bytes.length) return 'zip_member_stream_invalid';
    const header = bytes.readUIntLE(offset, 3);
    const type = (header >>> 1) & 3;
    if (type === 3) return 'zip_member_stream_invalid';
    offset += 3 + (type === 1 ? 1 : header >>> 3);
    if (header & 1) return offset + ((flags & 4) ? 4 : 0) === bytes.length ? null : 'zip_member_stream_invalid';
  }
  return 'zip_member_zstd_block_limit';
}

function content(bytes, member, budget, archiveBudget) {
  if (member.overlap) return { status: 'zip_member_overlap' };
  if (member.duplicate) return { status: 'zip_member_duplicate' };
  if (member.error || member.local.error) return { status: member.error ?? member.local.error };
  if (member.kind === 'symlink' || member.kind === 'special') return { status: 'zip_member_special_file' };
  if (member.flags & 0x2041) return { status: 'zip_member_encrypted' };
  if (![0, 8, 93].includes(member.method)) return { status: 'zip_member_codec_unsupported' };
  if (member.method === 93 && typeof zlib.zstdDecompressSync !== 'function') return { status: 'zip_member_codec_unavailable' };
  const supportedFlags = member.method === 8 ? 0x080e : 0x0808;
  if ((member.flags & ~supportedFlags) !== 0) return { status: 'zip_member_flags_unsupported' };
  if (member.kind === 'directory' && member.size !== 0) return { status: 'zip_directory_content_invalid' };
  if (member.method === 0 && member.compressed !== member.size) return { status: 'zip_member_size_mismatch' };
  if (member.size > MAX_MEMBER_BYTES || member.compressed > 2 * MAX_MEMBER_BYTES) return { status: 'zip_member_content_limit' };
  if (member.size > Math.min(budget.outputBytes, archiveBudget.outputBytes) || member.compressed > budget.compressedBytes) {
    return { status: 'zip_content_budget' };
  }
  // Charge declared work before decoding so failed members still consume budget.
  budget.compressedBytes -= member.compressed;
  budget.outputBytes -= member.size;
  archiveBudget.outputBytes -= member.size;
  const stored = bytes.subarray(member.local.data, member.local.data + member.compressed);
  let raw = stored;
  if (member.method !== 0) {
    const options = { info: true, maxOutputLength: Math.max(1, member.size) };
    if (member.method === 93) {
      const frameError = zstdFrameError(stored, member.size);
      if (frameError) return { status: frameError };
      options.params = { [zlib.constants.ZSTD_d_windowLogMax]: ZSTD_WINDOW_LOG_MAX };
    }
    try {
      const decoded = member.method === 8 ? zlib.inflateRawSync(stored, options) : zlib.zstdDecompressSync(stored, options);
      if (decoded.engine.bytesWritten !== stored.length) return { status: 'zip_member_stream_invalid' };
      raw = decoded.buffer;
    } catch { return { status: 'zip_member_stream_invalid' }; }
  }
  if (raw.length !== member.size) return { status: 'zip_member_size_mismatch' };
  if (crc32(raw) !== member.crc) return { status: 'zip_member_crc_mismatch' };
  return member.kind === 'directory' ? { status: 'directory' } : { status: 'verified', sha256: hashBytes(raw), raw };
}

function classify(members) {
  const names = new Set(members.filter(member => member.identity && !member.overlap && !member.duplicate
    && !member.local.error && member.kind === 'file').map(member => member.name));
  const hasApkManifest = names.has('AndroidManifest.xml');
  const hasBundleManifest = names.has('BundleConfig.pb') && names.has('base/manifest/AndroidManifest.xml');
  const hasDex = [...names].some(name => /^classes(?:[2-9]|[1-9][0-9]+)?\.dex$/u.test(name));
  let format = 'zip-container';
  if (hasApkManifest) format = 'apk-container';
  else if (hasBundleManifest) format = 'android-bundle-container';
  else if (hasDex) format = 'android-package-container';
  else if (names.has('AppxManifest.xml') && names.has('[Content_Types].xml')) format = 'appx-package-container';
  else if ([...names].some(name => /^Payload\/[^/]+\.app\/Info\.plist$/u.test(name))) format = 'ipa-container';
  else if (names.has('META-INF/MANIFEST.MF')) format = 'jar-container';
  return { format, hasManifest: hasApkManifest || hasBundleManifest, hasDex };
}

function result({ format = 'zip-container', directory, entries = null, members = [], hasManifest = null, hasDex = null, unknowns = [] }) {
  const statusCounts = {};
  for (const member of members) statusCounts[member.content_status] = (statusCounts[member.content_status] ?? 0) + 1;
  const verified = statusCounts.verified ?? 0;
  const directories = statusCounts.directory ?? 0;
  for (const [code, count] of Object.entries(statusCounts)) {
    if (code.startsWith('zip')) unknowns.push({ code, detail: `${count} listed ZIP member(s) have content status ${code}.` });
  }
  return {
    format,
    confidence: directory === 'complete' ? 'signature+central-directory' : 'signature',
    metadata: {
      member_count: entries, listed_members: members, has_manifest: hasManifest, has_dex: hasDex,
      coverage: { central_directory: directory, listed_members: members.length, verified_files: verified, verified_directories: directories,
        content_complete: directory === 'complete' && verified + directories === entries, content_status_counts: statusCounts },
    },
    unknowns,
  };
}

const directoryErrors = {
  zip_central_directory_missing: 'No complete ZIP end record was found within the allowed comment window.',
  zip_central_directory_bounds: 'The declared ZIP central directory does not fit the end record.',
  zip_end_record_ambiguous: 'Multiple end records fit the archive. No central directory was selected.',
  zip64_unsupported: 'ZIP64 central directories and member records are unsupported.',
  zip_multidisk_unsupported: 'Split and multi-disk ZIP archives are unsupported.',
  zip_central_record_limit: 'The central directory exceeds the bounded ZIP record budget.',
  zip_central_directory_invalid: 'The declared ZIP central record count or member bounds do not match the directory.',
};

function directoryFailure(code, directory, entries) {
  return result({ directory, entries, unknowns: [{ code, detail: directoryErrors[code] }] });
}

// The optional internal visitor sees a read-only view of a regular file after CRC and size validation.
export function inspectZip(bytes, maxMembers, budget = zipVerificationBudget(), onVerifiedFile) {
  if (bytes.length < 4) return null;
  const signature = bytes.readUInt32LE(0);
  if (signature === DESCRIPTOR) return directoryFailure('zip_multidisk_unsupported', 'unsupported');
  if (signature !== LOCAL && signature !== EOCD) return null;
  const end = parseEndRecord(bytes);
  if (end.error) return directoryFailure(end.error, end.error.endsWith('_unsupported') ? 'unsupported' : 'invalid');
  if (end.entries > Math.min(MAX_CENTRAL_RECORDS, budget.centralRecords)) return directoryFailure('zip_central_record_limit', 'limited', end.entries);
  budget.centralRecords -= end.entries;
  const members = [];
  let cursor = end.start;
  for (let index = 0; index < end.entries; index++) {
    const member = centralMember(bytes, cursor, end.end);
    if (!member) return directoryFailure('zip_central_directory_invalid', 'invalid', end.entries);
    members.push(member);
    cursor = member.next;
  }
  if (cursor !== end.end) return directoryFailure('zip_central_directory_invalid', 'invalid', end.entries);
  for (const member of members) member.local = localRecord(bytes, end.start, member);
  markAmbiguities(members, end.start);
  const { format, hasManifest, hasDex } = classify(members);
  const archiveBudget = { outputBytes: MAX_ARCHIVE_OUTPUT_BYTES };
  const listingLimit = Math.min(maxMembers, budget.listings);
  const listed = members.slice(0, listingLimit).map(member => {
    const verified = content(bytes, member, budget, archiveBudget);
    if (verified.status === 'verified') onVerifiedFile?.(member.name, verified.raw);
    return {
      name: member.name, ...(member.name === null ? { name_bytes_sha256: hashBytes(member.rawName) } : {}),
      compressed_bytes: member.compressed, uncompressed_bytes: member.size, compression_method: member.method,
      crc32: member.crc.toString(16).padStart(8, '0'), kind: member.kind, content_status: verified.status,
      content_sha256: verified.sha256 ?? null,
    };
  });
  budget.listings -= listed.length;
  const unknowns = [];
  if (end.entries > listingLimit) {
    const code = listingLimit < maxMembers ? 'zip_listing_budget' : 'zip_member_limit';
    unknowns.push({ code, detail: `Only ${listed.length} of ${end.entries} members are listed and eligible for content verification.` });
  }
  return result({ format, directory: 'complete', entries: end.entries, members: listed, hasManifest, hasDex, unknowns });
}
