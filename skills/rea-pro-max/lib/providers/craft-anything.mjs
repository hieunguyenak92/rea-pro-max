import { RpmError } from '../common.mjs';
import { JsonRpcProvider } from './provider.mjs';

/** Pinned source identity inspected in the 2026-11-11 Craft Anything audit. */
export const CRAFT_ANYTHING_MANIFEST = Object.freeze({
  provider: 'craft-anything',
  repository: 'storytold/craft-anything',
  version: '0.4.0',
  commit: '49af55e4e4f4b729152a1e61c845a5b10f7b6d9b',
  license: 'MIT OR Apache-2.0',
  licenses: Object.freeze(['MIT', 'Apache-2.0']),
  source_url: 'https://github.com/storytold/craft-anything/tree/49af55e4e4f4b729152a1e61c845a5b10f7b6d9b',
});

/**
 * Typed REA aliases. The names are from Craft's inspected MCP registry; callers
 * cannot pass an arbitrary Craft tool name through this adapter.
 * `doctor` is a local handshake/tools-list check and does not execute a tool.
 */
export const CRAFT_ANYTHING_COMMANDS = Object.freeze({
  doctor: null,
  inspect: 'js_app_map',
  capture: 'web_site_capture',
  compare: 'app_graphs_compare',
});

function commandInput(command, input) {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RpmError('provider_input', `${command} input must be a JSON object.`);
  return input;
}

/** Optional Craft Anything MCP provider; the REA core remains usable without it. */
export class CraftAnythingProvider extends JsonRpcProvider {
  constructor(options = {}) {
    super({
      ...options,
      provider: CRAFT_ANYTHING_MANIFEST.provider,
      manifest: CRAFT_ANYTHING_MANIFEST,
      commands: CRAFT_ANYTHING_COMMANDS,
      // The inspected source reports no commit in serverInfo. Requiring it here
      // intentionally fails closed for unpinned binaries rather than claiming
      // that a version string proves the reviewed source commit.
      expectedServer: { version: CRAFT_ANYTHING_MANIFEST.version, commit: CRAFT_ANYTHING_MANIFEST.commit },
    });
  }

  async execute(command, input = {}, options = {}) {
    if (!Object.hasOwn(CRAFT_ANYTHING_COMMANDS, command)) throw new RpmError('provider_command', 'Craft Anything command is not in the typed allowlist.', { command, allowed: Object.keys(CRAFT_ANYTHING_COMMANDS) });
    return super.execute(command, commandInput(command, input), options);
  }

  async doctor(options = {}) { return this.execute('doctor', {}, options); }
  async inspect(input = {}, options = {}) { return this.execute('inspect', input, options); }
  async capture(input = {}, options = {}) { return this.execute('capture', input, options); }
  async compare(input = {}, options = {}) { return this.execute('compare', input, options); }
}

export function createCraftAnythingProvider(options) { return new CraftAnythingProvider(options); }

