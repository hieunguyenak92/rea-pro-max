// Build-only entry. Release MCP runtime imports the bundled local module.
export { McpServer } from '@modelcontextprotocol/server';
export { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
export { z } from 'zod';
