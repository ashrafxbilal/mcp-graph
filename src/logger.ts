import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, safeJsonStringify } from './utils.js';

export class AuditLogger {
  constructor(private readonly logPath?: string) {}

  async log(event: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.logPath) {
      return;
    }

    await ensureDir(path.dirname(this.logPath));
    const line = safeJsonStringify({ ts: new Date().toISOString(), event, ...payload }, 0);
    await fs.appendFile(this.logPath, `${line}\n`, 'utf8');
  }
}
