import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJvmTargets } from '../skills/rea-pro-max/lib/analysis/jvm-targets.mjs';

// OpenJDK javac 21.0.12.1 --release 17 -g:none Probe.java; includes invokedynamic.
// final class Probe { static String label(int n) { return "owned-" + n; } }
const compiled = Buffer.from(
  'yv66vgAAAD0AHgoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWEgAAAAgMAAkACgEAF21ha2VDb25jYXRXaXRoQ29uc3RhbnRzAQAVKEkpTGphdmEvbGFuZy9TdHJpbmc7BwAMAQAFUHJvYmUBAARDb2RlAQAFbGFiZWwBABBCb290c3RyYXBNZXRob2RzCAARAQAHb3duZWQtAQ8GABMKABQAFQcAFgwACQAXAQAkamF2YS9sYW5nL2ludm9rZS9TdHJpbmdDb25jYXRGYWN0b3J5AQCYKExqYXZhL2xhbmcvaW52b2tlL01ldGhvZEhhbmRsZXMkTG9va3VwO0xqYXZhL2xhbmcvU3RyaW5nO0xqYXZhL2xhbmcvaW52b2tlL01ldGhvZFR5cGU7TGphdmEvbGFuZy9TdHJpbmc7W0xqYXZhL2xhbmcvT2JqZWN0OylMamF2YS9sYW5nL2ludm9rZS9DYWxsU2l0ZTsBAAxJbm5lckNsYXNzZXMHABoBACVqYXZhL2xhbmcvaW52b2tlL01ldGhvZEhhbmRsZXMkTG9va3VwBwAcAQAeamF2YS9sYW5nL2ludm9rZS9NZXRob2RIYW5kbGVzAQAGTG9va3VwADAACwACAAAAAAACAAAABQAGAAEADQAAABEAAQABAAAABSq3AAGxAAAAAAAIAA4ACgABAA0AAAATAAEAAQAAAAcaugAHAACwAAAAAAACAA8AAAAIAAEAEgABABAAGAAAAAoAAQAZABsAHQAZ',
  'base64',
);

function u2(value) { const bytes = Buffer.alloc(2); bytes.writeUInt16BE(value); return bytes; }
function utf(value) { const bytes = Buffer.from(value); return Buffer.concat([Buffer.of(1), u2(bytes.length), bytes]); }
function minimal({ major = 52, minor = 0, flags = 0x21, extra = [], slots = extra.length, tail } = {}) {
  return Buffer.concat([
    Buffer.from('cafebabe', 'hex'), u2(minor), u2(major), u2(5 + slots),
    utf('Test'), Buffer.of(7, 0, 1), utf('java/lang/Object'), Buffer.of(7, 0, 3), ...extra,
    u2(flags), u2(2), u2(4), tail || Buffer.alloc(8),
  ]);
}

function rejected(bytes, code) {
  const result = parseJvmTargets(bytes);
  assert.deepEqual(result, { format: 'jvm-class', targets: [], complete: false, issues: [code] });
}

test('one independently compiled release-17 class reports only declared target facts', () => {
  assert.deepEqual(parseJvmTargets(compiled), {
    format: 'jvm-class', complete: true, issues: [],
    targets: [{ architecture: 'jvm', variant: 'standard', kind: 'class', platform: 'java', minimumOS: null,
      javaRelease: 17, minimumJavaVersion: '17', preview: false, classMajor: 61, classMinor: 0 }],
  });
});

test('historic nonzero minors advance only the first release which admits that class version', () => {
  for (const [major, minor, expected, javaRelease] of [
    [45, 0, '1.0.2', 1], [45, 3, '1.0.2', 1], [45, 4, '1.1', 1], [45, 65535, '1.1', 1],
    [46, 0, '1.2', 2], [46, 1, '1.3', 3], [48, 65535, '5', 5], [52, 1, '9', 9],
    [55, 65535, '12', 12], [56, 0, '12', 12],
  ]) {
    const [target] = parseJvmTargets(minimal({ major, minor })).targets;
    assert.equal(target.minimumJavaVersion, expected);
    assert.equal(target.javaRelease, javaRelease);
    assert.equal(target.preview, false);
  }
});

test('modern preview marker is tied to an exact release, with unknown future versions withheld', () => {
  for (const major of [56, 71]) {
    const target = parseJvmTargets(minimal({ major, minor: 65535 })).targets[0];
    assert.equal(target.variant, 'preview');
    assert.equal(target.preview, true);
    assert.equal(target.javaRelease, major - 44);
    rejected(minimal({ major, minor: 1 }), 'invalid-class-minor');
  }
  for (const major of [44, 72]) rejected(minimal({ major }), 'unsupported-class-version');
});

