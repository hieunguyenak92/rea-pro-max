import { canonical, digest, hashBytes, RpmError } from '../common.mjs';

export const WASM_INTERFACE_LIMITS = Object.freeze({
  max_file_bytes: 8 * 1024 * 1024,
  max_sections: 256,
  max_declarations_per_section: 4096,
  max_public_declarations: 1024,
  max_name_bytes: 1024,
  max_signature_values: 128,
  max_public_receipt_bytes: 1024 * 1024,
  max_initializer_instructions: 256,
});

export const WASM_BEHAVIOR_LIMITS = Object.freeze({
  max_file_bytes: 64 * 1024,
  max_cases: 256,
  max_parameters: 8,
  max_functions: 128,
  max_locals: 128,
  max_instructions_per_function: 256,
});

const HEADER = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
// Core section order differs from section ID order for tags and data counts.
const SECTION_ORDER = new Map([1, 2, 3, 4, 5, 13, 6, 7, 8, 9, 12, 10, 11].map((id, index) => [id, index]));
const KINDS = ['function', 'table', 'memory', 'global', 'tag'];
const REF_TYPES = new Map([[0x70, 'funcref'], [0x6f, 'externref']]);
const VALUE_TYPES = new Map([
  [0x7f, 'i32'], [0x7e, 'i64'], [0x7d, 'f32'], [0x7c, 'f64'], [0x7b, 'v128'], ...REF_TYPES,
]);
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

class Reader {
  constructor(data, start = 0, end = data.length, section = null) {
    this.data = data;
    this.offset = start;
    this.end = end;
    this.section = section;
  }

  fail(code, message) {
    throw new RpmError(code, message, { offset: this.offset, section: this.section });
  }

  take(size) {
    if (size > this.end - this.offset) this.fail('wasm_truncated', 'A field extends beyond its containing section.');
    const start = this.offset;
    this.offset += size;
    return this.data.subarray(start, this.offset);
  }

  byte() {
    if (this.offset >= this.end) this.fail('wasm_truncated', 'A field extends beyond its containing section.');
    return this.data[this.offset++];
  }

  unsigned(bits) {
    let value = 0n;
    for (let shift = 0; shift < bits; shift += 7) {
      const byte = this.byte();
      const payload = byte & 0x7f;
      if (payload >= 2 ** Math.min(7, bits - shift)) this.fail('wasm_integer', 'Unsigned LEB128 exceeds its declared bit width.');
      value |= BigInt(payload) << BigInt(shift);
      if (byte < 0x80) return value;
    }
    this.fail('wasm_integer', 'Unsigned LEB128 is too long.');
  }

  u32() { return Number(this.unsigned(32)); }

  skipSigned(bits) {
    for (let shift = 0; shift < bits; shift += 7) {
      const byte = this.byte();
      if (byte >= 0x80) continue;
      const signRange = 2 ** (Math.min(7, bits - shift) - 1);
      if (byte >= signRange && byte < 128 - signRange) this.fail('wasm_integer', 'Signed LEB128 has inconsistent sign extension.');
      return;
    }
    this.fail('wasm_integer', 'Signed LEB128 is too long.');
  }

  name() {
    const size = this.u32();
    if (size > WASM_INTERFACE_LIMITS.max_name_bytes) this.fail('wasm_interface_limit', 'An import or export name exceeds the byte budget.');
    const bytes = this.take(size);
    try { return utf8.decode(bytes); }
    catch { this.fail('wasm_name', 'An import or export name contains invalid UTF-8.'); }
  }

  vector(read, maximum = WASM_INTERFACE_LIMITS.max_declarations_per_section) {
    const count = this.u32();
    if (count > maximum) this.fail('wasm_interface_limit', 'A declaration vector exceeds the supported bound.');
    if (count > this.end - this.offset) this.fail('wasm_truncated', 'A declaration vector cannot fit in its section.');
    const rows = [];
    for (let index = 0; index < count; index++) rows.push(read());
    return rows;
  }
}

