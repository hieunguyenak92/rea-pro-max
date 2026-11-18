import { digest, hashBytes, RpmError } from '../common.mjs';
import { VERSION } from '../version.mjs';

export const NATIVE_LIMITS = Object.freeze({
  binary_bytes: 16 * 1024 * 1024,
  export_bytes: 4 * 1024 * 1024,
  functions: 16,
  instructions: 512,
  input_count: 256,
});

const labContract = 'rpm-native-u8-u16-v1';
const architectures = ['arm64', 'x86_64'];
const sha256 = /^[0-9a-f]{64}$/u;
const address = /^[a-zA-Z][a-zA-Z0-9_]{0,49}:[0-9a-f]{1,16}$/u;
const hexBytes = /^(?:[0-9a-f]{2}){1,16}$/u;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const uint = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const match = (value, pattern) => typeof value === 'string' && pattern.test(value);
const box = (value, maximum, maxText) => Array.isArray(value) && value.length <= maximum && value.every(item => text(item, maxText));

function receipt(result) {
  return { ...result, receipt_sha256: digest(result) };
}

// The importer's CPU label is independently checked only for the admitted,
// single-architecture headers below. Function locations still come from Ghidra.
export function identifyNativeBinary(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > NATIVE_LIMITS.binary_bytes) {
    throw new RpmError('native_binary_input', 'Use at most 16 MiB of binary input.');
  }
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = data.subarray(0, 4).toString('hex');
  if (magic === 'cffaedfe' && data.length >= 32) {
    const cpu = data.readUInt32LE(4);
    return { format: 'mach-o-64', architecture: { 0x01000007: 'x86_64', 0x0100000c: 'arm64' }[cpu] ?? null };
  }
  if (magic === '7f454c46' && data.length >= 64 && data[4] === 2 && data[5] === 1) {
    return { format: 'elf-64', architecture: { 62: 'x86_64', 183: 'arm64' }[data.readUInt16LE(18)] ?? null };
  }
  if (data.length >= 64 && data.subarray(0, 2).toString('hex') === '4d5a') {
    const pointer = data.readUInt32LE(60);
    if (pointer <= data.length - 26 && data.readUInt32LE(pointer) === 0x4550 && data.readUInt16LE(pointer + 24) === 0x20b) {
      return { format: 'pe32+', architecture: { 0x8664: 'x86_64', 0xaa64: 'arm64' }[data.readUInt16LE(pointer + 4)] ?? null };
    }
  }
  return { format: 'unsupported', architecture: null };
}

function malformedExport() {
  return new RpmError('native_export_schema', 'Use a bounded REA export from the shipped Ghidra 12.2 script.');
}

function importInstruction(item, bytes, issues) {
  if (!isObject(item) || !match(item.address, address) || !match(item.bytes, hexBytes) || !text(item.listing, 512) ||
      !(item.file_offset === null || uint(item.file_offset, NATIVE_LIMITS.binary_bytes - 1)) ||
      !box(item.raw_pcode, 64, 512)) throw malformedExport();
  const size = item.bytes.length / 2;
  const at = item.file_offset;
  const bound = at !== null && at + size <= bytes.length &&
    Buffer.from(bytes.subarray(at, at + size)).toString('hex') === item.bytes;
  if (!bound) issues.add(at === null ? 'unmapped_instruction_bytes' : 'instruction_byte_mismatch');
  return {
    address: item.address,
    file_offset: at,
    bytes: item.bytes,
    byte_binding: bound ? 'verified-at-file-offset' : 'unverified',
    listing: item.listing,
    raw_pcode: item.raw_pcode,
  };
}

