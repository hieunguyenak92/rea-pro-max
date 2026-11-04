# REA Pro Max v0.1.0 — verification record

Recorded 2026-11-04. This record separates executable engine checks, a controlled model and actual app observations. No comparison with another reverse-engineering product was run.

## Reproduce the engine checks

```sh
npm ci --ignore-scripts
npm test
npm run lint
npm run check:docs
python3 tools/package_skill.py --check
```

The local Node26 run passes **82 tests** with no skips. The suite covers artifact parsing without execution, context/alias ambiguity, conservative unknowns, bounded graph expansion, revision conflicts, stale bindings, finite behavior comparison, event ordering, reset-aware failure reduction, CLI exit codes, inert report embedding and extracted/linked installation paths. A Windows host may skip symlink-only checks when its account lacks symlink privileges. Remote CI status is visible in [Actions](https://github.com/hieunguyenak92/rea-pro-max/actions); the prepared matrix is Node22/24 on Linux/macOS/Windows. Do not infer remote success from this local record.

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

A real Chromium MV3 cold-worker cycle was **not verified**. The native browser's folder-selection interaction did not complete reliably through the available UI control. No qualified changed boot identity and retained state after idle suspension was collected. There is no claimed browser-termination pass. The fixtures and [qualified lifecycle protocol](../skills/rea-pro-max/references/lifecycle.md) are shipped for a host with working extension controls.

No Android, Apple-device, native-binary, managed-code, Flutter, React Native or WebAssembly semantic provider was exercised. Those task prompts require appropriate host tools. The release does not bundle universal decompilation or certify those integrations. The earlier multi-task evaluation design is a plan, not a completed benchmark.

## Support boundary

Static JavaScript/MV3/extracted Electron analysis and provider-neutral case/planner/verifier/reducer/report machinery are shipped. Input files, AST parsing, contexts, graph records and analysis occurrences have explicit limits; exceeding a hard graph limit fails with `analysis_bounds` so a caller can narrow the artifact. Imported runtime observations retain their stated provenance. A finite pass concerns only comparable supplied cases.

Local reports were checked for navigation, filters, record selection and JSON download; the public landing explorer was checked at desktop and narrow viewport sizes. Screenshots show actual pages/apps, not generated product mockups. Localization has not received a professional human/native-speaker review.
