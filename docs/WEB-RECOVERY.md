# Web recovery lane

REA Pro Max executes a finite web scenario in a fresh Chromium profile. Navigation, click, input, reload and wait actions record bounded DOM, layout, local-storage key names, screenshot digests and selected HTTP request starts. Use a finite scenario to compare what a user sees and what the page sends.

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

The replay compiles a finite contract and reports behavior and visual results separately. It compares path, query and fragment for page URL observations so two test servers can use different ports. Screenshot digests feed the visual verdict. Storage observations cover key names. To verify a persisted value, add a scenario that reads and exposes the value after reset or restart.

In a paired replay, absolute `navigate` actions must use the scenario origin or one of the two replay origins. Each side opens the same path, query and fragment on its own origin. Distinct start URLs that share one origin require scenarios without an explicit `navigate` action. An observation from an unexpected origin cannot certify that side. A supplied contract checks the captured action sequence and inputs. If its recorded reference observation disagrees with the fresh reference, the applicable verdict is `unknown`.

### HTTP observations and coverage

The Chromium adapter subscribes before initial navigation. Its comparison uses the method and pathname of same-origin fetch/XHR and HTTP writes that start within each action's observation window in the attached page session. Static GET requests, other origins, independent worker targets and activity outside those windows are out of scope. The per-action receipt records its measured duration and any coverage issues. The network subreceipt retains request ID, response status, cache or service-worker source when reported, and lifecycle outcome. The comparison uses request starts. For evidence that the server received or persisted a mutation, compare against a server observation or an independent read.

A window with a working observer and no matching requests has an empty summary. A disabled, detached or over-budget observer yields unavailable network evidence. The default contract requires DOM, network and storage, so missing network evidence leaves behavior `unknown` unless a different required channel already proves a mismatch. Visual output can still have its own verdict. Receipts from older Chromium runs supplied no measured network evidence and are converted accordingly.

An optional `network_counts` array in a supplied replay contract can require an exact count of in-scope starts on both sides. For example, `[{"action_id":"save","method":"POST","path":"/save","count":1}]` fails when both fully observed windows record zero matching sends.

Set `"network": false` in the scenario to disable HTTP collection. A supplied contract can explicitly limit required channels to the ones relevant to the task. Set `"network": {"correlation": true}` for an owned app that returns a bounded `X-REA-Operation-Id` response header. The receipt can then retain that ID and the first same-origin script location in the request stack. The network collector omits query strings, bodies, cookies and other response headers.

The capture provenance marks its URL digest as a locator. Build identity requires independent build evidence. The capture records its start and completion timestamps plus monotonic elapsed time.

The owned `assets/recovery-web/` fixture is a local, dependency-free example. It includes a reference, a deliberately defective starter and an independently authored recovered app. Its contract covers delayed responses, latest-wins cancellation, NFKC search normalization, empty/error/cancelled states, localStorage reload persistence, keyboard focus and responsive markup. The fixture is synthetic and does not call a network service.

### Save, restart and read from a fresh browser

Run the owned persistence project from the repository root:

```sh
RPM_BROWSER_EXECUTABLE="/absolute/path/to/chromium" \
  node skills/rea-pro-max/assets/labs/web-persistence/verify.mjs
```

The runner compares a reference path, a recovered path and a deliberately defective path. Each path launches a browser and a local save server, issues overlapping writes, then terminates the server and starts a new process and browser profile to read the persisted value. It joins Chromium request IDs and response operation IDs to receipts captured from the child server. For this fixture, it checks the bundle and map bytes served by the child against its manifest before mapping observed script locations to the authored source. The verifier returns JSON and exits nonzero if the working paths do not pass or the independent read fails to catch the defective path. [Fixture files](../skills/rea-pro-max/assets/labs/web-persistence/)

## MCP

Start the MCP server with `--browser` and call `capture_web` or `replay_web`. Pass workspace-relative scenario and contract files. The web provider runs the URL as supplied by the host; a disposable profile is not an OS or network sandbox, and the selected page may make requests allowed by the browser. No browser is downloaded and no personal profile is reused.