function importFunction(row, bytes, issues) {
  if (!isObject(row) || !text(row.name, 256) || !match(row.entry, address) ||
      typeof row.instructions_complete !== 'boolean' || !Array.isArray(row.instructions) ||
      row.instructions.length > NATIVE_LIMITS.instructions || !isObject(row.pseudocode) ||
      !['present', 'unavailable'].includes(row.pseudocode.status) ||
      (row.pseudocode.status === 'present' ? !text(row.pseudocode.text, 32768) : row.pseudocode.text !== null)) {
    throw malformedExport();
  }
  const instructions = row.instructions.map(item => importInstruction(item, bytes, issues));
  const addresses = new Set(instructions.map(item => item.address));
  if (addresses.size !== instructions.length) throw malformedExport();
  if (!row.instructions_complete || !addresses.has(row.entry)) issues.add('incomplete_function_listing');
  if (row.pseudocode.status === 'unavailable') issues.add('decompiler_output_unavailable');
  return {
    name: row.name,
    entry: row.entry,
    instructions_complete: row.instructions_complete,
    instructions,
    pseudocode: { status: row.pseudocode.status, text: row.pseudocode.text, meaning: 'derived-decompiler-text' },
  };
}

export function importGhidraExport(binaryBytes, exportDocument) {
  const binary = identifyNativeBinary(binaryBytes);
  const artifactSha = hashBytes(binaryBytes);
  const doc = exportDocument;
  if (!isObject(doc) || doc.schema_version !== 1 || doc.kind !== 'rpm-ghidra-export' ||
      !isObject(doc.provider) || doc.provider.name !== 'Ghidra' || !text(doc.provider.version, 24) ||
      doc.provider.exporter !== 'rpm-ghidra-1' || !match(doc.binary_sha256, sha256) ||
      !text(doc.language, 128) || typeof doc.functions_complete !== 'boolean' ||
      !Array.isArray(doc.functions) || doc.functions.length > NATIVE_LIMITS.functions) throw malformedExport();
  const issues = new Set();
  const architecture = doc.language.startsWith('AARCH64:LE:64:') ? 'arm64' :
    doc.language.startsWith('x86:LE:64:') ? 'x86_64' : null;
  if (artifactSha !== doc.binary_sha256) issues.add('artifact_digest_mismatch');
  if (doc.provider.version !== '12.2') issues.add('unsupported_provider_version');
  if (!binary.architecture || binary.architecture !== architecture) issues.add('unsupported_or_mismatched_architecture');
  const functions = issues.size ? [] : doc.functions.map(row => importFunction(row, binaryBytes, issues));
  if (!doc.functions_complete || functions.length === 0) issues.add('requested_functions_missing');
  if (new Set(functions.map(row => row.entry)).size !== functions.length) throw malformedExport();
  return receipt({
    schema_version: 1, kind: 'native-static-evidence', engine_version: VERSION,
    status: issues.size ? 'unknown' : 'complete',
    authority: 'reported-static-analysis',
    binary: { ...binary, sha256: artifactSha, bytes: binaryBytes.length },
    provider: { name: 'Ghidra', version: doc.provider.version, exporter: 'rpm-ghidra-1', language: doc.language, export_document_sha256: digest(doc) },
    functions, issues: [...issues],
    scope: 'The importer checks the binary digest and referenced instruction bytes. Addresses, raw instruction p-code and decompiler text come from a saved static provider export. No native behavior, origin, or source equivalence is attested.',
  });
}

function normalizeOutput(document, kind) {
  if (!isObject(document) || document.schema_version !== 1 || document.kind !== kind ||
      document.contract !== labContract || !Array.isArray(document.rows) ||
      document.rows.length > NATIVE_LIMITS.input_count || typeof document.complete !== 'boolean') {
    throw new RpmError('native_run_schema', 'Use a version 1 native u8-to-u16 run or independent oracle document.');
  }
  const rows = new Map();
  for (const row of document.rows) {
    if (!isObject(row) || !uint(row.input, 255) || !uint(row.output, 65535) || rows.has(row.input)) {
      throw new RpmError('native_run_row', 'Use unique integer inputs in 0–255 and integer outputs in 0–65535.');
    }
    rows.set(row.input, row.output);
  }
  return rows;
}

