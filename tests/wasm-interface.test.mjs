import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../skills/rea-pro-max/lib/common.mjs';
import { compareWasmInterfaces, inspectWasmInterface, WASM_INTERFACE_LIMITS } from '../skills/rea-pro-max/lib/analysis/wasm-interface.mjs';

const { validate, Module } = globalThis.WebAssembly;
const header = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
const i32 = 0x7f, i64 = 0x7e, funcref = 0x70, externref = 0x6f;
const bytes = (...items) => Buffer.concat(items.map(item => typeof item === 'number' ? Buffer.from([item]) : item));
function u32(value) {
  const output = [];
  do {
    const payload = value % 128;
    value = Math.floor(value / 128);
    output.push(payload | (value > 0 ? 128 : 0));
  } while (value > 0);
  return Buffer.from(output);
}
const vector = items => bytes(u32(items.length), ...items);
const name = text => vector(Buffer.from(text, 'utf8'));
const section = (id, payload) => bytes(id, u32(payload.length), payload);
const declarationSection = (id, entries) => section(id, vector(entries));
const type = (parameters, results) => bytes(0x60, vector(parameters), vector(results));
const importBinding = (module, item, kind, descriptor) => bytes(name(module), name(item), kind, descriptor);
const exportBinding = (item, kind, index) => bytes(name(item), kind, u32(index));
const moduleBytes = (...sections) => bytes(header, ...sections);

function definitionModule(resultType = i32, value = 1, exportName = 'get', extraType = false) {
  const getter = type([], [resultType]);
  // Type numbers can change without changing the exported declaration.
  const typeSection = declarationSection(1, extraType ? [type([], []), getter] : [getter]);
  const functionSection = declarationSection(3, [u32(extraType ? 1 : 0)]);
  const exportSection = declarationSection(7, [exportBinding(exportName, 0, 0)]);
  const body = bytes(0, resultType === i32 ? 0x41 : 0x42, value, 0x0b);
  return moduleBytes(typeSection, functionSection, exportSection, declarationSection(10, [bytes(u32(body.length), body)]));
}

test('inspects exact exported and imported declarations from a synthetic valid module', () => {
  const fixture = moduleBytes(
    declarationSection(1, [type([i32, i64], [i32]), type([], [i32, i64])]),
    declarationSection(2, [
      importBinding('env', '\uFEFFcall', 0, u32(0)),
      importBinding('env', 'another', 0, u32(1)),
      importBinding('source', 'global', 3, bytes(i64, 0)),
      importBinding('foreign', 'table', 1, bytes(externref, 0, 1)),
    ]),
    declarationSection(4, [bytes(funcref, 1, 1, 3)]),
    declarationSection(5, [bytes(1, 1, 2)]),
    declarationSection(6, [bytes(i32, 1, 0x41, 0x0b, 0x0b)]),
    declarationSection(7, [
      exportBinding('call', 0, 0), exportBinding('multivalue', 0, 1),
      exportBinding('table', 1, 1), exportBinding('memory', 2, 0), exportBinding('global', 3, 1),
    ]),
  );
  assert.equal(validate(fixture), true);
  const report = inspectWasmInterface(fixture);
  assert.equal(report.status, 'complete');
  assert.equal(report.coverage.host_validation, 'accepted');
  assert.deepEqual(report.imports[0], { module: 'env', name: '\uFEFFcall', kind: 'function', type: { parameters: ['i32', 'i64'], results: ['i32'] } });
  assert.deepEqual(report.exports, [
    { name: 'call', kind: 'function', type: { parameters: ['i32', 'i64'], results: ['i32'] } },
    { name: 'multivalue', kind: 'function', type: { parameters: [], results: ['i32', 'i64'] } },
    { name: 'table', kind: 'table', type: { element_type: 'funcref', address_type: 'i32', minimum: '1', maximum: '3' } },
    { name: 'memory', kind: 'memory', type: { address_type: 'i32', minimum: '1', maximum: '2', shared: false } },
    { name: 'global', kind: 'global', type: { value_type: 'i32', mutable: true } },
  ]);
  assert.deepEqual(report.unknowns, []);
  const reflected = new Module(fixture);
  assert.deepEqual(report.imports.map(({ module, name: item, kind }) => ({ module, name: item, kind })), Module.imports(reflected));
  assert.deepEqual(report.exports.map(({ name: item, kind }) => ({ name: item, kind })), Module.exports(reflected));
  const { receipt_sha256, ...receipt } = report;
  assert.equal(receipt_sha256, digest(receipt));
});

