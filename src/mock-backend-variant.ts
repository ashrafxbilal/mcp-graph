#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'mock-backend-variant', version: '0.1.0' });

server.registerTool(
  'echo',
  {
    description: 'Echo a message from the variant backend.',
    inputSchema: z.object({
      message: z.string(),
    }),
  },
  async ({ message }) => ({
    content: [{ type: 'text' as const, text: `variant:${message}` }],
    structuredContent: { message },
  }),
);

server.registerTool(
  'status',
  {
    description: 'Variant status endpoint used to prove alias dedupe is not over-aggressive.',
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    inputSchema: z.object({}).optional(),
  },
  async () => ({
    content: [{ type: 'text' as const, text: 'status:ok' }],
    structuredContent: { ok: true },
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
