import assert from 'node:assert/strict';
import test from 'node:test';
import { hashBytes } from '../skills/rea-pro-max/lib/common.mjs';
import { inspectFirmware } from '../skills/rea-pro-max/lib/analysis/firmware.mjs';

function hexRecord(type, offset = 0, data = []) {
  const record = Buffer.from([data.length, offset >> 8, offset & 0xff, type, ...data, 0]);
  record[record.length - 1] = -record.reduce((sum, value) => sum + value, 0) & 0xff;
  return `:${record.toString('hex').toUpperCase()}`;
}

const eof = hexRecord(1);
const hexFile = (...records) => Buffer.from(records.join('\n'));

function uf2Block({ number = 0, count = 1, address = 0x1000, data = [1, 2, 3, 4], flags = 0, family = 0 } = {}) {
  const block = Buffer.alloc(512);
  block.writeUInt32LE(0x0a324655, 0);
  block.writeUInt32LE(0x9e5d5157, 4);
  block.writeUInt32LE(flags, 8);
  block.writeUInt32LE(address, 12);
  block.writeUInt32LE(data.length, 16);
  block.writeUInt32LE(number, 20);
  block.writeUInt32LE(count, 24);
  block.writeUInt32LE(family, 28);
  Buffer.from(data).copy(block, 32);
  block.writeUInt32LE(0x0ab16f30, 508);
  return block;
}

test('identifies only supported carrier signatures and bounds independently admitted input', () => {
  assert.equal(inspectFirmware(Buffer.from(': plain text')), null);
  assert.equal(inspectFirmware(Buffer.from('S1050000CAFE32')), null);
  assert.equal(inspectFirmware(Buffer.from('UF2\n')), null);
  assert.throws(() => inspectFirmware(':00000001FF'), { code: 'format_input' });
  assert.throws(() => inspectFirmware(Buffer.alloc(16 * 1024 * 1024 + 1)), { code: 'format_bounds' });
});

test('merges checksum-verified Intel HEX records with layout-independent region identities', () => {
  const base = hexRecord(4, 0, [0, 1]);
  const bytes = Buffer.from([1, 2, 3, 4]);
  const first = inspectFirmware(Buffer.from([
    base, hexRecord(0, 2, [3, 4]), hexRecord(0, 0, [1, 2]), '', hexRecord(0, 16, [9]), hexRecord(5, 0, [0, 1, 0, 0]), eof, '',
  ].join('\r\n')));
  const second = inspectFirmware(hexFile(base.toLowerCase(), hexRecord(0, 0, bytes), hexRecord(0, 16, [9]), eof));
  assert.equal(first.format, 'intel-hex');
  assert.equal(first.confidence, 'validated-records');
  assert.equal(first.metadata.integrity, 'validated');
  assert.deepEqual(first.metadata.record_types, [0, 1, 4, 5]);
  assert.equal(first.metadata.payload_byte_count, 5);
  assert.equal(first.metadata.eof_record_found, true);
  assert.deepEqual(first.metadata.regions, second.metadata.regions);
  assert.deepEqual(first.metadata.regions[0], { load_address: 0x10000, byte_count: 4, sha256: hashBytes(bytes) });
  assert.doesNotMatch(JSON.stringify(first), /01020304/u);
  assert.deepEqual(first.unknowns, []);
});

test('checks Intel HEX shape, checksum, EOF, and supported addressing boundaries', () => {
  const head = hexRecord(0, 0, [3]);
  for (const [records, code, status] of [
    [[head, ':02000004000100', hexRecord(0, 0, [4]), eof], 'ihex_checksum', 'invalid'],
    [[head, ':0200000001FD', eof], 'ihex_byte_count', 'invalid'],
    [[head, hexRecord(4, 1, [0, 1]), eof], 'ihex_record_shape', 'invalid'],
    [[head, eof, head], 'ihex_after_eof', 'invalid'],
    [[head], 'ihex_eof_missing', 'incomplete'],
    [[head, hexRecord(23, 0, []), eof], 'ihex_record_type', 'unknown'],
    [[head, '; comments are outside the subset', eof], 'ihex_non_record_line', 'unknown'],
    [[head, hexRecord(4, 0, [0xff, 0xff]), hexRecord(0, 0xffff, [1, 2]), eof], 'ihex_wrapped_range', 'unknown'],
  ]) {
    const result = inspectFirmware(hexFile(...records));
    assert.equal(result.metadata.integrity, status, code);
    assert.equal(result.metadata.regions[0].load_address, 0, code);
    assert.equal(result.metadata.payload_byte_count, 1, code);
    assert.ok(result.unknowns.some(item => item.code === code), code);
  }
  const segment = inspectFirmware(hexFile(hexRecord(2, 0, [0x12, 0x34]), hexRecord(0, 3, [9]), hexRecord(3, 0, [0x12, 0x34, 0, 0]), eof));
  assert.equal(segment.metadata.integrity, 'validated');
  assert.equal(segment.metadata.regions[0].load_address, 0x12343);
});

test('deduplicates identical HEX records and withholds merged identities on conflicting overlap', () => {
  const data = hexRecord(0, 16, [3, 4]);
  const repeated = inspectFirmware(hexFile(data, data, eof));
  assert.equal(repeated.metadata.duplicate_data_records, 1);
  assert.equal(repeated.metadata.payload_byte_count, 2);
  const conflict = inspectFirmware(hexFile(data, hexRecord(0, 16, [0, 4]), data, hexRecord(0, 17, [9]), eof));
  assert.equal(conflict.metadata.integrity, 'invalid');
  assert.equal(conflict.metadata.region_count, null);
  assert.equal(conflict.metadata.duplicate_data_records, 1);
  assert.equal(conflict.metadata.overlapping_data_records, 2);
  assert.deepEqual(conflict.metadata.regions, []);
});

