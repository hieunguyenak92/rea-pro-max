import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMachTargets } from '../skills/rea-pro-max/lib/analysis/macho-targets.mjs';

function words(values, little = true) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => little ? bytes.writeUInt32LE(value, 4 * i) : bytes.writeUInt32BE(value, 4 * i));
  return bytes;
}
const modern = (platform = 1, minimum = 0x000d0102) => [0x32, 24, platform, minimum, 0x001a0000, 0];
function thin({ cpu = 0x0100000c, subtype = 0, wide = true, little = true, kind = 1, commands = [modern()] } = {}) {
  const commandsBytes = commands.map(command => words(command, little));
  const header = [wide ? 0xfeedfacf : 0xfeedface, cpu, subtype, kind, commands.length,
    commandsBytes.reduce((sum, command) => sum + command.length, 0), 0];
  if (wide) header.push(0);
  return Buffer.concat([words(header, little), ...commandsBytes]);
}

function fat(members, wide = false, little = false) {
  const stride = wide ? 32 : 20;
  const table = Buffer.alloc(8 + members.length * stride);
  words([wide ? 0xcafebabf : 0xcafebabe, members.length], little).copy(table);
  let offset = table.length;
  for (const [index, member] of members.entries()) {
    const at = 8 + index * stride;
    const littleInner = [0xfeedface, 0xfeedfacf].includes(member.readUInt32LE(0));
    const read = littleInner ? member.readUInt32LE.bind(member) : member.readUInt32BE.bind(member);
    words([read(4), read(8)], little).copy(table, at);
    if (wide) {
      const put64 = little ? table.writeBigUInt64LE.bind(table) : table.writeBigUInt64BE.bind(table);
      put64(BigInt(offset), at + 8);
      put64(BigInt(member.length), at + 16);
    } else words([offset, member.length], little).copy(table, at + 8);
    offset += member.length;
  }
  return Buffer.concat([table, ...members]);
}

function incomplete(bytes, code) {
  const result = parseMachTargets(bytes);
  assert.equal(result.complete, false);
  assert.ok(result.issues.includes(code), JSON.stringify(result));
  return result.targets;
}

test('a compiler-produced Mach object identifies the iOS simulator from its build command', () => {
  // Apple clang -target arm64-apple-ios16.2-simulator -c -x c (empty source).
  // The independent otool -hvl output identifies ARM64 ALL / OBJECT / IOSSIMULATOR / minos 16.2.
  const artifact = Buffer.from(
    'z/rt/gwAAAEAAAAAAQAAAAQAAAAYAQAAACAAAAAAAAAZAAAAmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAEAAAAAAAAAAAAAAAAAAAcAAAAHAAAAAQAAAAAAAABfX3RleHQAAAAAAAAAAAAAX19URVhUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AQAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAADIAAAAYAAAABwAAAAACEAAAARoAAAAAAAIAAAAYAAAAOAEAAAEAAABIAQAACAAAAAsAAABQAAAAAAAAAAEAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAA4BAAAAAAAAAAAAAABsdG1wMAAA',
    'base64');
  assert.deepEqual(parseMachTargets(artifact), {
    format: 'mach-o', complete: true, issues: [], targets: [{
      architecture: 'arm64', variant: '0x00000000', kind: 'object', platform: 'ios-simulator', minimumOS: '16.2.0',
    }],
  });
});

test('thin headers retain raw CPU capability flags, kind and the three deployment version parts', () => {
  const base = thin({ cpu: 0x01000007, subtype: 0x80000008, kind: 6 });
  assert.deepEqual(parseMachTargets(new Uint8Array(base)).targets[0],
    { architecture: 'x86_64', variant: '0x80000008', kind: 'dylib', platform: 'macos', minimumOS: '13.1.2' });
  const arm = thin({ cpu: 0x0200000c, wide: false, commands: [modern(4)] });
  assert.equal(parseMachTargets(arm).complete, true);
  assert.equal(parseMachTargets(arm).targets[0].architecture, 'arm64_32');
});

test('read old PowerPC build and legacy iOS device/simulator minima in their actual byte order', () => {
  const mac = thin({ cpu: 18, little: false, wide: false, commands: [[0x24, 16, 0x000a0501, 0]] });
  assert.deepEqual(parseMachTargets(mac).targets[0], {
    architecture: 'powerpc', variant: '0x00000000', kind: 'object', platform: 'macos', minimumOS: '10.5.1',
  });
  const tvos = [[0x2f, 16, 0x00090000, 0]];
  assert.equal(parseMachTargets(thin({ cpu: 0x01000007, commands: tvos })).targets[0].platform, 'tvos-simulator');
  incomplete(thin({ cpu: 7, wide: false, commands: tvos }), 'unknown-mach-platform');
  const legacy = [[0x25, 16, 0x00080000, 0]];
  assert.equal(parseMachTargets(thin({ cpu: 7, wide: false, commands: legacy })).targets[0].platform, 'ios-simulator');
  assert.equal(parseMachTargets(thin({ cpu: 12, wide: false, commands: legacy })).targets[0].platform, 'ios');
});