function normalizeRun(doc) {
  const rows = normalizeOutput(doc, 'rpm-native-run');
  if (!isObject(doc.build) || !match(doc.build.binary_sha256, sha256) ||
      !match(doc.build.implementation_sha256, sha256) || !match(doc.build.harness_sha256, sha256) ||
      !text(doc.build.compiler, 400) || !box(doc.build.flags, 16, 120) ||
      !isObject(doc.runtime) || !architectures.includes(doc.runtime.architecture) ||
      !text(doc.runtime.os, 64) || !text(doc.runtime.os_release, 128) ||
      !['native', 'translated'].includes(doc.runtime.mode) ||
      !architectures.includes(doc.runtime.host_architecture) ||
      (doc.runtime.mode === 'native') !== (doc.runtime.architecture === doc.runtime.host_architecture)) {
    throw new RpmError('native_run_identity', 'Record implementation, harness, executable, compiler, runtime, and CPU identities.');
  }
  return {
    rows,
    complete: doc.complete,
    build: {
      binary_sha256: doc.build.binary_sha256, implementation_sha256: doc.build.implementation_sha256,
      harness_sha256: doc.build.harness_sha256, compiler: doc.build.compiler, flags: doc.build.flags,
    },
    runtime: {
      architecture: doc.runtime.architecture, os: doc.runtime.os, os_release: doc.runtime.os_release,
      mode: doc.runtime.mode, host_architecture: doc.runtime.host_architecture,
    },
  };
}

export function compareNativeRuns(referenceDocument, candidateDocument, expectedDocument) {
  const reference = normalizeRun(referenceDocument), candidate = normalizeRun(candidateDocument);
  const expected = normalizeOutput(expectedDocument, 'rpm-native-oracle');
  if (!isObject(expectedDocument.oracle) || !match(expectedDocument.oracle.source_sha256, sha256) ||
      !text(expectedDocument.oracle.provider, 120)) {
    throw new RpmError('native_oracle_identity', 'Supply the separate oracle identity and source digest.');
  }
  const { build: refBuild, runtime: refRuntime } = reference;
  const { build: candBuild, runtime: candRuntime } = candidate;
  const issues = [];
  const compatible = digest(refRuntime) === digest(candRuntime) && refBuild.harness_sha256 === candBuild.harness_sha256;
  if (!compatible) issues.push('incompatible_runtime_or_harness');
  const oracle = { provider: expectedDocument.oracle.provider, source_sha256: expectedDocument.oracle.source_sha256 };
  const distinctOracle = ![refBuild.implementation_sha256, candBuild.implementation_sha256, refBuild.harness_sha256, candBuild.harness_sha256]
    .includes(oracle.source_sha256);
  if (!distinctOracle) issues.push('oracle_shares_source_digest');
  const differences = [];
  let compared = 0;
  if (compatible && distinctOracle) {
    for (let input = 0; input < NATIVE_LIMITS.input_count; input++) {
      if (!reference.rows.has(input) || !candidate.rows.has(input) || !expected.has(input)) continue;
      compared++;
      const a = reference.rows.get(input), b = candidate.rows.get(input), wanted = expected.get(input);
      if (a !== wanted || b !== wanted) differences.push({ input, reference: a, candidate: b, expected: wanted });
    }
  }
  if (compared !== NATIVE_LIMITS.input_count || !reference.complete || !candidate.complete || !expectedDocument.complete) {
    issues.push('incomplete_domain');
  }
  return receipt({
    schema_version: 1, kind: 'native-behavior-comparison', engine_version: VERSION,
    status: differences.length ? 'fail' : issues.length ? 'unknown' : 'pass',
    authority: 'reported-execution',
    contract: labContract, domain_size: NATIVE_LIMITS.input_count, compared, differences, issues,
    reference: { build: refBuild, runtime: refRuntime }, candidate: { build: candBuild, runtime: candRuntime }, oracle,
    scope: 'Results compare supplied u8-to-u16 outputs with a separately declared oracle for one admitted context. Receipt hashes bind report content rather than attesting authorship or execution.',
  });
}
