import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { compareJarProfiles, JAR_PROFILE_LIMITS } from '../skills/rea-pro-max/lib/analysis/jar-profiles.mjs';
import { ownedZip } from './fixtures/owned-zip.mjs';

const lab = new URL('../skills/rea-pro-max/assets/labs/jar-profiles/', import.meta.url);
const fixture = name => readFileSync(new URL(name, lab));
const targetLab = new URL('../skills/rea-pro-max/assets/labs/targets/', import.meta.url);
const java11 = readFileSync(new URL('java11/TargetSample.class', targetLab));
const java17 = readFileSync(new URL('java17/TargetSample.class', targetLab));
const manifestPath = 'META-INF/MANIFEST.MF';
const overlayPath = 'META-INF/versions/17/TargetSample.class';
const manifest = (flags = 'Multi-Release: true\r\n') => Buffer.from('Manifest-Version: 1.0\r\n' + flags + '\r\n');
const entry = (name, raw, method = 0) => ({ name, raw, method });

test('compiled JAR fixtures report the effective class and bytes per profile', () => {
  const report = compareJarProfiles(fixture('before.jar'), fixture('after.jar'), [21, 11, 17]);
  assert.equal(report.status, 'different');
  assert.equal(report.complete, true);
  assert.deepEqual(report.profiles.map(({ java, status }) => [java, status]), [
    [11, 'same-selection'], [17, 'different'], [21, 'different'],
  ]);
  const [base, overlay] = report.profiles;
  assert.equal(base.reference[0].path, 'Probe.class');
  assert.equal(base.reference[0].sha256, base.candidate[0].sha256);
  assert.equal(overlay.reference[0].selection_basis, 'highest-eligible-overlay');
  assert.equal(overlay.reference[0].path, 'META-INF/versions/17/Probe.class');
  assert.equal(overlay.reference[0].class_target.javaRelease, 17);
  assert.notEqual(overlay.reference[0].sha256, overlay.candidate[0].sha256);
  assert.deepEqual(overlay.changes, [{ name: 'Probe.class', change: 'modified' }]);
  assert.equal(report.receipt_sha256, compareJarProfiles(fixture('before.jar'), fixture('after.jar'), [11, 17, 21]).receipt_sha256);
});

test('only the manifest main flag activates overlay and the highest eligible directory wins', () => {
  const values = [
    entry('TargetSample.class', java11),
    entry('META-INF/versions/11/TargetSample.class', java11),
    entry('META-INF/versions/017/TargetSample.class', java11),
    entry(overlayPath, java17, 8),
    entry('META-INF/versions/26/TargetSample.class', java17),
  ];
  const active = ownedZip([entry(manifestPath, manifest('mUlTi-ReLeAsE: tR\r\n uE\r\n')), ...values]);
  const inactive = ownedZip([entry(manifestPath, manifest('\r\nName: TargetSample.class\r\nMulti-Release: true\r\n')), ...values]);
  const report = compareJarProfiles(active, inactive, [8, 11, 16, 17, 25, 26]);
  assert.deepEqual(report.profiles.map(row => row.reference[0].release), [8, 11, 11, 17, 17, 26]);
  assert.ok(report.profiles.every(row => row.candidate[0].release === 8));
  assert.equal(report.profiles[1].changes[0].change, 'reselected');
  assert.equal(report.profiles[0].reference[0].target_status, 'newer-java-required');
  const plain = ownedZip(values);
  assert.equal(compareJarProfiles(plain, inactive, [17]).status, 'same-selection');
});

test('an unverified effective class is unknown only where that class was selected', () => {
  const base = [entry(manifestPath, manifest()), entry('TargetSample.class', java11)];
  const good = ownedZip([...base, entry(overlayPath, java17)]);
  const invalid = ownedZip([...base, entry(overlayPath, java17.subarray(0, 8))]);
  const report = compareJarProfiles(good, invalid, [11, 17]);
  assert.equal(report.complete, false);
  assert.equal(report.status, 'unknown');
  assert.equal(report.profiles[0].status, 'same-selection');
  assert.equal(report.profiles[1].status, 'unknown');
  assert.deepEqual(report.profiles[1].issues, [{ name: 'TargetSample.class', code: 'jar_selected_class_unresolved' }]);
  assert.equal(report.profiles[1].candidate[0].path, overlayPath);

  const wrongTarget = ownedZip([...base, entry('META-INF/versions/11/TargetSample.class', java17)]);
  const unresolved = compareJarProfiles(good, wrongTarget, [11]);
  assert.equal(unresolved.status, 'unknown');
  assert.deepEqual(unresolved.profiles[0].candidate[0].issues, ['jar_versioned_class_target_exceeds_directory']);
});

