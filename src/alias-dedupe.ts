import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { GraphRegistry } from './clients.js';
import { DEFAULT_VERIFY_TIMEOUT_MS } from './constants.js';
import { AuditLogger } from './logger.js';
import type {
  AliasDeduplicationRecord,
  ConnectionResolution,
  LoadedServerConfig,
  NormalizedServerConfig,
} from './types.js';
import { withTimeout } from './utils.js';

interface VerifiedServerSignature {
  connectionFingerprint: string;
  toolFingerprint: string;
  toolCount: number;
}

export interface DeduplicateAliasesOptions {
  auditLogPath?: string;
  verifyTimeoutMs?: number;
}

export interface DeduplicateAliasesResult {
  loadedConfig: LoadedServerConfig;
  dedupedAliases: AliasDeduplicationRecord[];
}

export async function deduplicateVerifiedServerAliases(
  loadedConfig: LoadedServerConfig,
  options: DeduplicateAliasesOptions = {},
): Promise<DeduplicateAliasesResult> {
  const registry = new GraphRegistry(loadedConfig, new AuditLogger(options.auditLogPath));
  const verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const signatures = new Map<string, VerifiedServerSignature>();

  try {
    for (const config of loadedConfig.servers) {
      try {
        const tools = await withTimeout(
          registry.listServerTools(config.name, true),
          verifyTimeoutMs,
          `Alias verification for ${config.name}`,
        );
        const resolution = registry.getServerConnectionResolution(config.name);
        signatures.set(config.name, {
          connectionFingerprint: buildConnectionFingerprint(config, resolution),
          toolFingerprint: buildToolFingerprint(tools),
          toolCount: tools.length,
        });
      } catch {
        // Skip dedupe for unverified or failing backends. We only collapse aliases after a real successful verification.
      }
    }
  } finally {
    await registry.close();
  }

  const groups = new Map<string, NormalizedServerConfig[]>();
  for (const config of loadedConfig.servers) {
    const token = normalizeAliasToken(config.name);
    if (!token) {
      continue;
    }
    groups.set(token, [...(groups.get(token) ?? []), config]);
  }

  const dedupedAliases: AliasDeduplicationRecord[] = [];
  const droppedServerNames = new Set<string>();
  const canonicalConfigs = new Map<string, NormalizedServerConfig>();

  for (const [normalizedAlias, group] of groups.entries()) {
    if (group.length < 2) {
      continue;
    }

    const signatureGroups = new Map<string, NormalizedServerConfig[]>();
    for (const config of group) {
      const signature = signatures.get(config.name);
      if (!signature) {
        continue;
      }
      const key = `${signature.connectionFingerprint}::${signature.toolFingerprint}`;
      signatureGroups.set(key, [...(signatureGroups.get(key) ?? []), config]);
    }

    for (const configs of signatureGroups.values()) {
      if (configs.length < 2) {
        continue;
      }

      const canonical = chooseCanonicalConfig(configs);
      const aliases = configs
        .map((config) => config.name)
        .filter((name) => name !== canonical.name)
        .sort((left, right) => left.localeCompare(right));

      if (aliases.length === 0) {
        continue;
      }

      canonicalConfigs.set(canonical.name, withMergedAliases(canonical, configs));
      for (const alias of aliases) {
        droppedServerNames.add(alias);
      }

      dedupedAliases.push({
        canonicalName: canonical.name,
        aliases,
        normalizedAlias,
        toolCount: signatures.get(canonical.name)?.toolCount ?? 0,
      });
    }
  }

  const servers = loadedConfig.servers
    .filter((config) => !droppedServerNames.has(config.name))
    .map((config) => canonicalConfigs.get(config.name) ?? config)
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    loadedConfig: {
      ...loadedConfig,
      servers,
    },
    dedupedAliases: dedupedAliases.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName)),
  };
}

function chooseCanonicalConfig(configs: NormalizedServerConfig[]): NormalizedServerConfig {
  return [...configs].sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    const leftUnderscores = countCharacter(left.name, '_');
    const rightUnderscores = countCharacter(right.name, '_');
    if (leftUnderscores !== rightUnderscores) {
      return leftUnderscores - rightUnderscores;
    }
    if (left.name.length !== right.name.length) {
      return left.name.length - right.name.length;
    }
    return left.name.localeCompare(right.name);
  })[0];
}

function withMergedAliases(canonical: NormalizedServerConfig, configs: NormalizedServerConfig[]): NormalizedServerConfig {
  const aliases = new Set<string>();
  for (const config of configs) {
    for (const alias of extractConfigAliases(config)) {
      if (alias !== canonical.name) {
        aliases.add(alias);
      }
    }
    if (config.name !== canonical.name) {
      aliases.add(config.name);
    }
  }

  if (aliases.size === 0) {
    return canonical;
  }

  return {
    ...canonical,
    metadata: {
      ...(canonical.metadata ?? {}),
      aliases: [...aliases].sort((left, right) => left.localeCompare(right)),
    },
  };
}

function extractConfigAliases(config: NormalizedServerConfig): string[] {
  const aliases = new Set<string>();
  const metadataName = typeof config.metadata?.name === 'string' ? config.metadata.name : undefined;
  if (metadataName) {
    aliases.add(metadataName);
  }
  const metadataAliases = Array.isArray(config.metadata?.aliases)
    ? config.metadata.aliases.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  for (const alias of metadataAliases) {
    aliases.add(alias);
  }
  return [...aliases];
}

function buildConnectionFingerprint(config: NormalizedServerConfig, resolution?: ConnectionResolution): string {
  return stableSerialize({
    transport: resolution?.effectiveTransport ?? config.transport,
    url: resolution?.effectiveUrl ?? config.url,
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd,
    env: config.env ? Object.fromEntries(Object.entries(config.env).sort(([left], [right]) => left.localeCompare(right))) : undefined,
    headers: config.headers ? Object.fromEntries(Object.entries(config.headers).sort(([left], [right]) => left.localeCompare(right))) : undefined,
  });
}

function buildToolFingerprint(tools: Tool[]): string {
  const normalizedTools = tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: tool.inputSchema,
      outputSchema: 'outputSchema' in tool ? tool.outputSchema : undefined,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return stableSerialize(normalizedTools);
}

function normalizeAliasToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function countCharacter(value: string, target: string): number {
  return [...value].filter((character) => character === target).length;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(',')}}`;
}
