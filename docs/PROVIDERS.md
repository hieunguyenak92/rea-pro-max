# Optional providers

The REA Pro Max kernel is useful without external providers. Providers are adapters with their own version, scope and evidence boundaries; they do not turn static findings into runtime truth.

## Craft Anything

The optional adapter targets the Craft Anything MCP server reviewed at commit `49af55e4e4f4b729152a1e61c845a5b10f7b6d9b`, version `0.4.0`, with source license `MIT OR Apache-2.0`. No Craft source, branding or assets are bundled. Install and build the provider yourself, then supply its absolute executable path to the CLI/host tool. REA Pro Max never installs it automatically.

The typed aliases are:

| REA command | Pinned provider operation |
| --- | --- |
| `craft_provider_doctor` | MCP initialize plus tools/list; no target call |
| `craft_provider_inspect` | `js_app_map` |
| `craft_provider_capture` | `web_site_capture` |
| `craft_provider_compare` | `app_graphs_compare` |

Each call starts a fresh child process, uses newline JSON-RPC MCP, checks the pinned server identity and advertised tool, bounds input/output and deadline, admits path-bearing fields inside the selected workspace, and retains cleanup/provenance. The wrapper fails closed when a binary does not report the pinned commit/version, returns malformed JSON, drifts from the advertised tool list, exceeds its byte/time budget or escapes the workspace. Provider errors are evidence about the provider call; they are not target behavior.

Craft's visual similarity and evidence-ledger features can help a host agent inspect a web/app rebuild, but similarity is not behavioral equivalence. A claim-check or graph result does not certify that a rebuilt feature is semantically correct. Use REA's own finite web or application replay to verify the behavior you ship.

The provider executes caller-selected code with its normal permissions. The adapter is an admission and protocol boundary, not an operating-system sandbox. Review the provider's own license, dependencies, privacy policy and target authorization before enabling it.
