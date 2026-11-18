import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compareWasmBehavior, compareWasmInterfaces } from '../skills/rea-pro-max/lib/analysis/wasm-interface.mjs';

const fixture = side => readFileSync(new URL('../skills/rea-pro-max/assets/labs/release/' + side + '/engine.wasm', import.meta.url));
const getContract = { schema_version: 1, export_name: 'get', inputs: [[]] };

function moduleWithI32Function(instructions, extraSection = []) {
  const body = [0, ...instructions, 0x0b];
  return Buffer.from([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    1, 6, 1, 0x60, 1, 0x7f, 1, 0x7f,
    3, 2, 1, 0,
    ...extraSection,
    7, 5, 1, 1, 0x66, 0, 0,
    10, body.length + 2, 1, body.length, ...body,
  ]);
}

test('two independently executed Wasm functions can have equal ABI and different output', () => {
  const before = fixture('reference'), after = fixture('candidate');
  assert.equal(compareWasmInterfaces(before, after).status, 'same-interface');
  const result = compareWasmBehavior(before, after, getContract);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.cases, [{
    input: [], reference: { kind: 'return', value: 1 }, candidate: { kind: 'return', value: 2 }, status: 'fail',
  }]);
});

test('reports exhaustive declared domain rather than general equivalence', () => {
  const identity = moduleWithI32Function([0x20, 0x00]);
  const addZero = moduleWithI32Function([0x20, 0x00, 0x41, 0x00, 0x6a]);
  const contract = { schema_version: 1, export_name: 'f', domain: { min: 0, max: 255 } };
  const result = compareWasmBehavior(identity, addZero, contract);
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.coverage, { mode: 'exhaustive-declared-domain', requested: 256, executed: 256 });
  assert.equal(result.cases[255].candidate.value, 255);
});

test('does not execute valid modules with control flow or state outside the subset', () => {
  const identity = moduleWithI32Function([0x20, 0x00]);
  const loop = moduleWithI32Function([0x03, 0x40, 0x0c, 0x00, 0x0b, 0x41, 0]);
  const memory = moduleWithI32Function([0x20, 0x00], [5, 3, 1, 0, 0]);
  for (const module of [loop, memory]) {
    assert.equal(globalThis.WebAssembly.validate(module), true);
    const result = compareWasmBehavior(identity, module, { ...getContract, export_name: 'f', inputs: [[7]] });
    assert.equal(result.status, 'unknown');
    assert.equal(result.coverage.executed, 0);
    assert.equal(result.unknowns[0].code, 'wasm_behavior_unsupported');
  }
});

test('distinguishes trap from signed numeric return and rejects coercive inputs', () => {
  const identity = moduleWithI32Function([0x20, 0x00]);
  const trap = moduleWithI32Function([0x00]);
  const contract = { ...getContract, export_name: 'f', inputs: [[-2147483648]] };
  const result = compareWasmBehavior(identity, trap, contract);
  assert.deepEqual(result.cases[0].reference, { kind: 'return', value: -2147483648 });
  assert.deepEqual(result.cases[0].candidate, { kind: 'trap' });
  assert.equal(result.status, 'fail');
  assert.throws(() => compareWasmBehavior(identity, trap, { ...contract, inputs: [[2147483648]] }), {
    code: 'wasm_behavior_contract',
  });
});
