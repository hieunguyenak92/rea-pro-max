# REA 6.9.0 reference and v0.8 coverage

On November 18, 2026, the upstream GitHub release marked `rea-agents-6.9.0` as latest. It was published on November 12, 2026 at commit `d74549e495c58eb4a560279fd9f05508401ea0a0`, under MIT. REA Pro Max implements the workflows below in its own CLI and local MCP server. [Upstream release](https://github.com/morluto/rea/releases/tag/rea-agents-6.9.0) · [Upstream license](https://github.com/morluto/rea/blob/rea-agents-6.9.0/LICENSE)

| Workflow | Verified v0.8 scope | Remaining coverage |
| --- | --- | --- |
| Package investigation | Bounded ZIP member inventory for regular packages, local and central metadata checks, CRC-32 and SHA-256 of admitted member bytes. The pairwise view distinguishes packaging changes from added, removed or modified verified files. | ZIP64, multidisk, encrypted members, ambiguous names and unsupported member codecs produce explicit incomplete coverage. Package type labels describe naming/layout and carry no signature or application-semantics verdict. |
| Build regression | Compare file SHA-256 and two directory snapshots under a shared include/exclude scope. Equal content relocated between unique old and new paths has its own row. Archive-member evidence is linked to the byte-level changes. | The snapshot covers regular files within the selected scope. Permissions, timestamps, directory-only changes, nested archives and dynamic behavior require separate evidence. |
| Firmware inventory | Intel HEX records with shape, checksum, range and end-marker checks plus SHA-256 for contiguous load regions. Basic UF2 files with block magic, ranges, sequence, coverage and payload hashes. | File-container, extension flags, embedded MD5 and mixed-family UF2 semantics are outside the validated subset. Other embedded headers are descriptive. |
| API contract | Compare OpenAPI 3.0–3.2 JSON operation declarations with HTTP methods and URL paths from a saved HAR. Keep ambiguity, omissions and unmatched rows visible by entry index. | Use a HAR scoped to the intended service. Server prefixes, origin matching, YAML, external references, GraphQL and response validation are outside the implementation. |
| Behavior evidence | Replay the named MV3 protocol with an explicitly configured Chromium. Correlate literal worker message channels on the same digest. Apply a planned, hash-bound candidate patch only after a qualified mismatch and replay it. | Claims stay within the finite actions, channels and reset conditions in the receipt. Saved CLI runtime receipts carry reported authority. |
| Apple and Java deployment declarations | Read a thin or universal Mach-O file or an individual JVM class. Check whether a candidate preserves the reference deployment targets. [Compiler-produced examples](NATIVE-TARGETS.md) | Device execution, application bundles, JAR resolution, API compatibility and bytecode behavior require separate evidence. |
| Public Wasm interface | Inspect or compare supported core module public declarations. | Component Model and behavioral equivalence require separate evidence. |
| Saved Playwright trace | Import v10 action timings, page events and optional network aggregates from one unpacked context. | Assisted replay, cross-context correlation and full browser evidence are outside this importer. |
| Release check | Apply an exact file and ZIP policy, deployment targets, Wasm ABI assertions and required HAR/Playwright observations to two local builds. | Results cover only declared checks and retain reported authority for saved observations. [Run the release example](RELEASE-CHECK.md) |
| External workflows | Upstream release metadata and historical provider results remain separately attributable. | Native/managed/mobile semantic engines, desktop build computers, NTFS journals and upstream runtime execution are outside this release candidate's validated coverage. |

## Reproduce a local result

Run from a source checkout. The fixture contains two observed operations, an unobserved delete declaration and one unmatched HAR entry.

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs api-diff \
  skills/rea-pro-max/assets/labs/api/openapi.json \
  skills/rea-pro-max/assets/labs/api/traffic.har --out coverage.json
```

The comparison uses method and path only. The report includes OpenAPI path templates and HAR entry indices. It omits HAR hosts, concrete paths, query strings, headers, cookies and bodies. `unobserved` means zero matches in the saved capture. An observed operation records a request match and leaves server behavior unverified. [OpenAPI path matching](https://spec.openapis.org/oas/v3.1.2.html#path-templating-matching)

Compare two regular files or two build directories. Run with `--scope scope.json` to use matching `include` and `exclude` prefixes on both sides.

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs compare ./old-build ./new-build --out build-diff.json
```

`compare` exits 0 for equal fully admitted file bytes, 2 for a byte/path change and 3 for scoped equality with omitted files. Two ZIPs can differ as bytes while containing identical verified file contents. `api-diff` exits 0 when the comparison finished its supported scope and 3 when an omission or ambiguity leaves it partial. Domain results are still written to the new output file. The MCP equivalents are `compare_artifacts` and `compare_api_contract`; use `read_artifact` and `export_artifact` with their result handles.

The build comparator admits up to 256 regular files and 16 MiB per side, with up to eight changed ZIP pairs and 128 listed members per archive. ZIP verification supports STORE, raw DEFLATE and one bounded Zstandard method-93 frame on Node builds exposing Zstandard. It checks central/local agreement, output size, CRC and decoder consumption before recording the content hash. Decoding stays in memory, with a 4 MiB decoded member ceiling and shared byte and record budgets. [ZIP format](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) · [Zstandard frame format](https://www.rfc-editor.org/rfc/rfc8878.html#section-3.1)

## Historical compatibility receipt

The November 15, 2026 workspace trial recorded a successful upstream 6.9.0 identity handshake and a failed JavaScript target-analysis call at the macOS Swift process-ownership helper. The saved catalog count describes that upstream advertisement. `tools/verify-rea69.mjs` checks historical receipt identity and summarizes reported status offline. See the [v0.6 verification record](VALIDATION.md) for independent implementation results.
