import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolIndexCache } from './caching/tool-index-cache.js';
import { renderToolResult, type GraphToolResult } from './formatting/result-shaper.js';
import { AuditLogger } from './logger.js';
import type {
  BatchCallToolParams,
  CallToolParams,
  LoadedServerConfig,
  NormalizedServerConfig,
  SearchToolParams,
  ToolMatch,
} from './types.js';
import { scoreText } from './utils.js';
import { MCP_GRAPH_VERSION } from './version.js';

interface ToolCacheRecord {
  tools: Tool[];
  fetchedAt: number;
}

class BackendSession {
  private client?: Client;
  private transport?: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  private connectPromise?: Promise<Client>;
  private toolCache?: ToolCacheRecord;

  constructor(
    readonly config: NormalizedServerConfig,
    private readonly logger: AuditLogger,
    private readonly cache: ToolIndexCache,
  ) {}

  async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.connectInternal();
    }
    return this.connectPromise;
  }

  async listTools(refresh = false): Promise<Tool[]> {
    if (!refresh && this.toolCache) {
      return this.toolCache.tools;
    }

    const diskCached = refresh ? undefined : await this.cache.get(this.config);
    if (diskCached && !diskCached.stale) {
      this.toolCache = { tools: diskCached.tools, fetchedAt: Date.parse(diskCached.cachedAt) || Date.now() };
      await this.logger.log('tool_cache_hit', {
        server: this.config.name,
        stale: false,
        cacheDir: this.cache.cacheDir,
      });
      return diskCached.tools;
    }

    try {
      const client = await this.getClient();
      const tools: Tool[] = [];
      let cursor: string | undefined;

      do {
        const response = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...response.tools);
        cursor = response.nextCursor;
      } while (cursor);

      this.toolCache = { tools, fetchedAt: Date.now() };
      await this.cache.set(this.config, tools);
      return tools;
    } catch (error) {
      if (diskCached) {
        this.toolCache = { tools: diskCached.tools, fetchedAt: Date.parse(diskCached.cachedAt) || Date.now() };
        await this.logger.log('tool_cache_stale_fallback', {
          server: this.config.name,
          stale: true,
          reason: error instanceof Error ? error.message : String(error),
        });
        return diskCached.tools;
      }
      throw error;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<GraphToolResult> {
    const client = await this.getClient();
    return (await client.callTool({ name, arguments: args })) as GraphToolResult;
  }

  async close(): Promise<void> {
    await this.transport?.close();
    this.client = undefined;
    this.transport = undefined;
    this.connectPromise = undefined;
    this.toolCache = undefined;
  }

  private async connectInternal(): Promise<Client> {
    const client = new Client(
      { name: 'mcp-graph-backend-client', version: MCP_GRAPH_VERSION },
      { capabilities: {} },
    );
    const transport = this.createTransport();
    await client.connect(transport);

    this.client = client;
    this.transport = transport;

    await this.logger.log('backend_connected', {
      server: this.config.name,
      sourceKind: this.config.sourceKind,
      transport: this.config.transport,
      sourceFile: this.config.sourceFile,
    });

    return client;
  }

  private createTransport(): StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport {
    if (this.config.transport === 'stdio') {
      if (!this.config.command) {
        throw new Error(`Missing command for stdio server ${this.config.name}`);
      }
      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        cwd: this.config.cwd,
        env: { ...(process.env as Record<string, string | undefined>), ...(this.config.env ?? {}) } as Record<string, string>,
        stderr: 'pipe',
      });
    }

    if (!this.config.url) {
      throw new Error(`Missing URL for remote server ${this.config.name}`);
    }

    const url = new URL(this.config.url);
    if (this.config.transport === 'sse') {
      return new SSEClientTransport(url, {
        requestInit: { headers: this.config.headers },
        eventSourceInit: { fetch: globalThis.fetch as typeof fetch, headers: this.config.headers } as never,
      });
    }

    return new StreamableHTTPClientTransport(url, {
      requestInit: { headers: this.config.headers },
    });
  }
}

export class GraphRegistry {
  private readonly sessions = new Map<string, BackendSession>();
  private readonly configByName = new Map<string, NormalizedServerConfig>();
  private readonly toolIndexCache: ToolIndexCache;

  constructor(config: LoadedServerConfig, private readonly logger: AuditLogger) {
    this.toolIndexCache = new ToolIndexCache({ logger });
    for (const server of config.servers) {
      this.configByName.set(server.name, server);
    }
  }

