import { digest, RpmError } from '../common.mjs';

/** Reference metadata for the independently implemented offline workflows. */
export const REA_6_9_MANIFEST = Object.freeze({
  package: 'rea-agents',
  version: '6.9.0',
  tag: 'rea-agents-6.9.0',
  commit: 'd74549e495c58eb4a560279fd9f05508401ea0a0',
  published_at: '2026-11-12T08:59:13Z',
  license: 'MIT',
  source_url: 'https://github.com/morluto/rea/releases/tag/rea-agents-6.9.0',
  integration: 'independent-offline-workflows',
});

export function reviewRea69Receipt(receipt) {
  if (!receipt || receipt.package !== 'rea-agents@6.9.0' || receipt.release_tag !== REA_6_9_MANIFEST.tag ||
      ![REA_6_9_MANIFEST.commit, REA_6_9_MANIFEST.commit.slice(0, 7)].includes(receipt.release_commit) ||
      receipt.doctor?.server?.name !== 'rea' || receipt.doctor?.server?.version !== REA_6_9_MANIFEST.version) {
    throw new RpmError('upstream_receipt_mismatch', 'The saved receipt does not identify the reviewed REA 6.9.0 release and server.');
  }
  return {
    schema_version: 1,
    kind: 'rea-release-receipt-review',
    release: REA_6_9_MANIFEST,
    authority: 'reported',
    saved_receipt_sha256: digest(receipt),
    reported: {
      handshake_status: receipt.doctor.status === 'ok' ? 'ok' : 'unknown',
      catalog_count: receipt.doctor.reported_tool_count === 255 ? 255 : null,
      target_analysis: receipt.typed_call?.status === 'provider_error' ? 'failed' : 'unverified',
    },
  };
}