test('class, interface, annotation and enum flags remain distinct', () => {
  for (const [flags, kind] of [[0x21, 'class'], [0x601, 'interface'], [0x2601, 'annotation'], [0x4021, 'enum']]) {
    assert.equal(parseJvmTargets(minimal({ flags })).targets[0].kind, kind);
  }
  rejected(minimal({ flags: 0x621 }), 'invalid-interface-flags');
  rejected(minimal({ flags: 0x2000 }), 'invalid-class-flags');
  rejected(minimal({ flags: 0x8000, major: 53 }), 'invalid-module-header');
});

test('truncated compiled class, trailing data, invalid header and over-budget input stay incomplete', () => {
  for (let n = 0; n < compiled.length; n++) assert.equal(parseJvmTargets(compiled.subarray(0, n)).complete, false);
  rejected(Buffer.concat([compiled, Buffer.of(0)]), 'trailing-class-data');
  rejected(Buffer.alloc(4), 'not-class-magic');
  rejected(null, 'invalid-class-input');
  rejected(Buffer.alloc(16 * 1024 * 1024 + 1), 'class-size-limit');
});

test('double-slot constants, pool reference types and constant-version gates are checked', () => {
  const wide = Buffer.concat([Buffer.of(5), Buffer.alloc(8)]);
  assert.equal(parseJvmTargets(minimal({ extra: [wide], slots: 2 })).complete, true);
  rejected(minimal({ extra: [wide] }), 'invalid-wide-constant');
  rejected(minimal({ extra: [wide, Buffer.of(8, 0, 6)], slots: 3 }), 'invalid-constant-reference');
  rejected(minimal({ extra: [Buffer.of(9, 0, 1, 0, 1)] }), 'invalid-constant-reference');
  rejected(minimal({ extra: [Buffer.of(2)] }), 'unknown-constant-tag');
  rejected(minimal({ major: 50, extra: [Buffer.of(16, 0, 1)] }), 'constant-before-version');
  rejected(minimal({ major: 54, extra: [Buffer.of(17, 0, 0, 0, 0)] }), 'constant-before-version');
  rejected(minimal({ major: 53, extra: [Buffer.of(19, 0, 1)] }), 'unexpected-module-constant');
});

test('malformed member attribute bounds and modified UTF-8 are rejected', () => {
  const attr = Buffer.from('0000000000000001000100000020', 'hex');
  rejected(minimal({ tail: attr }), 'truncated-class');
  for (const invalid of [[0], [0x80], [0xc0, 0x81], [0xe0, 0x80, 0x80], [0xf0, 0x90, 0x80, 0x80]]) {
    rejected(minimal({ extra: [utf(invalid)] }), 'invalid-modified-utf8');
  }
  assert.equal(parseJvmTargets(minimal({ extra: [utf([0xc0, 0x80, 0xed, 0xa0, 0x80])] })).complete, true);
});

test('slice views respect offsets and bootstrap method references must be backed by a table', () => {
  const wrapper = Buffer.concat([Buffer.of(0), compiled, Buffer.of(0)]);
  assert.equal(parseJvmTargets(new Uint8Array(wrapper.buffer, wrapper.byteOffset + 1, compiled.length)).complete, true);
  const altered = Buffer.from(compiled);
  const attr = altered.indexOf('BootstrapMethods');
  assert.ok(attr > 0);
  altered[attr] = 0x4e;
  rejected(altered, 'invalid-bootstrap-reference');
});

test('javac module-info has valid module structure and no exported constant-pool names', () => {
  // javac 21.0.12.1 --release 17 -g:none module-info.java, source: module example.probe {}
  const descriptor = Buffer.from(
    'yv66vgAAAD0ACAcAAgEAC21vZHVsZS1pbmZvAQAGTW9kdWxlEwAFAQANZXhhbXBsZS5wcm9iZRMABwEACWphdmEuYmFzZYAAAAEAAAAAAAAAAAABAAMAAAAWAAQAAAAAAAEABoAAAAAAAAAAAAAAAA==',
    'base64',
  );
  const result = parseJvmTargets(descriptor);
  assert.equal(result.complete, true);
  assert.equal(result.targets[0].kind, 'module');
  assert.doesNotMatch(JSON.stringify(result), /example\.probe|java\.base/);
  const altered = Buffer.from(descriptor);
  altered.writeUInt16BE(1, altered.length - 22); // module_name_index must point to a Module.
  rejected(altered, 'invalid-constant-reference');
});
