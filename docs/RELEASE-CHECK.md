# Check a release against a known build

Use one local policy to decide whether candidate build changes fit what you intended to ship. The check reads the two directories, verifies designated archive contents and Wasm declarations, then applies any required assertions to saved HTTP and browser evidence. CI can consume the exit status and retain the same receipt an MCP client would page.

## Run the bundled case

From the source checkout:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs release-check \
  skills/rea-pro-max/assets/labs/release/policy.json --out release-verdict.json
```

The synthetic candidate changes a Wasm function body while keeping its declared `get() -> i32` interface and repacks the same file with a different ZIP codec. The saved HAR contains the required response statuses and the synthetic Playwright trace contains the required action categories. The four checks return `pass`.

The result contains the exact policy-file hash, the normalized policy hash, both build identities and the hashes of evidence files successfully admitted for reading. `checks` retains verdicts and reasons. CLI exit codes are 0 for pass, 2 for a known policy failure, 3 for incomplete evidence and 1 for invalid arguments, a bad policy or unreadable build input. A known failure controls the overall verdict when another check remains unknown. An output path must be new.

## Write a policy

Use the [bundled policy](../skills/rea-pro-max/assets/labs/release/policy.json) as a working example. All paths use forward slashes. Inputs are local and relative to the policy file. File rules, ABI paths and the OpenAPI path refer to files inside a build.

| Field | Meaning |
| --- | --- |
| `schema_version` | Set to 1. |
| `reference_path`, `candidate_path` | Two disjoint, nonempty build directories. The byte inventory includes up to 256 regular files and 16 MiB per side. |
| `required_files` | Up to 64 exact paths that must exist in both builds. |
| `allowed_changes` | Up to 256 exact `{path, status}` rules. Status is `added`, `modified` or `removed`. A relocation needs a removal rule for the old path and an addition rule for the new path. |
| `repack_only` | Up to eight paths that must be present in both builds and have equal verified ZIP member file contents. A missing file fails and verified changes fail. Incomplete decoding with no known change yields unknown. These checks run even when archive bytes match. |
| `deployment_targets` | Optional list of one to 16 exact file paths. Each reference target must be preserved in the candidate. Missing paths fail. Unsupported or ambiguous declarations yield unknown. [Apple and Java examples](NATIVE-TARGETS.md) |
| `wasm_interfaces` | Up to eight module paths that must be present in both builds and have equal supported import/export names, kinds and types. |
| `api` | Optional. Use a candidate `contract_path`, saved `har_path`, explicit HTTP(S) `origin` and up to 64 nonempty `required_operations` with `method` and declared `path`. Each operation requires an observed 2xx response by default. Set `expected_status` for an exact status, including an intentional error. Set `reject_unmatched` to fail on unmatched in-scope requests when coverage is complete. |
| `playwright` | Optional. Use a saved `trace_path` and one to 128 `expected_categories` in order. An optional `network_path` adds companion stream coverage. `max_action_duration_ms` places a ceiling on the longest retained action in this saved capture. |

Allowing a file change leaves deployment target, ABI, ZIP and observation assertions active. A release check covers the declared conditions. Build inventory covers regular file paths and bytes, while permission bits, empty directories, archive signatures and runtime behavior need separate evidence.

API matching uses the selected origin plus the method and path resolution of the [OpenAPI and HAR analyzer](REA-6.9.md). It retains status integers, template names, row counts and file identities. Requests from other recognized origins do not satisfy observations. Unattributed requests and missing response status where required degrade coverage. HAR success is the recorded response status. Payload or schema validation remains separate.

Playwright actions are checked as an ordered subsequence by category, so incidental actions can appear between required ones. Known failed actions, trace errors and page errors fail the check. Missing pairs, unsupported trace data and incomplete required streams leave the check unknown. Timing describes the saved capture and depends on its browser, infrastructure and workload. HAR and trace files carry reported authority. Hashes bind the supplied bytes and do not attest that a remote build produced them.

## Inspect the signals directly

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs wasm-inspect ./candidate/engine.wasm
node skills/rea-pro-max/scripts/rea-pro-max.mjs wasm-diff ./reference/engine.wasm ./candidate/engine.wasm
node skills/rea-pro-max/scripts/rea-pro-max.mjs playwright-trace ./trace.trace --network ./trace.network
```

Wasm inspection is bounded to 8 MiB per core module. It retains names and supported types of imports and exports, including repeated import occurrences. It reports `unknown` for unsupported encodings or a rejected host validation. Declaration comparison does not instantiate the module. For a changed interface, inspect `changes` for added, removed, type-changed and occurrence-changed rows. [WebAssembly binary format](https://www.w3.org/TR/wasm-core-1/#binary-module) · [Host validation](https://webassembly.github.io/spec/js-api/#dom-webassembly-validate)

The Playwright importer expects unpacked NDJSON `.trace`, with at most one v10 context, and optionally `.network` from the corresponding saved capture. Select the desired streams from a trusted export. The importer keeps action categories, relative timing, status, line numbers and page events. Network output groups methods, resource types and status classes. URLs, selectors, arguments, console content, headers, credentials, bodies, screenshots and attachments are omitted. A byte digest preserves identity. The source stream stores its own raw observations, so keep it local when sharing the reduced receipt. [Playwright 1.64.1 tracing recorder](https://raw.githubusercontent.com/microsoft/playwright/v1.64.1/packages/playwright-core/src/server/trace/recorder/tracing.ts) · [Tracing API](https://playwright.dev/docs/api/class-tracing)

In MCP, call `check_release` with the workspace-relative policy path. Use `read_artifact` to page `checks` and `/artifacts/changes`. Export the receipt with `export_artifact`. For a narrower look, call `inspect_wasm_interface`, `compare_wasm_interfaces` or `inspect_playwright_trace`. These tools operate on files, including when the MCP browser is disabled.
