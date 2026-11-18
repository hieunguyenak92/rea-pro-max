import { createHash } from 'node:crypto';
import { hashBytes, RpmError } from '../common.mjs';

const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_HEX_RECORDS = 65_536;
const MAX_ROWS = 256;
const UF2_BLOCK_SIZE = 512;
const UF2_MAGIC_START = 0x0a324655;
const UF2_MAGIC_NEXT = 0x9e5d5157;
const UF2_MAGIC_END = 0x0ab16f30;
const UF2_NO_FLASH = 0x0001;
const UF2_FAMILY_ID = 0x2000;
const UF2_PAYLOAD_SIZE = 476;
const ADDRESS_LIMIT = 0x1_0000_0000;

function issue(issues, code, detail) {
  if (!issues.has(code)) issues.set(code, { code, detail });
}

function result(format, status, metadata, issues) {
  return {
    format,
    confidence: status === 'validated' ? 'validated-records' : 'record-signature',
    metadata: { ...metadata, integrity: status },
    unknowns: [...issues.values()],
  };
}

function hexDataRegions(records) {
  const sorted = records.sort((a, b) => a.start - b.start || a.data.length - b.data.length || Buffer.compare(a.data, b.data));
  const regions = [];
  let duplicates = 0;
  let byteCount = 0;
  let overlaps = 0;
  let regionCount = 0;
  let current;
  let previous;

  function retainRegion() {
    if (!current) return;
    regionCount++;
    if (current.hash) regions.push({ load_address: current.start, byte_count: current.end - current.start, sha256: current.hash.digest('hex') });
  }

  for (const item of sorted) {
    if (previous?.start === item.start && previous.data.equals(item.data)) {
      duplicates++;
      continue;
    }
    const end = item.start + item.data.length;
    if (current && item.start < current.end) {
      overlaps++;
      current.end = Math.max(current.end, end);
      previous = item;
      continue;
    }
    if (!current || item.start > current.end) {
      retainRegion();
      current = { start: item.start, end: item.start, hash: regions.length < MAX_ROWS ? createHash('sha256') : null };
    }
    current.hash?.update(item.data);
    current.end = end;
    previous = item;
    byteCount += item.data.length;
  }
  retainRegion();
  if (overlaps) return { duplicates, overlaps, byteCount: null, regionCount: null, regions: [] };
  return { duplicates, overlaps, byteCount, regionCount, regions };
}

