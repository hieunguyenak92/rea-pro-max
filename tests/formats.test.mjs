import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectFormat } from '../skills/rea-pro-max/lib/analysis/formats.mjs';
import { inspectArtifact } from '../skills/rea-pro-max/lib/analysis/inspect.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function bytes(size = 128) { return Buffer.alloc(size); }

test('bounded format inspection extracts ELF, PE, Mach-O and WASM headers without execution', () => {
  const elf = bytes(); elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]); elf.writeUInt16LE(2, 16); elf.writeUInt16LE(62, 18); elf.writeBigUInt64LE(0x401000n, 24);
  const pe = bytes(); pe.write('MZ'); pe.writeUInt32LE(64, 0x3c); pe.write('PE\0\0', 64); pe.writeUInt16LE(0x8664, 68); pe.writeUInt16LE(3, 70); pe.writeUInt16LE(0x20b, 88);
  const macho = bytes(); macho.writeUInt32LE(0xfeedfacf, 0); macho.writeUInt32LE(0x01000007, 4); macho.writeUInt32LE(2, 12); macho.writeUInt32LE(5, 16);
  const wasm = bytes(); wasm.set([0, 0x61, 0x73, 0x6d]); wasm.writeUInt32LE(1, 4);
  assert.equal(inspectFormat(elf).format, 'elf');
  assert.equal(inspectFormat(pe).metadata.machine, 0x8664);
  assert.equal(inspectFormat(macho).metadata.load_command_count, 5);
  assert.equal(inspectFormat(wasm).metadata.version, 1);
  for (const input of [elf, pe, macho, wasm]) assert.equal(inspectFormat(input).executed, false);
});

test('bounded format inspection classifies APK from a validated ZIP member name', () => {
  const name = Buffer.from('AndroidManifest.xml');
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(name.length, 28); name.copy(central, 46);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length, 16);
  const zip = Buffer.concat([local, central, eocd]);
  const result = inspectFormat(zip);
  assert.ok(result);
  assert.equal(result.format, 'apk-container');
  assert.equal(result.metadata.has_manifest, true);
  assert.equal(result.static_only, true);
});

test('format inspection detects ML, firmware and record containers', () => {
  const gguf = Buffer.alloc(32); gguf.write('GGUF'); gguf.writeUInt32LE(3, 4); gguf.writeBigUInt64LE(2n, 8); gguf.writeBigUInt64LE(4n, 16);
  const safeHeader = Buffer.from(JSON.stringify({ weight: { dtype: 'F32', shape: [2], data_offsets: [0, 8] }, __metadata__: { source: 'owned' } }));
  const safe = Buffer.concat([Buffer.alloc(8), safeHeader]); safe.writeBigUInt64LE(BigInt(safeHeader.length), 0);
  const uf2 = Buffer.alloc(512); uf2.writeUInt32LE(0x0a324655, 0); uf2.writeUInt32LE(0x9e5d5157, 4); uf2.writeUInt32LE(256, 16); uf2.writeUInt32LE(7, 20); uf2.writeUInt32LE(1, 24);
  const hex = Buffer.from(':100000000C945C000C946E000C946E000C946E00A2\n:00000001FF\n');
  assert.equal(inspectFormat(gguf).format, 'gguf');
  assert.equal(inspectFormat(safe).format, 'safetensors');
  assert.equal(inspectFormat(uf2).format, 'uf2');
  assert.equal(inspectFormat(hex).format, 'intel-hex');
});

test('format inspection keeps Android, managed, BEAM and embedded signatures static', () => {
  const dex = Buffer.alloc(64); dex.write('dex\n039\0');
  const dotnet = Buffer.alloc(16); dotnet.write('BSJB');
  const beam = Buffer.alloc(32); beam.write('FOR1'); beam.write('BEAM', 8);
  const ines = Buffer.alloc(32); ines.write('NES\x1a');
  const gzip = Buffer.from([0x1f, 0x8b, 8, 0]);
  assert.equal(inspectFormat(dex).format, 'android-dex');
  assert.equal(inspectFormat(dotnet).format, 'dotnet-metadata');
  assert.equal(inspectFormat(beam).format, 'erlang-beam');
  assert.equal(inspectFormat(ines).format, 'ines');
  assert.equal(inspectFormat(gzip).format, 'gzip-container');
  for (const input of [dex, dotnet, beam, ines, gzip]) assert.equal(inspectFormat(input).executed, false);
});

test('artifact inspection retains static format details and capability labels', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rpm-formats-')); t.after(() => rm(root, { recursive: true, force: true }));
  const wasm = Buffer.alloc(8); wasm.set([0, 0x61, 0x73, 0x6d]); wasm.writeUInt32LE(1, 4);
  await writeFile(join(root, 'module.wasm'), wasm);
  const report = await inspectArtifact(join(root, 'module.wasm'));
  assert.equal(report.artifact_details.static_only, true);
  assert.equal(report.artifact_details.formats[0].format, 'wasm');
  assert.ok(report.capabilities.includes('static-format:wasm'));
  assert.equal(report.limits.target_executed, false);
});
