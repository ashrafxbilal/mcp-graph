import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { buildOpenCodeStatsReport } from '../src/opencode-stats.js';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((dirPath) => fs.rm(dirPath, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe('buildOpenCodeStatsReport', () => {
  it('summarizes a target day and supports project filtering', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-kingdom-opencode-stats-'));
    const dbPath = path.join(rootDir, 'opencode.db');
    tempRoots.push(rootDir);

    const projectA = path.join(rootDir, 'repo-a');
    const projectB = path.join(rootDir, 'repo-b');
    await fs.mkdir(projectA, { recursive: true });
    await fs.mkdir(projectB, { recursive: true });

    const sql = [
      'create table session (id text primary key, directory text not null);',
      'create table message (id text primary key, session_id text not null, time_created integer not null, data text not null);',
      `insert into session (id, directory) values ('session-a', ${sqlString(projectA)}), ('session-b', ${sqlString(projectA)}), ('session-c', ${sqlString(projectB)});`,
      `insert into message (id, session_id, time_created, data) values`,
      `  ('msg-1', 'session-a', 1777242000000, ${sqlString(JSON.stringify({ role: 'assistant', cost: 0.25, tokens: { input: 10, output: 20, total: 130, cache: { read: 30, write: 70 } } }))}),`,
      `  ('msg-2', 'session-a', 1777267200000, ${sqlString(JSON.stringify({ role: 'assistant', cost: 0.1, tokens: { input: 5, output: 15, total: 30, cache: { read: 0, write: 10 } } }))}),`,
      `  ('msg-3', 'session-b', 1777269000000, ${sqlString(JSON.stringify({ role: 'assistant', cost: 0.05, tokens: { input: 7, output: 8, total: 20, cache: { read: 3, write: 2 } } }))}),`,
      `  ('msg-4', 'session-c', 1777269000000, ${sqlString(JSON.stringify({ role: 'assistant', cost: 0.4, tokens: { input: 100, output: 200, total: 400, cache: { read: 50, write: 50 } } }))}),`,
      `  ('msg-5', 'session-a', 1777269300000, ${sqlString(JSON.stringify({ role: 'user', tokens: { input: 1, output: 1, total: 2, cache: { read: 0, write: 0 } } }))});`,
    ].join('\n');

    await execFileAsync('sqlite3', [dbPath, sql]);

    const report = await buildOpenCodeStatsReport({
      dbPath,
      project: projectA,
      targetDate: '2026-04-27',
      compareDays: 2,
      timezone: 'UTC',
    });

    expect(report.project).toBe(projectA);
    expect(report.targetDay).toMatchObject({
      date: '2026-04-27',
      messages: 2,
      sessions: 2,
      input: 12,
      output: 23,
      cacheRead: 3,
      cacheWrite: 12,
      fresh: 35,
      total: 50,
    });
    expect(report.targetDay.cost).toBeCloseTo(0.15, 8);
    expect(report.previousWindow).toMatchObject({
      startDate: '2026-04-25',
      endDate: '2026-04-26',
      days: 2,
      totals: {
        messages: 1,
        sessions: 1,
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheWrite: 70,
        fresh: 30,
        total: 130,
        cost: 0.25,
      },
    });
    expect(report.comparison?.cost?.target).toBeCloseTo(0.15, 8);
    expect(report.comparison?.cost?.previousDailyAverage).toBeCloseTo(0.125, 8);
    expect(report.comparison?.cost?.delta).toBeCloseTo(0.025, 8);
    expect(report.comparison?.cost?.ratio).toBeCloseTo(1.2, 8);
    expect(report.dailyBreakdown.map((entry) => entry.date)).toEqual([
      '2026-04-25',
      '2026-04-26',
      '2026-04-27',
    ]);
  });
});

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
