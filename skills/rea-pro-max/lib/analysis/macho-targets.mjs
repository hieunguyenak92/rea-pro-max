// Declared build targets only. Other load commands are walked by their framing;
// section data, symbols, signatures and executable contents are outside this reader.
const THIN_LAYOUTS = new Map([
  [0xfeedface, [false, false]], [0xcefaedfe, [false, true]],
  [0xfeedfacf, [true, false]], [0xcffaedfe, [true, true]],
]);
const FAT_LAYOUTS = new Map([
  [0xcafebabe, [false, false]], [0xbebafeca, [false, true]],
  [0xcafebabf, [true, false]], [0xbfbafeca, [true, true]],
]);
const ARCHITECTURES = new Map([
  [7, 'i386'], [0x01000007, 'x86_64'], [12, 'arm'], [0x0100000c, 'arm64'],
  [0x0200000c, 'arm64_32'], [18, 'powerpc'], [0x01000012, 'powerpc64'],
]);
const KINDS = [null, 'object', 'executable', 'fvmlib', 'core', 'preload', 'dylib',
  'dylinker', 'bundle', 'dylib-stub', 'dsym', 'kext-bundle', 'fileset', 'gpu-executable', 'gpu-dylib'];
const PLATFORMS = [null, 'macos', 'ios', 'tvos', 'watchos', 'bridgeos', 'maccatalyst',
  'ios-simulator', 'tvos-simulator', 'watchos-simulator', 'driverkit', 'visionos',
  'visionos-simulator', 'firmware', 'sepos', 'macos-exclavecore', 'macos-exclavekit',
  'ios-exclavecore', 'ios-exclavekit', 'tvos-exclavecore', 'tvos-exclavekit',
  'watchos-exclavecore', 'watchos-exclavekit', 'visionos-exclavecore', 'visionos-exclavekit'];
const LEGACY_PLATFORMS = new Map([[0x24, 'macos'], [0x25, 'ios'], [0x2f, 'tvos'], [0x30, 'watchos']]);
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SLICES = 64;
const MAX_COMMANDS = 4096;

class InvalidMach extends Error {}
function invalid(issue) { throw new InvalidMach(issue); }

function read32(bytes, little) {
  return little ? bytes.readUInt32LE.bind(bytes) : bytes.readUInt32BE.bind(bytes);
}

function legacyPlatform(command, architecture) {
  const platform = LEGACY_PLATFORMS.get(command);
  if (platform === 'macos') return platform;
  if (architecture === 'x86_64') return platform + '-simulator';
  if (architecture === 'i386') return platform === 'tvos' ? null : platform + '-simulator';
  if (architecture === 'arm' || architecture === 'arm64' || architecture === 'arm64_32') return platform;
  return null;
}

function thinTarget(data, issues, expected) {
  const magic = data.length >= 4 && data.readUInt32BE(0);
  const layout = THIN_LAYOUTS.get(magic);
  if (!layout) invalid('unrecognized-thin-header');
  const [wide, little] = layout;
  const header = wide ? 32 : 28;
  if (data.length < header) invalid('truncated-mach-header');
  const u32 = read32(data, little);
  if (wide && u32(28) !== 0) issues.add('reserved-mach-field');
  const cpu = u32(4);
  const subtype = u32(8);
  if (expected && (cpu !== expected.cpu || subtype !== expected.subtype)) invalid('fat-slice-identity-mismatch');

  const architecture = ARCHITECTURES.get(cpu);
  if (!architecture) invalid('unknown-mach-architecture');
  // arm64_32 has 64-bit instructions and a 32-bit object format.
  if (wide !== Boolean(cpu & 0x01000000)) invalid('mach-width-mismatch');
  const expectedLittleEndian = !architecture.startsWith('powerpc');
  if (little !== expectedLittleEndian) invalid('mach-endian-mismatch');
  const kind = KINDS[u32(12)];
  if (!kind) invalid('unknown-mach-kind');
  const count = u32(16);
  const size = u32(20);
  if (count > MAX_COMMANDS) invalid('mach-command-limit');
  if (size > data.length - header || count * 8 > size) invalid('invalid-mach-command-table');

  let cursor = header;
  const end = header + size;
  let versionCount = 0;
  let platform = null;
  let minimum = 0;
  for (let index = 0; index < count; index++) {
    if (end - cursor < 8) invalid('truncated-mach-command');
    const command = u32(cursor);
    const length = u32(cursor + 4);
    if (length < 8 || length % (wide ? 8 : 4) || length > end - cursor) invalid('invalid-mach-command-size');
    if (command === 0x32) {
      if (length < 24 || length !== 24 + 8 * u32(cursor + 20)) invalid('invalid-mach-build-version');
      versionCount++;
      platform = PLATFORMS[u32(cursor + 8)] ?? null;
      minimum = u32(cursor + 12);
    } else if (LEGACY_PLATFORMS.has(command)) {
      if (length !== 16) invalid('invalid-mach-version-min');
      versionCount++;
      platform = legacyPlatform(command, architecture);
      minimum = u32(cursor + 8);
    }
    cursor += length;
  }
  if (cursor !== end) invalid('invalid-mach-command-table');
  // Multiple platforms may be valid in a zippered dylib. A single row cannot
  // represent the per-platform declarations without conflating their floors.
  if (versionCount > 1) invalid('multiple-mach-target-declarations');
  if (!versionCount) issues.add('missing-mach-target-declaration');
  else {
    if (!platform) issues.add('unknown-mach-platform');
    if (!minimum) issues.add('unspecified-mach-minimum-os');
  }

  return {
    architecture, variant: '0x' + subtype.toString(16).padStart(8, '0'), kind,
    platform: platform ?? 'unknown',
    minimumOS: minimum ? [minimum >>> 16, (minimum >>> 8) & 255, minimum & 255].join('.') : null,
  };
}

