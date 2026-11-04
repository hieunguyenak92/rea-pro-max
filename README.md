# REA Pro Max

**Understand the mechanism. Rebuild the behavior. Prove the result.**

An independent reverse-engineering skill and executable toolkit for Claude Code and Codex. Turn an unfamiliar app, extension or web feature into a mechanism you can reason about, an implementation you can run and a finite behavior contract you can check.

[English](README.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md) · [ไทย](README.th.md) · [Français](README.fr.md)

[Explore the recorded lab](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [Install the skill](docs/INSTALL.md) · [Read the verification record](docs/VALIDATION.md) · [Releases](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](docs/media/hero.png)

## A convincing interface is only the beginning

The difficult part is what happens after the click: which context receives the message, where state survives, what cancellation interrupts, which error reaches the caller and why a rebuilt feature fails on the second attempt.

REA Pro Max brings those questions into the implementation loop. Inspect the shipped JavaScript. Make competing explanations explicit. Choose an experiment that separates them. Build the requested behavior in your project. Compare what the two implementations actually return, write and emit. Reduce a mismatch to the actions that still reproduce it.

**The deliverable is the requested working feature, supported by evidence.** The host agent performs the coding and runtime work; the bundled toolkit supplies concrete analysis, experiment ranking, verification and reduction machinery.

## Give it a task, not a new workflow to learn

After [installation](docs/INSTALL.md), use an ordinary task prompt in Claude Code:

```text
/rea-pro-max Investigate this extension's save-and-restore behavior and implement it in my project. Trace popup, content script, worker and storage boundaries. Test persistence under a qualified worker restart, preserve error behavior, and deliver runnable code with the exact cases exercised and remaining unknowns.
```

In Codex, select the skill or prefix the same task with `$rea-pro-max`. Supply your target and receiving project; the agent prepares the internal case files. Actual browser, app or device observations need the corresponding tools in your host.

Use it to:

- **Rebuild a selected feature** with its ordering, errors, cancellation and persistence behavior.
- **Understand an MV3 extension** across popup, content, page and worker contexts before changing it.
- **Recover an Electron boundary** from extracted main, preload and renderer sources.
- **Explain a regression between two builds** through comparable inputs and observable effects.
- **Shrink a reproducible failure** into a smaller action sequence while retaining its failure identity.

## See the machinery before trusting the promise

Requires **Node.js 22+**. The bundled toolkit runs directly; no API key, npm install or upstream REA server is required.

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

Open `rpm-lab/report.html` in your browser. The owned synthetic lab runs reference and regression worker scripts under a **controlled JavaScript model with simulated Chrome APIs**. It produces real kernel outputs for inspection, probe ranking, behavioral mismatch detection and action reduction. It does **not** establish real Chromium worker suspension. Separately exercised runtime claims belong in the [verification record](docs/VALIDATION.md).

Inspect the included artifact yourself:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

Use fresh output paths: generated outputs are not silently overwritten. See [installation and CLI usage](docs/INSTALL.md) for host setup and further commands.

## Expertise you can inspect

| Capability | What it adds to the investigation |
| --- | --- |
| Artifact boundary analysis | Acorn AST parsing, distinct execution contexts, candidate communication edges, exact source locations and content digests. Target code is not executed by `inspect`. |
| Competing explanations | Explicit hypotheses, predictions and reset-aware probe recipes instead of silently choosing the first plausible story. |
| Conservative experiment ranking | Worst-case hypothesis elimination per declared cost, filtered by capabilities, allowed effects and budget. Missing predictions stay unknown. |
| Bound observations | Target, scenario, reset and toolchain identities keep incompatible observations out of a current inference. A hash establishes content identity, not runtime truth. |
| Finite behavior verification | `pass`, `fail` and `unknown` across outputs, state, effects and traces. Duplicate events and relevant ordering remain significant. |
| Failure reduction | Bounded action removal with repeated oracle checks and a stable mismatch fingerprint. It reports uncertainty and budget exhaustion; it does not promise the globally shortest trace. |
| Local investigation workbench | Standalone HTML with real search, context filters, evidence selection and full JSON export. No report backend or CDN is needed. |
| 36 task prompts | Rebuild, explain and verify tasks across web, extensions, desktop and mobile families, with explicit prerequisites. Templates do not certify provider support. |

The planner selects a useful next question; it does not launch a probe. The verifier checks supplied observations; it does not independently attest that a runtime ran. The skill directs the host agent to perform that work and retain the evidence.

## Deliberate scope, visible boundaries

**v0.1 built-in analysis:** JavaScript files and extracted web, Manifest V3 and Electron sources. Dynamic expressions, unsupported syntax, missing imports and resource limits remain explicit in the result.

**Provider-neutral kernel:** case management, experiment ranking, finite behavioral comparison, sequence reduction and local reports. `shrink` explicitly executes an owned `.mjs` oracle you supply.

**Advanced host-tool workflows:** native, managed, Android, Apple, React Native, Flutter, Tauri and WebAssembly tasks appear in the prompt library. Deeper analysis depends on available, appropriate tools. This release does not bundle a universal decompiler, mobile runtime, package extractor or semantic recovery engine. Native/mobile detection or a task template is not a verified integration.

The CLI makes no network requests or telemetry uploads. Your AI host and any external tools follow their own data policies. Reports and receipts may contain sensitive paths, code and observed values. Read [privacy and execution boundaries](docs/PRIVACY.md) before sharing them.

## What you take away

A requested rebuild should include runnable source and its launch path, plus the selected behavior contract, operations actually exercised, relevant JSON evidence and remaining limits. A finite pass applies to the cases checked; it is not whole-application equivalence.

The demo exports `inspection.json`, `case.json`, `planner.json`, `reference.json`, `candidate.json`, `verification.json`, `reduction.json`, `lab.json` and the self-contained `report.html`. You can inspect the records independently, retain them with your project and export the complete report payload from the workbench.

## Go deeper

[Skill instructions](skills/rea-pro-max/SKILL.md) · [Target scope](skills/rea-pro-max/references/target-analysis.md) · [Case format](skills/rea-pro-max/references/case-format.md) · [Verification contract](skills/rea-pro-max/references/verification.md) · [Task prompts](skills/rea-pro-max/references/prompt-library.md)

REA Pro Max is independently developed. Research inspiration and dependency notices are recorded in [credits](THIRD_PARTY_NOTICES.md); upstream REA is not a mandatory dependency. [MIT license](LICENSE).

**Bring a feature worth understanding. Leave with a result you can inspect.**
