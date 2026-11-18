import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareDeploymentTargets, inspectDeploymentTargets } from '../skills/rea-pro-max/lib/analysis/deployment-targets.mjs';
import { inspectFormat } from '../skills/rea-pro-max/lib/analysis/formats.mjs';
import { checkRelease } from '../skills/rea-pro-max/lib/release-check.mjs';
import { fileURLToPath } from 'node:url';

const lab = new URL('../skills/rea-pro-max/assets/labs/targets/', import.meta.url);
const fixture = path => readFileSync(new URL(path, lab));
const java11 = fixture('java11/TargetSample.class'), java17 = fixture('java17/TargetSample.class');
const universal = fixture('universal-macos11.o'), thin = fixture('arm64-macos12.o');

test('shared magic resolves by structure in both ordinary inspection and dedicated receipts', () => {
  assert.deepEqual(java11.subarray(0, 4), universal.subarray(0, 4));
  assert.equal(inspectFormat(java11).format, 'jvm-class');
  assert.equal(inspectFormat(universal).format, 'mach-o-fat');
  assert.deepEqual(inspectFormat(thin).metadata.targets, inspectDeploymentTargets(thin).targets);
  const truncated = java11.subarray(0, 10);
  assert.equal(inspectFormat(truncated).confidence, 'signature');
  const unknown = compareDeploymentTargets(truncated, truncated);
  assert.equal(unknown.status, 'unknown');
  assert.ok(unknown.reference.issues.includes('shared_magic_undetermined'));
});

test('declared deployment comparison is directional and retains independent losses and gains', () => {
  const down = compareDeploymentTargets(universal, thin), up = compareDeploymentTargets(thin, universal);
  assert.equal(down.status, 'narrowed');
  assert.deepEqual(down.changes.map(row => row.reason).sort(), ['minimum_os_raised', 'target_removed']);
  assert.equal(down.changes.find(row => row.reason === 'target_removed').reference.architecture, 'x86_64');
  assert.equal(up.status, 'preserved');
  assert.deepEqual(up.changes.map(row => row.reason).sort(), ['minimum_os_lowered', 'target_added']);
  assert.equal(compareDeploymentTargets(java11, thin).changes[0].reason, 'format_replaced');
  const same = compareDeploymentTargets(java11, java11);
  assert.deepEqual(same.changes, []);
  assert.equal(same.status, 'preserved');
});

test('preview releases are exact even when the candidate lowers its numerical target', () => {
  const preview = (source, major) => {
    const bytes = Buffer.from(source);
    bytes.writeUInt16BE(65535, 4);
    bytes.writeUInt16BE(major, 6);
    return bytes;
  };
  const preview17 = preview(java17, 61), preview18 = preview(java17, 62);
  assert.equal(compareDeploymentTargets(preview18, preview17).changes[0].reason, 'preview_release_changed');
  assert.equal(compareDeploymentTargets(java17, preview17).status, 'narrowed');
  assert.equal(compareDeploymentTargets(preview17, java17).status, 'preserved');
  assert.equal(compareDeploymentTargets(preview18, java17).status, 'preserved');
});

test('release and standalone commands bind the same comparison to independently compiled Java fixtures', async () => {
  const diff = compareDeploymentTargets(java11, java17);
  const result = await checkRelease(fileURLToPath(new URL('policy.json', lab)));
  assert.deepEqual(result.checks.map(row => row.status), ['pass', 'fail']);
  assert.equal(result.checks[1].comparison_sha256, diff.receipt_sha256);
  assert.deepEqual(result.checks[1].changes.map(row => row.reason), ['minimum_java_raised']);
});
