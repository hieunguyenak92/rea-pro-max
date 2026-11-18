import { RpmError } from '../common.mjs';
import { inspectZip, zipVerificationBudget } from './zip.mjs';
import { inspectFirmware } from './firmware.mjs';
import { parseDeploymentTargets } from './deployment-targets.mjs';

// This module records bounded static facts. It never executes a target or
// treats a signature as semantic support. Keep `unknowns` visible to users.
const text = bytes => new TextDecoder('utf-8', { fatal: false }).decode(bytes);
const u16le = (b, o) => o + 2 <= b.length ? b.readUInt16LE(o) : null;
const u16be = (b, o) => o + 2 <= b.length ? b.readUInt16BE(o) : null;
const u32le = (b, o) => o + 4 <= b.length ? b.readUInt32LE(o) : null;
const u32be = (b, o) => o + 4 <= b.length ? b.readUInt32BE(o) : null;
const boundedString = (value, max = 256) => value.length > max ? `${value.slice(0, max)}…` : value;

function unknown(code, detail) { return { code, detail }; }

function parseElf(bytes) {
  if (bytes.length < 16 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return null;
  const elfClass = bytes[4], endian = bytes[5] === 1 ? 'little' : bytes[5] === 2 ? 'big' : 'unknown';
  const read16 = endian === 'big' ? u16be : u16le;
  const read32 = endian === 'big' ? u32be : u32le;
  if (![1, 2].includes(elfClass) || !['little', 'big'].includes(endian)) return { format: 'elf', confidence: 'signature', metadata: { elf_class: elfClass, endian }, unknowns: [unknown('elf_header_invalid', 'ELF class or byte order is unsupported.')] };
  const is64 = elfClass === 2;
  const readWord = (offset) => {
    if (is64) return endian === 'big' ? (offset + 8 <= bytes.length ? bytes.readBigUInt64BE(offset) : null) : (offset + 8 <= bytes.length ? bytes.readBigUInt64LE(offset) : null);
    const value = read32(bytes, offset); return value === null ? null : BigInt(value);
  };
  const metadata = {
    elf_class: is64 ? 'ELF64' : 'ELF32', endian,
    version: bytes[6] ?? null,
    os_abi: bytes[7] ?? null,
    type: read16(bytes, 16), machine: read16(bytes, 18),
    entry: readWord(24)?.toString() ?? null,
    program_header_offset: readWord(is64 ? 32 : 28)?.toString() ?? null,
    section_header_offset: readWord(is64 ? 40 : 32)?.toString() ?? null,
    program_header_count: read16(bytes, is64 ? 56 : 44),
    section_header_count: read16(bytes, is64 ? 60 : 48),
  };
  const unknowns = [];
  if (metadata.program_header_count === null || metadata.section_header_count === null) unknowns.push(unknown('elf_header_truncated', 'ELF header ended before table counts could be read.'));
  return { format: 'elf', confidence: 'signature+header', metadata, unknowns };
}

function parsePe(bytes) {
  if (bytes.length < 2 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null;
  const peOffset = u32le(bytes, 0x3c);
  const unknowns = [];
  if (peOffset === null || peOffset + 24 > bytes.length || !bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))) return { format: 'pe', confidence: 'dos-signature', metadata: { dos_header: true }, unknowns: [unknown('pe_header_missing', 'MZ signature is present but a bounded PE header was not found.')] };
  const fileHeader = peOffset + 4, optional = fileHeader + 20, optionalMagic = u16le(bytes, optional);
  const sectionCount = u16le(bytes, fileHeader + 2), timestamp = u32le(bytes, fileHeader + 4), characteristics = u16le(bytes, fileHeader + 18);
  const metadata = { pe_offset: peOffset, machine: u16le(bytes, fileHeader), section_count: sectionCount, timestamp, characteristics, optional_magic: optionalMagic, subsystem: optionalMagic === 0x10b || optionalMagic === 0x20b ? u16le(bytes, optional + 68) : null, image_base: optionalMagic === 0x20b ? bytes.length >= optional + 32 ? bytes.readBigUInt64LE(optional + 24).toString() : null : optionalMagic === 0x10b ? u32le(bytes, optional + 28)?.toString() ?? null : null };
  if (optionalMagic !== 0x10b && optionalMagic !== 0x20b) unknowns.push(unknown('pe_optional_header_unknown', 'PE optional-header magic is outside the bounded PE32/PE32+ parser.'));
  return { format: 'pe', confidence: 'signature+header', metadata, unknowns };
}

