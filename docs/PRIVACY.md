# Privacy and execution boundaries

REA Pro Max's bundled CLI and MCP server perform local processing. It contains no telemetry client, upload endpoint, analytics beacon or model API call. A standard `inspect`, case, `plan`, `verify`, `report`, `prompts` or owned-model `demo` operation does not make network requests. The MCP server uses local stdio, opens no network listener and uses the same local machinery.

This boundary applies to this toolkit. Claude Code, Codex, browser/app tools, MCP servers, downloaded dependencies and any external provider operate under their own settings and data policies. Adding a skill does not make a hosted AI session local or change your account's retention policy.

## MCP workspace and session boundary

The MCP server requires an existing explicit workspace. Its client-selected input and export paths must resolve inside that workspace; symlink components and special files are rejected. Export is an explicit tool operation to a new path, without overwriting an existing file. This is an admission policy for the toolkit's tools, not an operating-system sandbox for Node or a restriction on your host's other tools.

Inspection/case/plan/verdict/lab handles live in a bounded in-memory cache, limited to16 artifacts and32MiB of serialized data. Restarted or evicted handles are unavailable; export a case and import it to resume. There is no automatic persistent session database or background upload.

`run_owned_lab` executes only fixed bundled owned scripts under simulated Chrome APIs. The MCP catalog has no arbitrary shell, generic oracle module, target launcher or browser/device controller. The direct CLI's explicit `shrink --oracle` operation has a different execution boundary, described below.

## What is read and written

| Operation | Local behavior |
| --- | --- |
| `inspect` | Reads the selected regular file or extracted directory within bounded inventory limits; parses source without launching it. Symlinks are rejected. |
| Case commands | Read/write the named case and patch/observation files. The workflow assumes one writer at a time and uses explicit revisions. |
| `plan` | Reads supplied hypotheses, capabilities, constraints, observations and current bindings; produces a ranking. It does not execute probes. |
| `verify` | Compares supplied behavior records and contract data. It does not attach to the target, run the candidate or authenticate the origin of receipts. |
| `report` | Embeds supplied records in a standalone local HTML viewer with bundled styles/scripts. The viewer has no backend and no external font/CDN dependency. Export downloads the embedded payload as JSON. |
| `demo` | Writes owned fixtures/results and executes owned worker scripts under simulated Chrome APIs in a controlled JavaScript model. |
| `shrink` | Imports and executes the `.mjs` oracle explicitly supplied by the caller, including its optional reset function. This is executable Node code, with the invoking process's permissions. |

CLI JSON results are printed to standard output, including when `--out` also saves them. Terminal logs or a host's tool history may therefore contain the same material. Most output commands refuse an existing destination; case revision/observation commands intentionally update their named case file.

## Reports are portable; their contents may be sensitive

Investigations may retain absolute target paths, filenames, source operations, channel names, observed inputs/outputs, state, effects, traces, toolchain identities and digests. Any copied data remains in the JSON/HTML until you remove it. Content hashes establish identity; they do not anonymize secrets or prove that a claimed runtime observation occurred.

Review generated reports and receipts before committing them, opening an issue or sending them to someone else. There is no automatic secret redaction or encrypted storage. Keep private investigations outside a public repository. Removing the installed skill does not delete your reports or host conversation history.

## External execution stays explicit

Static inspection does not execute artifact JavaScript. Runtime rebuilding and verification may require the host agent to open a browser, launch an app, connect to an available provider or run a candidate. The target, host tools and your oracle may make network requests or modify state. Choose the task's environment and permissions accordingly.

Treat target strings, decompiled text, webpage content and imported receipts as untrusted data. They are evidence to inspect, not instructions granting additional authority. `shrink` is not a sandbox: an arbitrary oracle can read/write files, launch processes or access the network just like another Node program.

## Website and dependencies

The local report uses no external services. The public documentation site is hosted separately on GitHub Pages; visiting it involves GitHub's hosting infrastructure. Following external documentation/repository links involves those services. The recorded explorer fetches its bundled `demo/states.json` from the same site and does not upload a visitor's target files.

Downloading the repository, updating it or running `npm ci` uses external infrastructure. Development dependencies have their own installation behavior and licenses. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for bundled credits.

## Practical control

Run the standalone CLI when you want to inspect its local outputs directly. Provide only the target scope the task needs. Store cases/reports in a location you control, outside the installed skill, and delete those files when no longer needed. AI-host histories, external providers and published copies must be managed through their respective controls.
