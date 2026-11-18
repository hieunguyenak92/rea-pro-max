import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REA_6_9_MANIFEST, reviewRea69Receipt } from '../skills/rea-pro-max/lib/providers/rea-6-9.mjs';

const saved = {
  package: 'rea-agents@6.9.0',
  release_tag: 'rea-agents-6.9.0',
  release_commit: 'd74549e',
  doctor: { status: 'ok', reported_tool_count: 255, server: { name: 'rea', version: '6.9.0' } },
  typed_call: { status: 'provider_error' },
};

test('release receipt review retains reported identity and distinguishes a failed analysis', () => {
  const result = reviewRea69Receipt(saved);
  assert.equal(result.release.commit, REA_6_9_MANIFEST.commit);
  assert.equal(result.authority, 'reported');
  assert.deepEqual(result.reported, { handshake_status: 'ok', catalog_count: 255, target_analysis: 'failed' });
  assert.match(result.saved_receipt_sha256, /^[a-f0-9]{64}$/u);
});

test('release receipt review rejects identity drift and never certifies a saved analysis', () => {
  assert.throws(() => reviewRea69Receipt({ ...saved, release_commit: 'another' }), { code: 'upstream_receipt_mismatch' });
  assert.equal(reviewRea69Receipt({ ...saved, typed_call: { status: 'ok' } }).reported.target_analysis, 'unverified');
});