function inspectIntelHex(bytes) {
  const issues = new Map();
  const records = [];
  const recordTypes = new Set();
  let offset = 0;
  let lineNumber = 0;
  let recordCount = 0;
  let base = 0;
  let eof = false;
  let integrity = 'validated';

  function stop(code, detail, status = 'invalid') {
    issue(issues, code, detail);
    integrity = status;
  }

  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset);
    const end = newline === -1 ? bytes.length : newline;
    const lineEnd = bytes[end - 1] === 0x0d ? end - 1 : end;
    lineNumber++;
    const length = lineEnd - offset;
    if (length > 0 && recordCount >= MAX_HEX_RECORDS) {
      stop('ihex_record_limit', 'The record inspection limit was reached before the end of the file.', 'unknown');
      break;
    }
    const lineStart = offset;
    offset = newline === -1 ? end : end + 1;
    if (length === 0) continue;
    recordCount++;
    if (eof) {
      stop('ihex_after_eof', `Line ${lineNumber} contains data after the EOF record.`);
      break;
    }
    if (bytes[lineStart] !== 0x3a) {
      stop('ihex_non_record_line', `Line ${lineNumber} uses a non-record line outside the canonical HEX subset.`, 'unknown');
      break;
    }
    if (length < 11 || length > 521 || length % 2 === 0 || !/^:[0-9a-f]+$/iu.test(bytes.toString('latin1', lineStart, lineEnd))) {
      stop('ihex_record_syntax', `Line ${lineNumber} is outside the supported Intel HEX record syntax.`);
      break;
    }
    const record = Buffer.from(bytes.toString('latin1', lineStart + 1, lineEnd), 'hex');
    const size = record[0];
    if (record.length !== size + 5) {
      stop('ihex_byte_count', `Line ${lineNumber} does not contain its declared number of data bytes.`);
      break;
    }
    if (record.reduce((sum, byte) => (sum + byte) & 0xff, 0) !== 0) {
      stop('ihex_checksum', `Line ${lineNumber} failed its record checksum.`);
      break;
    }
    const start = record.readUInt16BE(1);
    const type = record[3];
    if (type > 5) {
      stop('ihex_record_type', `Line ${lineNumber} uses an unsupported record type. Later addresses were omitted.`, 'unknown');
      break;
    }
    const expectedSize = [null, 0, 2, 4, 2, 4][type];
    if (type === 0 ? size === 0 : size !== expectedSize || start !== 0) {
      stop('ihex_record_shape', `Line ${lineNumber} has an invalid record length or address field.`);
      break;
    }
    recordTypes.add(type);
    if (type === 0) {
      if (start + size > 0x1_0000 || base + start + size > ADDRESS_LIMIT) {
        stop('ihex_wrapped_range', `Line ${lineNumber} crosses an addressing boundary outside the non-wrapping inventory.`, 'unknown');
        break;
      }
      records.push({ start: base + start, data: record.subarray(4, 4 + size) });
    } else if (type === 1) {
      eof = true;
    } else if (type === 2 || type === 4) {
      base = record.readUInt16BE(4) * (type === 2 ? 16 : 65_536);
    }
  }
  if (integrity === 'validated' && !eof) stop('ihex_eof_missing', 'No valid EOF record was found.', 'incomplete');
  const inventory = hexDataRegions(records);
  if (inventory.overlaps) stop('ihex_data_overlap', 'Nonidentical data records overlap. Region identities were omitted.');
  if (inventory.duplicates) issue(issues, 'ihex_duplicate_records', 'Identical repeated data records were counted once in the region inventory.');
  const omitted = inventory.regionCount === null ? null : inventory.regionCount - inventory.regions.length;
  if (omitted > 0) issue(issues, 'ihex_region_limit', 'Additional validated regions were counted without retaining their identities.');
  return result('intel-hex', integrity, {
    record_count: recordCount,
    record_types: [...recordTypes].sort((a, b) => a - b),
    data_record_count: records.length,
    duplicate_data_records: inventory.duplicates,
    overlapping_data_records: inventory.overlaps,
    eof_record_found: eof,
    unexamined_bytes: bytes.length - offset,
    region_count: inventory.regionCount,
    payload_byte_count: inventory.byteCount,
    omitted_region_identities: omitted,
    regions: inventory.regions,
  }, issues);
}

