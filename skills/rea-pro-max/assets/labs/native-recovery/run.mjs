import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { hashBytes, readBoundedBytes } from '../../../lib/common.mjs';
import { compareNativeRuns, identifyNativeBinary, NATIVE_LIMITS } from '../../../lib/native-recovery/native.mjs';
import { expectedQuotes } from './oracle.mjs';

const { values } = parseArgs({
  options: { out: { type: 'string' }, arch: { type: 'string', multiple: true } },
});
const hostArchitecture = { arm64: 'arm64', x64: 'x86_64' }[process.arch];
if (!hostArchitecture || !['darwin', 'linux'].includes(process.platform) || !values.out) {
  throw new Error('Use a macOS/Linux arm64 or x86-64 host and supply --out <new directory>.');
}
const requested = values.arch ?? [hostArchitecture];
if (new Set(requested).size !== requested.length ||
    requested.some(arch => arch !== hostArchitecture && !(arch === 'x86_64' && hostArchitecture === 'arm64' && process.platform === 'darwin'))) {
  throw new Error('Select the native architecture or x86_64 via Rosetta on arm64 macOS.');
}

const source = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(values.out);
const contract = 'rpm-native-u8-u16-v1';
const compiler = process.env.CC || 'cc';
const harness = join(source, 'harness.c');
const manifest = { schema_version: 1, kind: 'rpm-native-owned-lab', contract, results: [] };

function execute(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024, timeout: 30_000, cwd: out });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.error?.code ?? result.status}): ${(result.stderr ?? '').slice(0, 1200)}`);
  }
  return result.stdout;
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
}

function buildAndRecord(dir, arch, flags, compilerVersion, label, file) {
  const implementation = join(source, file);
  const outputFile = join(dir, label + '.bin');
  execute(compiler, [...flags, harness, implementation, '-o', outputFile]);
  const output = readBoundedBytes(outputFile, NATIVE_LIMITS.binary_bytes);
  const binaryId = identifyNativeBinary(output);
  const translated = arch !== hostArchitecture;
  const stdout = translated ? execute('/usr/bin/arch', ['-x86_64', outputFile]) : execute(outputFile, []);
  const [reportedArchitecture, ...lines] = stdout.trimEnd().split('\n');
  if (arch !== binaryId.architecture || arch !== reportedArchitecture || lines.length !== NATIVE_LIMITS.input_count) {
    throw new Error('Binary header, requested architecture, or runtime output disagree.');
  }
  const rows = lines.map(line => {
    if (!/^\d{1,3} \d{1,5}$/u.test(line)) throw new Error('Unexpected output from owned harness.');
    const [input, result] = line.split(' ').map(Number);
    return { input, output: result };
  });
  const doc = {
    schema_version: 1, kind: 'rpm-native-run', contract, complete: true, rows,
    build: {
      binary_sha256: hashBytes(output),
      implementation_sha256: hashBytes(readBoundedBytes(implementation, 8192)),
      harness_sha256: hashBytes(readBoundedBytes(harness, 8192)),
      compiler: compilerVersion,
      flags,
    },
    runtime: {
      architecture: arch, os: process.platform, os_release: release(),
      mode: translated ? 'translated' : 'native', host_architecture: hostArchitecture,
    },
  };
  writeJson(join(dir, label + '.json'), doc);
  return doc;
}

mkdirSync(out);
const compilerVersion = execute(compiler, ['--version']).split('\n')[0];
const oracle = {
  schema_version: 1, kind: 'rpm-native-oracle', contract, complete: true,
  oracle: { provider: 'pricing-rate-recurrence', source_sha256: hashBytes(readBoundedBytes(join(source, 'oracle.mjs'), 8192)) },
  rows: expectedQuotes(),
};
for (const arch of requested) {
  for (const [optimization, debug] of [['O0', 'g'], ['O2', 'g0']]) {
    const profile = `${arch}-${optimization}-${debug}`;
    const dir = join(out, profile);
    mkdirSync(dir);
    const flags = ['-std=c11', `-${optimization}`, `-${debug}`, '-Wall', '-Wextra', '-Werror'];
    if (process.platform === 'darwin') flags.push('-arch', arch);
    const reference = buildAndRecord(dir, arch, flags, compilerVersion, 'reference', 'reference.c');
    const candidate = buildAndRecord(dir, arch, flags, compilerVersion, 'candidate', 'recovered.c');
    const negative = buildAndRecord(dir, arch, flags, compilerVersion, 'negative', 'negative.c');
    const result = compareNativeRuns(reference, candidate, oracle);
    const counterexample = compareNativeRuns(reference, negative, oracle);
    writeJson(join(dir, 'oracle.json'), oracle);
    writeJson(join(dir, 'verification.json'), result);
    writeJson(join(dir, 'counterexample.json'), counterexample);
    if (result.status !== 'pass' || result.compared !== 256 ||
        counterexample.status !== 'fail' || counterexample.differences.length !== 1 ||
        counterexample.differences[0].input !== 173) throw new Error(`Unexpected fixture result for ${profile}.`);
    manifest.results.push({
      profile, runtime: reference.runtime, compiler: compilerVersion, flags,
      compared: result.compared, recovered: result.status, negative: counterexample.status,
      counterexample: counterexample.differences[0],
      verification_sha256: result.receipt_sha256, counterexample_sha256: counterexample.receipt_sha256,
    });
  }
}
writeJson(join(out, 'summary.json'), manifest);
console.log(JSON.stringify(manifest, null, 2));