test('module bytes can change without changing the ABI fingerprint', () => {
  const reference = definitionModule(), candidate = definitionModule(i32, 24, 'get', true);
  assert.equal(validate(reference), true);
  assert.equal(validate(candidate), true);
  const report = compareWasmInterfaces(reference, candidate);
  assert.equal(report.status, 'same-interface');
  assert.notEqual(report.reference.sha256, report.candidate.sha256);
  assert.equal(report.reference.abi_sha256, report.candidate.abi_sha256);
  assert.deepEqual(report.changes, []);
  assert.equal(report.counts.unchanged, 1);
  assert.deepEqual(report, compareWasmInterfaces(reference, candidate));
});

test('reports changed types and removed and added declarations in public names', () => {
  const reference = definitionModule(), candidate = definitionModule(i64);
  assert.equal(validate(candidate), true);
  const changed = compareWasmInterfaces(reference, candidate);
  assert.equal(changed.status, 'changed-interface');
  assert.equal(changed.counts.type_changed, 1);
  assert.deepEqual(changed.changes, [{
    side: 'export', name: 'get', status: 'type-changed',
    reference: [{ kind: 'function', type: { parameters: [], results: ['i32'] }, occurrences: 1 }],
    candidate: [{ kind: 'function', type: { parameters: [], results: ['i64'] }, occurrences: 1 }],
  }]);
  assert.notEqual(changed.reference.abi_sha256, changed.candidate.abi_sha256);

  const renamed = compareWasmInterfaces(reference, definitionModule(i32, 1, 'next'));
  assert.deepEqual(renamed.changes.map(({ name: item, status }) => [item, status]), [['get', 'removed'], ['next', 'added']]);
});

test('retains independent import names and compares repeated declarations as multisets', () => {
  const first = importBinding('a\0b', 'c', 0, u32(0));
  const second = importBinding('a', 'b\0c', 0, u32(0));
  const types = declarationSection(1, [type([], [])]);
  const before = moduleBytes(types, declarationSection(2, [first, second, first]));
  const reordered = moduleBytes(types, declarationSection(2, [second, first, first]));
  const reduced = moduleBytes(types, declarationSection(2, [second, first]));
  assert.equal(validate(before), true);
  assert.equal(validate(reordered), true);
  assert.equal(compareWasmInterfaces(before, reordered).status, 'same-interface');
  const diff = compareWasmInterfaces(before, reduced);
  assert.equal(diff.status, 'changed-interface');
  assert.equal(diff.counts.occurrences_changed, 1);
  assert.equal(diff.counts.unchanged, 1);
  assert.deepEqual(diff.changes.map(({ side, module, name: item, status, reference, candidate }) => [
    side, module, item, status, reference[0].occurrences, candidate[0].occurrences,
  ]), [['import', 'a\0b', 'c', 'occurrences-changed', 2, 1]]);
});

test('keeps signed initializer widths, exception tags, and data-count section order', () => {
  const fixture = moduleBytes(
    declarationSection(1, [type([i32], [])]),
    declarationSection(13, [bytes(0, 0)]),
    declarationSection(6, [bytes(i32, 0, 0x41, 0x80, 0x80, 0x80, 0x80, 0x78, 0x0b)]),
    declarationSection(7, [exportBinding('event', 4, 0), exportBinding('minimum', 3, 0)]),
    section(12, u32(0)),
    declarationSection(10, []),
    declarationSection(11, []),
  );
  assert.equal(validate(fixture), true);
  assert.deepEqual(inspectWasmInterface(fixture).exports, [
    { name: 'event', kind: 'tag', type: { parameters: ['i32'], results: [] } },
    { name: 'minimum', kind: 'global', type: { value_type: 'i32', mutable: false } },
  ]);
  const wrongSignWidth = moduleBytes(
    declarationSection(6, [bytes(i32, 0, 0x41, 0x80, 0x80, 0x80, 0x80, 8, 0x0b)]),
  );
  assert.equal(inspectWasmInterface(wrongSignWidth).unknowns[0].code, 'wasm_integer');
});

test('distinguishes memory limits and ownership shapes through public imports', () => {
  const memory = (limits) => moduleBytes(declarationSection(2, [importBinding('env', 'arena', 2, limits)]));
  const reference = memory(bytes(1, 1, 2));
  const candidate = memory(bytes(3, 1, 3));
  assert.equal(validate(reference), true);
  assert.equal(validate(candidate), true);
  const changes = compareWasmInterfaces(reference, candidate).changes;
  assert.deepEqual(changes[0].candidate[0].type, { address_type: 'i32', minimum: '1', maximum: '3', shared: true });
  assert.equal(changes[0].status, 'type-changed');
  const reversedLimits = memory(bytes(1, 2, 1));
  assert.equal(inspectWasmInterface(reversedLimits).unknowns[0].code, 'wasm_limits');
});

