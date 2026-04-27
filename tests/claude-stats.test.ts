import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildClaudeStatsReport } from '../src/claude-stats.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((dirPath) => fs.rm(dirPath, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe('buildClaudeStatsReport', () => {
  it('summarizes a target day and compares it to previous days', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-kingdom-claude-stats-'));
    tempRoots.push(rootDir);
    await fs.mkdir(path.join(rootDir, 'project-a', 'subagents'), { recursive: true });

    await fs.writeFile(
      path.join(rootDir, 'project-a', 'session.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-04-27T01:00:00Z',
          sessionId: 'session-a',
          message: {
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              cache_read_input_tokens: 30,
              cache_creation_input_tokens: 40,
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-27T09:00:00Z',
          sessionId: 'session-a',
          message: {
            usage: {
              input_tokens: 5,
              output_tokens: 15,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 10,
            },
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-27T09:30:00Z',
          sessionId: 'ignored',
          message: {
            role: 'assistant',
          },
        }),
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(rootDir, 'project-a', 'subagents', 'agent.jsonl'),
      JSON.stringify({
        timestamp: '2026-04-26T10:00:00Z',
        sessionId: 'agent-1',
        message: {
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
          },
        },
      }),
      'utf8',
    );

    const report = await buildClaudeStatsReport({
      rootDir,
      targetDate: '2026-04-27',
      compareDays: 2,
      timezone: 'UTC',
    });

    expect(report.logFileCount).toBe(2);
    expect(report.targetDay).toMatchObject({
      date: '2026-04-27',
      messages: 2,
      sessions: 1,
      input: 15,
      output: 35,
      cacheRead: 30,
      cacheWrite: 50,
      fresh: 50,
      total: 130,
    });
    expect(report.previousWindow).toMatchObject({
      startDate: '2026-04-25',
      endDate: '2026-04-26',
      days: 2,
      totals: {
        messages: 1,
        sessions: 1,
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        fresh: 3,
        total: 10,
      },
      dailyAverage: {
        messages: 0.5,
        sessions: 0.5,
        input: 0.5,
        output: 1,
        cacheRead: 1.5,
        cacheWrite: 2,
        fresh: 1.5,
        total: 5,
      },
    });
    expect(report.comparison?.fresh).toEqual({
      target: 50,
      previousDailyAverage: 1.5,
      delta: 48.5,
      ratio: 50 / 1.5,
    });
    expect(report.comparison?.total).toEqual({
      target: 130,
      previousDailyAverage: 5,
      delta: 125,
      ratio: 26,
    });
    expect(report.dailyBreakdown.map((entry) => entry.date)).toEqual([
      '2026-04-25',
      '2026-04-26',
      '2026-04-27',
    ]);
  });
});
