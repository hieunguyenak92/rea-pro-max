#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveStdio, StdioServerTransport } from '../assets/vendor/mcp-sdk.mjs';
import { createReaMcpServer } from '../lib/mcp/server.mjs';
import { WorkspacePolicy, MCP_LIMITS } from '../lib/mcp/policy.mjs';
import { RpmError } from '../lib/common.mjs';

export async function startServer(workspace) {
  // Validate startup before installing a stdio listener; a bad root fails promptly.
  new WorkspacePolicy(workspace);
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: MCP_LIMITS.maxInputBufferBytes });
  const handle = serveStdio(() => createReaMcpServer({ workspace }), { transport });
  let stopping;
  const stop = () => { stopping ??= handle.close(); void stopping.catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return handle;
}

function argumentsOf(tokens) {
  if (tokens.length === 1 && tokens[0] === '--help') return null;
  if (tokens.length !== 2 || tokens[0] !== '--workspace' || !tokens[1]) throw new RpmError('arguments', 'Use mcp-server.mjs --workspace ABSOLUTE_EXISTING_DIRECTORY.');
  return tokens[1];
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const workspace = argumentsOf(process.argv.slice(2));
    if (workspace === null) process.stderr.write(`REA Pro Max MCP: node mcp-server.mjs --workspace ABSOLUTE_EXISTING_DIRECTORY\nLocal stdio only. JSON input buffer budget: ${MCP_LIMITS.maxInputBufferBytes} bytes.\n`);
    else await startServer(workspace);
  } catch (error) { process.stderr.write(JSON.stringify({ error: error.code || 'startup_failed', message: error instanceof RpmError ? error.message : 'Cannot open the requested workspace.' }) + '\n'); process.exitCode = 1; }
}
