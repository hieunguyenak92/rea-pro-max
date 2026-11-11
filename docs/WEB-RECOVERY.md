# Web recovery lane

REA Pro Max v0.4 can execute a bounded web scenario in a fresh Chromium profile and compare two explicit URLs. The lane is designed for recovering a concrete interaction: navigation, click, input, reload and wait actions produce bounded observations for the URL, title, DOM text/HTML digest, layout width, active element, local-storage keys and screenshot digest.

## Scenario

```json
{
  "schema_version": 1,
  "name": "Search submit",
  "url": "http://127.0.0.1:4173/reference/",
  "actions": [
    {"id": "open", "kind": "wait", "milliseconds": 0},
    {"id": "type", "kind": "input", "selector": "#search", "value": "café"},
    {"id": "submit", "kind": "click", "selector": "#submit"},
    {"id": "settled", "kind": "wait", "milliseconds": 100}
  ]
}
```

Actions are capped at 64. Selectors, input strings, waits and captured DOM are bounded. The URL must be an absolute `http` or `https` URL without embedded credentials. Run `web capture` when you need one target, or `web replay` when you have a reference and receiving URL:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs web capture \
  --browser "/absolute/path/to/chromium" \
  --scenario ./web-scenario.json --out ./capture.json

node skills/rea-pro-max/scripts/rea-pro-max.mjs web replay \
  --reference-url http://127.0.0.1:4173/reference/ \
  --candidate-url http://127.0.0.1:4174/recovered/ \
  --browser "/absolute/path/to/chromium" \
  --scenario ./web-scenario.json --out ./replay.json
```

The replay compiles a finite contract and reports behavior and visual results separately. Origin and port are removed from URL observations so two local servers can be compared; path, query and hash remain observable. A visual hash mismatch never becomes a behavior pass or fail. Missing observations, incomplete cleanup, unsupported browser state and provider errors remain `unknown` or an explicit failure. The output is evidence for the declared actions only; it is not pixel-perfect or whole-application equivalence.

The owned `assets/recovery-web/` fixture is a local, dependency-free example. It includes a reference, a deliberately defective starter and an independently authored recovered app. Its contract covers delayed responses, latest-wins cancellation, NFKC search normalization, empty/error/cancelled states, localStorage reload persistence, keyboard focus and responsive markup. The fixture is synthetic and does not call a network service.

## MCP

Start the MCP server with `--browser` and call `capture_web` or `replay_web`. Pass workspace-relative scenario and contract files. The web provider runs the URL as supplied by the host; a disposable profile is not an OS or network sandbox, and the selected page may make requests allowed by the browser. No browser is downloaded and no personal profile is reused.
