# Changelog

## 1.0.0 — 2026-11-19

- Chromium web replay now records network evidence per action. A required channel with missing coverage produces an unknown verdict and legacy captures preserve that gap.
- The browser persistence lab ties a request to the owned server's receipt and checks the saved value after restarting the server and browser.
- Added multi-release JAR profile comparison and execution of a bounded, stateless Wasm i32 subset against declared input contracts.
- Added local Ghidra 12.2 export import and finite native run verification against an independent oracle, with a runnable C reconstruction.
- The local MCP catalog now includes 35 tools. All nine READMEs link the new examples.

## 0.8.0 — 2026-11-18

- Detect lost deployment targets across compiler-produced Apple Mach-O and JVM class files from the CLI and local MCP. Use exact CPU subtypes, per-slice platform minimums and Java preview-release constraints.
- Distinguish universal Mach-O and Java class files sharing the same signature in ordinary artifact inspection.
- Require preserved deployment targets at named paths in a release policy. Reject explicit null rule lists. A known ZIP member change fails a repack rule even when another member cannot be verified.
- Bound directory enumeration as entries arrive, including pending siblings, and retain deterministic traversal order.

## 0.7.0 — local release candidate, 2026-11-18

- Add an executable release policy that combines exact file changes, required paths, verified ZIP repacks, Wasm interfaces and saved HTTP/Playwright assertions.
- Inspect and diff public WebAssembly ABI declarations. Keep unsupported modules unknown and retain host validation details.
- Import one unpacked Playwright v10 context with action timing, page events and bounded companion network statistics. Omit raw traffic, DOM and action inputs.
- Require in-origin observed status evidence in the HAR release check. Retain exact source hashes through partial results.
- Expose the added workflows through 29 MCP tools and standalone CLI commands, with a packaged release fixture and nine localized READMEs.

## 0.6.0 — local release candidate, 2026-11-18

- Compare file and tree snapshots by SHA-256. Identify uniquely relocated content, verified ZIP member changes and repackaged archives with identical verified file contents.
- Validate bounded ZIP members, Intel HEX regions and basic UF2 blocks. Retain header-only coverage for the wider native, model and container catalog.
- Correlate OpenAPI JSON operations with saved HAR requests offline. Preserve ambiguous paths, unobserved declarations, unmatched requests and omission reasons.
- Run typed Chromium replay with reviewed hash-bound patch plans. Preserve earlier attempts when a later patch or replay fails. Restrict MV3 writes to the receiving project and stop before patching incomplete observations.
- Bind MV3 static/runtime correlations to one artifact digest. Saved CLI captures retain reported authority. Keep web screenshot hashes exclusive to the visual verdict.
- Put Craft launcher configuration at server startup and send tools/call only after the checked MCP identity and tool advertisement. Record upstream REA 6.9.0 as a source reference.
- Ship the shared CLI/MCP workflows, owned API example and updated documentation in nine languages.

## 0.4.0 — 2026-11-11

- Add a bounded web recovery IR and contract kernel with route/state/viewport inputs, typed actions, explicit authority/coverage, deterministic diffs, separate behavior versus visual verdicts and dependency-aware counterexample shrinking.
- Add dependency-free Chromium web capture/replay for explicit scenarios and URLs. Receipts retain bounded DOM/layout/storage observations, visual hashes, provider identity and cleanup without claiming whole-application equivalence.
- Add an owned `assets/recovery-web` reference/starter/recovered fixture covering delayed search responses, cancellation, latest-wins ordering, Unicode normalization, empty/error states, localStorage persistence, keyboard focus and responsive markup.
- Add an optional Craft Anything MCP adapter pinned to the audited `0.4.0` commit, with typed aliases, handshake/capability drift checks, bounded JSON-RPC, path admission, cancellation, timeout cleanup and provenance. No Craft source or assets are bundled.
- Extend the independent local MCP server and CLI to expose web capture/replay and the typed provider operations. Runtime/provider execution remains opt-in and local; no automatic installation or arbitrary shell/tool execution is added.
- Record the v0.4 verification scope in [VALIDATION.md](docs/VALIDATION.md), including explicit browser-unavailable limits and the provider audit boundary.

## 0.3.0 — 2026-11-06

- Add optional dependency-free actual Chromium capture/replay for the documented `rpm-kv-v1` MV3 protocol, with disposable profiles/snapshots, distinct reset receipts, retained raw evidence and explicit cleanup status.
- Add an owned persistence recovery project with reference, intentionally faulty starter, independently authored runnable receiving example and replay scenario. The host agent performs the repair; the toolkit executes and verifies the selected finite behavior.
- Extend local MCP to15 tools with hash-checked source evidence and opt-in capture/replay; browser execution requires explicit startup configuration.
- Report unsupported imported source coverage and bounded include/exclude scope; harden JSON admission and CLI current-target bindings.
- Run explicit CLI oracle trials in fresh child processes with bounded output and deadlines; preserve external-reset and sandbox limits.
- Synchronize all nine README languages with recovery usage, execution boundaries and exact support scope. Final measured checks are recorded in [VALIDATION.md](docs/VALIDATION.md).

## 0.2.1 — 2026-11-04

- Canonicalize admitted workspace roots with the native filesystem resolver so Windows short-path aliases and native-resolved absolute inputs identify the same workspace.
- Reject existing output entries explicitly before exclusive export creation, including dangling symlinks on Windows. Retain exclusive creation and the scoped-parent checks.

## 0.2.0 — 2026-11-04

- Add an independent local stdio MCP server with12 tools and bundled officialSDK2.4.0 runtime; current-discovery and legacy clients are exercised.
- Add workspace-contained artifact/JSON access, bounded handles/pages, portable case import/export, revision-safe updates and explicit report exports.
- Keep arbitrary oracle/shell execution outside MCP; its lab runs bundled owned scripts under simulated Chrome APIs.
- Expand the main README and8 substantive translations; move localized documents into `docs/i18n` so the root contains one README.
- Add real-client, scope, paging, cache, input-budget, error, concurrent-revision and concurrency-bound checks; preserve original dependency licenses and reproducible bundle checks.

## 0.1.0

- Independent Claude Code/Codex skill with a bundled Node toolkit.
- Bounded static inspection for JavaScript, web, ManifestV3 and extracted Electron sources, using Acorn with source identities and explicit unknowns.
- Revisioned investigation cases and conservative, capability/effect/budget-filtered experiment ranking.
- Finite output/state/effect/trace comparison with pass, fail and unknown verdicts.
- Bounded stable-failure action reduction and standalone local investigation reports.
- Owned synthetic fixtures, a recorded demonstration,36 task templates and nine README languages.
- Deterministic skill packaging, file/archive checksums and extracted CLI smoke checks.

The [verification record](docs/VALIDATION.md) describes checks actually completed and their limits. Native/mobile task templates require appropriate external tools; they do not certify a bundled runtime integration.
