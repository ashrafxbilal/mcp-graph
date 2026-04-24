import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function createMockBackendConfig(serverName = 'mock-backend'): Promise<{
  backendConfigPath: string;
  cleanup: () => Promise<void>;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-graph-test-'));
  const backendConfigPath = path.join(rootDir, 'backends.json');
  const command = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  const mockBackendPath = path.join(repoRoot, 'src', 'mock-backend.ts');

  await fs.writeFile(
    backendConfigPath,
    JSON.stringify({
      mcpServers: {
        [serverName]: {
          command,
          args: [mockBackendPath],
          cwd: repoRoot,
        },
      },
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

export function getRepoRoot(): string {
  return repoRoot;
}
