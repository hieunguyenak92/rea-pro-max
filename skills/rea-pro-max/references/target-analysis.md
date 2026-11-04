# Artifact analysis and provider scope

The bundled Acorn-based reader handles regular JavaScript files and extracted directories for ordinary web scripts, ManifestV3 extension contexts and Electron main/preload/renderer boundaries. Read the inspection's limits, capabilities and unknowns; dynamic calls and unsupported syntax may prevent full attribution.

Static records include file hashes and ranges. Edges remain declared/candidate. A matching message name in two contexts does not prove delivery, and a handler in the AST does not prove it ran. Inspect imports within the admitted artifact only. Symlinks, unresolved imports, bounds and parse failures must stay explicit.

For archives/binaries/mobile packages, classify and report only the format facts actually returned. Use an available version-tested provider when deeper analysis is needed. The bundled toolkit does not include native decompilers, an APK/Hermes/Dart semantic-recovery engine, a universal ASAR extractor or an iOS runtime. Extracted Electron source is a supported intake; installed app extraction is a separate step through appropriate tools.

When full source is available, ordinary repository search/AST/code tools may answer the question directly. Use runtime experiments for behavior that static structure cannot establish. A new engine/version must earn an integration receipt before a support claim is published.