test('checks complete UF2 sequences, deduplicating identical blocks independent of file order', () => {
  const blocks = [
    uf2Block({ number: 0, count: 3, flags: 0x2000, family: 7 }),
    uf2Block({ number: 1, count: 3, flags: 0x2000, family: 7, address: 0x1004, data: [2, 4, 6, 8] }),
    uf2Block({ number: 2, count: 3, flags: 0x2001, family: 7, address: 3, data: [9, 10] }),
  ];
  const result = inspectFirmware(Buffer.concat([blocks[2], blocks[1], blocks[1], blocks[0]]));
  assert.equal(result.format, 'uf2');
  assert.equal(result.metadata.integrity, 'validated');
  assert.equal(result.metadata.family_id, 7);
  assert.equal(result.metadata.physical_block_count, 4);
  assert.equal(result.metadata.declared_block_count, 3);
  assert.equal(result.metadata.unique_block_count, 3);
  assert.equal(result.metadata.duplicate_block_count, 1);
  assert.equal(result.metadata.missing_block_count, 0);
  assert.deepEqual(result.metadata.blocks.map(block => block.block_number), [0, 1, 2]);
  assert.deepEqual(result.metadata.blocks[1], {
    block_number: 1, physical_index: 1, load_address: 0x1004, payload_byte_count: 4, payload_sha256: hashBytes(Buffer.from([2, 4, 6, 8])),
  });
  assert.equal(result.metadata.blocks[2].load_address, null);
  assert.deepEqual(result.unknowns, []);
});

test('preserves incomplete, invalid, and unknown UF2 facts separately', () => {
  const first = uf2Block({ count: 2 });
  const badMagic = uf2Block({ number: 1, count: 2 });
  badMagic.writeUInt32LE(0, 508);
  const badSize = uf2Block();
  badSize.writeUInt32LE(477, 16);
  const badPadding = uf2Block();
  badPadding[507] = 1;
  for (const [bytes, code, status] of [
    [first, 'uf2_missing_blocks', 'incomplete'],
    [first.subarray(0, 400), 'uf2_trailing_bytes', 'incomplete'],
    [Buffer.concat([first, badMagic]), 'uf2_block_magic', 'invalid'],
    [badSize, 'uf2_block_bounds', 'invalid'],
    [badPadding, 'uf2_block_padding', 'invalid'],
    [uf2Block({ number: 1 }), 'uf2_block_bounds', 'invalid'],
    [uf2Block({ address: 0xfffffffc, data: [1, 2, 3, 4, 5, 6, 7, 8] }), 'uf2_flash_range', 'invalid'],
    [Buffer.concat([first, uf2Block({ number: 1, count: 3, address: 0x1004 })]), 'uf2_inconsistent_block_count', 'invalid'],
    [Buffer.concat([first, uf2Block({ count: 2, address: 0x1004 })]), 'uf2_conflicting_index', 'invalid'],
    [Buffer.concat([first, uf2Block({ number: 1, count: 2 })]), 'uf2_flash_overlap', 'invalid'],
    [uf2Block({ flags: 0x1000 }), 'uf2_unsupported_variant', 'unknown'],
    [uf2Block({ flags: 0x4000 }), 'uf2_unsupported_variant', 'unknown'],
    [Buffer.concat([uf2Block({ flags: 0x2000, family: 7 }), uf2Block({ flags: 0x2000, family: 8 })]), 'uf2_mixed_families', 'unknown'],
  ]) {
    const inspected = inspectFirmware(bytes);
    assert.equal(inspected.metadata.integrity, status, code);
    assert.ok(inspected.unknowns.some(item => item.code === code), code);
    if (code === 'uf2_conflicting_index') assert.deepEqual(inspected.metadata.blocks, []);
  }
  assert.equal(inspectFirmware(first).metadata.missing_block_count, 1);
  assert.equal(inspectFirmware(Buffer.concat([first, badMagic])).metadata.missing_block_count, null);
});

test('caps rendered identity rows while retaining examined totals and complete validation', () => {
  const count = 257;
  const hex = inspectFirmware(hexFile(...Array.from({ length: count }, (_, index) => hexRecord(0, index * 2, [1])), eof));
  const uf2 = inspectFirmware(Buffer.concat(Array.from({ length: count }, (_, number) => uf2Block({ number, count, address: number * 4 }))));
  assert.equal(hex.metadata.integrity, 'validated');
  assert.equal(hex.metadata.region_count, count);
  assert.equal(hex.metadata.omitted_region_identities, 1);
  assert.equal(hex.metadata.regions.length, 256);
  assert.equal(uf2.metadata.integrity, 'validated');
  assert.equal(uf2.metadata.unique_block_count, count);
  assert.equal(uf2.metadata.omitted_block_identities, 1);
  assert.equal(uf2.metadata.blocks.length, 256);
});

test('stops Intel HEX record work at its limit without treating an unexamined EOF as missing', () => {
  const input = Buffer.from(`${hexRecord(0, 0, [1])}\n`.repeat(65_536) + eof);
  const result = inspectFirmware(input);
  assert.equal(result.metadata.integrity, 'unknown');
  assert.equal(result.metadata.record_count, 65_536);
  assert.equal(result.metadata.unexamined_bytes, eof.length);
  assert.equal(result.metadata.duplicate_data_records, 65_535);
  assert.ok(result.unknowns.some(item => item.code === 'ihex_record_limit'));
  assert.ok(!result.unknowns.some(item => item.code === 'ihex_eof_missing'));
});
