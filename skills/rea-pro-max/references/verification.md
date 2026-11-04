# Finite behavior verification

Receipt shape:

```json
{
  "schema_version":1,
  "bindings":{"target_sha256":"64hex","scenario_sha256":"64hex","reset_sha256":"64hex","toolchain_sha256":"64hex","verifier_sha256":"64hex"},
  "complete":true,
  "cases":[{"id":"stable-case","input":{},"output":{},"state":{},"effects":[],"trace":[],"metadata":{"source":"actual run or reported import"}}]
}
```

Replace64hex with actual digests. Reference/candidate target hashes may differ; scenario/reset/toolchain/verifier identity must be comparable. Keep proof bound to the actual build and oracle; stale receipts are historical observations. `contract.expected_bindings` can bind comparison to expected current identities where supported by the verifier.

The contract's trace_order is total or per-channel. Per-channel comparison permits only independent interleaving and preserves within-channel order and duplicates. Exact output/state/effects differences remain failures. Explicit volatile_paths are restricted to metadata; do not normalize primary behavior away. Incomplete/missing/incomparable data yields unknown. These comparisons verify caller-provided observations and their consistency, not that the runtime actually executed.

An oracle module for reduction exports `async oracle(sequence)` and optionally `async reset()`. Return `{status:'mismatch'|'equivalent'|'invalid'|'unknown',fingerprint:'stable failure class'}`. It must use owned/authorized runners and validate preconditions. Shrink explicitly imports/executes that module; ordinary inspect does not. Report elapsed time/tokens only when actually measured, and distinguish controlled models, host-reported observations and real-engine runs.