test('malformed function bodies do not yield a same-interface result', () => {
  const valid = definitionModule(), invalid = Buffer.from(valid);
  invalid[invalid.length - 1] = 0xff;
  assert.equal(validate(invalid), false);
  const diff = compareWasmInterfaces(valid, invalid);
  assert.equal(diff.status, 'unknown');
  assert.equal(diff.counts, null);
  assert.deepEqual(diff.changes, []);
  assert.equal(diff.candidate.exports[0].name, 'get');
  assert.equal(diff.candidate.abi_sha256, null);
  assert.equal(diff.candidate.coverage.host_validation, 'not-accepted');
  assert.deepEqual(diff.unknowns.map(({ side, code }) => [side, code]), [['candidate', 'wasm_not_validated']]);
});

test('rejects incomplete, wrong-version, unordered, and overlong framing', () => {
  const typeSection = declarationSection(1, [type([], [])]);
  const exportSection = declarationSection(7, []);
  for (const [fixture, code] of [
    [header.subarray(0, 7), 'wasm_truncated'],
    [bytes(header.subarray(0, 4), 0x0d, 0, 1, 0), 'wasm_unsupported_header'],
    [moduleBytes(exportSection, typeSection), 'wasm_section_order'],
    [moduleBytes(typeSection, typeSection), 'wasm_section_order'],
    [moduleBytes(bytes(1, 0x80, 0x80, 0x80, 0x80, 0x10)), 'wasm_integer'],
    [moduleBytes(bytes(1, 20, 0)), 'wasm_truncated'],
    [moduleBytes(section(1, bytes(0, 0))), 'wasm_section_size'],
    [moduleBytes(section(1, bytes(0x80, 0))), null], // Valid non-minimal u32 encoding.
    [moduleBytes(section(14, Buffer.alloc(0))), 'wasm_unsupported_section'],
  ]) {
    const report = inspectWasmInterface(fixture);
    assert.equal(report.status, code ? 'unknown' : 'complete', code);
    assert.equal(report.unknowns[0]?.code ?? null, code);
  }
});

test('distinguishes unknown types, invalid UTF-8, and unresolved declaration indices', () => {
  const emptyType = declarationSection(1, [type([], [])]);
  const imported = declarationSection(2, [importBinding('env', 'func', 0, u32(0))]);
  const unknownTypes = declarationSection(1, [bytes(0x4e, 0x01, 0x5f, 0x00)]);
  const badNameImport = declarationSection(2, [bytes(name('env'), 1, 0xff, 0, 0)]);
  const badExport = declarationSection(7, [exportBinding('func', 0, 1)]);
  assert.equal(inspectWasmInterface(moduleBytes(unknownTypes)).unknowns[0].code, 'wasm_unsupported_type');
  assert.equal(inspectWasmInterface(moduleBytes(emptyType, badNameImport)).unknowns[0].code, 'wasm_name');
  assert.equal(inspectWasmInterface(moduleBytes(emptyType, imported, badExport)).unknowns[0].code, 'wasm_index');
});

test('does not instantiate a module with an imported start function', () => {
  const starter = moduleBytes(
    declarationSection(1, [type([], [])]),
    declarationSection(2, [importBinding('effect', 'start', 0, u32(0))]),
    section(8, u32(0)),
  );
  assert.equal(validate(starter), true);
  assert.equal(inspectWasmInterface(starter).status, 'complete');
});

test('constrains input, declaration vectors, and retained symbol sizes', () => {
  const limits = WASM_INTERFACE_LIMITS;
  assert.throws(() => inspectWasmInterface('wasm'), { code: 'wasm_interface_input' });
  assert.throws(() => inspectWasmInterface(Buffer.alloc(limits.max_file_bytes + 1)), { code: 'wasm_interface_limit' });
  const tooManyTypes = moduleBytes(section(1, u32(limits.max_declarations_per_section + 1)));
  assert.equal(inspectWasmInterface(tooManyTypes).unknowns[0].code, 'wasm_interface_limit');
  const overwide = type(Buffer.alloc(limits.max_signature_values + 1, i32), []);
  assert.equal(inspectWasmInterface(moduleBytes(declarationSection(1, [overwide]))).unknowns[0].code, 'wasm_interface_limit');
  const oversized = definitionModule(i32, 1, 'x'.repeat(limits.max_name_bytes + 1));
  assert.equal(inspectWasmInterface(oversized).unknowns[0].code, 'wasm_interface_limit');
});
