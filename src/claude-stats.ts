import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileExists } from './utils.js';

export interface ClaudeUsageTotals {
  messages: number;
  sessions: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  fresh: number;
  total: number;
}

export interface ClaudeDailyUsage extends ClaudeUsageTotals {
  date: string;
}

export interface ClaudeWindowUsage {
  startDate: string;
  endDate: string;
  days: number;
  totals: ClaudeUsageTotals;
  dailyAverage: ClaudeUsageTotals;
}

export interface ClaudeStatsComparisonField {
  target: number;
  previousDailyAverage: number;
  delta: number;
  ratio: number | null;
}

export interface ClaudeStatsReport {
  rootDir: string;
  timezone: string;
  targetDate: string;
  compareDays: number;
  logFileCount: number;
  targetDay: ClaudeDailyUsage;
  previousWindow?: ClaudeWindowUsage;
  comparison?: {
    fresh: ClaudeStatsComparisonField;
    total: ClaudeStatsComparisonField;
  };
  dailyBreakdown: ClaudeDailyUsage[];
}

interface MutableUsageBucket {
  sessionIds: Set<string>;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface ClaudeStatsOptions {
  rootDir?: string;
  targetDate?: string;
  compareDays?: number;
  timezone?: string;
  now?: Date;
}

export async function buildClaudeStatsReport(options: ClaudeStatsOptions = {}): Promise<ClaudeStatsReport> {
  const rootDir = options.rootDir ?? path.join(os.homedir(), '.claude', 'projects');
  const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const now = options.now ?? new Date();
  const targetDate = resolveTargetDate(options.targetDate, timezone, now);
  const compareDays = Math.max(0, options.compareDays ?? 7);
  const buckets = new Map<string, MutableUsageBucket>();

  const jsonlFiles = await listJsonlFiles(rootDir);
  for (const filePath of jsonlFiles) {
    await ingestClaudeLogFile(filePath, buckets, timezone, rootDir);
  }

  const compareDates = buildPreviousDateRange(targetDate, compareDays);
  const dailyBreakdown = [...compareDates, targetDate]
    .map((date) => toDailyUsage(date, buckets.get(date)))
    .sort((left, right) => left.date.localeCompare(right.date));

  const targetDay = toDailyUsage(targetDate, buckets.get(targetDate));
  const previousWindow = compareDays > 0
    ? buildWindowUsage(compareDates, buckets)
    : undefined;

  return {
    rootDir,
    timezone,
    targetDate,
    compareDays,
    logFileCount: jsonlFiles.length,
    targetDay,
    previousWindow,
    comparison: previousWindow ? {
      fresh: buildComparisonField(targetDay.fresh, previousWindow.dailyAverage.fresh),
      total: buildComparisonField(targetDay.total, previousWindow.dailyAverage.total),
    } : undefined,
    dailyBreakdown,
  };
}

async function listJsonlFiles(rootDir: string): Promise<string[]> {
  if (!(await fileExists(rootDir))) {
    return [];
  }

  const files: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function ingestClaudeLogFile(
  filePath: string,
  buckets: Map<string, MutableUsageBucket>,
  timezone: string,
  rootDir: string,
): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split('\n');

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const message = record.message;
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      continue;
    }

    const usage = (message as Record<string, unknown>).usage;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
      continue;
    }

    const timestamp = typeof record.timestamp === 'string'
      ? record.timestamp
      : typeof (message as Record<string, unknown>).timestamp === 'string'
        ? (message as Record<string, unknown>).timestamp as string
        : undefined;
    if (!timestamp) {
      continue;
    }

    const date = formatDateInTimezone(new Date(timestamp), timezone);
    const bucket = buckets.get(date) ?? createBucket();
    const usageRecord = usage as Record<string, unknown>;
    bucket.messages += 1;
    bucket.input += numberOrZero(usageRecord.input_tokens);
    bucket.output += numberOrZero(usageRecord.output_tokens);
    bucket.cacheRead += numberOrZero(usageRecord.cache_read_input_tokens);
    bucket.cacheWrite += numberOrZero(usageRecord.cache_creation_input_tokens);
    bucket.sessionIds.add(resolveSessionId(record, filePath, rootDir));
    buckets.set(date, bucket);
  }
}

