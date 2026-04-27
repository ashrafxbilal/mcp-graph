import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileExists } from './utils.js';

const execFileAsync = promisify(execFile);

export interface OpenCodeUsageTotals {
  messages: number;
  sessions: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  fresh: number;
  total: number;
  cost: number;
}

export interface OpenCodeDailyUsage extends OpenCodeUsageTotals {
  date: string;
}

export interface OpenCodeWindowUsage {
  startDate: string;
  endDate: string;
  days: number;
  totals: OpenCodeUsageTotals;
  dailyAverage: OpenCodeUsageTotals;
}

export interface OpenCodeStatsComparisonField {
  target: number;
  previousDailyAverage: number;
  delta: number;
  ratio: number | null;
}

export interface OpenCodeStatsReport {
  dbPath: string;
  timezone: string;
  targetDate: string;
  compareDays: number;
  project?: string;
  targetDay: OpenCodeDailyUsage;
  previousWindow?: OpenCodeWindowUsage;
  comparison?: {
    fresh: OpenCodeStatsComparisonField;
    total: OpenCodeStatsComparisonField;
    cost: OpenCodeStatsComparisonField;
  };
  dailyBreakdown: OpenCodeDailyUsage[];
}

interface MutableUsageBucket {
  sessionIds: Set<string>;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
}

interface OpenCodeStatsOptions {
  dbPath?: string;
  targetDate?: string;
  compareDays?: number;
  timezone?: string;
  project?: string;
  now?: Date;
}

interface OpenCodeMessageRow {
  session_id: string;
  time_created: number;
  directory: string;
  input: number | null;
  output: number | null;
  total: number | null;
  cache_read: number | null;
  cache_write: number | null;
  cost: number | null;
}

export async function buildOpenCodeStatsReport(options: OpenCodeStatsOptions = {}): Promise<OpenCodeStatsReport> {
  const dbPath = await resolveOpenCodeDbPath(options.dbPath);
  const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const now = options.now ?? new Date();
  const targetDate = resolveTargetDate(options.targetDate, timezone, now);
  const compareDays = Math.max(0, options.compareDays ?? 7);
  const project = options.project ? path.resolve(options.project) : undefined;
  const rows = await loadOpenCodeRows(dbPath);
  const buckets = new Map<string, MutableUsageBucket>();

  for (const row of rows) {
    if (project && path.resolve(row.directory) !== project) {
      continue;
    }

    const date = formatDateInTimezone(new Date(row.time_created), timezone);
    const bucket = buckets.get(date) ?? createBucket();
    bucket.messages += 1;
    bucket.sessionIds.add(row.session_id);
    bucket.input += numberOrZero(row.input);
    bucket.output += numberOrZero(row.output);
    bucket.cacheRead += numberOrZero(row.cache_read);
    bucket.cacheWrite += numberOrZero(row.cache_write);
    bucket.total += row.total ?? (numberOrZero(row.input) + numberOrZero(row.output) + numberOrZero(row.cache_read) + numberOrZero(row.cache_write));
    bucket.cost += numberOrZero(row.cost);
    buckets.set(date, bucket);
  }

  const compareDates = buildPreviousDateRange(targetDate, compareDays);
  const dailyBreakdown = [...compareDates, targetDate]
    .map((date) => toDailyUsage(date, buckets.get(date)))
    .sort((left, right) => left.date.localeCompare(right.date));
  const targetDay = toDailyUsage(targetDate, buckets.get(targetDate));
  const previousWindow = compareDays > 0 ? buildWindowUsage(compareDates, buckets) : undefined;

  return {
    dbPath,
    timezone,
    targetDate,
    compareDays,
    ...(project ? { project } : {}),
    targetDay,
    previousWindow,
    comparison: previousWindow ? {
      fresh: buildComparisonField(targetDay.fresh, previousWindow.dailyAverage.fresh),
      total: buildComparisonField(targetDay.total, previousWindow.dailyAverage.total),
      cost: buildComparisonField(targetDay.cost, previousWindow.dailyAverage.cost),
    } : undefined,
    dailyBreakdown,
  };
}

