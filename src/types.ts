import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type SourceKind =
  | 'explicit'
  | 'project-mcp'
  | 'opencode-project'
  | 'opencode-json'
  | 'claude-settings'
  | 'claude-mcp'
  | 'claude-json'
  | 'codex-toml';

export type GraphTransport = 'stdio' | 'streamable-http' | 'sse';

export interface NormalizedServerConfig {
  name: string;
  sourceFile: string;
  sourceKind: SourceKind;
  priority: number;
  transport: GraphTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  rawType?: string;
  metadata?: Record<string, unknown>;
}

export interface DuplicateServerRecord {
  name: string;
  kept: NormalizedServerConfig;
  discarded: NormalizedServerConfig;
}

export interface LoadedServerConfig {
  servers: NormalizedServerConfig[];
  duplicates: DuplicateServerRecord[];
  loadedFiles: string[];
}

export interface ToolMatch {
  server: string;
  tool: Tool;
  score: number;
  sourceKind: SourceKind;
  sourceFile: string;
  transport: GraphTransport;
}

export interface SearchToolParams {
  query?: string;
  server?: string;
  limit?: number;
  detail?: 'name' | 'summary' | 'schema';
  refresh?: boolean;
}

export interface CallToolParams {
  server: string;
  tool: string;
  arguments?: Record<string, unknown>;
  maxCharacters?: number;
  includeStructuredResult?: boolean;
  outputMode?: 'content' | 'structured' | 'full';
  fieldPath?: string;
  maxArrayItems?: number;
}

export interface BatchCallToolStep {
  server: string;
  tool: string;
  arguments?: Record<string, unknown>;
}

export interface BatchCallToolParams {
  steps: BatchCallToolStep[];
  mode?: 'parallel' | 'sequential';
  maxCharactersPerResult?: number;
  outputMode?: 'content' | 'structured' | 'full';
}
