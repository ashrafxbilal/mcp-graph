import { afterEach, describe, expect, it } from 'vitest';
import { deduplicateVerifiedServerAliases } from '../src/alias-dedupe.js';
import { GraphRegistry } from '../src/clients.js';
import { loadMergedServerConfigs } from '../src/config.js';
import { AuditLogger } from '../src/logger.js';
import {
  createBackendConfig,
  createMockServerDefinition,
  createVariantMockServerDefinition,
} from './helpers/mock-backend.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

describe('deduplicateVerifiedServerAliases', () => {
  it('collapses verified alias duplicates and preserves dropped names as aliases', async () => {
    const fixture = await createBackendConfig({
      'Friday AWS MCP': createMockServerDefinition(),
      'Friday_AWS_MCP': createMockServerDefinition(),
      'coralogix-pos': createMockServerDefinition(),
      'coralogix-server': createMockServerDefinition(),
    });
    cleanups.push(fixture.cleanup);

    const loaded = await loadMergedServerConfigs({
      explicitConfigPaths: [fixture.backendConfigPath],
    });
    const deduped = await deduplicateVerifiedServerAliases(loaded);

    expect(deduped.loadedConfig.servers.map((server) => server.name)).toEqual([
      'coralogix-pos',
      'coralogix-server',
      'Friday AWS MCP',
    ]);
    expect(deduped.dedupedAliases).toEqual([
      {
        canonicalName: 'Friday AWS MCP',
        aliases: ['Friday_AWS_MCP'],
        normalizedAlias: 'fridayawsmcp',
        toolCount: 2,
      },
    ]);

    const friday = deduped.loadedConfig.servers.find((server) => server.name === 'Friday AWS MCP');
    expect(friday?.metadata?.aliases).toEqual(['Friday_AWS_MCP']);

    const registry = new GraphRegistry(deduped.loadedConfig, new AuditLogger());
    try {
      const aliasResolved = await registry.getTool('Friday_AWS_MCP', 'echo');
      expect(aliasResolved.server.name).toBe('Friday AWS MCP');
    } finally {
      await registry.close();
    }
  });

  it('does not dedupe same alias family when the verified tool surface differs', async () => {
    const fixture = await createBackendConfig({
      'Alpha MCP': createMockServerDefinition(),
      'Alpha_MCP': createVariantMockServerDefinition(),
    });
    cleanups.push(fixture.cleanup);

    const loaded = await loadMergedServerConfigs({
      explicitConfigPaths: [fixture.backendConfigPath],
    });
    const deduped = await deduplicateVerifiedServerAliases(loaded);

    expect(deduped.loadedConfig.servers.map((server) => server.name)).toEqual([
      'Alpha MCP',
      'Alpha_MCP',
    ]);
    expect(deduped.dedupedAliases).toEqual([]);
  });
});