function codedType(reader, values) {
  const type = values.get(reader.byte());
  if (type === undefined) reader.fail('wasm_unsupported_type', 'An extended or unrecognized value or reference type is outside this ABI reader.');
  return type;
}

function functionType(reader) {
  if (reader.byte() !== 0x60) reader.fail('wasm_unsupported_type', 'Only plain function types are supported in the type section.');
  return {
    parameters: reader.vector(() => codedType(reader, VALUE_TYPES), WASM_INTERFACE_LIMITS.max_signature_values),
    results: reader.vector(() => codedType(reader, VALUE_TYPES), WASM_INTERFACE_LIMITS.max_signature_values),
  };
}

function limits(reader, kind) {
  const flags = reader.byte();
  if (flags > 7 || (kind === 'table' && (flags & 2))) reader.fail('wasm_unsupported_limits', 'A table or memory uses unrecognized limits flags.');
  const address_type = flags & 4 ? 'i64' : 'i32';
  const shared = Boolean(flags & 2);
  const minimum = reader.unsigned(64);
  const maximum = flags & 1 ? reader.unsigned(64) : null;
  if ((maximum !== null && maximum < minimum) || (shared && maximum === null)) reader.fail('wasm_limits', 'A table or memory has inconsistent limits.');
  // Decimal strings preserve the exact declared limit for both address types.
  return { address_type, minimum: minimum.toString(), maximum: maximum?.toString() ?? null, ...(kind === 'memory' ? { shared } : {}) };
}

function indexed(reader, declarations) {
  const index = reader.u32();
  if (index >= declarations.length) reader.fail('wasm_index', 'A declaration references a missing type or entity index.');
  return declarations[index];
}

function entityType(reader, kind, types) {
  switch (kind) {
    case 'function': return indexed(reader, types);
    case 'table': return { element_type: codedType(reader, REF_TYPES), ...limits(reader, kind) };
    case 'memory': return limits(reader, kind);
    case 'global': {
      const value_type = codedType(reader, VALUE_TYPES);
      const flag = reader.byte();
      if (flag !== 0 && flag !== 1) reader.fail('wasm_unsupported_global', 'A global uses unrecognized mutability flags.');
      return { value_type, mutable: flag === 1 };
    }
    case 'tag':
      if (reader.byte() !== 0) reader.fail('wasm_unsupported_tag', 'An exception tag uses unrecognized attributes.');
      return indexed(reader, types);
    default: return reader.fail('wasm_unsupported_entity', 'An import or export uses an unrecognized entity kind.');
  }
}

// Advance over constant initializers only to locate the next ABI declaration.
// Initializer values, function bodies and data contents are never returned.
function skipInitializer(reader) {
  for (let count = 0; count < WASM_INTERFACE_LIMITS.max_initializer_instructions; count++) {
    const opcode = reader.byte();
    switch (opcode) {
      case 0x0b: return;
      case 0x41: reader.skipSigned(32); break; // i32.const
      case 0x42: reader.skipSigned(64); break; // i64.const
      case 0x43: reader.take(4); break; // f32.const
      case 0x44: reader.take(8); break; // f64.const
      case 0xd0: reader.skipSigned(33); break; // ref.null
      case 0x23: // global.get
      case 0xd2: reader.u32(); break; // ref.func
      case 0x6a: case 0x6b: case 0x6c: // i32 add/sub/mul
      case 0x7c: case 0x7d: case 0x7e: break; // i64 add/sub/mul
      case 0xfd:
        if (reader.u32() !== 0x0c) reader.fail('wasm_unsupported_initializer', 'A public-ABI section uses an unsupported constant initializer.');
        reader.take(16); // v128.const
        break;
      default: reader.fail('wasm_unsupported_initializer', 'A public-ABI section uses an unsupported constant initializer.');
    }
  }
  reader.fail('wasm_interface_limit', 'A constant initializer exceeds the ABI parsing budget.');
}

