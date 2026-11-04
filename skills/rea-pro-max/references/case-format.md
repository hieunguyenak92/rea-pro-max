# Case and experiment format

The agent writes this internal format after inspecting the target. A case uses schema_version1, stable id, revision, goal, target(kind/sha256), capabilities, hypotheses, probes and observations. Use the `case init/revise/observe` CLI; each mutation requires the expected revision. Case files support one writer at a time.

A hypothesis is `{id,label,predictions:{probe_id:outcome}}`; outcomes are strings, explicit admissible string arrays or null for unknown. A probe declares `{id,label,cost,requires,effects,reset,steps}`. Cost is positive heuristic units. Requires names actual available capabilities. Reset and steps must be nonempty descriptions of executable operations. The planner ranks worst-case candidate elimination divided by cost, with deterministic ties. It does not execute probes.

Example patch:

```json
{
  "capabilities": ["browser-ui"],
  "hypotheses": [
    {"id":"memory","label":"Worker memory","predictions":{"restart":"lost"}},
    {"id":"local","label":"Extension storage","predictions":{"restart":"retained"}}
  ],
  "probes": [{"id":"restart","label":"Observe a cold worker","cost":2,"requires":["browser-ui"],"effects":[],"reset":"Fresh owned profile","steps":["Save a synthetic clip","Allow a qualified worker stop","Wake normally and read"]}]
}
```

Bindings are64hexSHA256 strings: target_sha256,scenario_sha256,reset_sha256,toolchain_sha256. A reported observation declares probe_id,outcome,source,authority(reported/captured),bindings,partial. The case kernel retains provenance; caller-supplied JSON cannot independently attest runtime execution. Current matching bindings and complete observations are needed before using an observation to eliminate a hypothesis.

Changing the target or scenario/tool/reset identity invalidates affected old observations. If every candidate contradicts qualified observations, status is model_incomplete. Unknown predictions survive; no positive-gain admissible probe yields no_discriminating_probe. These are useful investigation states rather than invented certainty.
