import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMergedServerConfigs } from '../src/config.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((dirPath) => fs.rm(dirPath, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function createFixtureRoot(): Promise<{ rootDir: string; homeDir: string; projectDir: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-kingdom-config-'));
  const homeDir = path.join(rootDir, 'home');
  const projectDir = path.join(rootDir, 'project');
  tempRoots.push(rootDir);
  await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true });
  await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
  await fs.mkdir(path.join(homeDir, '.config', 'opencode'), { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  return { rootDir, homeDir, projectDir };
}

describe('loadMergedServerConfigs', () => {
  it('merges supported config formats and skips disabled OpenCode entries', async () => {
    const { homeDir, projectDir } = await createFixtureRoot();

    await fs.writeFile(
      path.join(projectDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          shared: { command: 'project-backend', args: ['run'] },
          'project-backend': { command: 'project-backend', args: ['run'] },
        },
      }, null, 2),
      'utf8',
    );

    await fs.writeFile(
      path.join(projectDir, 'opencode.json'),
      JSON.stringify({
        mcp: {
          'project-opencode': {
            type: 'local',
            command: ['project-opencode', 'serve'],
            enabled: true,
          },
          'disabled-opencode': {
            type: 'remote',
            url: 'https://example.com/sse',
            enabled: false,
          },
        },
      }, null, 2),
      'utf8',
    );

    await fs.writeFile(
      path.join(homeDir, '.claude', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          shared: { command: 'claude-backend', args: ['serve'] },
          'claude-only': { command: 'claude-only', args: ['serve'] },
        },
      }, null, 2),
      'utf8',
    );

    await fs.writeFile(
      path.join(homeDir, '.codex', 'config.toml'),
      [
        '[mcp_servers.codex-backend]',
        'command = "codex-backend"',
        'args = ["serve"]',
        '',
      ].join('\n'),
      'utf8',
    );

    const loaded = await loadMergedServerConfigs({
      cwd: projectDir,
      homeDir,
      includeCodex: true,
    });

    expect(loaded.servers.map((server) => server.name)).toEqual([
      'claude-only',
      'codex-backend',
      'project-backend',
      'project-opencode',
      'shared',
    ]);
    expect(loaded.servers.find((server) => server.name === 'shared')?.command).toBe('project-backend');
    expect(loaded.servers.find((server) => server.name === 'project-opencode')?.transport).toBe('stdio');
    expect(loaded.servers.find((server) => server.name === 'disabled-opencode')).toBeUndefined();
    expect(loaded.duplicates).toHaveLength(1);
    expect(loaded.duplicates[0]?.kept.sourceKind).toBe('project-mcp');
  });

  it('uses explicit config paths instead of default discovery when provided', async () => {
    const { homeDir, projectDir } = await createFixtureRoot();
    const explicitPath = path.join(projectDir, 'explicit.json');

    await fs.writeFile(
      explicitPath,
      JSON.stringify({
        mcpServers: {
          explicit: {
            command: 'explicit-backend',
            args: ['serve'],
          },
        },
      }, null, 2),
      'utf8',
    );

    await fs.writeFile(
      path.join(projectDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          ignored: {
            command: 'ignored-backend',
          },
        },
      }, null, 2),
      'utf8',
    );

    const loaded = await loadMergedServerConfigs({
      cwd: projectDir,
      homeDir,
      explicitConfigPaths: [explicitPath],
      includeCodex: true,
    });

    expect(loaded.loadedFiles).toEqual([explicitPath]);
    expect(loaded.servers.map((server) => server.name)).toEqual(['explicit']);
  });
});
