# REA Pro Max MCP

REA Pro Max v1.0 exposes its shared kernel through **35 local MCP tools**. Compare two builds, correlate a saved HAR with OpenAPI, inspect a scoped artifact or verify a finite behavior contract. An explicitly configured Chromium also enables typed MV3/web capture, replay and reviewed hash-bound patch plans.

The server uses the bundled official MCP SDK runtime over **stdio**. It requires no service account and does not call a model API. Static operations open no network listener; optional runtime execution launches a disposable browser with a loopback debugging endpoint. Node.js22+ is required; runtime npm installation is unnecessary. Client availability and permissions remain subject to your installed host.

## Start with an explicit workspace

```sh
node /absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs --workspace /absolute/path/to/your-workspace
```

Both paths should be absolute. The workspace must already exist. It is the root admitted for client-selected inputs and exports; choose a directory containing the artifacts and output locations needed for the task. The server waits for MCP messages on stdin. Running it by hand and seeing no prose is normal: stdout is reserved for the protocol, while diagnostics go to stderr.

Do not pipe interactive shell text into this process. Let an MCP client launch it. Closing the client's connection ends the process; session handles do not survive a restart.

## Register with Claude Code

Use your actual checkout and workspace paths:

```sh
claude mcp add --transport stdio --scope local rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

This uses Claude Code's local configuration scope. Reconnect/restart the host as needed, inspect its MCP status and confirm that `get_capabilities` is available. In a Claude Code session, `/mcp` opens its MCP controls.

The command is provided for you to run. REA Pro Max does not silently edit host configuration files. Managed environments may restrict local servers or require host approval. [Official Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## Register with Codex

```sh
codex mcp add rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

Reconnect the host and confirm the tools appear. The installed Codex CLI's `mcp add --help` describes the command; the registration writes Codex configuration only when you run it. [Official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

On a desktop host with a different PATH, replace `node` with the absolute Node executable. Installation paths containing spaces must remain quoted in shell commands.

## Generic stdio configuration

For a client using an `mcpServers` JSON configuration, adapt this entry to its documented configuration location:

```json
{
  "mcpServers": {
    "rea-pro-max": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs",
        "--workspace",
        "/absolute/path/to/your-workspace"
      ]
    }
  }
}
```

Do not assume every client uses this JSON shape. No authentication header, URL or API key is needed for this local stdio server. The [verification record](VALIDATION.md) identifies the client/protocol checks actually completed for this release; a generic configuration example is not certification of every MCP application.

## First useful result

Ask the connected agent:

```text
Use REA Pro Max. Call get_capabilities, run the owned lab, read the inspection
and ranked experiments, then export the resulting lab as JSON and standalone
HTML to new files in the configured workspace. Explain which parts are modeled
and which runtime claims remain unverified.
```

`run_owned_lab` executes only the project's bundled reference/regression worker fixtures under a controlled JavaScript model with simulated Chrome APIs. It does not execute an arbitrary selected target or establish real Chromium suspension.

For your own artifact, ask the agent to call `inspect_artifact` with a workspace-contained path, read coverage and selected evidence, then create a case for the feature. The opt-in runtime provider below supports the documented `rpm-kv-v1` MV3 protocol. Other browser/app/device experiments need appropriate host tools or an adapter.

## Opt in to actual Chromium capture and replay

Chromium execution is **disabled by default**. To enable it, append an explicit executable path when the client launches the server:

```sh
node /absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs --workspace /absolute/path/to/your-workspace --browser "/absolute/path/to/chromium"
```

The same trailing `--browser` arguments can be added to the Claude Code/Codex registration commands above or to the JSON `args` array. Use an installed Chromium/Chrome for Testing build that supports unpacked extensions. The product does not download a browser or use a personal profile. Call `get_capabilities` to confirm that runtime execution is enabled.