test('a nonstandard version-8 override or a directory alias cannot certify a base selection', () => {
  const base = [entry(manifestPath, manifest()), entry('TargetSample.class', java11)];
  const good = ownedZip(base);
  const nonstandard = ownedZip([...base, entry('META-INF/versions/8/TargetSample.class', java17)]);
  const result = compareJarProfiles(good, nonstandard, [8, 11]);
  assert.equal(result.profiles[0].status, 'same-selection');
  assert.equal(result.profiles[1].status, 'unknown');
  assert.ok(result.profiles[1].candidate[0].issues.includes('jar_versioned_directory_below_nine'));

  const directory = ownedZip([...base, entry(overlayPath + '/', Buffer.alloc(0))]);
  const ambiguous = compareJarProfiles(good, directory, [11, 17]);
  assert.equal(ambiguous.profiles[0].status, 'same-selection');
  assert.equal(ambiguous.profiles[1].status, 'unknown');
  assert.deepEqual(ambiguous.profiles[1].candidate[0].issues, ['jar_class_entry_not_regular']);
});

test('a verified unrelated change survives a second unresolved class', () => {
  const base = [entry(manifestPath, manifest()), entry('TargetSample.class', java11)];
  const before = ownedZip(base);
  const after = ownedZip([entry(manifestPath, manifest()), entry('Nested/Unknown.class', Buffer.of(1, 2))]);
  const report = compareJarProfiles(before, after, [11]);
  assert.equal(report.complete, false);
  assert.equal(report.status, 'different');
  assert.deepEqual(report.profiles[0].changes, [{ name: 'TargetSample.class', change: 'removed' }]);
  assert.equal(report.profiles[0].issues.length, 1);
});

test('partial directory, corrupted manifest, manifest aliases and unsupported codec cannot pass', () => {
  const reference = fixture('before.jar');
  const tooMany = ownedZip(Array.from({ length: JAR_PROFILE_LIMITS.max_members + 1 }, (_, i) => entry(`member-${i}`, Buffer.of(0))));
  for (const [bytes, issue] of [
    [tooMany, 'jar_incomplete_archive'],
    [ownedZip([{ name: manifestPath, raw: manifest(), claimedCrc: 0 }]), 'zip_member_crc_mismatch'],
    [ownedZip([entry(manifestPath, manifest('Multi-Release: true\r\nmulti-release: false\r\n'))]), 'jar_manifest_invalid_or_unsupported'],
    [ownedZip([entry(manifestPath, manifest()), entry(manifestPath.toLowerCase(), manifest())]), 'jar_manifest_ambiguous'],
    [ownedZip([entry(manifestPath, manifest()), entry(overlayPath, java17, 12)]), 'zip_member_codec_unsupported'],
  ]) {
    const report = compareJarProfiles(reference, bytes, [11]);
    assert.equal(report.status, 'unknown');
    assert.ok(report.candidate.issues.includes(issue), report.candidate.issues.join(','));
  }
  for (const profiles of [undefined, [], [11, 11], [11, 7], [11, 28], ['11'], Array(1)]) {
    assert.throws(() => compareJarProfiles(reference, reference, profiles), { code: 'jar_profiles' });
  }
});

const jdk = process.env.RPM_JAVA_HOME;
test('JDK JarFile yields the same class paths and hashes and the JVM reproduces their behavior', { skip: !jdk }, t => {
  const work = mkdtempSync(join(tmpdir(), 'rpm-jar-profiles-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  for (const item of ['SelectClass.java', 'Call.java', 'before.jar', 'after.jar']) copyFileSync(new URL(item, lab), join(work, item));
  function run(tool, args) {
    const executable = join(jdk, 'bin', process.platform === 'win32' ? tool + '.exe' : tool);
    const { status, stdout, stderr, error } = spawnSync(executable, args, { cwd: work, encoding: 'utf8', timeout: 30_000 });
    if (error) throw error;
    assert.equal(status, 0, stderr);
    return stdout.trim();
  }
  run('javac', ['--release', '17', '-proc:none', 'SelectClass.java']);
  run('javac', ['--release', '11', '-proc:none', '-cp', 'before.jar', 'Call.java']);
  const jars = ['before.jar', 'after.jar'];
  const result = compareJarProfiles(...jars.map(fixture), [11, 17, 21]);
  const expected = jars.flatMap((jar, index) => result.profiles.map(profile => {
    const member = (index === 0 ? profile.reference : profile.candidate)[0];
    return [jar, String(profile.java), member.path, member.sha256].join('\t');
  }));
  assert.deepEqual(run('java', ['SelectClass', ...jars]).split(/\r?\n/u), expected);
  for (const [profile, values] of [[11, ['base', 'base']], [17, ['v17', 'changed']]]) {
    const outputs = jars.map(jar => run('java', [`-Djdk.util.jar.version=${profile}`, '-cp', ['.', jar].join(delimiter), 'Call']));
    assert.deepEqual(outputs, values);
  }
  assert.deepEqual(jars.map(jar => run('java', ['-cp', ['.', jar].join(delimiter), 'Call'])), ['v17', 'changed']);
});
