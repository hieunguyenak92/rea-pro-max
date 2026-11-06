# REA Pro Max — verification record

Recorded 2026-11-06. This record separates executable engine checks, a controlled model and actual app observations. No comparison with another reverse-engineering product was run.

## v0.3 — recovery and actual Chromium provider

The v0.3 checkout uses version `0.3.0` and exposes **15 local MCP tools**. It adds explicit unsupported-source coverage, bounded include/exclude scopes, hash-checked source excerpts, a shared descriptor-based JSON reader, current-target CLI binding checks and isolated CLI oracle trials with a hard child-process deadline. The runtime lane is opt-in and provider-specific: it executes the documented `rpm-kv-v1` MV3 extension protocol in a fresh disposable Chromium profile.

The model and receiving suites pass locally. The full suite reports **144 tests, 142 pass and 2 skipped** when no browser environment variable is supplied; the two skips are the explicit real-Chromium tests. Lint, MCP smoke and vendor checks pass.

On 2026-11-06, Chrome for Testing **156.0.8078.4** on macOS arm64 executed the owned fixtures with Node v26.5.0. The starter intentionally failed after a forced worker stop at `cold-read`, while the independently authored `recovered` implementation matched the durable reference. The run also passed six independently authored acceptance families covering persistence, retry after removal, request-ID conflicts, Unicode/prototype keys, invalid input and mutation semantics. Evidence is retained in [recovery-v0.3.json](evidence/recovery-v0.3.json); it is not a market benchmark or universal extension claim.

The natural-idle case waited 35 seconds without polling or attaching a worker debugger. The worker target was absent before wake, the target-reported boot identity changed, and the recovered value remained available. This is a qualified observation for the recorded Chrome build and fixture, not a claim for every browser version or extension.

Browser-enabled MCP smoke passed both legacy initialization and 2026-07-28 discovery. It exercised source evidence, actual capture, starter replay failure and recovered replay pass. The executable is validated at MCP startup; omitting `--browser` keeps runtime disabled.

## v0.2.1 — MCP and documentation

The first v0.2.0 Windows CI run exposed native/short-path workspace aliases and dangling-symlink export behavior. Version0.2.1 canonicalizes the workspace with the native resolver and rejects existing export entries before exclusive creation. The existing real-client security cases exercise both behaviors.

The independent local stdio server exposes15 tools through the bundled official SDK2.4.0 runtime. Official clients exercise both the legacy initialization path and the current2026-07-28 discovery path. The v0.3 suite passes **142 tests with2 explicit browser skips** without a browser environment. This is protocol/client integration evidence, not a claim that a commercial LLM completed a live task in every named host.

Checks include scoped artifact/JSON access; deterministic bounded paging; opaque session handles; portable case export/import; failed-mutation rollback; concurrent revision conflicts; current case-target binding checks; valid finite fail/unknown results; exclusive HTML/JSON exports; cache eviction; input/model/graph bounds; two concurrent heavy operations; stdout discipline and EOF shutdown.

The56-file self-contained archive is extracted outside the repository. Its server runs without node_modules in its installation. Official current and legacy clients repeat capabilities/catalog, static inspection/evidence paging, case export/import, fixed owned lab, finite mismatch verification and standalone report export. The original CLI help/demo/verify path also passes after extraction. The105-test suite and extracted server checks also pass on local macOS arm64 with Node24.22.2; the Node22 and Node24 archive builds are byte-identical.

`npm run check:vendor` regenerates and compares the pinned SDK/schema bundle and retained license bytes. Complete original SDK Apache-2.0/MIT transition licenses and Zod MIT license are included. Development dependencies require npm; the packaged runtime does not.

The main README is expanded; English remains at root and eight substantive translations live under `docs/i18n`. All nine selectors resolve to the same language destinations. The commands distinguish Git/source archives from the packaged skill ZIP layout. Localization has no professional human/native-speaker review.

