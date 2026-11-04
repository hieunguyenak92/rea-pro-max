# Credits and notices

REA Pro Max is an independent project. Research inspiration: [morluto/rea](https://github.com/morluto/rea). This release does not include its source code or require its MCP server. The project's own kernel, adapters, skill and fixtures are developed here.

The skill vendors the ESM distribution of **Acorn8.15.0**, copyright2012–2022 by contributors, under MIT. Its full notice is retained in `skills/rea-pro-max/assets/vendor/ACORN-LICENSE`. `docs/ACORN-RECEIPT.json` records official npm acquisition and integrity verification. Acorn parses target code; parsing does not execute that code.

Electron and lint tooling are development dependencies under their respective package notices. Optional analysis providers and target applications retain their own licenses and access requirements.

## Bundled official MCP runtime

MCP support uses the official Model Context Protocol TypeScript SDK2.4.0 server/core packages and Zod4.6.7, bundled with pinned esbuild0.28.2. The generated runtime is included so installation does not require npm. The SDK retains Apache-2.0/MIT transition licensing; Zod is MIT. Complete original licenses and provenance are preserved in [MCP notices](skills/rea-pro-max/assets/vendor/MCP-NOTICES.md) and the [bundle receipt](skills/rea-pro-max/assets/vendor/MCP-RECEIPT.json). The surrounding REA Pro Max code is MIT.

Rebuild with `npm ci --ignore-scripts` and `npm run vendor:mcp`; verify bytes with `npm run check:vendor`. SDK documentation/source: https://github.com/modelcontextprotocol/typescript-sdk. No source from upstream REA is included.