async function resolveOpenCodeDbPath(explicitPath?: string): Promise<string> {
  const homeDir = os.homedir();
  const candidates = [
    explicitPath,
    process.env.OPENCODE_DB_PATH,
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'opencode', 'opencode.db') : undefined,
    path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db'),
    path.join(homeDir, 'Library', 'Application Support', 'opencode', 'opencode.db'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'opencode', 'opencode.db') : undefined,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (await fileExists(resolved)) {
      return resolved;
    }
  }

  throw new Error('Unable to locate opencode.db. Pass --db /absolute/path/to/opencode.db.');
}

async function loadOpenCodeRows(dbPath: string): Promise<OpenCodeMessageRow[]> {
  const query = [
    'select',
    '  m.session_id as session_id,',
    '  m.time_created as time_created,',
    '  s.directory as directory,',
    "  json_extract(m.data, '$.tokens.input') as input,",
    "  json_extract(m.data, '$.tokens.output') as output,",
    "  json_extract(m.data, '$.tokens.total') as total,",
    "  json_extract(m.data, '$.tokens.cache.read') as cache_read,",
    "  json_extract(m.data, '$.tokens.cache.write') as cache_write,",
    "  json_extract(m.data, '$.cost') as cost",
    'from message m',
    'join session s on s.id = m.session_id',
    "where json_extract(m.data, '$.tokens.total') is not null",
    "  and json_extract(m.data, '$.role') = 'assistant'",
    'order by m.time_created asc;',
  ].join(' ');

  try {
    const { stdout } = await execFileAsync('sqlite3', ['-json', dbPath, query]);
    return stdout.trim() ? JSON.parse(stdout) as OpenCodeMessageRow[] : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message)) {
      throw new Error('sqlite3 is required for opencode-stats but was not found on PATH.');
    }
    throw error;
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
    total: 0,
    cost: 0,
  };
}

function numberOrZero(value: number | null | undefined): number {
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

function toDailyUsage(date: string, bucket?: MutableUsageBucket): OpenCodeDailyUsage {
  const input = bucket?.input ?? 0;
  const output = bucket?.output ?? 0;
  const cacheRead = bucket?.cacheRead ?? 0;
  const cacheWrite = bucket?.cacheWrite ?? 0;

  return {
    date,
    messages: bucket?.messages ?? 0,
    sessions: bucket?.sessionIds.size ?? 0,
    input,
    output,
    cacheRead,
    cacheWrite,
    fresh: input + output,
    total: bucket?.total ?? 0,
    cost: bucket?.cost ?? 0,
  };
}

function buildWindowUsage(compareDates: string[], buckets: Map<string, MutableUsageBucket>): OpenCodeWindowUsage {
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
      cost: accumulator.cost + day.cost,
    }), emptyTotals());

  return {
    startDate: compareDates[0] ?? '',
    endDate: compareDates[compareDates.length - 1] ?? '',
    days: compareDates.length,
    totals,
    dailyAverage: divideTotals(totals, compareDates.length || 1),
  };
}

function emptyTotals(): OpenCodeUsageTotals {
  return {
    messages: 0,
    sessions: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    fresh: 0,
    total: 0,
    cost: 0,
  };
}

function divideTotals(value: OpenCodeUsageTotals, divisor: number): OpenCodeUsageTotals {
  return {
    messages: value.messages / divisor,
    sessions: value.sessions / divisor,
    input: value.input / divisor,
    output: value.output / divisor,
    cacheRead: value.cacheRead / divisor,
    cacheWrite: value.cacheWrite / divisor,
    fresh: value.fresh / divisor,
    total: value.total / divisor,
    cost: value.cost / divisor,
  };
}

function buildComparisonField(target: number, previousDailyAverage: number): OpenCodeStatsComparisonField {
  return {
    target,
    previousDailyAverage,
    delta: target - previousDailyAverage,
    ratio: previousDailyAverage === 0 ? null : target / previousDailyAverage,
  };
}
