import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importGhidraExport, compareNativeRuns } from '../skills/rea-pro-max/lib/native-recovery/native.mjs';

const directory = new URL('../skills/rea-pro-max/assets/labs/native-recovery/evidence/', import.meta.url);
const loadBytes = name => readFileSync(new URL(name, directory));
const load = name => JSON.parse(loadBytes(name));

for (const [architecture, file, instructionCount] of [['arm64', 'reference.bin', 10], ['x86_64', 'reference-x86_64.bin', 19]]) {
  test(`Ghidra 12.2 receipt binds the owned ${architecture} Mach-O and retains separate analysis layers`, () => {
    const binary = loadBytes(file);
    const doc = load(`ghidra-12.2-${architecture}.json`);
    const result = importGhidraExport(binary, doc);
    assert.equal(result.status, 'complete');
    assert.equal(result.authority, 'reported-static-analysis');
    assert.equal(result.binary.architecture, architecture);
    assert.equal(result.functions.length, 1);
    const [quote] = result.functions;
    assert.equal(quote.instructions.length, instructionCount);
    assert.ok(quote.instructions.some(insn => insn.raw_pcode.length > 0));
    assert.ok(quote.instructions.every(insn => insn.byte_binding === 'verified-at-file-offset'));
    assert.equal(quote.pseudocode.meaning, 'derived-decompiler-text');
    assert.match(quote.pseudocode.text, /quote/u);
  });
}

test('native static import rejects a stale binary, moved byte mapping and provider drift', () => {
  const binary = loadBytes('reference.bin');
  const doc = load('ghidra-12.2-arm64.json');
  const changed = Buffer.from(binary);
  changed[changed.length - 1] ^= 1;
  const stale = importGhidraExport(changed, doc);
  assert.equal(stale.status, 'unknown');
  assert.ok(stale.issues.includes('artifact_digest_mismatch'));
  assert.deepEqual(stale.functions, []);

  doc.functions[0].instructions[0].file_offset = 0;
  const moved = importGhidraExport(binary, doc);
  assert.equal(moved.status, 'unknown');
  assert.ok(moved.issues.includes('instruction_byte_mismatch'));

  doc.functions[0].instructions[0].file_offset = null;
  doc.functions[0].pseudocode = { status: 'unavailable', text: null };
  const partial = importGhidraExport(binary, doc);
  assert.equal(partial.status, 'unknown');
  assert.deepEqual(partial.issues, ['unmapped_instruction_bytes', 'decompiler_output_unavailable']);

  doc.provider.version = '12.3';
  const drift = importGhidraExport(binary, doc);
  assert.ok(drift.issues.includes('unsupported_provider_version'));
  assert.deepEqual(drift.functions, []);
});

test('independent oracle confirms full finite coverage and finds a single real differing input', () => {
  const reference = load('reference.json');
  const candidate = load('candidate.json');
  const negative = load('negative.json');
  const expected = load('oracle.json');
  const verified = compareNativeRuns(reference, candidate, expected);
  assert.equal(verified.status, 'pass');
  assert.equal(verified.authority, 'reported-execution');
  assert.equal(verified.compared, 256);
  const counterexample = compareNativeRuns(reference, negative, expected);
  assert.equal(counterexample.status, 'fail');
  assert.deepEqual(counterexample.differences, [{ input: 173, reference: 433, candidate: 434, expected: 433 }]);
  assert.equal(compareNativeRuns(negative, negative, expected).status, 'fail');
});

test('partial runs, duplicate inputs, mismatched runtime and reused oracle digest cannot pass', () => {
  const reference = load('reference.json');
  const candidate = load('candidate.json');
  const expected = load('oracle.json');
  candidate.complete = false;
  const partial = compareNativeRuns(reference, candidate, expected);
  assert.equal(partial.status, 'unknown');
  assert.ok(partial.issues.includes('incomplete_domain'));
  candidate.complete = true;
  candidate.runtime.os_release = 'different release';
  const mismatch = compareNativeRuns(reference, candidate, expected);
  assert.equal(mismatch.status, 'unknown');
  assert.ok(mismatch.issues.includes('incompatible_runtime_or_harness'));
  candidate.runtime.os_release = reference.runtime.os_release;
  candidate.rows[1] = candidate.rows[0];
  assert.throws(() => compareNativeRuns(reference, candidate, expected), { code: 'native_run_row' });
  expected.oracle.source_sha256 = reference.build.implementation_sha256;
  const shared = compareNativeRuns(reference, reference, expected);
  assert.equal(shared.status, 'unknown');
  assert.ok(shared.issues.includes('oracle_shares_source_digest'));
});
