// Reads class-file target metadata and outer framing (JVMS §4.1, §4.4–4.7).
// Code and other member attributes remain opaque. No class loading or verification occurs.
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_MAJOR = 71; // Java SE 27
const UTF8 = 1;
const CLASS = 7;
const NAME_AND_TYPE = 12;
const OBJECT = Buffer.from('java/lang/Object');
const MODULE_INFO = Buffer.from('module-info');
const MODULE = Buffer.from('Module');
const BOOTSTRAPS = Buffer.from('BootstrapMethods');

class FormatError extends Error {}
function invalid(code) { throw new FormatError(code); }

class Reader {
  constructor(bytes) { this.bytes = bytes; this.pos = 0; }
  take(length) {
    if (length > this.bytes.length - this.pos) invalid('truncated-class');
    const start = this.pos;
    this.pos += length;
    return start;
  }
  u1() { return this.bytes[this.take(1)]; }
  u2() { return this.bytes.readUInt16BE(this.take(2)); }
  u4() { return this.bytes.readUInt32BE(this.take(4)); }
}

// Modified UTF-8 uses two bytes for NUL and encodes surrogate code units separately.
function checkUtf8(bytes, start, end) {
  for (let i = start; i < end;) {
    const first = bytes[i++];
    if (first >= 1 && first < 0x80) continue;
    if (i >= end) invalid('invalid-modified-utf8');
    const second = bytes[i++];
    if ((second & 0xc0) !== 0x80) invalid('invalid-modified-utf8');
    if (first === 0xc0 && second === 0x80) continue;
    if (first >= 0xc2 && first < 0xe0) continue;
    if (first < 0xe0 || first > 0xef || (first === 0xe0 && second < 0xa0)
      || i >= end || (bytes[i++] & 0xc0) !== 0x80) invalid('invalid-modified-utf8');
  }
}

function poolTable(reader, major) {
  const { bytes } = reader;
  const count = reader.u2();
  if (count < 2 || count > bytes.length) invalid('invalid-pool-count');
  const tags = new Uint8Array(count);
  const starts = new Uint32Array(count);
  let needsModule = false;
  let highestBootstrap = -1;
  for (let i = 1; i < count; i++) {
    const tag = reader.u1();
    tags[i] = tag;
    starts[i] = reader.pos;
    switch (tag) {
      case UTF8: {
        const length = reader.u2();
        const start = reader.take(length);
        checkUtf8(bytes, start, reader.pos);
        break;
      }
      case 3: case 4: case 9: case 10: case 11: case NAME_AND_TYPE:
        reader.take(4);
        break;
      case 5: case 6:
        reader.take(8);
        if (++i >= count) invalid('invalid-wide-constant');
        break;
      case CLASS: case 8:
        reader.take(2);
        break;
      case 15: case 16: case 18:
        if (major < 51) invalid('constant-before-version');
        reader.take(tag === 15 ? 3 : tag === 16 ? 2 : 4);
        break;
      case 17:
        if (major < 55) invalid('constant-before-version');
        reader.take(4);
        break;
      case 19: case 20:
        if (major < 53) invalid('constant-before-version');
        needsModule = true;
        reader.take(2);
        break;
      default: invalid('unknown-constant-tag');
    }
  }
  function expect(index, ...allowed) {
    if (!allowed.includes(tags[index])) invalid('invalid-constant-reference');
  }
  function utfEquals(index, literal) {
    const offset = starts[index];
    const size = bytes.readUInt16BE(offset);
    return size === literal.length && bytes.subarray(offset + 2, offset + 2 + size).equals(literal);
  }
  function classNamed(index, literal) {
    return utfEquals(bytes.readUInt16BE(starts[index]), literal);
  }
  for (let i = 1; i < count; i++) {
    const tag = tags[i];
    const offset = starts[i];
    switch (tag) {
      case CLASS: case 8: case 16: case 19: case 20:
        expect(bytes.readUInt16BE(offset), UTF8);
        break;
      case 9: case 10: case 11:
        expect(bytes.readUInt16BE(offset), CLASS);
        expect(bytes.readUInt16BE(offset + 2), NAME_AND_TYPE);
        break;
      case NAME_AND_TYPE:
        expect(bytes.readUInt16BE(offset), UTF8);
        expect(bytes.readUInt16BE(offset + 2), UTF8);
        break;
      case 17: case 18:
        highestBootstrap = Math.max(highestBootstrap, bytes.readUInt16BE(offset));
        expect(bytes.readUInt16BE(offset + 2), NAME_AND_TYPE);
        break;
      case 15: {
        const kind = bytes[offset];
        const index = bytes.readUInt16BE(offset + 1);
        if (kind < 1 || kind > 9) invalid('invalid-method-handle');
        if (kind <= 4) expect(index, 9);
        else if (kind === 9) expect(index, 11);
        else if ((kind === 6 || kind === 7) && major >= 52) expect(index, 10, 11);
        else expect(index, 10);
        break;
      }
    }
  }
  return { expect, utfEquals, classNamed, needsModule, highestBootstrap };
}

function kindFromFlags(flags, major) {
  if (flags & 0x8000) {
    if (flags !== 0x8000 || major < 53) invalid('invalid-module-flags');
    return 'module';
  }
  if (major < 49 && (flags & 0x6000)) invalid('unsupported-class-flags');
  if (flags & 0x0200) {
    if (!(flags & 0x0400) || (flags & 0x4030)) invalid('invalid-interface-flags');
    return flags & 0x2000 ? 'annotation' : 'interface';
  }
  if ((flags & 0x2000) || (flags & 0x0410) === 0x0410) invalid('invalid-class-flags');
  return flags & 0x4000 ? 'enum' : 'class';
}

