# MV3 recovery workflow

Version 0.3 includes one executable recovery lane for the documented local `rpm-kv-v1` protocol. It runs a target, compares a deliberately faulty receiving project, and leaves evidence for a repair and replay.

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