function createBucket(): MutableUsageBucket {
  return {
    sessionIds: new Set<string>(),
    messages: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

function resolveSessionId(record: Record<string, unknown>, filePath: string, rootDir: string): string {
  const direct = firstString(record.sessionId, record.session_id, record.conversationId);
  if (direct) {
    return direct;
  }
  return path.relative(rootDir, filePath) || filePath;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function resolveTargetDate(value: string | undefined, timezone: string, now: Date): string {
  if (!value || value === 'today') {
    return formatDateInTimezone(now, timezone);
  }
  if (value === 'yesterday') {
    return shiftDateString(formatDateInTimezone(now, timezone), -1);
  }
  return value;
}

function formatDateInTimezone(value: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error(`Unable to format date in timezone ${timezone}`);
  }
  return `${year}-${month}-${day}`;
}

function buildPreviousDateRange(targetDate: string, days: number): string[] {
  const dates: string[] = [];
  for (let offset = days; offset >= 1; offset -= 1) {
    dates.push(shiftDateString(targetDate, -offset));
  }
  return dates;
}

function shiftDateString(date: string, offset: number): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
}

function toDailyUsage(date: string, bucket?: MutableUsageBucket): ClaudeDailyUsage {
  const input = bucket?.input ?? 0;
  const output = bucket?.output ?? 0;
  const cacheRead = bucket?.cacheRead ?? 0;
  const cacheWrite = bucket?.cacheWrite ?? 0;
  const total = input + output + cacheRead + cacheWrite;

  return {
    date,
    messages: bucket?.messages ?? 0,
    sessions: bucket?.sessionIds.size ?? 0,
    input,
    output,
    cacheRead,
    cacheWrite,
    fresh: input + output,
    total,
  };
}

function buildWindowUsage(compareDates: string[], buckets: Map<string, MutableUsageBucket>): ClaudeWindowUsage {
  const totals = compareDates
    .map((date) => toDailyUsage(date, buckets.get(date)))
    .reduce((accumulator, day) => ({
      messages: accumulator.messages + day.messages,
      sessions: accumulator.sessions + day.sessions,
      input: accumulator.input + day.input,
      output: accumulator.output + day.output,
      cacheRead: accumulator.cacheRead + day.cacheRead,
      cacheWrite: accumulator.cacheWrite + day.cacheWrite,
      fresh: accumulator.fresh + day.fresh,
      total: accumulator.total + day.total,
    }), emptyTotals());

  return {
    startDate: compareDates[0] ?? '',
    endDate: compareDates[compareDates.length - 1] ?? '',
    days: compareDates.length,
    totals,
    dailyAverage: divideTotals(totals, compareDates.length || 1),
  };
}

function emptyTotals(): ClaudeUsageTotals {
  return {
    messages: 0,
    sessions: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    fresh: 0,
    total: 0,
  };
}

function divideTotals(value: ClaudeUsageTotals, divisor: number): ClaudeUsageTotals {
  return {
    messages: value.messages / divisor,
    sessions: value.sessions / divisor,
    input: value.input / divisor,
    output: value.output / divisor,
    cacheRead: value.cacheRead / divisor,
    cacheWrite: value.cacheWrite / divisor,
    fresh: value.fresh / divisor,
    total: value.total / divisor,
  };
}

function buildComparisonField(target: number, previousDailyAverage: number): ClaudeStatsComparisonField {
  return {
    target,
    previousDailyAverage,
    delta: target - previousDailyAverage,
    ratio: previousDailyAverage === 0 ? null : target / previousDailyAverage,
  };
}
