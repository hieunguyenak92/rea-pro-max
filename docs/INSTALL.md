# Install and run REA Pro Max

The runtime toolkit needs **Node.js 22 or later**. It uses Node built-ins and the bundled Acorn parser. A runtime npm install, model API key and upstream REA server are not required. Claude Code or Codex needs filesystem and terminal access; runtime investigations additionally need appropriate browser, app or device tools.

## Try the owned lab first

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs version
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

Open `rpm-lab/report.html` with your browser's Open File command. The standalone report needs no server or CDN. Choose a fresh lab directory for another run. CLI output paths refuse an existing destination; they do not silently replace it.

This lab executes our owned worker scripts in a controlled JavaScript model using simulated Chrome APIs. It demonstrates actual kernel results, not actual Chromium suspension. [VALIDATION.md](VALIDATION.md) records separately exercised runtime claims and their limits.

## Add the skill to Claude Code or Codex

Copy the **entire** `skills/rea-pro-max` directory, including `lib`, `scripts`, `references` and `assets`. Copying only `SKILL.md` removes its executable machinery.

| Host | Project location | Personal location |
| --- | --- | --- |
| Claude Code | `<your-project>/.claude/skills/rea-pro-max` | `~/.claude/skills/rea-pro-max` |
| Codex | `<your-project>/.agents/skills/rea-pro-max` | `~/.agents/skills/rea-pro-max` |

The following commands run from your receiving project's root. Replace `/absolute/path/to/rea-pro-max` with the checkout path. The examples stop if the destination already exists so a prior installation is not accidentally nested or overwritten.

Claude Code, macOS/Linux:

```sh
mkdir -p .claude/skills
test ! -e .claude/skills/rea-pro-max && cp -R /absolute/path/to/rea-pro-max/skills/rea-pro-max .claude/skills/rea-pro-max
```

Codex, macOS/Linux:

```sh
mkdir -p .agents/skills
test ! -e .agents/skills/rea-pro-max && cp -R /absolute/path/to/rea-pro-max/skills/rea-pro-max .agents/skills/rea-pro-max
```

For paths containing spaces, quote the source path. Alternatively use your file manager to copy the folder into the corresponding location. On Windows, PowerShell can install a project skill as follows; use `.agents` for Codex or `.claude` for Claude Code:

```powershell
New-Item -ItemType Directory -Force .agents/skills | Out-Null
if (Test-Path .agents/skills/rea-pro-max) { throw "Skill destination already exists" }
Copy-Item -Recurse "C:\path\to\rea-pro-max\skills\rea-pro-max" .agents/skills/rea-pro-max
```

Start a new host session in the receiving project and confirm the skill appears in its skill selector. Claude Code supports explicit `/rea-pro-max`; in Codex select the skill or mention `$rea-pro-max` in your task. Host discovery/permissions can depend on local settings and managed policies. These are local skill instructions, not a claim that every chat/web/mobile surface can run the bundled Node CLI.

Host-location references checked on 2026-11-04: [Claude Code skills](https://code.claude.com/docs/en/skills), [Codex local skills](https://learn.chatgpt.com/docs/build-skills).

## Give it a concrete job

```text
Use REA Pro Max to investigate this extension's save-and-restore flow and implement the selected behavior in my project. Trace popup, content, worker and storage boundaries. Preserve ordering and error behavior. Run comparable target/candidate cases, deliver runnable source, and identify exactly what remains unverified.
```

Provide the artifact or target URL/app, the requested feature and the receiving repository. The agent authors internal case/receipt formats. It uses host tools to run the target and candidate; the planner and report viewer do not run them automatically. Native/mobile investigations require the actual provider and its prerequisites.

## CLI reference

From the checkout root:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs help
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

Replace the synthetic fixture path with a regular JavaScript file or a narrow extracted application directory. `inspect` reads and parses target artifacts without executing them. Default inventory limits are 256 files, 2 MiB per file, 16 MiB total and directory depth 32. Symlinks are rejected. Unknown syntax, dynamic calls and missing sources remain visible; choose a narrower extracted scope when a resource bound is exceeded.

Create and revise an investigation case:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs case init --inspection inspection.json --goal "Explain the selected persistence behavior" --out case.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs case revise case.json --patch experiment.json --revision 1
node skills/rea-pro-max/scripts/rea-pro-max.mjs plan case.json --bindings bindings.json --budget 10 --out plan.json
```

`experiment.json` and `bindings.json` must first be authored using the [case format](../skills/rea-pro-max/references/case-format.md). Capability, effect and budget filters apply before ranking. Probe recipes are instructions for the host; the planner does not execute them. Cases support one writer at a time. Each mutation requires the expected revision.

Compare finite behavior receipts:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs verify --reference reference.json --candidate candidate.json --contract contract.json --out verdict.json
```

Author the files using the [verification format](../skills/rea-pro-max/references/verification.md). Exit codes: `0` pass, `2` mismatch, `3` incomplete or incomparable evidence, `1` command/input failure. A pass concerns the declared finite cases. Supplied receipts and hashes do not independently prove runtime execution.

Reduce a stable mismatch:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs shrink --input actions.json --oracle ./owned-oracle.mjs --max-tests 100 --out reduced.json
```

The oracle must export `async oracle(sequence)` and may export `async reset()`. It must return a supported status and retain a stable failure fingerprint. **This command executes that module with Node's permissions.** Review and own the oracle, its reset routine, timeouts and external effects. See [PRIVACY.md](PRIVACY.md).

`report` accepts an inspection JSON or a combined workbench payload such as the demo's `lab.json`; raw planner/verdict files remain independently readable JSON. The workbench is a read-only viewer with search, selection and JSON export.

## Update or remove

Keep your case/report files in the receiving workspace, outside the installed skill. To update, compare the new release and replace only the installed `rea-pro-max` folder after retaining any local modifications. To remove, delete that folder through your file manager and start a new host session. Your separately saved investigations remain in your workspace.

## Develop the toolkit

Development tools are separate from runtime installation:

```sh
npm ci
npm test
npm run lint
npm run check:docs
```

`npm ci` downloads development dependencies, including Electron, and may run their install scripts. It is unnecessary for ordinary CLI or skill use. See [VALIDATION.md](VALIDATION.md) for the checks actually completed for a release; available commands alone are not evidence they passed.