function declarationIndex(inspection) {
  const groups = new Map();
  function index(side, rows) {
    for (const { name, module, kind, type } of rows) {
      const key = JSON.stringify([side, module ?? null, name]);
      let group = groups.get(key);
      if (!group) {
        group = { side, name, ...(side === 'import' ? { module } : {}), types: new Map() };
        groups.set(key, group);
      }
      const fingerprint = canonical({ kind, type });
      const declaration = group.types.get(fingerprint);
      if (declaration) declaration.occurrences++;
      else group.types.set(fingerprint, { kind, type, occurrences: 1 });
    }
  }
  index('import', inspection.imports);
  index('export', inspection.exports);
  return new Map(Array.from(groups).sort((a, b) => compareText(a[0], b[0])).map(([key, { types, ...group }]) => [
    key, { ...group, declarations: Array.from(types).sort((a, b) => compareText(a[0], b[0])).map(([, value]) => value) },
  ]));
}

function readModule(data, state) {
  const reader = new Reader(data);
  if (!reader.take(HEADER.length).equals(HEADER)) reader.fail('wasm_unsupported_header', 'Expected a WebAssembly core module with binary version 1.');
  let lastSection = -1;
  let types = [];
  const entities = Object.fromEntries(KINDS.map(kind => [kind, []]));
  const exportNames = new Set();
  let publicBytes = 0;
  function retain(declaration, destination, section) {
    publicBytes += Buffer.byteLength(canonical(declaration));
    if (publicBytes > WASM_INTERFACE_LIMITS.max_public_receipt_bytes ||
        state.imports.length + state.exports.length >= WASM_INTERFACE_LIMITS.max_public_declarations) {
      section.fail('wasm_interface_limit', 'Public interface declarations exceed the receipt budget.');
    }
    destination.push(declaration);
  }

  while (reader.offset < reader.end) {
    if (state.sections_seen >= WASM_INTERFACE_LIMITS.max_sections) reader.fail('wasm_interface_limit', 'The module has too many sections.');
    const id = reader.byte();
    const payloadSize = reader.u32();
    const start = reader.offset;
    reader.take(payloadSize);
    state.sections_seen++;
    if (id === 0) continue;
    const order = SECTION_ORDER.get(id);
    if (order === undefined) reader.fail('wasm_unsupported_section', 'The module contains an unrecognized standard section.');
    if (order <= lastSection) reader.fail('wasm_section_order', 'Standard sections must be ordered and unique.');
    lastSection = order;
    const section = new Reader(data, start, start + payloadSize, id);

    switch (id) {
      case 1:
        types = section.vector(() => functionType(section));
        break;
      case 2:
        section.vector(() => {
          const module = section.name();
          const name = section.name();
          const kind = KINDS[section.byte()];
          const type = entityType(section, kind, types);
          entities[kind].push(type);
          retain({ module, name, kind, type }, state.imports, section);
        });
        break;
      case 3: case 4: case 5: case 6: case 13: {
        const kind = { 3: 'function', 4: 'table', 5: 'memory', 6: 'global', 13: 'tag' }[id];
        const definitions = section.vector(() => {
          const type = entityType(section, kind, types);
          if (kind === 'global') skipInitializer(section);
          return type;
        });
        entities[kind].push(...definitions);
        break;
      }
      case 7:
        section.vector(() => {
          const name = section.name();
          if (exportNames.has(name)) section.fail('wasm_export_duplicate', 'The module declares a duplicate export name.');
          exportNames.add(name);
          const kind = KINDS[section.byte()];
          if (kind === undefined) section.fail('wasm_unsupported_entity', 'An export uses an unrecognized entity kind.');
          retain({ name, kind, type: indexed(section, entities[kind]) }, state.exports, section);
        });
        break;
      default:
        continue; // The platform validator validates body/start/segment contents.
    }
    if (section.offset !== section.end) section.fail('wasm_section_size', 'A declaration section has unconsumed bytes.');
  }
}

