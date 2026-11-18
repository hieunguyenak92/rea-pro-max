# Verify recovered behavior in REA Pro Max 1.0

Start with a question about what changes, then select a check that can answer it. The CLI runs from a source checkout or the extracted skill on Node.js 22+. The examples use the project's own fixtures.

## Find which Java profiles are affected

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs jar-profile-diff \
  skills/rea-pro-max/assets/labs/jar-profiles/before.jar \
  skills/rea-pro-max/assets/labs/jar-profiles/after.jar --profiles 11,17,21
```

Only the Java 17 overlay of `Probe.class` changes. The Java 11 profile selects the unchanged base member. Profiles 17 and 21 select the changed member. Read `profiles` for each selected path and its SHA-256. MCP uses `compare_jar_profiles` with an integer array and can page individual members at `/profiles/0/reference` and `/profiles/0/candidate`.

The static resolver accepts one to eight Java feature versions from 8 to 27 and compares regular class entries of a single JAR per side. It applies standard multi-release lookup and records declared class targets. Custom class loaders, module and dependency resolution, signatures and actual JVM behavior require separate checks. Incomplete admission is visible in the result. [JAR specification](https://docs.oracle.com/en/java/javase/27/docs/specs/jar/jar.html#multi-release-jar-files)

## Check Wasm outputs separately from ABI

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs wasm-behavior \
  skills/rea-pro-max/assets/labs/release/reference/engine.wasm \
  skills/rea-pro-max/assets/labs/release/candidate/engine.wasm \
  --contract skills/rea-pro-max/assets/labs/release/wasm-behavior.json
```

The command intentionally exits 2. Both modules declare `get() -> i32`. Their return values are 1 and 2. The ABI command `wasm-diff` reports `same-interface`. The MCP equivalent is `compare_wasm_behavior`; pass paths to the two modules and the contract.

A contract contains `schema_version: 1`, `export_name`, and either `inputs` (an array of argument vectors) or `domain` (an inclusive signed i32 `min` and `max` for a single parameter). The runner evaluates at most 256 vectors, up to eight i32 parameters and a single i32 result. It checks both modules before any export is called. The supported core subset contains straight-line integer arithmetic, comparisons and locals, with no calls, loops, imports, start function or module state. Unsupported modules return `unknown`. Traps are compared by occurrence. [Bundled contract](../skills/rea-pro-max/assets/labs/release/wasm-behavior.json)

## Observe Save and read back after restart

```sh
RPM_BROWSER_EXECUTABLE="/absolute/path/to/chromium" \
  node skills/rea-pro-max/assets/labs/web-persistence/verify.mjs
```

Start with the actual browser record and compare it with the independent receipt from the fixture's server. Then launch a fresh browser session after restarting the server and check the readback from disk. A new project can use the fixture's layout and validation pattern with its own state and source.

Generic web replay covers bounded same-origin HTTP request starts in the observed page and the time window for each action. A matching DOM and screenshot can coexist with different network effects. A request does not by itself establish durable writes. Missing or incomplete observation of a required channel gives `unknown` unless another comparison already establishes a failure. A web URL identifies a locator. Establish a separate content binding for any claim about the build behind that URL. [Web capture and coverage details](WEB-RECOVERY.md)

## Reconstruct a finite native function

```sh
node skills/rea-pro-max/assets/labs/native-recovery/run.mjs --out ./native-run
```

The example builds and executes the project's reference, independently written implementation and intentionally incorrect implementation, then records their results for each of the 256 input values. The separate oracle supplies expected outputs. Run the commands in the native guide to check a passing pair and isolate the failing input. The native CLI also imports an instruction listing, raw p-code and derived decompiler output from a saved Ghidra 12.2 export. Reading such a file does not execute the native artifact. [Native example, Ghidra setup and reproducibility](NATIVE-RECOVERY.md)

## Read the verdict

CLI status 0 indicates the check completed and found no difference within scope. Status 2 indicates a confirmed difference or contract failure. Status 3 indicates incomplete or unsupported evidence without a confirmed difference. Status 1 indicates an input or execution error. In MCP, `read_artifact` pages findings and `export_artifact` writes local JSON or a standalone HTML report. The receipt records the result and its scope. [MCP tool catalog](MCP.md) · [Release validation](VALIDATION.md)
