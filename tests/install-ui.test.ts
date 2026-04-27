import { describe, expect, it } from 'vitest';
import { renderInstallPreview, renderInstallSummary } from '../src/install-ui.js';

describe('install UI', () => {
  it('renders an interactive preview with shortcut information', () => {
    const text = renderInstallPreview({
      cwd: '/tmp/project',
      homeDir: '/tmp/home',
      backendPath: '/tmp/home/.mcp-kingdom/backends.json',
      auditLogPath: '/tmp/home/.mcp-kingdom/audit.log',
      policyPath: '/tmp/home/.mcp-kingdom/policy.json',
      verifyTimeoutMs: 2000,
      targets: ['claude', 'opencode'],
      excludedServers: [],
      loadedFiles: ['/tmp/home/.claude/settings.json'],
      discoveredServerCount: 2,
      discoveredServers: ['foo', 'bar'],
      duplicateCount: 0,
      duplicates: [],
      backendServerCount: 2,
      policySummary: {
        totalServers: 2,
        allowListedServers: 2,
        passthroughServers: 0,
        failedServers: 0,
        discoveredTools: 12,
        probeOkCount: 1,
        probeFailedCount: 0,
        probeSkippedCount: 1,
      },
      dedupedAliases: [],
      shortcutBinDir: '/tmp/home/.local/bin',
      shortcutCommands: ['claude-stats', 'opencode-stats'],
      filePlan: [
        { path: '/tmp/home/.claude/settings.json', action: 'update' },
        { path: '/tmp/home/.local/bin/claude-stats', action: 'create' },
      ],
      legacyMigrations: [],
      notes: ['Helper shortcuts will be written to /tmp/home/.local/bin.'],
    });

    expect(text).toContain('Progressive-disclosure install preview');
    expect(text).toContain('Helper commands: claude-stats, opencode-stats');
    expect(text).toContain('/tmp/home/.local/bin/claude-stats');
  });

  it('renders a post-install summary with next steps', () => {
    const text = renderInstallSummary({
      backendPath: '/tmp/home/.mcp-kingdom/backends.json',
      auditLogPath: '/tmp/home/.mcp-kingdom/audit.log',
      policyPath: '/tmp/home/.mcp-kingdom/policy.json',
      backendServerCount: 3,
      targets: ['claude'],
      changedFiles: ['/tmp/home/.claude/settings.json'],
      backups: ['/tmp/home/.claude/settings.json.bak-1'],
      policySummary: {
        totalServers: 3,
        allowListedServers: 2,
        passthroughServers: 1,
        failedServers: 1,
        discoveredTools: 9,
        probeOkCount: 0,
        probeFailedCount: 1,
        probeSkippedCount: 2,
      },
      dedupedAliases: [],
      shortcutBinDir: '/tmp/home/.local/bin',
      shortcutCommands: ['claude-stats'],
      notes: ['Add /tmp/home/.local/bin to PATH.'],
    });

    expect(text).toContain('Installation complete.');
    expect(text).toContain('Helper commands installed: claude-stats');
    expect(text).toContain('restart Claude/Codex/OpenCode');
  });
});