  listServers(): NormalizedServerConfig[] {
    return [...this.configByName.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async getServerInventory(params: { server?: string; includeToolCounts?: boolean; refresh?: boolean } = {}): Promise<Array<{
    server: NormalizedServerConfig;
    toolCount?: number;
  }>> {
    const configs = this.filterServers(params.server);
    if (!params.includeToolCounts) {
      return configs.map((config) => ({ server: config }));
    }

    return Promise.all(
      configs.map(async (config) => ({
        server: config,
        toolCount: (await this.getSession(config.name).listTools(params.refresh ?? false)).length,
      })),
    );
  }

  async searchTools(params: SearchToolParams = {}): Promise<ToolMatch[]> {
    const detail = params.detail ?? 'summary';
    const limit = params.limit ?? 20;
    const serverConfigs = this.filterServers(params.server);
    const matches: ToolMatch[] = [];

    for (const config of serverConfigs) {
      const tools = await this.getSession(config.name).listTools(params.refresh ?? false);
      for (const tool of tools) {
        const score = scoreTool(config.name, tool, params.query ?? '');
        if (params.query && score <= 0) {
          continue;
        }
        matches.push({
          server: config.name,
          tool: detail === 'name'
            ? ({ name: tool.name } as Tool)
            : detail === 'summary'
              ? ({ name: tool.name, description: tool.description, annotations: tool.annotations } as Tool)
              : tool,
          score,
          sourceKind: config.sourceKind,
          sourceFile: config.sourceFile,
          transport: config.transport,
        });
      }
    }

    return matches
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.server !== right.server) {
          return left.server.localeCompare(right.server);
        }
        return left.tool.name.localeCompare(right.tool.name);
      })
      .slice(0, limit);
  }

  async getTool(server: string, toolName: string, refresh = false): Promise<{ server: NormalizedServerConfig; tool: Tool }> {
    const config = this.requireServer(server);
    const tools = await this.getSession(server).listTools(refresh);
    const tool = tools.find((entry) => entry.name === toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found on server ${server}`);
    }
    return { server: config, tool };
  }

  async callTool(params: CallToolParams): Promise<{
    text: string;
    truncated: boolean;
    result: GraphToolResult;
    selectedValue: unknown;
    outputMode: 'content' | 'structured' | 'full';
  }> {
    const config = this.requireServer(params.server);
    const args = params.arguments ?? {};
    const maxCharacters = params.maxCharacters ?? 12_000;

    await this.logger.log('tool_call', {
      server: config.name,
      tool: params.tool,
      argumentKeys: Object.keys(args),
      outputMode: params.outputMode ?? 'content',
      fieldPath: params.fieldPath,
    });

    const result = await this.getSession(config.name).callTool(params.tool, args);
    const rendered = renderToolResult(result, {
      maxCharacters,
      outputMode: params.outputMode,
      fieldPath: params.fieldPath,
      maxArrayItems: params.maxArrayItems,
    });

    return {
      text: rendered.text,
      truncated: rendered.truncated,
      result,
      selectedValue: rendered.selectedValue,
      outputMode: rendered.outputMode,
    };
  }

  async batchCallTools(params: BatchCallToolParams): Promise<Array<{ step: number; server: string; tool: string; ok: boolean; preview: string }>> {
    const steps = params.steps;
    const maxCharacters = params.maxCharactersPerResult ?? 4_000;
    const mode = params.mode ?? 'sequential';

    if (mode === 'parallel') {
      const settled = await Promise.allSettled(
        steps.map((step) => this.callTool({
          server: step.server,
          tool: step.tool,
          arguments: step.arguments,
          maxCharacters,
          outputMode: params.outputMode,
        })),
      );

      return settled.map((entry, index) => {
        const step = steps[index];
        if (entry.status === 'fulfilled') {
          return { step: index + 1, server: step.server, tool: step.tool, ok: !(entry.value.result.isError ?? false), preview: entry.value.text };
        }
        return { step: index + 1, server: step.server, tool: step.tool, ok: false, preview: entry.reason instanceof Error ? entry.reason.message : String(entry.reason) };
      });
    }

    const results: Array<{ step: number; server: string; tool: string; ok: boolean; preview: string }> = [];
    for (const [index, step] of steps.entries()) {
      try {
        const result = await this.callTool({
          server: step.server,
          tool: step.tool,
          arguments: step.arguments,
          maxCharacters,
          outputMode: params.outputMode,
        });
        results.push({ step: index + 1, server: step.server, tool: step.tool, ok: !(result.result.isError ?? false), preview: result.text });
      } catch (error) {
        results.push({
          step: index + 1,
          server: step.server,
          tool: step.tool,
          ok: false,
          preview: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  async refresh(server?: string): Promise<{ refreshedServers: string[] }> {
    const configs = this.filterServers(server);
    for (const config of configs) {
      await this.getSession(config.name).listTools(true);
    }
    return { refreshedServers: configs.map((config) => config.name) };
  }

  async invalidateToolCache(server?: string): Promise<{ invalidatedServers: string[] }> {
    if (server) {
      await this.toolIndexCache.invalidate(server);
      const session = this.sessions.get(server);
      if (session) {
        await session.close();
      }
      this.sessions.delete(server);
      return { invalidatedServers: [server] };
    }

    await this.toolIndexCache.invalidate();
    await Promise.all([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
    return { invalidatedServers: this.listServers().map((entry) => entry.name) };
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.close()));
  }

  private getSession(serverName: string): BackendSession {
    const existing = this.sessions.get(serverName);
    if (existing) {
      return existing;
    }
    const config = this.requireServer(serverName);
    const session = new BackendSession(config, this.logger, this.toolIndexCache);
    this.sessions.set(serverName, session);
    return session;
  }

  private filterServers(server?: string): NormalizedServerConfig[] {
    if (!server) {
      return this.listServers();
    }
    return [this.requireServer(server)];
  }

  private requireServer(name: string): NormalizedServerConfig {
    const config = this.configByName.get(name);
    if (!config) {
      throw new Error(`Unknown server ${name}`);
    }
    return config;
  }
}

export function scoreTool(serverName: string, tool: Tool, query: string): number {
  if (!query.trim()) {
    return 1;
  }
  return scoreText(serverName, query) + scoreText(tool.name, query) * 2 + scoreText(tool.description ?? '', query);
}
