import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as zlib from 'node:zlib';
import { inspectFormat, inventoryFormats } from '../skills/rea-pro-max/lib/analysis/formats.mjs';
import { ownedZip as archive } from './fixtures/owned-zip.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('ZIP member hashes reflect uncompressed bytes across archive encodings and streaming descriptors', () => {
  const raw = Buffer.from('same owner-provided application document\n'.repeat(10));
  const bytes = archive([
    { name: 'données/', unixMode: 0x41ed, method: 8 },
    { name: 'données/a.txt', raw },
    { name: 'données/b.txt', method: 8, raw, descriptor: 'signed' },
    { name: 'données/c.txt', method: 8, raw, descriptor: 'unsigned' },
  ]);
  const result = inspectFormat(bytes);
  const { listed_members: members, coverage } = result.metadata;
  assert.equal(result.executed, false);
  assert.equal(coverage.central_directory, 'complete');
  assert.equal(coverage.content_complete, true);
  assert.equal(coverage.verified_directories, 1);
  assert.equal(coverage.verified_files, 3);
  assert.deepEqual(members.map(member => member.content_status), ['directory', 'verified', 'verified', 'verified']);
  assert.deepEqual(members.map(member => member.content_sha256), [null, sha256(raw), sha256(raw), sha256(raw)]);

  for (const [names, format] of [
    [['AndroidManifest.xml', 'classes.dex'], 'apk-container'],
    [['BundleConfig.pb', 'base/manifest/AndroidManifest.xml'], 'android-bundle-container'],
    [['AppxManifest.xml', '[Content_Types].xml'], 'appx-package-container'],
    [['Payload/Example.app/Info.plist'], 'ipa-container'],
    [['META-INF/MANIFEST.MF'], 'jar-container'],
  ]) {
    assert.equal(inspectFormat(archive(names.map(name => ({ name })))).format, format);
  }
});

test('ZIP end record validates its comment and full central-directory envelope', () => {
  const comment = Buffer.alloc(65_535, 65);
  // A lookalike EOCD near EOF declares a comment whose range does not end at EOF.
  comment.writeUInt32LE(0x06054b50, comment.length - 24);
  const valid = inspectFormat(archive([{ name: 'a.txt' }], comment));
  assert.equal(valid.metadata.coverage.content_complete, true);

  const empty = inspectFormat(archive([]));
  assert.equal(empty.metadata.member_count, 0);
  assert.equal(empty.metadata.coverage.content_complete, true);

  const zip = archive([{ name: 'a.txt' }, { name: 'b.txt' }]);
  zip.writeUInt16LE(1, zip.length - 22 + 8);
  zip.writeUInt16LE(1, zip.length - 22 + 10);
  const malformed = inspectFormat(zip);
  assert.equal(malformed.metadata.coverage.central_directory, 'invalid');
  assert.deepEqual(malformed.metadata.listed_members, []);
  assert.equal(malformed.unknowns[0].code, 'zip_central_directory_invalid');
});

test('ZIP local metadata, descriptors and decoded bytes need to agree before hashes are returned', () => {
  const raw = Buffer.from('owned text');
  const trailing = Buffer.concat([zlib.deflateRawSync(raw), Buffer.of(0)]);
  const zip = archive([
    { name: 'a.txt', raw, claimedCrc: 0 },
    { name: 'b.txt', raw, method: 8, storedData: trailing },
    { name: 'c.txt', raw, method: 8, claimedSize: 1 },
    { name: 'd.txt', raw, descriptor: 'signed' },
    { name: 'e.txt', raw, method: 8 },
  ]);
  zip[30] = 'z'.charCodeAt();
  const localHeaders = 4 * (30 + 'a.txt'.length);
  const precedingPayloads = 2 * raw.length + trailing.length + zlib.deflateRawSync(raw).length;
  zip.writeUInt32LE(0, localHeaders + precedingPayloads + 4);
  const result = inspectFormat(zip);
  assert.equal(result.metadata.coverage.content_complete, false);
  assert.deepEqual(result.metadata.listed_members.map(member => member.content_status), [
    'zip_local_central_mismatch', 'zip_member_stream_invalid', 'zip_member_stream_invalid', 'zip_descriptor_invalid', 'verified',
  ]);
  assert.equal(result.metadata.listed_members[4].content_sha256, sha256(raw));

  const crcMismatch = inspectFormat(archive([{ name: 'owned.txt', raw, claimedCrc: 0 }]));
  assert.equal(crcMismatch.metadata.listed_members[0].content_status, 'zip_member_crc_mismatch');
  assert.equal(crcMismatch.metadata.listed_members[0].content_sha256, null);
});

