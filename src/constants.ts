import os from 'node:os';
import path from 'node:path';

export const DEFAULT_KINGDOM_HOME = path.join(os.homedir(), '.mcp-kingdom');
export const LEGACY_GRAPH_HOME = path.join(os.homedir(), '.mcp-graph');
export const DEFAULT_GRAPH_HOME = DEFAULT_KINGDOM_HOME;
export const DEFAULT_BACKEND_SNAPSHOT = path.join(DEFAULT_KINGDOM_HOME, 'backends.json');
export const DEFAULT_AUDIT_LOG_PATH = path.join(DEFAULT_KINGDOM_HOME, 'audit.log');
export const DEFAULT_POLICY_PATH = path.join(DEFAULT_KINGDOM_HOME, 'policy.json');
export const DEFAULT_CACHE_DIR = path.join(DEFAULT_KINGDOM_HOME, 'cache');
export const DEFAULT_AUTH_DIR = path.join(DEFAULT_KINGDOM_HOME, 'auth');
export const LEGACY_BACKEND_SNAPSHOT = path.join(LEGACY_GRAPH_HOME, 'backends.json');
export const LEGACY_POLICY_PATH = path.join(LEGACY_GRAPH_HOME, 'policy.json');
export const LEGACY_CACHE_DIR = path.join(LEGACY_GRAPH_HOME, 'cache');
export const LEGACY_AUTH_DIR = path.join(LEGACY_GRAPH_HOME, 'auth');
export const DEFAULT_TOOL_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
export const DEFAULT_VERIFY_TIMEOUT_MS = 1000 * 8;
export const PRIMARY_SERVER_NAME = 'mcp-kingdom';
export const LEGACY_SERVER_NAMES = ['mcp-graph'] as const;
export const FRONT_DOOR_SERVER_NAMES = [PRIMARY_SERVER_NAME, ...LEGACY_SERVER_NAMES] as const;

export const GRAPH_TOOL_NAMES = [
  'list_servers',
  'search_tools',
  'get_tool_schema',
  'call_tool',
  'batch_call_tools',
  'refresh_cache',
] as const;

export const RESERVED_SERVER_NAMES = new Set([
  ...FRONT_DOOR_SERVER_NAMES,
  'code-executor',
  'code-executor-mcp',
]);

export const SOURCE_PRIORITIES = {
  explicit: 100,
  'project-mcp': 90,
  'opencode-project': 85,
  'claude-mcp': 80,
  'claude-json': 70,
  'claude-settings': 65,
  'opencode-json': 60,
  'codex-toml': 50,
} as const;
