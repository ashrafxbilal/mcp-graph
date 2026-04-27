import { afterEach, describe, expect, it } from 'vitest';
import { GraphRegistry } from '../src/clients.js';
import { loadMergedServerConfigs } from '../src/config.js';
import { AuditLogger } from '../src/logger.js';
import { createBackendConfig, createFailingServerDefinition, createMockBackendConfig, createMockServerDefinition } from './helpers/mock-backend.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

describe('GraphRegistry', () => {
  it('searches tools, proxies calls, and reports inventory counts', async () => {
    const fixture = await createMockBackendConfig();
    cleanups.push(fixture.cleanup);

    const loaded = await loadMergedServerConfigs({
      explicitConfigPaths: [fixture.backendConfigPath],
    });
    const registry = new GraphRegistry(loaded, new AuditLogger());

    try {
      const inventory = await registry.getServerInventory({ includeToolCounts: true });
      expect(inventory.entries).toHaveLength(1);
      expect(inventory.entries[0]?.toolCount).toBe(2);
      expect(inventory.errors).toHaveLength(0);

      const search = await registry.searchTools({ query: 'catalog', detail: 'summary' });
      expect(search.matches.map((match) => match.tool.name)).toEqual(['catalog']);
      expect(search.errors).toHaveLength(0);

      const shaped = await registry.callTool({
        server: 'mock-backend',
        tool: 'catalog',
        arguments: { size: 3 },
        outputMode: 'structured',
        fieldPath: 'items',
        maxArrayItems: 1,
      });
      expect(shaped.outputMode).toBe('structured');
      expect(shaped.text).toContain('item-1');
      expect(shaped.text).not.toContain('item-2');
      expect(Array.isArray(shaped.selectedValue)).toBe(true);

      const batch = await registry.batchCallTools({
        mode: 'parallel',
        outputMode: 'content',
        steps: [
          { server: 'mock-backend', tool: 'echo', arguments: { message: 'one' } },
          { server: 'mock-backend', tool: 'catalog', arguments: { size: 2 } },
        ],
      });
      expect(batch).toHaveLength(2);
      expect(batch.every((entry) => entry.ok)).toBe(true);

      const invalidated = await registry.invalidateToolCache('mock-backend');
      expect(invalidated.invalidatedServers).toEqual(['mock-backend']);
    } finally {
      await registry.close();
    }
  });

  it('returns partial results when one backend fails and resolves server aliases', async () => {
    const fixture = await createBackendConfig({
      'remote-friday-mcp-server': createMockServerDefinition({ name: 'FridayMCP' }),
      broken: createFailingServerDefinition(),
      'Friday AWS MCP': createMockServerDefinition(),
    });
    cleanups.push(fixture.cleanup);

    const loaded = await loadMergedServerConfigs({
      explicitConfigPaths: [fixture.backendConfigPath],
    });
    const registry = new GraphRegistry(loaded, new AuditLogger());

    try {
      const inventory = await registry.getServerInventory({ includeToolCounts: true });
      expect(inventory.entries).toHaveLength(3);
      expect(inventory.errors).toHaveLength(1);
      expect(inventory.errors[0]?.server).toBe('broken');

      const search = await registry.searchTools({ query: 'echo', detail: 'summary' });
      expect(search.matches.some((match) => match.tool.name === 'echo')).toBe(true);
      expect(search.errors).toHaveLength(1);
      expect(search.errors[0]?.server).toBe('broken');

      const aliasResolved = await registry.getTool('friday-mcp', 'echo');
      expect(aliasResolved.server.name).toBe('remote-friday-mcp-server');

      await expect(registry.getTool('friday', 'echo')).rejects.toThrow(/Ambiguous server friday/i);
      await expect(registry.getTool('remote-friday-mcp-server', 'execute')).rejects.toThrow(/Available tools: catalog, echo/i);
    } finally {
      await registry.close();
    }
  });
});
