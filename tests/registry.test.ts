import { afterEach, describe, expect, it } from 'vitest';
import { GraphRegistry } from '../src/clients.js';
import { loadMergedServerConfigs } from '../src/config.js';
import { AuditLogger } from '../src/logger.js';
import { createMockBackendConfig } from './helpers/mock-backend.js';

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
      expect(inventory).toHaveLength(1);
      expect(inventory[0]?.toolCount).toBe(2);

      const search = await registry.searchTools({ query: 'catalog', detail: 'summary' });
      expect(search.map((match) => match.tool.name)).toEqual(['catalog']);

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
});
