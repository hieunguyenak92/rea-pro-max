# Recover and verify a bounded native function

The native lab starts with an owned C function compiled to a Mach-O executable. Recover its piecewise pricing rule, compile the recovered implementation, and compare every input to a separate incremental pricing oracle. The test also compiles an implementation with a single wrong return value, at input 173. Each run records the compiler, flags, architecture, execution mode, and SHA-256 digests of the implementation, harness and executable.

## Inspect saved Ghidra evidence and compare the saved captures

Run the commands from the repository root with Node.js 22+.

```sh
skill=skills/rea-pro-max
proof="$skill/assets/labs/native-recovery/evidence"
node "$skill/scripts/rea-pro-max.mjs" native-import-ghidra "$proof/reference.bin" "$proof/ghidra-12.2-arm64.json"
node "$skill/scripts/rea-pro-max.mjs" native-verify "$proof/reference.json" "$proof/candidate.json" "$proof/oracle.json"
node "$skill/scripts/rea-pro-max.mjs" native-verify "$proof/reference.json" "$proof/negative.json" "$proof/oracle.json"
```

The first command imports an explicit function export. Each instruction carries an address, its file offset when known, bytes, listing text, and raw p-code reported by Ghidra. The separate pseudocode field contains decompiler output. REA checks the executable hash, the header's architecture, and the bytes at each supplied file offset. The exporter limits each request to 16 named functions or entry addresses, with up to 512 instructions per function and 4 MiB total output. Unmapped or modified instructions, incomplete listings and unavailable decompiler text yield `unknown` with a reason.

The second command reports `pass` after comparing 256 inputs across the two saved runs and the independent oracle. The final command exits 2 with a single counterexample, reference and expected output 433 versus candidate output 434 at input 173. Missing inputs, incomplete captures, incompatible execution contexts and reused oracle source digests yield `unknown` unless another comparable input already establishes a mismatch.

The MCP tools `import_ghidra_evidence` and `verify_native_behavior` take workspace-relative paths and return file-backed evidence handles. The two CLI commands and the MCP tools consume local files. The static adapter reads reported output and compares bytes. The run verifier reads reported execution records. Both receipts digest the compared content. Provenance and authorship of externally supplied records require a trusted capture source.

## Run the owned native lab

Use Node.js 22+ and a C11 compiler on macOS or Linux, on arm64 or x86-64. Run the lab from the repository root.

```sh
node skills/rea-pro-max/assets/labs/native-recovery/run.mjs --out ./native-runs
```

The runner requires a new output directory. It builds and executes the three supplied implementations under `-O0 -g` and `-O2 -g0`. On Apple Silicon with Rosetta installed, use `--arch arm64 --arch x86_64` to include the translated x86-64 run. Use `CC` to select a compiler executable. Review `summary.json`, then open each profile's `verification.json` and `counterexample.json`. All four such profiles were exercised on Apple Silicon. The native arm64 and translated x86-64 runs each matched all 256 oracle results in both build configurations. [Reference implementation](../skills/rea-pro-max/assets/labs/native-recovery/reference.c) · [Recovered implementation](../skills/rea-pro-max/assets/labs/native-recovery/recovered.c) · [Independent oracle](../skills/rea-pro-max/assets/labs/native-recovery/oracle.mjs) · [Measured results](evidence/native-v1.0.json)

## Produce a new Ghidra export

Use Ghidra 12.2 and a supported 64-bit JDK (25 or later). Check Ghidra's Getting Started guide for native component availability on the host. The lab's verified 12.2 release archive supplied Linux x86-64 native components. For the recorded macOS test, the arm64 decompiler helper was built from the sources in that same archive and used with OpenJDK 26.0.2. REA recognizes little-endian, single-architecture arm64 and x86-64 headers for Mach-O, ELF64 and PE32+. Choose a single slice before importing a fat Mach-O. The commands use the output of the lab on Apple Silicon. The example ELF symbol is usually `quote`. [Ghidra 12.2 release](https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.2_build)

```sh
skill="$(pwd)/skills/rea-pro-max"
project_dir="$(mktemp -d)"
"$GHIDRA_HOME/support/analyzeHeadless" "$project_dir" rpm-quote -deleteProject \
  -max-cpu 2 -analysisTimeoutPerFile 45 \
  -import "$PWD/native-runs/arm64-O2-g0/reference.bin" \
  -scriptPath "$skill/assets/labs/native-recovery" \
  -postScript RpmGhidraExport.java "$project_dir/quote.json" _quote
node "$skill/scripts/rea-pro-max.mjs" native-import-ghidra \
  "$PWD/native-runs/arm64-O2-g0/reference.bin" "$project_dir/quote.json"
```

Selectors can be exact global names or hexadecimal entry addresses starting with `0x`. The headless script performs static analysis of the selected input. Raw p-code records Ghidra's instruction translations. Decompiled C expresses a higher-level interpretation that may infer types or rearrange control flow. The run comparison can confirm the lab's return-value contract over a fully enumerated domain. Other functions, side effects, memory behavior and execution contexts need different evidence. [Ghidra p-code reference](https://ghidra.re/ghidra_docs/languages/html/pcoderef.html)