function attributes(reader, pool, visitor) {
  const count = reader.u2();
  for (let i = 0; i < count; i++) {
    const name = reader.u2();
    pool.expect(name, UTF8);
    const length = reader.u4();
    const start = reader.take(length);
    visitor?.(name, start, length);
  }
}

function moduleAttribute(bytes, pool) {
  const payload = new Reader(bytes);
  function indexes(tag, nonempty = false) {
    const count = payload.u2();
    if (!count && nonempty) invalid('invalid-module-attribute');
    for (let i = 0; i < count; i++) pool.expect(payload.u2(), tag);
  }
  function header(tag) {
    pool.expect(payload.u2(), tag);
    payload.take(2); // flags
    const version = payload.u2();
    if (version) pool.expect(version, UTF8);
  }
  header(19);
  const requires = payload.u2();
  for (let i = 0; i < requires; i++) header(19);
  for (let section = 0; section < 2; section++) { // exports, opens
    const count = payload.u2();
    for (let i = 0; i < count; i++) {
      pool.expect(payload.u2(), 20);
      payload.take(2);
      indexes(19);
    }
  }
  indexes(CLASS); // uses
  const provides = payload.u2();
  for (let i = 0; i < provides; i++) {
    pool.expect(payload.u2(), CLASS);
    indexes(CLASS, true);
  }
  if (payload.pos !== bytes.length) invalid('invalid-module-attribute');
}

function inspect(bytes) {
  const reader = new Reader(bytes);
  if (reader.u4() !== 0xcafebabe) invalid('not-class-magic');
  const minor = reader.u2();
  const major = reader.u2();
  if (major < 45 || major > MAX_MAJOR) invalid('unsupported-class-version');
  if (major >= 56 && minor !== 0 && minor !== 65535) invalid('invalid-class-minor');
  const pool = poolTable(reader, major);
  const kind = kindFromFlags(reader.u2(), major);
  const self = reader.u2();
  const parent = reader.u2();
  pool.expect(self, CLASS);
  if (parent) pool.expect(parent, CLASS);
  if (kind === 'module') {
    if (parent || !pool.classNamed(self, MODULE_INFO)) invalid('invalid-module-header');
  } else {
    if (pool.needsModule) invalid('unexpected-module-constant');
    if (pool.classNamed(self, OBJECT) !== (parent === 0)) invalid('invalid-superclass');
    if ((kind === 'interface' || kind === 'annotation') && (!parent || !pool.classNamed(parent, OBJECT))) {
      invalid('invalid-interface-superclass');
    }
  }
  const interfaces = reader.u2();
  if (kind === 'module' && interfaces) invalid('invalid-module-members');
  for (let i = 0; i < interfaces; i++) pool.expect(reader.u2(), CLASS);
  for (let table = 0; table < 2; table++) { // fields, then methods
    const count = reader.u2();
    if (kind === 'module' && count) invalid('invalid-module-members');
    for (let i = 0; i < count; i++) {
      reader.take(2); // access_flags
      pool.expect(reader.u2(), UTF8);
      pool.expect(reader.u2(), UTF8);
      attributes(reader, pool);
    }
  }
  let bootstrapCount = -1;
  let hasModule = false;
  attributes(reader, pool, (name, start, length) => {
    if (pool.utfEquals(name, BOOTSTRAPS)) {
      if (bootstrapCount >= 0 || length < 2) invalid('invalid-bootstrap-table');
      const payload = new Reader(bytes.subarray(start, start + length));
      bootstrapCount = payload.u2();
      for (let i = 0; i < bootstrapCount; i++) {
        pool.expect(payload.u2(), 15);
        const args = payload.u2();
        for (let j = 0; j < args; j++) pool.expect(payload.u2(), 3, 4, 5, 6, 7, 8, 15, 16, 17);
      }
      if (payload.pos !== length) invalid('invalid-bootstrap-table');
    } else if (pool.utfEquals(name, MODULE)) {
      if (kind !== 'module' || hasModule || length < 16) invalid('invalid-module-attribute');
      moduleAttribute(bytes.subarray(start, start + length), pool);
      hasModule = true;
    }
  });
  if (pool.highestBootstrap >= 0 && pool.highestBootstrap >= bootstrapCount) invalid('invalid-bootstrap-reference');
  if (kind === 'module' && !hasModule) invalid('missing-module-attribute');
  if (reader.pos !== bytes.length) invalid('trailing-class-data');
  const preview = major >= 56 && minor === 65535;
  // Through Java 11 each release (except 1.1) admitted its newest major only at minor zero.
  const javaRelease = major - 44 + Number(major >= 46 && major <= 55 && minor !== 0);
  const minimumJavaVersion = major === 45 ? (minor <= 3 ? '1.0.2' : '1.1') :
    (javaRelease < 5 ? '1.' + javaRelease : String(javaRelease));
  return { architecture: 'jvm', variant: preview ? 'preview' : 'standard', kind, platform: 'java',
    minimumOS: null, javaRelease, minimumJavaVersion, preview, classMajor: major, classMinor: minor };
}

export function parseJvmTargets(input) {
  try {
    if (!(input instanceof Uint8Array)) invalid('invalid-class-input');
    if (input.byteLength > MAX_BYTES) invalid('class-size-limit');
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    return { format: 'jvm-class', targets: [inspect(bytes)], complete: true, issues: [] };
  } catch (error) {
    if (!(error instanceof FormatError)) throw error;
    return { format: 'jvm-class', targets: [], complete: false, issues: [error.message] };
  }
}
