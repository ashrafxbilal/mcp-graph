import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { doctorMcpKingdom } from '../src/doctor.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((dirPath) => fs.rm(dirPath, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function createFixtureRoot(): Promise<{ rootDir: string; homeDir: string; projectDir: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-kingdom-doctor-'));
  const homeDir = path.join(rootDir, 'home');
  const projectDir = path.join(rootDir, 'project');
  tempRoots.push(rootDir);
  await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true });
  await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  return { rootDir, homeDir, projectDir };
}

describe('doctorMcpKingdom', () => {
  it('reports what setup would change without mutating files', async () => {
    const { homeDir, projectDir } = await createFixtureRoot();

    await fs.writeFile(
      path.join(projectDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'project-backend': {
            command: 'project-backend',
            args: ['serve'],
          },
        },
      }, null, 2),
      'utf8',
    );

    await fs.writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Read'] },
        mcpServers: {
          'old-claude': {
            command: 'old-claude',
          },
        },
      }, null, 2),
      'utf8',
    );

    await fs.writeFile(
      path.join(homeDir, '.codex', 'config.toml'),
      ['[mcp_servers.old-codex]', 'command = "old-codex"', ''].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(homeDir, '.opencode.json'),
      JSON.stringify({
        mcp: {
          'old-opencode': {
            type: 'local',
            command: ['old-opencode', 'serve'],
            enabled: true,
          },
        },
      }, null, 2),
      'utf8',
    );

    const report = await doctorMcpKingdom({
      cwd: projectDir,
      homeDir,
      backendPath: path.join(homeDir, '.mcp-kingdom', 'backends.json'),
      policyPath: path.join(homeDir, '.mcp-kingdom', 'policy.json'),
      auditLogPath: path.join(homeDir, '.mcp-kingdom', 'audit.log'),
      targets: ['claude', 'codex', 'opencode'],
    });

    expect(report.targets).toEqual(['claude', 'codex', 'opencode']);
    expect(report.discoveredServers).toEqual(['old-claude', 'old-codex', 'old-opencode', 'project-backend']);
    expect(report.backendServerCount).toBe(4);
    expect(report.policySummary.totalServers).toBe(4);
    expect(report.filePlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: path.join(homeDir, '.mcp-kingdom', 'backends.json'),
        action: 'create',
      }),
      expect.objectContaining({
        path: path.join(homeDir, '.claude', 'settings.json'),
        action: 'update',
      }),
      expect.objectContaining({
        path: path.join(homeDir, '.claude.json'),
        action: 'create',
      }),
    ]));

    await expect(fs.access(path.join(homeDir, '.mcp-kingdom', 'backends.json'))).rejects.toThrow();
  });
});