function universalSlices(data, wide, little) {
  if (data.length < 8) invalid('truncated-fat-header');
  const u32 = read32(data, little);
  const u64 = little ? data.readBigUInt64LE.bind(data) : data.readBigUInt64BE.bind(data);
  const count = u32(4);
  if (!count || count > MAX_SLICES) invalid('fat-slice-count');
  const stride = wide ? 32 : 20;
  const headerEnd = 8 + count * stride;
  if (headerEnd > data.length) invalid('truncated-fat-table');

  const slices = [];
  const identities = new Set();
  for (let index = 0; index < count; index++) {
    const cursor = 8 + index * stride;
    const cpu = u32(cursor);
    const subtype = u32(cursor + 4);
    // A fat image selects a slice by CPU type and base subtype, even when
    // the subtype's top byte has distinct capability flags.
    const id = cpu + '/' + (subtype & 0x00ffffff);
    if (identities.has(id)) invalid('duplicate-fat-architecture');
    identities.add(id);
    const offset = wide ? Number(u64(cursor + 8)) : u32(cursor + 8);
    const length = wide ? Number(u64(cursor + 16)) : u32(cursor + 12);
    const alignment = u32(cursor + (wide ? 24 : 16));
    if (wide && u32(cursor + 28) !== 0) invalid('reserved-fat-field');
    // uint64 values too large to represent exactly also exceed data.length.
    if (offset < headerEnd || offset > data.length || !length || length > data.length - offset) invalid('invalid-fat-slice-range');
    if (alignment > 31 || offset % 2 ** alignment) invalid('invalid-fat-alignment');
    slices.push({ cpu, subtype, offset, length });
  }
  slices.sort((a, b) => a.offset - b.offset);
  for (let index = 1; index < count; index++) {
    const previous = slices[index - 1];
    if (previous.offset + previous.length > slices[index].offset) invalid('overlapping-fat-slices');
  }
  return slices;
}

export function parseMachTargets(bytes) {
  const targets = [];
  const issues = new Set();
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4) invalid('truncated-mach-header');
    if (bytes.length > MAX_FILE_BYTES) invalid('mach-file-limit');
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fat = FAT_LAYOUTS.get(data.readUInt32BE(0));
    if (!fat) targets.push(thinTarget(data, issues));
    else {
      // Apple's on-disk universal table is big endian. Preserve readable
      // declarations in a swapped table, with an explicit coverage limit.
      if (fat[1]) issues.add('noncanonical-fat-byte-order');
      for (const slice of universalSlices(data, ...fat)) {
        try { targets.push(thinTarget(data.subarray(slice.offset, slice.offset + slice.length), issues, slice)); }
        catch (error) {
          if (!(error instanceof InvalidMach)) throw error;
          issues.add(error.message);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof InvalidMach)) throw error;
    issues.add(error.message);
  }
  targets.sort((a, b) => {
    const left = a.architecture + '/' + a.variant;
    const right = b.architecture + '/' + b.variant;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return { format: 'mach-o', targets, complete: issues.size === 0, issues: [...issues].sort() };
}