test('both FAT table widths reconcile inner CPU identity and normalize member order', () => {
  const arm = thin();
  const x86 = thin({ cpu: 0x01000007, subtype: 3, commands: [[0x24, 16, 0x000a0a00, 0]] });
  const expected = [parseMachTargets(arm).targets[0], parseMachTargets(x86).targets[0]];
  for (const wide of [false, true]) {
    const result = parseMachTargets(fat([x86, arm], wide));
    assert.equal(result.complete, true);
    assert.deepEqual(result.targets, expected);
    assert.deepEqual(incomplete(fat([arm, x86], wide, true), 'noncanonical-fat-byte-order'), expected);
  }
});

test('duplicate base subtypes, overlapping, out-of-range and misaligned FAT entries cannot pass', () => {
  const arm = thin();
  const x86 = thin({ cpu: 0x01000007, subtype: 3 });
  incomplete(fat([arm, thin({ subtype: 0x80000000 })]), 'duplicate-fat-architecture');
  const overlap = fat([arm, x86]);
  overlap.writeUInt32BE(52, 36);
  incomplete(overlap, 'overlapping-fat-slices');
  const beforeTable = fat([arm]);
  beforeTable.writeUInt32BE(8, 16);
  incomplete(beforeTable, 'invalid-fat-slice-range');
  const huge = fat([arm], true);
  huge.writeBigUInt64BE(0xffffffffffffffffn, 16);
  incomplete(huge, 'invalid-fat-slice-range');
  const unaligned = fat([arm]);
  unaligned.writeUInt32BE(7, 24);
  incomplete(unaligned, 'invalid-fat-alignment');
  const reserved = fat([arm], true);
  reserved.writeUInt32BE(1, 36);
  incomplete(reserved, 'reserved-fat-field');
});

test('disagreeing FAT entry and nested identity keep only independently reconciled slices', () => {
  const pair = fat([thin(), thin({ cpu: 0x01000007, subtype: 3 })]);
  pair.writeUInt32BE(0x80000000, 12);
  assert.deepEqual(incomplete(pair, 'fat-slice-identity-mismatch').map(row => row.architecture), ['x86_64']);
  incomplete(fat([Buffer.from('!<arch>\n................')]), 'unrecognized-thin-header');
});

test('ambiguous, absent and unrecognized deployment declarations produce incomplete results', () => {
  assert.deepEqual(incomplete(thin({ commands: [modern(1), modern(6)] }), 'multiple-mach-target-declarations'), []);
  assert.equal(incomplete(thin({ commands: [] }), 'missing-mach-target-declaration')[0].minimumOS, null);
  assert.equal(incomplete(thin({ commands: [modern(999)] }), 'unknown-mach-platform')[0].platform, 'unknown');
  assert.equal(incomplete(thin({ commands: [modern(1, 0)] }), 'unspecified-mach-minimum-os')[0].minimumOS, null);
});

test('truncated and mismatched command lengths are never treated as absence', () => {
  incomplete(thin({ commands: [[0x32, 24, 1, 0x000e0000, 0, 1]] }), 'invalid-mach-build-version');
  incomplete(thin({ commands: [[0x24, 8]] }), 'invalid-mach-version-min');
  incomplete(thin({ commands: [[1, 12, 0], modern()] }), 'invalid-mach-command-size');
  const excess = thin();
  excess.writeUInt32LE(0, 16);
  incomplete(excess, 'invalid-mach-command-table');
  const truncated = thin();
  for (let i = 0; i < truncated.length; i++) assert.equal(parseMachTargets(truncated.subarray(0, i)).complete, false);
});

test('budgets and architecture/header consistency apply before target classification', () => {
  incomplete(Buffer.alloc(16 * 1024 * 1024 + 1), 'mach-file-limit');
  incomplete(words([0xcafebabe, 65], false), 'fat-slice-count');
  incomplete(words([0xcafebabf, 2], false), 'truncated-fat-table');
  const lots = thin();
  lots.writeUInt32LE(4097, 16);
  incomplete(lots, 'mach-command-limit');
  incomplete(thin({ cpu: 7 }), 'mach-width-mismatch');
  incomplete(thin({ little: false }), 'mach-endian-mismatch');
  incomplete(thin({ kind: 127 }), 'unknown-mach-kind');
  incomplete(thin({ cpu: 1234 }), 'unknown-mach-architecture');
});
