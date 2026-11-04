# Contributing

Help make investigations more precise and useful. A contribution should improve a real task, preserve evidence boundaries and include a small reproducible example. A new target name or prompt does not establish a working integration.

## Develop and check

Use Node.js22+ and Python3. Development installation is separate from ordinary skill use:

```sh
npm ci --ignore-scripts
npm test
npm run lint
npm run check:docs
python3 tools/package_skill.py --check
```

The install command skips dependency lifecycle scripts, including the Electron runtime download. These engine, CLI and extracted-package checks do not require Electron. Runtime verification of an Electron change needs the actual supported runtime and an explicit test record.

## Make the behavior reviewable

- Describe the user's task, the previous behavior and the resulting behavior.
- Use owned or shareable fixtures. Do not upload private applications, credentials or captured user data.
- Preserve source hashes, exact target/context identity, reset assumptions and observation authority. Incomplete or incompatible evidence stays unknown.
- Add meaningful tests for changed behavior, including ambiguity and failure cases where relevant. Avoid tests that merely repeat an implementation's internals.
- Keep runtime dependencies small. Static inspection must not execute target code. New external providers require explicit prerequisites and evidence of what was actually exercised.
- Update relevant references and all nine READMEs when the public behavior changes. Preserve the shared language selector and consistent commands, counts and limits.

Include the checks you actually ran in your pull request. Separate locally observed results from unexecuted platform/runtime claims. See the [verification record](docs/VALIDATION.md) and [security reporting guidance](SECURITY.md).
