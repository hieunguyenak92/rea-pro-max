# Recovered search — worked implementation

Owned target: `skills/rea-pro-max/assets/labs/web/`. This receiving app implements the selected text-search job independently; it does not copy the target UI, import its script or share its storage. Both use the same owned synthetic seed records so behavior is comparable.

Recovery used artifact inspection, reading the target's search expression and actual browser observations. NFKC normalization followed by `toLocaleLowerCase('en-US')` applies to both query and text; substring matching retains original record order and string IDs. It does not remove accents or trim whitespace. An empty query returns all records. This contract is smaller than the target app: adding notes and persistence are outside this rebuild.

Serve the repository, then visit `/examples/recovered-search/`. `node --test tests/recovered-search.test.mjs` runs the selected finite cases, including cases authored after the initial implementation. These are correctness checks for this component, not a blind study or evidence that the skill caused an improvement. The same agent authored and checked it with access to the source fixture.