function parseBuildTarget(bytes) {
  if (bytes.length < 4) return null;
  const magic = bytes.subarray(0, 4).toString('hex');
  const little = ['cefaedfe', 'cffaedfe', 'bebafeca', 'bfbafeca'].includes(magic);
  const big = ['feedface', 'feedfacf', 'cafebabe', 'cafebabf'].includes(magic);
  if (!little && !big) return null;
  const profile = parseDeploymentTargets(bytes);
  const target = { targets: profile.targets, target_coverage: profile.complete ? 'complete' : 'unknown' };
  const unknowns = profile.issues.map(code => unknown(code, 'See target coverage before inferring compatibility.'));
  if (profile.format === 'jvm-class' || profile.format === 'undetermined') {
    return { format: profile.format === 'jvm-class' ? profile.format : 'jvm-or-mach-o-candidate',
      confidence: profile.complete ? 'structure' : 'signature', metadata: { magic, ...target }, unknowns };
  }
  if (['cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic)) {
    const read = magic === 'cafebabe' || magic === 'cafebabf' ? u32be : u32le;
    return { format: 'mach-o-fat', confidence: profile.complete ? 'structure' : 'signature', metadata: { magic, architecture_count: read(bytes, 4), fat_64: ['cafebabf', 'bfbafeca'].includes(magic), ...target }, unknowns };
  }
  const read = big ? u32be : u32le;
  return { format: 'mach-o', confidence: profile.complete ? 'structure' : 'signature', metadata: { magic, cpu_type: read(bytes, 4), cpu_subtype: read(bytes, 8), file_type: read(bytes, 12), load_command_count: read(bytes, 16), load_commands_bytes: read(bytes, 20), flags: read(bytes, 24), '64_bit': magic === 'feedfacf' || magic === 'cffaedfe', byte_order: big ? 'big' : 'little', ...target }, unknowns };
}

function parseWasm(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d]))) return null;
  return { format: 'wasm', confidence: 'signature+header', metadata: { version: u32le(bytes, 4) }, unknowns: [] };
}

function parseGguf(bytes) {
  if (bytes.length < 16 || bytes.subarray(0, 4).toString('ascii') !== 'GGUF') return null;
  return { format: 'gguf', confidence: 'signature+header', metadata: { version: u32le(bytes, 4), tensor_count: bytes.length >= 16 ? bytes.readBigUInt64LE(8).toString() : null, metadata_kv_count: bytes.length >= 24 ? bytes.readBigUInt64LE(16).toString() : null }, unknowns: [] };
}

function parseSafetensors(bytes) {
  if (bytes.length < 8) return null;
  const headerLength = Number(bytes.readBigUInt64LE(0));
  if (!Number.isSafeInteger(headerLength) || headerLength < 2 || headerLength > bytes.length - 8 || headerLength > 2 * 1024 * 1024) return null;
  const headerBytes = bytes.subarray(8, 8 + headerLength);
  let header;
  try { header = JSON.parse(text(headerBytes)); } catch { return null; }
  if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
  const names = Object.keys(header).filter(key => key !== '__metadata__').sort();
  const unknowns = [];
  for (const name of names.slice(0, 512)) {
    const value = header[name];
    if (!value || typeof value !== 'object' || !Array.isArray(value.shape) || !Array.isArray(value.data_offsets)) unknowns.push(unknown('safetensors_entry_invalid', `Tensor metadata for ${boundedString(name)} is incomplete.`));
  }
  if (names.length > 512) unknowns.push(unknown('safetensors_tensor_limit', 'Only the first 512 tensor names are retained.'));
  return { format: 'safetensors', confidence: 'header-json', metadata: { header_bytes: headerLength, tensor_count: names.length, tensor_names: names.slice(0, 512), has_metadata: Object.hasOwn(header, '__metadata__') }, unknowns };
}

function parseTextRecord(bytes) {
  if (bytes[0] !== 0x53) return null;
  const limit = 2 * 1024 * 1024;
  const source = text(bytes.subarray(0, limit));
  const lines = source.split(/\r?\n/u).filter(Boolean);
  if (bytes.length > limit) lines.pop();
  const sample = lines.slice(0, 4096);
  if (sample.length && sample.every(line => /^S[0-9][0-9A-Fa-f]{4,}$/u.test(line))) return { format: 'motorola-s-record', confidence: 'record-signature', metadata: { sampled_record_count: sample.length, record_types: [...new Set(sample.map(line => line[1]))].sort() }, unknowns: [unknown('s_record_unvalidated', 'Only bounded S-record syntax was sampled; counts, checksums and addresses are unvalidated.')] };
  return null;
}

