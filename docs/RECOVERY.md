# MV3 recovery workflow

Version 0.6 includes executable MV3 recovery for the documented local `rpm-kv-v1` protocol. It runs a target, compares a deliberately faulty receiving project, and leaves evidence for a repair and replay. The separate bounded web lane is documented in [WEB-RECOVERY.md](WEB-RECOVERY.md).

The lane is bounded. It executes an unpacked Manifest V3 extension in an explicitly selected local Chromium or Chrome for Testing executable. It does not reconstruct arbitrary extensions automatically, launch arbitrary target code through MCP, or prove unobserved UI, network or file effects. A fresh profile is not an OS or network sandbox.

## Prepare the recovery project

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs recovery init --out ./recovery-work
```

The directory contains `reference/` (durable target), `starter/` (intentional memory-only defect), `recovered/` (independently authored worked example) and `scenario.json`. Read `starter/TASK.md` and `starter/contract.json` before editing. The contract defines validation, revisions, idempotency receipts, capacity limits and the persistence boundary.

## Run the real browser replay

```sh
export RPM_BROWSER="/absolute/path/to/chromium"
node skills/rea-pro-max/scripts/rea-pro-max.mjs runtime doctor --browser "$RPM_BROWSER"
node skills/rea-pro-max/scripts/rea-pro-max.mjs recovery replay \
  --reference ./recovery-work/reference \
  --candidate ./recovery-work/starter \
  --scenario ./recovery-work/scenario.json \
  --browser "$RPM_BROWSER" \
  --out ./before-repair.json
```

The first replay intentionally exits with status `2`: the starter passes its warm read and fails after a qualified forced worker stop. The result retains both executions, boot identities, lifecycle receipts and the first mismatch. Repair `starter/worker.js` against its contract, then replay with a new output path:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs recovery replay \
  --reference ./recovery-work/reference \
  --candidate ./recovery-work/starter \
  --scenario ./recovery-work/scenario.json \
  --browser "$RPM_BROWSER" \
  --out ./after-repair.json
```

Status `0` means the declared message and reset cases compare equal. It is finite evidence for this protocol and scenario, not whole-program equivalence.

## Reset evidence

`page-reopen`, `worker-stop` and `idle` are separate reset types. A worker restart is qualified only when the provider observes the requested lifecycle condition and the extension reports a changed boot identity. The provider does not use a changed DevTools handle as proof. Natural idle waits at least 30 seconds without polling the worker, observes worker absence before wake and then checks the new boot identity.

Raw captures keep boot IDs. The finite comparison excludes only the declared ephemeral `boot_id` envelope field. `state: null` and `effects: []` mean those effects were not collected; they are not empty-state claims.

## MCP path

```sh
node skills/rea-pro-max/scripts/mcp-server.mjs \
  --workspace "/absolute/path/to/workspace" \
  --browser "$RPM_BROWSER"
```

Without `--browser`, runtime tools fail closed with `runtime_disabled`. The browser is startup configuration and cannot be selected by a tool call. The host agent still edits the receiving project.

## Acceptance evidence

The owned acceptance corpus covers acknowledged persistence, retry after removal, request conflicts, Unicode and `__proto__` keys, invalid input and mutation capacity. Model tests exercise worker code under a controlled storage model; real Chromium checks add forced termination and natural idle evidence.

```sh
node --test tests/recovery-contract.test.mjs tests/receiving-recovery.test.mjs
node tools/check-recovery.mjs --browser "$RPM_BROWSER" --out ./runtime-evidence
```

The second command executes only owned fixtures in fresh temporary profiles and records the intentionally failing starter, the recovered example, six acceptance families and a separately qualified natural-idle case.
## Declarative repair and replay

Start with the project created by `recovery init`. Review a candidate patch, compute the current lowercase SHA-256 of its target file and create a plan. Copy the complete `scenario.json` object into `scenario`. A valid plan supplies these fields:

| Field | MV3 example |
| --- | --- |
| `schema_version`, `kind` | `1`, `"mv3"` |
| `candidate_root` | Absolute recovery workspace containing both projects. |
| `browser_executable` | Absolute Chromium executable for CLI runs. |
| `reference_path`, `candidate_path` | `reference`, `starter`, as disjoint directories relative to the workspace. |
| `scenario` | The complete object in the generated `scenario.json`. |
| `max_attempts` | `2` for one before/after replay. Up to eight total. |
| `patches` | Array of workspace-relative `path`, `expected_sha256`, literal `search` and `replace`, and optional `expected_matches` defaulting to one. |

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs recover ./recovery-plan.json --out ./recovery-result.json
```

A patch runs only after a complete failing replay. The engine restricts MV3 changes to the receiving subtree, validates the file identity, SHA-256 and exact match count and replaces the admitted file atomically. Cancellation, a stale patch or incomplete replay returns a receipt with earlier attempts, applied patches and a stop reason. Earlier successful replacements are durable. Run against a stable receiving workspace.

For a web plan, use distinct `reference_url` and `candidate_url` with the web scenario. Operate the receiving server from the patched project so a fresh capture can observe the edit. For MCP, send `plan_path` to `run_recovery`. The server uses its startup Chromium and requires `candidate_root` to name the same workspace.