test('ZIP suppresses overlapping, duplicate, unsafe and unsupported members with explicit statuses', () => {
  const zip = archive([
    { name: 'alias.txt', raw: Buffer.from('fixture') },
    { name: 'alias.txt', offset: 0 },
    { name: '../outside.txt' },
    { name: 'link', unixMode: 0xa1ff, raw: Buffer.from('owned.txt') },
    { name: 'encrypted.txt', extraFlags: 1 },
    { name: 'codec.txt', method: 12 },
    { name: 'dupe.txt' },
    { name: 'dupe.txt' },
  ]);
  const result = inspectFormat(zip);
  assert.deepEqual(result.metadata.listed_members.map(member => member.content_status), [
    'zip_member_overlap', 'zip_member_overlap', 'zip_member_unsafe_path', 'zip_member_special_file',
    'zip_member_encrypted', 'zip_member_codec_unsupported', 'zip_member_duplicate', 'zip_member_duplicate',
  ]);
  assert.ok(result.metadata.listed_members.every(member => member.content_sha256 === null));
  assert.equal(result.metadata.coverage.content_complete, false);

  const limited = inspectFormat(zip, { maxMembers: 7 });
  assert.equal(limited.metadata.listed_members.at(-1).content_status, 'zip_member_duplicate');
  assert.equal(limited.metadata.member_count, 8);
  assert.ok(limited.unknowns.some(item => item.code === 'zip_member_limit'));
});

test('ZIP64 and multi-disk signatures retain an explicit unsupported state', () => {
  const zip64 = archive([]);
  zip64.writeUInt32LE(0xffffffff, 16);
  const multiDisk = archive([]);
  multiDisk.writeUInt16LE(1, 4);
  for (const [bytes, code] of [[zip64, 'zip64_unsupported'], [multiDisk, 'zip_multidisk_unsupported']]) {
    const result = inspectFormat(bytes);
    assert.equal(result.metadata.coverage.central_directory, 'unsupported');
    assert.equal(result.metadata.coverage.content_complete, false);
    assert.equal(result.unknowns[0].code, code);
  }
});

test('ZIP method 93 verifies a single bounded Zstandard frame with an optional checksum', { skip: typeof zlib.zstdCompressSync !== 'function' }, () => {
  const raw = Buffer.from('owned Zstandard test document\n'.repeat(100));
  const frame = zlib.zstdCompressSync(raw, { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } });
  const wrongChecksum = Buffer.from(frame);
  wrongChecksum[wrongChecksum.length - 1] ^= 1;
  const frames = [frame, frame.subarray(0, -1), wrongChecksum, Buffer.concat([frame, frame])];
  const members = frames.map((storedData, index) => ({ name: `${index}.txt`, raw, method: 93, storedData }));
  const { listed_members: results } = inspectFormat(archive(members)).metadata;
  assert.deepEqual(results.map(member => member.content_status), [
    'verified', 'zip_member_stream_invalid', 'zip_member_stream_invalid', 'zip_member_stream_invalid',
  ]);
  assert.equal(results[0].content_sha256, sha256(raw));
  assert.ok(results.slice(1).every(member => member.content_sha256 === null));
});

test('ZIP content caps apply before decode and across archives in one inventory', () => {
  const maximum = 4 * 1024 * 1024;
  const raw = Buffer.alloc(maximum);
  const over = inspectFormat(archive([{ name: 'large.bin', method: 8, claimedSize: maximum + 1 }]));
  assert.equal(over.metadata.listed_members[0].content_status, 'zip_member_content_limit');

  const bytes = archive([{ name: 'bounded.bin', raw, method: 8 }]);
  const entries = Array.from({ length: 9 }, (_, index) => ({ path: `${index}.zip`, sha256: sha256(bytes), size: bytes.length, bytes }));
  const results = inventoryFormats(entries);
  assert.ok(results.slice(0, 8).every(entry => entry.metadata.coverage.content_complete));
  assert.equal(results[8].metadata.listed_members[0].content_status, 'zip_content_budget');
  assert.equal(results[8].metadata.coverage.content_complete, false);
});