/** Inspect public ABI declarations without instantiating or executing the module. */
export function inspectWasmInterface(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new RpmError('wasm_interface_input', 'Supply WebAssembly module bytes.');
  if (bytes.byteLength > WASM_INTERFACE_LIMITS.max_file_bytes) throw new RpmError('wasm_interface_limit', 'The module exceeds the eight MiB input budget.');
  const data = Buffer.from(bytes);
  const state = { sections_seen: 0, imports: [], exports: [] };
  const unknowns = [];
  let validation = 'skipped';
  try {
    readModule(data, state);
    if (typeof globalThis.WebAssembly?.validate !== 'function') {
      validation = 'unavailable';
      unknowns.push({ code: 'wasm_validator_unavailable', message: 'Module validation is unavailable in this Node runtime.' });
    } else if (globalThis.WebAssembly.validate(data)) {
      validation = 'accepted';
    } else {
      validation = 'not-accepted';
      unknowns.push({ code: 'wasm_not_validated', message: 'The host validator rejected malformed content or an unavailable module feature.' });
    }
  } catch (error) {
    if (!(error instanceof RpmError)) throw error;
    unknowns.push({ code: error.code, message: error.message, ...error.details });
  }
  const complete = unknowns.length === 0;
  const result = {
    schema_version: 1,
    kind: 'wasm-interface',
    status: complete ? 'complete' : 'unknown',
    authority: 'bounded-static',
    sha256: hashBytes(data),
    bytes: data.length,
    abi_sha256: complete ? digest([...declarationIndex(state).values()]) : null,
    imports: state.imports,
    exports: state.exports,
    unknowns,
    coverage: {
      complete,
      sections_seen: state.sections_seen,
      retained_imports: state.imports.length,
      retained_exports: state.exports.length,
      host_validation: validation,
      validator_node: process.versions.node,
      validator_v8: process.versions.v8,
    },
  };
  return { ...result, receipt_sha256: digest(result) };
}

/** Compare declared interface shapes, using multiset semantics for repeated imports. */
export function compareWasmInterfaces(referenceBytes, candidateBytes) {
  const reference = inspectWasmInterface(referenceBytes);
  const candidate = inspectWasmInterface(candidateBytes);
  const complete = reference.coverage.complete && candidate.coverage.complete;
  const changes = [];
  const counts = complete ? { unchanged: 0, added: 0, removed: 0, type_changed: 0, occurrences_changed: 0 } : null;
  if (complete) {
    const before = declarationIndex(reference);
    const after = declarationIndex(candidate);
    for (const key of [...new Set([...before.keys(), ...after.keys()])].sort(compareText)) {
      const previous = before.get(key), next = after.get(key);
      const { declarations, ...identity } = previous ?? next;
      if (!previous) {
        counts.added++;
        changes.push({ ...identity, status: 'added', candidate: declarations });
      } else if (!next) {
        counts.removed++;
        changes.push({ ...identity, status: 'removed', reference: declarations });
      } else if (canonical(previous.declarations) === canonical(next.declarations)) {
        counts.unchanged++;
      } else {
        const signature = rows => rows.map(({ kind, type }) => ({ kind, type }));
        const sameTypes = canonical(signature(previous.declarations)) === canonical(signature(next.declarations));
        const status = sameTypes ? 'occurrences-changed' : 'type-changed';
        counts[sameTypes ? 'occurrences_changed' : 'type_changed']++;
        changes.push({ ...identity, status, reference: previous.declarations, candidate: next.declarations });
      }
    }
  }
  const result = {
    schema_version: 1,
    kind: 'wasm-interface-comparison',
    status: complete ? (changes.length ? 'changed-interface' : 'same-interface') : 'unknown',
    authority: 'bounded-static',
    reference,
    candidate,
    changes,
    counts,
    unknowns: [...reference.unknowns.map(issue => ({ side: 'reference', ...issue })), ...candidate.unknowns.map(issue => ({ side: 'candidate', ...issue }))],
    scope: 'Declared import and export names, kinds and supported core WebAssembly types. Equal declarations leave behavior, toolchain compatibility, runtime linking and Component Model interfaces unverified.',
  };
  return { ...result, receipt_sha256: digest(result) };
}

