#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_BACKEND_SNAPSHOT, GRAPH_TOOL_NAMES } from './constants.js';
import { loadMergedServerConfigs, snapshotMergedConfig } from './config.js';
import { GraphRegistry } from './clients.js';
import { installMcpGraph, type InstallTarget } from './install.js';
import { AuditLogger } from './logger.js';
import { ensureDir, safeJsonStringify } from './utils.js';
import { runGraphServer } from './server.js';

async function main(): Promise<void> {
  const [command = 'serve', ...args] = process.argv.slice(2);

  switch (command) {
    case 'serve':
      await runGraphServer();
      return;
    case 'snapshot':
      await handleSnapshot(args);
      return;
    case 'inspect':
      await handleInspect(args);
      return;
    case 'install':
      await handleInstall(args);
      return;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function handleSnapshot(args: string[]): Promise<void> {
  const output = readFlag(args, '--output') ?? DEFAULT_BACKEND_SNAPSHOT;
  const config = await snapshotMergedConfig();
  await ensureDir(path.dirname(output));
  await fs.writeFile(output, `${safeJsonStringify(config, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote backend snapshot to ${output}\n`);
}

async function handleInspect(args: string[]): Promise<void> {
  const config = await loadMergedServerConfigs();
  const includeToolCounts = hasFlag(args, '--tool-counts');
  const refresh = hasFlag(args, '--refresh');
  const registry = includeToolCounts ? new GraphRegistry(config, new AuditLogger()) : undefined;
  const inventory = includeToolCounts
    ? await registry?.getServerInventory({ includeToolCounts: true, refresh })
    : undefined;
  const payload = {
    loadedFiles: config.loadedFiles,
    serverCount: config.servers.length,
    servers: config.servers.map((entry) => ({
      name: entry.name,
      transport: entry.transport,
      sourceKind: entry.sourceKind,
      sourceFile: entry.sourceFile,
      ...(includeToolCounts ? {
        toolCount: inventory?.entries.find((item) => item.server.name === entry.name)?.toolCount ?? 0,
        error: inventory?.entries.find((item) => item.server.name === entry.name)?.error,
      } : {}),
    })),
    duplicates: config.duplicates.map((entry) => ({
      name: entry.name,
      keptFrom: entry.kept.sourceFile,
      discardedFrom: entry.discarded.sourceFile,
    })),
    ...(includeToolCounts ? {
      totalBackendTools: inventory?.entries.reduce((sum, item) => sum + (item.toolCount ?? 0), 0) ?? 0,
      frontDoorToolCount: GRAPH_TOOL_NAMES.length,
      errors: inventory?.errors ?? [],
    } : {}),
  };
  process.stdout.write(`${safeJsonStringify(payload, 2)}\n`);
  await registry?.close();
}

async function handleInstall(args: string[]): Promise<void> {
  const backendPath = readFlag(args, '--backend');
  const auditLogPath = readFlag(args, '--audit-log');
  const dryRun = hasFlag(args, '--dry-run');
  const targets = parseTargets(readFlag(args, '--targets'));
  const result = await installMcpGraph({
    backendPath,
    auditLogPath,
    dryRun,
    targets,
  });

  process.stdout.write(`${safeJsonStringify(result, 2)}\n`);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseTargets(value?: string): InstallTarget[] | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is InstallTarget => entry === 'claude' || entry === 'codex' || entry === 'opencode');
}

function printHelp(): void {
  process.stdout.write(`mcp-graph\n\nCommands:\n  serve               Run the MCP server over stdio (default)\n  snapshot            Merge discovered MCP configs and write a backend snapshot file\n  inspect             Print the merged server inventory and duplicate resolution\n  install             Snapshot backend MCPs and rewire Claude/Codex/OpenCode to use only mcp-graph\n\nExamples:\n  node dist/cli.js snapshot --output ~/.mcp-graph/backends.json\n  node dist/cli.js inspect --tool-counts\n  node dist/cli.js install\n  node dist/cli.js install --targets claude,codex,opencode\n  MCP_GRAPH_CONFIG_PATH=~/.mcp-graph/backends.json node dist/cli.js\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
