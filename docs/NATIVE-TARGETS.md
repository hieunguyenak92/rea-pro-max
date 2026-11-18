# Check which deployment targets a build still declares

A macOS library can lose its Intel slice during packaging. Recompiling an unchanged Java source file with a newer release target can exclude an older JVM. Compare the two artifacts directly to identify these changes before shipping. The check reads local files and requires neither Xcode nor a JDK to inspect the bundled examples.

## Try the two regressions

From a source checkout, run each command separately. A target regression returns exit code 2.

```sh
cli=skills/rea-pro-max/scripts/rea-pro-max.mjs
lab=skills/rea-pro-max/assets/labs/targets

node "$cli" target-inspect "$lab/universal-macos11.o"
node "$cli" target-diff "$lab/universal-macos11.o" "$lab/arm64-macos12.o"
node "$cli" target-diff "$lab/java11/TargetSample.class" "$lab/java17/TargetSample.class"
node "$cli" release-check "$lab/policy.json"
```

| Owned build pair | Change the compiler made | Expected comparison |
| --- | --- | --- |
| Universal object → arm64 object | Removed x86_64 and raised the arm64 minimum from macOS 11.0 to 12.0 | Narrowed |
| Java 11 class → Java 17 class | Raised the class-file major version from 55 to 61. Both minor versions are zero. | Narrowed |
| arm64 object → universal object | Retained arm64, lowered its minimum to 11.0 and added x86_64 | Preserved |

The bundled release policy allows the bytes of `TargetSample.class` to change. Its `deployment_targets` entry separately requires the candidate to preserve the reference class-file target. The expected release verdict is `fail`. [Example policy](../skills/rea-pro-max/assets/labs/targets/policy.json) · [Release checks](RELEASE-CHECK.md)

## Interpret a receipt

`target-inspect` reports the supported declarations it can read from one Mach-O file or one JVM class file. `target-diff` compares a reference against a candidate in that order. A `preserved` verdict admits additional declared targets and lower deployment minimums. A `narrowed` verdict identifies a lost target or a stricter minimum. `unknown` calls for more evidence. Exit codes for comparisons are 0, 2 and 3 respectively. The local MCP equivalents are `inspect_deployment_targets` and `compare_deployment_targets`. [MCP usage](MCP.md)