// Core operations with no immediates, host calls, allocation, or control transfers.
// i32.eqz..ge_u, i32.clz..rotr, drop, select, unreachable.
function simpleI32Opcode(opcode) {
  return (opcode >= 0x45 && opcode <= 0x4f) || (opcode >= 0x67 && opcode <= 0x78)
    || opcode === 0x00 || opcode === 0x1a || opcode === 0x1b;
}

function verifyPureI32Code(section) {
  const { max_functions, max_locals, max_instructions_per_function } = WASM_BEHAVIOR_LIMITS;
  const count = section.u32();
  if (count > max_functions) section.fail('wasm_behavior_limit', 'Too many function bodies.');
  for (let index = 0; index < count; index++) {
    const size = section.u32();
    const start = section.offset;
    section.take(size);
    const body = new Reader(section.data, start, section.offset, 10);
    const groups = body.u32();
    if (groups > max_locals) body.fail('wasm_behavior_limit', 'Too many local declaration groups.');
    let locals = 0;
    for (let group = 0; group < groups; group++) {
      locals += body.u32();
      if (locals > max_locals) body.fail('wasm_behavior_limit', 'Too many local variables.');
      if (body.byte() !== 0x7f) body.fail('wasm_behavior_unsupported', 'Only i32 locals are supported.');
    }
    let ended = false;
    for (let instruction = 0; instruction <= max_instructions_per_function; instruction++) {
      const opcode = body.byte();
      if (opcode === 0x0b) {
        ended = true;
        break;
      }
      if (opcode === 0x41) body.skipSigned(32);
      else if (opcode >= 0x20 && opcode <= 0x22) body.u32();
      else if (!simpleI32Opcode(opcode)) {
        body.fail('wasm_behavior_unsupported', 'The body uses an operation outside straight-line i32 evaluation.');
      }
    }
    if (!ended) body.fail('wasm_behavior_limit', 'The function exceeds the instruction budget.');
    if (body.offset !== body.end) body.fail('wasm_behavior_unsupported', 'The function has code after its end.');
  }
  if (section.offset !== section.end) section.fail('wasm_behavior_unsupported', 'Unexpected bytes remain in the code section.');
}

function prepareI32Module(bytes, name) {
  const data = Buffer.from(bytes);
  const inspection = inspectWasmInterface(data);
  if (!inspection.coverage.complete) {
    throw new RpmError('wasm_behavior_unvalidated', 'The host and core ABI parser must accept the module.');
  }
  const selected = inspection.exports.find(entry => entry.name === name);
  if (selected?.kind !== 'function' || selected.type.results.length !== 1 || selected.type.results[0] !== 'i32' ||
      selected.type.parameters.length > WASM_BEHAVIOR_LIMITS.max_parameters ||
      selected.type.parameters.some(type => type !== 'i32')) {
    throw new RpmError('wasm_behavior_signature', 'The named export must be an i32 function within the parameter budget.');
  }
  const moduleReader = new Reader(data, HEADER.length);
  while (moduleReader.offset < moduleReader.end) {
    const id = moduleReader.byte();
    const size = moduleReader.u32();
    const start = moduleReader.offset;
    moduleReader.take(size);
    if (id === 10) verifyPureI32Code(new Reader(data, start, moduleReader.offset, id));
    else if (![0, 1, 3, 7].includes(id)) {
      throw new RpmError('wasm_behavior_unsupported', 'The evaluation subset excludes imports, start functions and module state.', { section: id });
    }
  }
  const { Module, Instance } = globalThis.WebAssembly;
  const instance = new Instance(new Module(data));
  return { arity: selected.type.parameters.length, execute: instance.exports[name] };
}

const isI32 = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