function inspectUf2(bytes) {
  const issues = new Map();
  const blocks = new Map();
  const conflicts = new Set();
  const blockCount = Math.floor(bytes.length / UF2_BLOCK_SIZE);
  const trailing = bytes.length % UF2_BLOCK_SIZE;
  let familyId;
  let declaredCount;
  let duplicateCount = 0;
  let omittedCount = 0;
  let addressCount = 0;
  let malformed = false;
  let unsupported = false;

  function omit(code, detail, invalid = true) {
    issue(issues, code, detail);
    omittedCount++;
    if (invalid) malformed = true;
    else unsupported = true;
  }

  for (let index = 0; index < blockCount; index++) {
    const block = bytes.subarray(index * UF2_BLOCK_SIZE, (index + 1) * UF2_BLOCK_SIZE);
    if (block.readUInt32LE(0) !== UF2_MAGIC_START || block.readUInt32LE(4) !== UF2_MAGIC_NEXT || block.readUInt32LE(508) !== UF2_MAGIC_END) {
      omit('uf2_block_magic', `Physical block ${index} failed its start or end magic.`);
      continue;
    }
    const flags = block.readUInt32LE(8);
    const target = block.readUInt32LE(12);
    const size = block.readUInt32LE(16);
    const number = block.readUInt32LE(20);
    const count = block.readUInt32LE(24);
    const family = flags & UF2_FAMILY_ID ? block.readUInt32LE(28) : null;
    const flash = !(flags & UF2_NO_FLASH);
    if (size > UF2_PAYLOAD_SIZE || count === 0 || number >= count) {
      omit('uf2_block_bounds', `Physical block ${index} has an invalid payload size or sequence fields.`);
      continue;
    }
    if ((flags & ~(UF2_NO_FLASH | UF2_FAMILY_ID)) !== 0 || (family === null && block.readUInt32LE(28) !== 0)) {
      omit('uf2_unsupported_variant', `Physical block ${index} declares flags or reserved fields outside basic UF2.`, false);
      continue;
    }
    if (block.subarray(32 + size, 508).some(byte => byte !== 0)) {
      omit('uf2_block_padding', `Physical block ${index} has nonzero padding outside the declared payload.`);
      continue;
    }
    if (flash && (size === 0 || size % 4 !== 0 || target % 4 !== 0 || target + size > ADDRESS_LIMIT)) {
      omit('uf2_flash_range', `Physical block ${index} has a zero, unaligned, or overflowing flash range.`);
      continue;
    }
    if (familyId === undefined) familyId = family;
    if (familyId !== family) {
      omit('uf2_mixed_families', `Physical block ${index} belongs to a different family sequence. Only the initial family is inventoried.`, false);
      continue;
    }
    if (declaredCount === undefined) declaredCount = count;
    if (declaredCount !== count) {
      omit('uf2_inconsistent_block_count', `Physical block ${index} declares a different sequence length.`);
      continue;
    }
    const previous = blocks.get(number);
    if (conflicts.has(number) || (previous && !previous.block.equals(block))) {
      conflicts.add(number);
      blocks.delete(number);
      omit('uf2_conflicting_index', `Block number ${number} occurs with different bytes. Its identity was omitted.`);
    } else if (previous) {
      duplicateCount++;
    } else {
      blocks.set(number, { block, number, size, physicalIndex: index, loadAddress: flash ? target : null });
    }
  }

  const flash = [...blocks.values()].filter(block => block.loadAddress !== null).sort((a, b) => a.loadAddress - b.loadAddress);
  let lastEnd = 0;
  for (const block of flash) {
    if (block.loadAddress < lastEnd) addressCount++;
    lastEnd = Math.max(lastEnd, block.loadAddress + block.size);
  }
  if (addressCount) {
    malformed = true;
    issue(issues, 'uf2_flash_overlap', 'Distinct block indices declare overlapping flash ranges. Block identities do not describe a unique image.');
  }
  if (trailing) issue(issues, 'uf2_trailing_bytes', 'The file ends with a partial 512-byte block.');
  const missing = declaredCount !== undefined && omittedCount === 0 && trailing === 0 ? declaredCount - blocks.size : null;
  if (missing > 0) issue(issues, 'uf2_missing_blocks', 'Declared sequence indices are absent from the saved blocks.');
  if (blocks.size > MAX_ROWS) issue(issues, 'uf2_block_limit', 'Additional validated block identities were counted without retaining their rows.');
  const rows = [...blocks.values()].sort((a, b) => a.number - b.number).slice(0, MAX_ROWS).map(entry => ({
    block_number: entry.number,
    physical_index: entry.physicalIndex,
    load_address: entry.loadAddress,
    payload_byte_count: entry.size,
    payload_sha256: hashBytes(entry.block.subarray(32, 32 + entry.size)),
  }));
  const integrity = malformed ? 'invalid' : unsupported ? 'unknown' : trailing || missing > 0 ? 'incomplete' : 'validated';
  return result('uf2', integrity, {
    physical_block_count: blockCount,
    declared_block_count: declaredCount ?? null,
    family_id: familyId ?? null,
    unique_block_count: blocks.size,
    duplicate_block_count: duplicateCount,
    conflicting_index_count: conflicts.size,
    overlapping_flash_block_count: addressCount,
    missing_block_count: missing,
    omitted_physical_blocks: omittedCount,
    omitted_block_identities: blocks.size - rows.length,
    trailing_bytes: trailing,
    blocks: rows,
  }, issues);
}

/** Validate and hash the byte carriers locally. The hashes identify bytes and cannot authenticate a firmware producer. */
export function inspectFirmware(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new RpmError('format_input', 'Firmware inspection requires admitted bytes.');
  if (bytes.length > MAX_INPUT_BYTES) throw new RpmError('format_bounds', 'Firmware inspection is limited to 16 MiB per file.');
  if (bytes.length >= 8 && bytes.readUInt32LE(0) === UF2_MAGIC_START && bytes.readUInt32LE(4) === UF2_MAGIC_NEXT) return inspectUf2(bytes);
  if (bytes[0] === 0x3a && /^:[0-9a-f]{8}$/iu.test(bytes.toString('latin1', 0, 9))) return inspectIntelHex(bytes);
  return null;
}
