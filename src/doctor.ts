import {
  DEFAULT_AUDIT_LOG_PATH,
  DEFAULT_BACKEND_SNAPSHOT,
  DEFAULT_CACHE_DIR,
  DEFAULT_POLICY_PATH,
  DEFAULT_VERIFY_TIMEOUT_MS,
  LEGACY_AUTH_DIR,
  LEGACY_CACHE_DIR,
  DEFAULT_AUTH_DIR,
} from './constants.js';
import { loadMergedServerConfigs } from './config.js';
import { detectInstallTargets, installMcpKingdom, type InstallOptions, type InstallTarget } from './install.js';
import type { AliasDeduplicationRecord, DuplicateServerRecord, GraphPolicySummary } from './types.js';
import { fileExists } from './utils.js';

export interface DoctorFilePlan {
  path: string;
  action: 'create' | 'update';
  backupPath?: string;
}

export interface DoctorLegacyMigration {
  from: string;
  to: string;
}

export interface DoctorReport {
  cwd: string;
  homeDir: string;
  backendPath: string;
  auditLogPath: string;
  policyPath: string;
  verifyTimeoutMs: number;
  targets: InstallTarget[];
  excludedServers: string[];
  loadedFiles: string[];
  discoveredServerCount: number;
  discoveredServers: string[];
  duplicateCount: number;
  duplicates: Array<{
    name: string;
    keptFrom: string;
    discardedFrom: string;
  }>;
  backendServerCount: number;
  policySummary: GraphPolicySummary;
  dedupedAliases: AliasDeduplicationRecord[];
  filePlan: DoctorFilePlan[];
  legacyMigrations: DoctorLegacyMigration[];
  notes: string[];
}

export async function doctorMcpKingdom(options: InstallOptions = {}): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? cwd;
  const backendPath = options.backendPath ?? DEFAULT_BACKEND_SNAPSHOT;
  const auditLogPath = options.auditLogPath ?? DEFAULT_AUDIT_LOG_PATH;
  const policyPath = options.policyPath ?? DEFAULT_POLICY_PATH;
  const verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const targets = options.targets ?? await detectInstallTargets(homeDir);
  const excludedServers = [...new Set(options.excludeServers ?? getExcludedServersFromEnv())].sort((left, right) => left.localeCompare(right));
  const discovered = await loadMergedServerConfigs({
    cwd,
    homeDir,
    excludeServers: excludedServers,
  });
  const installPreview = await installMcpKingdom({
    ...options,
    cwd,
    homeDir,
    backendPath,
    auditLogPath,
    policyPath,
    verifyTimeoutMs,
    targets,
    dryRun: true,
  });

  const filePlan = await Promise.all(
    installPreview.changedFiles.map(async (filePath) => ({
      path: filePath,
      action: await fileExists(filePath) ? 'update' as const : 'create' as const,
      backupPath: installPreview.backups.find((backup) => backup.startsWith(`${filePath}.bak-`)),
    })),
  );

  const duplicates = discovered.duplicates.map((entry) => mapDuplicate(entry));
  const legacyMigrations = getLegacyMigrations(installPreview.changedFiles, installPreview.backups);
  const notes = buildDoctorNotes({
    targets,
    discoveredServerCount: discovered.servers.length,
    backendServerCount: installPreview.backendServerCount,
    legacyMigrations,
  });

  return {
    cwd,
    homeDir,
    backendPath,
    auditLogPath,
    policyPath,
    verifyTimeoutMs,
    targets,
    excludedServers,
    loadedFiles: discovered.loadedFiles,
    discoveredServerCount: discovered.servers.length,
    discoveredServers: discovered.servers.map((server) => server.name),
    duplicateCount: duplicates.length,
    duplicates,
    backendServerCount: installPreview.backendServerCount,
    policySummary: installPreview.policySummary,
    dedupedAliases: installPreview.dedupedAliases,
    filePlan: filePlan.sort((left, right) => left.path.localeCompare(right.path)),
    legacyMigrations,
    notes,
  };
}

function getExcludedServersFromEnv(): string[] {
  const value = process.env.MCP_KINGDOM_EXCLUDE_SERVERS ?? process.env.MCP_GRAPH_EXCLUDE_SERVERS;
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mapDuplicate(entry: DuplicateServerRecord): { name: string; keptFrom: string; discardedFrom: string } {
  return {
    name: entry.name,
    keptFrom: entry.kept.sourceFile,
    discardedFrom: entry.discarded.sourceFile,
  };
}

function getLegacyMigrations(changedFiles: string[], backups: string[]): DoctorLegacyMigration[] {
  const migrations: DoctorLegacyMigration[] = [];
  if (changedFiles.includes(DEFAULT_AUTH_DIR) && backups.includes(LEGACY_AUTH_DIR)) {
    migrations.push({ from: LEGACY_AUTH_DIR, to: DEFAULT_AUTH_DIR });
  }
  if (changedFiles.includes(DEFAULT_CACHE_DIR) && backups.includes(LEGACY_CACHE_DIR)) {
    migrations.push({ from: LEGACY_CACHE_DIR, to: DEFAULT_CACHE_DIR });
  }
  return migrations;
}

function buildDoctorNotes({
  targets,
  discoveredServerCount,
  backendServerCount,
  legacyMigrations,
}: {
  targets: InstallTarget[];
  discoveredServerCount: number;
  backendServerCount: number;
  legacyMigrations: DoctorLegacyMigration[];
}): string[] {
  const notes: string[] = [];

  if (targets.length === 0) {
    notes.push('No supported client configs were auto-detected. Pass --targets claude,codex,opencode if you want to create configs explicitly.');
  }
  if (discoveredServerCount === 0 && backendServerCount > 0) {
    notes.push('No direct backend MCPs were discovered from the active configs. Existing snapshot backends will still be preserved behind mcp-kingdom.');
  }
  if (legacyMigrations.length > 0) {
    notes.push('Legacy ~/.mcp-graph state will be carried forward into ~/.mcp-kingdom.');
  }

  return notes;
}
