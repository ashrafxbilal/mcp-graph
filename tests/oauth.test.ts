import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOAuthProvider } from '../src/oauth.js';
import type { NormalizedServerConfig } from '../src/types.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((dirPath) => fs.rm(dirPath, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe('createOAuthProvider', () => {
  it('does not trigger automatic OAuth bootstrap when no saved tokens exist', async () => {
    const authDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-kingdom-oauth-'));
    tempRoots.push(authDir);

    const config: NormalizedServerConfig = {
      name: 'slack',
      sourceFile: '/tmp/slack.json',
      sourceKind: 'explicit',
      priority: 100,
      transport: 'streamable-http',
      url: 'https://mcp.slack.com/mcp',
    };

    expect(createOAuthProvider(config, { authDir, requireTokens: true })).toBeUndefined();

    await fs.writeFile(
      path.join(authDir, 'slack.json'),
      JSON.stringify({
        tokens: {
          access_token: 'token',
          token_type: 'Bearer',
        },
      }),
      'utf8',
    );

    expect(createOAuthProvider(config, { authDir, requireTokens: true })).toBeDefined();
  });
});