Prepare the owned task from the checkout:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs recovery init --out ./recovery-work
```

Keep that directory inside the configured workspace. Then ask the agent:

```text
Use REA Pro Max to replay recovery-work/reference against recovery-work/starter
with recovery-work/scenario.json. Read the first mismatch and lifecycle evidence.
Repair starter/worker.js against starter/contract.json, preserving the protocol,
then replay with fresh profiles and export the final result as a new JSON file.
Deliver the runnable feature and remaining unknowns.
```

`capture_feature` records one extension. `replay_feature` records reference and candidate independently, then calls the same finite verifier as the CLI. A valid fail/unknown is a domain result the agent should investigate. The toolkit does not itself call a model to rewrite the candidate; the host agent performs the edit. The bundled `recovered/` folder is an independently authored worked example.

The provider is specific to **`rpm-kv-v1`**, a documented local message contract implemented by the owned fixtures and receiving projects. Scenario actions are `message`, `page-reopen`, `worker-stop`, `idle` and `storage-snapshot`. It is not general browser automation or automatic reconstruction of arbitrary extensions. [Scenario shape, outputs and limits](RECOVERY.md).

Every runtime run copies the admitted artifact bytes into a temporary snapshot, launches a fresh profile and records browser/provider/target/scenario/reset identities. Forced worker stop and natural idle have different receipts. Boot IDs remain in raw evidence; only the declared top-level boot metadata is excluded from message comparison. Missing reset proof produces incomplete/unknown evidence. Message output receipts do not attest unobserved UI, network or file effects.

A fresh profile is **not an OS or network sandbox**. The selected browser and extension execute with their normal process permissions and may make permitted network requests. Cancellation and deadlines trigger cleanup; inspect the recorded cleanup status. Read [PRIVACY.md](PRIVACY.md) and [VALIDATION.md](VALIDATION.md) for the boundary and exact observations.

## Exact tool catalog

[Supported inputs and runnable examples](VERIFIED-RECOVERY.md)

Arguments below describe the product's input names. The schemas discovered through the running client's tool list are authoritative, including field bounds.

| Tool | Arguments | Effect |
| --- | --- | --- |
| `get_capabilities` | `{}` | Returns version, workspace, target scope, limits and execution policy. |
| `inspect_artifact` | `path`, optional `include`, `exclude` | Static analysis with exact relative file/directory scope. Format evidence is available at `/artifact_details/formats`. |
| `compare_artifacts` | `reference_path`, `candidate_path`, optional `include`, `exclude` | Compare two files or two build trees. Page `changes` and `archives`. |
| `compare_api_contract` | `openapi_path`, `har_path` | Correlate OpenAPI JSON declarations and saved HAR requests offline. Page `operations` and `observations`. |
| `inspect_deployment_targets` | `path` | Read the target declarations in a Mach-O object, binary or JVM class. |
| `compare_deployment_targets` | `reference_path`, `candidate_path` | Identify removed targets, raised minimums or changed Java preview requirements. [Compiled examples](NATIVE-TARGETS.md) |
| `inspect_wasm_interface` | `path` | Inspect supported core Wasm public interface declarations. |
| `compare_wasm_interfaces` | `reference_path`, `candidate_path` | Compare public ABI declarations in two Wasm modules. |
| `compare_jar_profiles` | `reference_path`, `candidate_path`, `profiles` | Resolve effective class bytes for the declared Java feature versions. |
| `compare_wasm_behavior` | `reference_path`, `candidate_path`, `contract_path` | Evaluate inputs in the bounded stateless i32 subset. |
| `import_ghidra_evidence` | `binary_path`, `export_path` | Bind a saved Ghidra 12.2 export to the selected binary. |
| `verify_native_behavior` | `reference_path`, `candidate_path`, `oracle_path` | Compare finite saved runs against a declared output oracle. |
| `inspect_playwright_trace` | `trace_path`, optional `network_path` | Import saved Playwright v10 action and page evidence with bounded optional network counts. |
| `check_release` | `path` | Apply a local release policy to two builds and supplied evidence. [Release check](RELEASE-CHECK.md) |
| `read_artifact` | `handle`, `section`, `offset`, `limit`, optional `query` | Reads a bounded section/page of a retained artifact. |
| `read_source_evidence` | Inspection handle, evidence ID, optional character bound; see discovered schema | Reads a hash-checked snippet for an evidence record; stale source is rejected. |
| `capture_feature` | `extension_path`, `scenario_path`, optional `timeout_ms` | With runtime enabled, executes one declared MV3 scenario in a disposable Chromium profile. |
| `replay_feature` | `reference_path`, `candidate_path`, `scenario_path`, optional `timeout_ms` | Runs both extensions in separate profiles; retains verdict, full captures and first mismatch. |
| `capture_web` | `scenario_path`, optional `timeout_ms` | With runtime enabled, executes one bounded web scenario in a disposable Chromium profile. |
| `replay_web` | `reference_url`, `candidate_url`, `scenario_path`, optional `contract_path`, `timeout_ms` | Runs two explicit web URLs and compares behavior separately from visual hashes. |
| `craft_provider_doctor` | Optional `timeout_ms` | Checks the startup-configured Craft launcher identity and tool list. |
| `craft_provider_inspect` / `craft_provider_capture` / `craft_provider_compare` | Optional `input`, `timeout_ms` | Calls a typed Craft alias and retains provider provenance. |
| `run_recovery` | `plan_path` | Replays a declared scenario and applies an explicit patch after a qualified mismatch. |
| `reconcile_runtime` | `inspection_handle`, `runtime_handle` | Correlates literal MV3 worker channels with an in-session capture of the same artifact digest. |
| `create_case` | `inspection_handle`, `goal`, `capabilities` | Creates an in-memory case using the inspection's actual target identity. |
| `revise_case` | `case_handle`, `expected_revision`, `patch` | Validates and commits a model revision. |
| `record_observation` | `case_handle`, `expected_revision`, `observation` | Retains the receipt's source, authority and bindings. |
| `rank_probes` | `case_handle`, `bindings`, optional `budget`, `allowed_effects` | Ranks permitted recipes without executing them; retains the plan. |
| `verify_behavior` | `reference_path`, `candidate_path`, optional `contract_path` | Compares bounded workspace JSON files and retains a verdict. |
| `export_artifact` | `handle`, `output_path`, `format` | Writes `json` or standalone `html` to a new workspace file. |
| `run_owned_lab` | `{}` | Runs only the fixed bundled controlled model and retains its results. |
| `list_task_prompts` | optional `target`, `offset`, `limit` | Pages the 36 task templates and their scope. |
| `import_case` | `path` | Validates a saved case JSON file and stores it for this process. |

Tools that retain results return bounded `structuredContent` including `handle`, `kind`, `summary` and available `sections`. Handles are opaque; do not construct them or assume another server has the same handle.

## Web replay and optional Craft provider

With `--browser` configured, `capture_web` accepts the same bounded scenario shape as the CLI. `replay_web` runs that action list against `reference_url` and `candidate_url` in fresh profiles. It stores a web recovery IR, a finite contract and two verdicts: behavior channels (DOM, network summary and storage) and visual artifact hashes. A visual mismatch does not prove a behavior mismatch; incomplete coverage remains unknown. See [WEB-RECOVERY.md](WEB-RECOVERY.md).

The Craft Anything tools are disabled by default. Supply the launcher via `--craft-config` at startup. The handshake checks the reviewed `0.4.0`/`49af55e4e4f4b729152a1e61c845a5b10f7b6d9b` identity before sending any typed request. See [PROVIDERS.md](PROVIDERS.md).

## Read only the section you need

`read_artifact` defaults to `section: "summary"`, `offset: 0`, `limit: 20`. Its maximum page size is50. Nested sections may also use an RFC6901 pointer, such as `/inspection/contexts` for a lab payload. Array sections such as `contexts`, `edges`, `evidence`, `findings` and `unknowns` are paginated. `query` is a bounded filter, not code to execute.

```json
{
  "handle": "<returned_handle>",
  "section": "evidence",
  "offset": 0,
  "limit": 20
}
```

Replace `<returned_handle>` with the exact handle returned by the preceding tool. Select a section listed by that artifact. `full` is available only when the serialized result fits the response bound; otherwise use its sections or export it. For a large ZIP comparison row, page `/archives/0/changes` or export the structured result. This keeps a large investigation available without repeating the entire graph in each response; no token-saving percentage is claimed.

### Revise deliberately

`revise_case` and `record_observation` require the current revision. A stale expected revision fails without changing the case. `rank_probes` requires current bindings to use the case target digest, so a target revision cannot silently reuse the old target binding. Read the current case and reapply your intended change. Imported observations keep their supplied authority; a content digest does not upgrade them into independently authenticated runtime observations.

The [case format](../skills/rea-pro-max/references/case-format.md) defines patches, predictions, probe recipes and observation bindings. A probe recipe is a task for an available host tool. Ranking does not execute it.

### Export and resume

```json
{
  "handle": "<returned_handle>",
  "output_path": "investigation.json",
  "format": "json"
}
```

Use a new relative workspace path whose parent directory already exists. Export does not create directories. `html` produces a read-only standalone report; `json` retains portable records. To resume a case after restarting, export that case as JSON and call `import_case` with its saved path in the new server process. Handles themselves are not persistent IDs across processes.

## Limits and execution policy

MCP applies a tighter case budget than the generic kernel so experiment planning remains bounded in an agent tool call:

| MCP case bound | Release limit |
| --- | --- |
| Hypotheses | 32 |
| Probe recipes | 64 |
| Observations | 256 |
| Steps per probe | 64 |
| Serialized case | 1MiB |

Updates and imports must fit these limits; a rejected change does not replace the previous case. The capability result advertises the active bounds.

- Client-selected input/export paths must resolve inside the configured workspace. Symlink components and special files are rejected; existing output files are not overwritten.
- Session retention is bounded to16 artifacts and32MiB of serialized data. Older/evicted handles may need re-import or re-inspection.
- At most2 heavy inspection/lab/runtime operations run concurrently; excess requests return `server_busy` and can be retried. Input JSON files are bounded to4MiB. Read pages are bounded to64KiB; a single oversized record may need export rather than inline reading.
- Static artifact analysis also has its own inventory, source-byte, AST and graph limits.
- Prompt browsing is paginated, with at most10 templates per response.
- Session state is in memory. No hidden background database or automatic case upload is used.
- MV3 and web execution use an explicitly configured browser. Craft uses an operator-supplied launcher from its startup configuration.
- In capabilities, `target_execution` tracks the configured browser runtime. `wasm_evaluation` describes the bounded stateless i32 evaluation that is independently available offline. Ghidra and native tools read saved evidence files.

The workspace policy restricts paths admitted by these tools; it is not an operating-system sandbox for Node or for other tools in your AI host. Bundled trusted lab assets are an explicit internal exception to client workspace intake. They do not grant arbitrary access to the skill directory.

The direct CLI retains `shrink --oracle` for an owned `.mjs` module. That explicit code-execution operation is not exposed through MCP. Read [PRIVACY.md](PRIVACY.md) for host data policies and execution boundaries.

## Result and error semantics

A finite `fail` or `unknown` verdict is a valid comparison result. It is returned as a successful MCP tool response containing that verdict, so an agent can act on it. It is not converted into a transport failure.

Invalid arguments, unknown handles, incompatible revisions and rejected paths return actionable tool errors. Malformed protocol requests are handled by the SDK. An oversized or rejected result is not a complete analysis.

Cancellation is best effort; bounded CPU work is not advertised as instantaneously preemptible. Export checks cancellation before committing a new output when cancellation is known at that point. Cases remain explicit; there is no implicit global active case shared between requests.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Server exits immediately | Node version, absolute entry path, existing workspace and stderr diagnostics. |
| Server looks silent in a terminal | Stdio servers wait for protocol input; start it through a client. |
| Client discovers no tools | Host server status, local configuration scope, managed permissions and restart/reconnect. |
| Access is rejected | Target must be in scope and must not traverse symlinks or special files. Restart with the intended workspace. |
| Case handle no longer works | Server restarted or the bounded cache evicted it. Import a saved case or inspect again. |
| Revision conflict | Read the latest record and use its actual revision. |
| `verify_behavior` is unknown | Inspect missing cases, incomplete receipts, matching inputs and current bindings. |
| Export path already exists | Choose a new file. Existing evidence is retained. |

Host setup references and installed CLI help were checked on2026-11-04. Product client/protocol validation belongs to [VALIDATION.md](VALIDATION.md).