For current remote CI status, use [Actions](https://github.com/hieunguyenak92/rea-pro-max/actions). The release publication report records actual remote results separately; a configured matrix is not a completed run. Existing real-app fixture observations below were collected for v0.1 and are retained as dated examples.

## Reproduce the engine checks

```sh
npm ci --ignore-scripts
npm test
npm run lint
npm run check:docs
python3 tools/package_skill.py --check
```

The original v0.1 local Node26 run passed **82 tests** with no skips. The v0.2 local Node22 suite passes **105 tests** with no skips. The suite covers artifact parsing without execution, context/alias ambiguity, conservative unknowns, bounded graph expansion, revision conflicts, stale bindings, finite behavior comparison, event ordering, reset-aware failure reduction, CLI exit codes, inert report embedding and extracted/linked installation paths. A Windows host may skip symlink-only checks when its account lacks symlink privileges. Remote CI status is visible in [Actions](https://github.com/hieunguyenak92/rea-pro-max/actions); the prepared matrix is Node22/24 on Linux/macOS/Windows. Do not infer remote success from this local record.

The skill ZIP is built twice from the same source and checked byte-for-byte. It is extracted outside the checkout; `help`, `demo` and `verify` run without npm, Electron or an upstream REA installation. Internal checksums cover its entries. Release checksums bind bytes, not the truth of imported observations.

## Controlled persistence lab

`demo --out ./rpm-lab` executes this repository's two owned worker scripts in Node VM contexts with simulated Chrome message/storage APIs. It does not execute an arbitrary inspected target.

- Static inspection separates manifest, popup, content-script and worker contexts. Edges retain declared/candidate authority.
- A declared popup-reopen probe has no distinguishing gain for the two known storage explanations. A worker-context reset is ranked first. An unmodeled explanation remains possible.
- The same five actions expose the intentionally faulty worker's lost clips. Persistent writes are recorded as modeled effects.
- The reducer retains `save → restart → read`, with the original mismatch fingerprint, 22 oracle attempts and tested one-minimality. This is not a globally shortest proof.
- A receipt self-comparison exercises the passing verifier path. It is a control, not an independently rebuilt application.

Workers, actual action sequence, reset implementation, Node toolchain and verifier/common source are hashed into model bindings. These are reproducible content identities. The model remains a model.

The [recorded explorer](https://hieunguyenak92.github.io/rea-pro-max/#explorer) reads saved outputs from these operations. It does not attach to a browser or run live target probes.

## Actual web and reconstructed-feature observations

The owned web fixture was served on loopback and exercised through a real in-app browser:

| Action | Visible result |
| --- | --- |
| Search `Ｃａｆé` | NFKC-normalized `café`; record `0001` |
| Search `東京` | Record `0002` |
| Add synthetic note, then reload | Record `0004` retained |

A separate [receiving implementation](../examples/recovered-search/CONTRACT.md) reconstructs only the selected search behavior. It was launched separately and returned `0001` for decomposed `Café` and fullwidth `Ｃａｆé`. Nine finite component checks include accent significance, untrimmed spaces, stable order, duplicates and leading-zero IDs.

This is one worked task authored and checked by the same agent with access to the supplied source fixture. It is not blinded, filesystem-isolated, statistically representative or evidence of a causal performance improvement from installing a skill.

![Reconstructed search running](media/recovered-search.png)

## Actual Electron observation

The owned fixture ran in official npm Electron45.2.2 on macOS arm64. Clicking **Export synthetic records** traversed renderer → preload bridge → `ipcRenderer.invoke` → main handler. The visible main-process response reported a 124-byte local JSON export. Reading that file confirmed two records, including `0001` and `東京`. The inspector separately identified main/preload and candidate IPC boundaries without launching the target; it does not infer runtime causality from those static links.

![Owned Electron runtime response](media/electron-runtime.png)

## Explicitly unverified runtime claims

The v0.3 owned MV3 provider has qualified forced-stop and natural-idle observations on the recorded Chrome for Testing build above. This does not generalize to arbitrary MV3 extensions or every browser/platform. The provider requires the `rpm-kv-v1` response envelope and does not collect every UI/network/file effect. Missing boot evidence, incomplete cleanup or a different browser environment produces incomplete/unknown evidence.

No Android, Apple-device, native-binary, managed-code, Flutter, React Native or WebAssembly semantic provider was exercised. Those task prompts require appropriate host tools. The release does not bundle universal decompilation or certify those integrations. The earlier multi-task evaluation design is a plan, not a completed benchmark.

## Support boundary

Static JavaScript/MV3/extracted Electron analysis and provider-neutral case/planner/verifier/reducer/report machinery are shipped. Input files, AST parsing, contexts, graph records and analysis occurrences have explicit limits; exceeding a hard graph limit fails with `analysis_bounds` so a caller can narrow the artifact. Imported runtime observations retain their stated provenance. A finite pass concerns only comparable supplied cases.

Local reports were checked for navigation, filters, record selection and JSON download; the public landing explorer was checked at desktop and narrow viewport sizes. Screenshots show actual pages/apps, not generated product mockups. Localization has not received a professional human/native-speaker review.
