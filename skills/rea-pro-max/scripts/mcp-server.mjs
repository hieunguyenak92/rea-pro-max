#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { serveStdio, StdioServerTransport } from '../assets/vendor/mcp-sdk.mjs';
import { createReaMcpServer } from '../lib/mcp/server.mjs';
import { runtimeDoctor } from '../lib/runtime/mv3.mjs';
import { WorkspacePolicy, MCP_LIMITS } from '../lib/mcp/policy.mjs';
import { CraftAnythingProvider } from '../lib/providers/craft-anything.mjs';
import { readJson, RpmError } from '../lib/common.mjs';

function loadCraftLauncher(path, workspace) {
  if (path === undefined) return;
  if (!isAbsolute(path)) throw new RpmError('provider_config', '--craft-config must be an absolute path to a trusted launcher JSON file.');
  const config = readJson(path, 64 * 1024);
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Object.hasOwn(config, 'executable_path') || Object.keys(config).some(key => !['executable_path', 'args'].includes(key))) {
    throw new RpmError('provider_config', 'Craft launcher configuration must contain executable_path and optional args.');
  }
  const provider = new CraftAnythingProvider({ executablePath: config.executable_path, args: config.args, workspace });
  return { executablePath: provider.executablePath, args: provider.args };
}

export async function startServer(workspace, browserExecutable, craftConfig) {
  // Validate startup before installing a stdio listener; a bad root fails promptly.
  const policy = new WorkspacePolicy(workspace);
  const craftLauncher = loadCraftLauncher(craftConfig, policy.root);
  if (browserExecutable !== undefined) await runtimeDoctor(browserExecutable);
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: MCP_LIMITS.maxInputBufferBytes });
  const handle = serveStdio(() => createReaMcpServer({ workspace, browserExecutable, craftLauncher }), { transport });
  let stopping;
  const stop = () => { stopping ??= handle.close(); void stopping.catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return handle;
}

function argumentsOf(tokens) {
  if (tokens.length === 1 && tokens[0] === '--help') return null;
  try {
    const parsed = parseArgs({ args: tokens, tokens: true, options: { workspace: { type: 'string' }, browser: { type: 'string' }, 'craft-config': { type: 'string' } } });
    if (!parsed.values.workspace || parsed.tokens.length !== Object.keys(parsed.values).length) throw new Error('invalid options');
    return { workspace: parsed.values.workspace, browserExecutable: parsed.values.browser, craftConfig: parsed.values['craft-config'] };
  } catch {
    throw new RpmError('arguments', 'Use mcp-server.mjs --workspace ABSOLUTE_EXISTING_DIRECTORY [--browser ABSOLUTE_CHROMIUM] [--craft-config ABSOLUTE_FILE].');
  }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const options = argumentsOf(process.argv.slice(2));
    if (options === null) process.stderr.write(`REA Pro Max MCP: node mcp-server.mjs --workspace ABSOLUTE_EXISTING_DIRECTORY [--browser ABSOLUTE_CHROMIUM] [--craft-config ABSOLUTE_FILE]\nLocal stdio only. Optional providers use operator startup configuration. JSON input buffer budget: ${MCP_LIMITS.maxInputBufferBytes} bytes.\n`);
    else await startServer(options.workspace, options.browserExecutable, options.craftConfig);
  } catch (error) { process.stderr.write(JSON.stringify({ error: error.code || 'startup_failed', message: error instanceof RpmError ? error.message : 'Cannot open the requested workspace.' }) + '\n'); process.exitCode = 1; }
}