function normalizeI32Contract(contract) {
  const { max_cases, max_parameters } = WASM_BEHAVIOR_LIMITS;
  if (!contract || typeof contract !== 'object' || Array.isArray(contract) ||
      contract.schema_version !== 1 || typeof contract.export_name !== 'string' ||
      !contract.export_name.length || Buffer.byteLength(contract.export_name) > WASM_INTERFACE_LIMITS.max_name_bytes ||
      Object.keys(contract).some(key => !['schema_version', 'export_name', 'inputs', 'domain'].includes(key)) ||
      Object.hasOwn(contract, 'inputs') === Object.hasOwn(contract, 'domain')) {
    throw new RpmError('wasm_behavior_contract', 'Provide schema_version 1, an export_name, and either inputs or domain.');
  }
  if (Object.hasOwn(contract, 'domain')) {
    const domain = contract.domain;
    if (!domain || typeof domain !== 'object' || Array.isArray(domain) || Object.keys(domain).length !== 2 ||
        !isI32(domain.min) || !isI32(domain.max) || domain.max < domain.min || domain.max - domain.min >= max_cases) {
      throw new RpmError('wasm_behavior_contract', 'Provide an inclusive i32 min/max domain of at most 256 inputs.');
    }
    return Array.from({ length: domain.max - domain.min + 1 }, (_, index) => [domain.min + index]);
  }
  if (!Array.isArray(contract.inputs) || !contract.inputs.length || contract.inputs.length > max_cases ||
      contract.inputs.some(row => !Array.isArray(row) || row.length > max_parameters || !row.every(isI32))) {
    throw new RpmError('wasm_behavior_contract', 'Provide one to 256 vectors of up to eight signed i32 inputs.');
  }
  return contract.inputs;
}

function observeI32(execute, input) {
  try { return { kind: 'return', value: execute(...input) }; }
  catch (error) {
    if (!(error instanceof globalThis.WebAssembly.RuntimeError)) throw error;
    return { kind: 'trap' };
  }
}

/** Compare finite signed i32 input/output behavior after validating a bounded, stateless kernel. */
export function compareWasmBehavior(reference, candidate, contract) {
  const inputs = normalizeI32Contract(contract);
  const unknowns = [];
  const modules = [reference, candidate].map((bytes, index) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > WASM_BEHAVIOR_LIMITS.max_file_bytes) {
      throw new RpmError('wasm_behavior_limit', 'Provide core module bytes within the 64 KiB evaluation bound.');
    }
    try {
      const prepared = prepareI32Module(bytes, contract.export_name);
      if (inputs.some(input => input.length !== prepared.arity)) {
        throw new RpmError('wasm_behavior_arity', 'The export parameters do not match the declared inputs.');
      }
      return prepared;
    } catch (error) {
      if (!(error instanceof RpmError)) throw error;
      unknowns.push({ side: index === 0 ? 'reference' : 'candidate', code: error.code, message: error.message, ...error.details });
      return null;
    }
  });
  const cases = unknowns.length ? [] : inputs.map(input => {
    const before = observeI32(modules[0].execute, input);
    const after = observeI32(modules[1].execute, input);
    return { input, reference: before, candidate: after, status: before.kind === after.kind && before.value === after.value ? 'pass' : 'fail' };
  });
  const result = {
    schema_version: 1,
    kind: 'wasm-behavior-comparison',
    status: unknowns.length ? 'unknown' : cases.some(entry => entry.status === 'fail') ? 'fail' : 'pass',
    authority: 'bounded-local-execution',
    reference_sha256: hashBytes(reference),
    candidate_sha256: hashBytes(candidate),
    contract_sha256: digest(contract),
    export_name: contract.export_name,
    coverage: { mode: contract.domain ? 'exhaustive-declared-domain' : 'explicit-inputs', requested: inputs.length, executed: cases.length },
    runtime: { node: process.versions.node, v8: process.versions.v8 },
    cases,
    unknowns,
    scope: 'Compares signed i32 return values or the occurrence of a trap for the declared inputs. Does not compare trap causes, other exports, or untested inputs.',
  };
  return { ...result, receipt_sha256: digest(result) };
}