Mach-O evidence describes the architecture, CPU subtype, file kind, platform and minimum version declared in each admitted slice. Java evidence describes the class-file release and preview requirement. A Java preview class requires its specific Java release with preview enabled. Library availability, application behavior, signing and device or VM execution need separate evidence. Compare individual build outputs, such as one object or one extracted class, for the same intended deliverable. [Apple Mach-O declarations](https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h) · [JVM class-file format](https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html#jvms-4.1)

Each direct input is bounded to 16 MiB. A Mach-O universal table can declare up to 64 slices, each with up to 4,096 load commands. Coverage applies to the declared table. Unlisted legacy slices are outside this inventory. A slice with several platform declarations returns incomplete coverage.

The JVM reader accepts class-file major versions 45 through 71, covering the version range from JDK 1.0.2 through Java SE 27. It checks the version, constant-pool framing and outer class structure through the final byte. Method bodies and member attribute payloads are opaque. An unsupported or ambiguous file produces an unknown comparison, including when the two files have identical bytes. [Java SE 27 format and preview rules](https://docs.oracle.com/javase/specs/jvms/se27/html/jvms-4.html#jvms-4.1)

## Reproduce the fixture evidence

The bundled [C source](../skills/rea-pro-max/assets/labs/targets/target-sample.c) and [Java source](../skills/rea-pro-max/assets/labs/targets/TargetSample.java) each declare the same constant across builds. Apple clang 17.0.0 (`clang-1700.4.4.1`), Apple `lipo` and OpenJDK `javac` 21.0.12.1 produced the bundled objects and classes on macOS. The following commands write fresh outputs to a temporary directory. Put the JDK's `javac` and `javap` on your path for the Java commands. [javac release targeting](https://docs.oracle.com/en/java/javase/21/docs/specs/man/javac.html)

```sh
lab=skills/rea-pro-max/assets/labs/targets
out=$(mktemp -d)
xcrun clang -target x86_64-apple-macos11 -c "$lab/target-sample.c" -o "$out/intel.o"
xcrun clang -target arm64-apple-macos11 -c "$lab/target-sample.c" -o "$out/arm.o"
xcrun lipo -create "$out/intel.o" "$out/arm.o" -output "$out/universal.o"
xcrun clang -target arm64-apple-macos12 -c "$lab/target-sample.c" -o "$out/arm12.o"
xcrun lipo -archs "$out/universal.o"
xcrun otool -arch all -l "$out/universal.o"
xcrun lipo -archs "$out/arm12.o"
xcrun otool -l "$out/arm12.o"

mkdir -p "$out/java11" "$out/java17"
javac --release 11 -proc:none -g:none -d "$out/java11" "$lab/TargetSample.java"
javac --release 17 -proc:none -g:none -d "$out/java17" "$lab/TargetSample.java"
javap -verbose "$out/java11/TargetSample.class"
javap -verbose "$out/java17/TargetSample.class"
```

On November 18, 2026, `lipo -archs` returned `x86_64 arm64` for the universal object and `arm64` for the thin object. For the two universal slices, `otool` reported `LC_BUILD_VERSION`, platform 1 and `minos 11.0`. For the thin slice it reported platform 1 and `minos 12.0`. The two `javap` outputs showed major/minor pairs `55/0` and `61/0`.

| Bundled artifact | SHA-256 |
| --- | --- |
| `universal-macos11.o` | `da97ef130669286037ccc4c37995c2b93839295406cc415049159a4f524040f2` |
| `arm64-macos12.o` | `7c9e310af55aad19e65c6e6b73a0909056549d00b56d55edc0199aec04aa3f4b` |
| `java11/TargetSample.class` | `c73ba03c89092b399f29155f700d3ee405a361607b0b5278704378237b39b004` |
| `java17/TargetSample.class` | `2abdb996f4c6a01a015892449bef251c1e43849e6bac6f8fe4207b8e42e5e074` |

## Repeat with linked macOS executables

From the source checkout with Apple Command Line Tools installed, generate two executables in a temporary directory. All inspection commands read their files without launching them.

```sh
cli=skills/rea-pro-max/scripts/rea-pro-max.mjs
out=$(mktemp -d)
echo 'int main(void) { return 42; }' > "$out/linked-sample.c"
xcrun clang -target x86_64-apple-macos11 "$out/linked-sample.c" -o "$out/intel11"
xcrun clang -target arm64-apple-macos11 "$out/linked-sample.c" -o "$out/arm11"
xcrun lipo -create "$out/intel11" "$out/arm11" -output "$out/universal11"
xcrun clang -target arm64-apple-macos12 "$out/linked-sample.c" -o "$out/arm12"
xcrun lipo -archs "$out/universal11"
xcrun lipo -archs "$out/arm12"
xcrun otool -arch all -hv "$out/universal11" "$out/arm12"
xcrun otool -arch all -l "$out/universal11" "$out/arm12"
node "$cli" target-diff "$out/universal11" "$out/arm12"
node "$cli" target-diff "$out/arm12" "$out/universal11"
```

In the November 18 run, `otool` classified all three slices as `EXECUTE`. It reported macOS 11.0 for both universal slices and 12.0 for the arm64 candidate. REA Pro Max recorded `target_removed` for x86_64 and `minimum_os_raised` for arm64 (exit 2). Reversing the inputs recorded `minimum_os_lowered` and `target_added` (exit 0). The measured input hashes were `679d415cf73840ce5af5f8b6ec36e36366401798dc1032810ef87c683159c501` and `40c38d0cb4a86cc61e52b70fd61331c504ea7f99476cea7047304c7212d4cf80`. Linked bytes can vary across toolchains.
