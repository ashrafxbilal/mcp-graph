import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface TestServerConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  type?: string;
  name?: string;
  headers?: Record<string, string>;
}

export async function createMockBackendConfig(serverName = 'mock-backend'): Promise<{
  backendConfigPath: string;
  cleanup: () => Promise<void>;
}> {
  return createBackendConfig({
    [serverName]: createMockServerDefinition(),
  });
}

export async function createBackendConfig(mcpServers: Record<string, TestServerConfig>): Promise<{
  backendConfigPath: string;
  cleanup: () => Promise<void>;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-graph-test-'));
  const backendConfigPath = path.join(rootDir, 'backends.json');

  await fs.writeFile(
    backendConfigPath,
    JSON.stringify({
      mcpServers,
    }, null, 2),
    'utf8',
  );

  return {
    backendConfigPath,
    cleanup: async () => {
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

export function createMockServerDefinition(overrides: TestServerConfig = {}): TestServerConfig {
  const command = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  const mockBackendPath = path.join(repoRoot, 'src', 'mock-backend.ts');

  return {
    command,
    args: [mockBackendPath],
    cwd: repoRoot,
    ...overrides,
  };
}

export function createFailingServerDefinition(): TestServerConfig {
  return {
    command: process.execPath,
    args: ['-e', 'process.exit(1)'],
    cwd: repoRoot,
  };
}

export function getRepoRoot(): string {
  return repoRoot;
}