function parseEmbedded(bytes) {
  if (bytes.length >= 64 && u32be(bytes, 0) === 0x27051956) return { format: 'u-boot-uimage', confidence: 'signature+header', metadata: { header_version: 1, timestamp: u32be(bytes, 4), data_size: u32be(bytes, 12), load_address: u32be(bytes, 16), entry_point: u32be(bytes, 20), os: bytes[28], architecture: bytes[29], image_type: bytes[30], compression: bytes[31] }, unknowns: [] };
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === 'DfuSe') return { format: 'dfuse', confidence: 'signature+header', metadata: { version: bytes[5] ?? null, image_size: u32le(bytes, 6) }, unknowns: [] };
  if (bytes.length >= 7 && bytes.subarray(0, 7).toString('ascii') === 'UnityFS') return { format: 'unityfs', confidence: 'signature', metadata: { header: boundedString(text(bytes.subarray(0, Math.min(bytes.length, 256))).split('\0')[0]) }, unknowns: [] };
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'GDPC') return { format: 'godot-pck', confidence: 'signature+header', metadata: { version: u32le(bytes, 4), major: u32le(bytes, 8), minor: u32le(bytes, 12), patch: u32le(bytes, 16) }, unknowns: [unknown('godot_directory_unparsed', 'The pack member table is outside this header parser.')] };
  if (bytes.length >= 16 && bytes.subarray(0, 16).toString('ascii') === 'SQLite format 3\0') return { format: 'sqlite', confidence: 'signature+header', metadata: { page_size: u16be(bytes, 16), write_version: bytes[18], read_version: bytes[19], page_count: u32be(bytes, 28) }, unknowns: [] };
  if (bytes.length >= 8 && bytes.subarray(0, 4).toString('ascii') === 'dex\n') return { format: 'android-dex', confidence: 'signature+header', metadata: { version: bytes.subarray(4, 7).toString('ascii'), file_size: u32le(bytes, 32), header_size: u32le(bytes, 36), endian_tag: u32le(bytes, 40) }, unknowns: [] };
  if (bytes.length >= 8 && bytes.subarray(0, 4).toString('ascii') === 'BSJB') return { format: 'dotnet-metadata', confidence: 'signature+header', metadata: { major_version: u16le(bytes, 4), minor_version: u16le(bytes, 6) }, unknowns: [] };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'FOR1' && bytes.subarray(8, 12).toString('ascii') === 'BEAM') return { format: 'erlang-beam', confidence: 'signature+header', metadata: { form_size: u32be(bytes, 4) }, unknowns: [] };
  if (bytes.length >= 16 && bytes.subarray(0, 4).toString('ascii') === 'NES\x1a') return { format: 'ines', confidence: 'signature+header', metadata: { prg_rom_banks: bytes[4], chr_rom_banks: bytes[5], flags6: bytes[6], flags7: bytes[7] }, unknowns: [] };
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return { format: 'gzip-container', confidence: 'signature', metadata: { compression_method: bytes[2], flags: bytes[3] }, unknowns: [] };
  if (bytes.length >= 512 && bytes.subarray(257, 262).toString('ascii') === 'ustar') return { format: 'tar-container', confidence: 'header', metadata: { ustar_version: bytes.subarray(263, 265).toString('ascii') }, unknowns: [] };
  const pyInstaller = bytes.lastIndexOf(Buffer.from('MEI\x0c\x0b\x0a\x0b\x0e', 'binary'));
  if (pyInstaller >= 0) return { format: 'pyinstaller', confidence: 'trailer-signature', metadata: { trailer_offset: pyInstaller }, unknowns: [] };
  return null;
}

/**
 * Parse bounded static metadata from one admitted file. The returned facts are
 * descriptive only; a caller must not turn them into runtime or semantic
 * equivalence claims.
 */
function inspectWithBudget(bytes, maxMembers, zipBudget) {
  if (!Buffer.isBuffer(bytes)) throw new RpmError('format_input', 'Format inspection requires admitted bytes.');
  if (bytes.length > 16 * 1024 * 1024) throw new RpmError('format_bounds', 'Format inspection is limited to16MiB per file.');
  if (!Number.isSafeInteger(maxMembers) || maxMembers < 1 || maxMembers > 2048) throw new RpmError('format_bounds', 'maxMembers must be a bounded positive integer.');
  const result = parseElf(bytes) || parsePe(bytes) || parseBuildTarget(bytes) || parseWasm(bytes) || inspectZip(bytes, maxMembers, zipBudget) || inspectFirmware(bytes) || parseGguf(bytes) || parseSafetensors(bytes) || parseEmbedded(bytes) || parseTextRecord(bytes);
  if (!result) return null;
  if (result.metadata?.listed_members?.length > maxMembers) result.metadata.listed_members = result.metadata.listed_members.slice(0, maxMembers);
  return { ...result, static_only: true, executed: false };
}

export function inspectFormat(bytes, { maxMembers = 512 } = {}) {
  return inspectWithBudget(bytes, maxMembers, zipVerificationBudget());
}

export function inventoryFormats(entries, options = {}) {
  const results = [];
  const maxFormats = options.maxFormats ?? 256;
  const maxMembers = options.maxMembers ?? 128;
  if (!Number.isSafeInteger(maxFormats) || maxFormats < 1 || maxFormats > 4096 || !Number.isSafeInteger(maxMembers) || maxMembers < 1 || maxMembers > 2048) throw new RpmError('format_bounds', 'Format inventory limits are outside their supported bounds.');
  const zipBudget = zipVerificationBudget();
  for (const file of entries.slice(0, maxFormats)) {
    const inspected = inspectWithBudget(file.bytes, maxMembers, zipBudget);
    if (inspected) results.push({ path: file.path, sha256: file.sha256, size: file.size, ...inspected });
  }
  if (entries.length > maxFormats) results.push({ path: '__format_inventory__', format: 'inventory-truncated', confidence: 'limit', static_only: true, executed: false, metadata: { omitted_files: entries.length - maxFormats }, unknowns: [unknown('format_inventory_limit', `Only the first ${maxFormats} admitted files were format-inspected.`)] });
  return results.sort((a, b) => a.path.localeCompare(b.path));
}
