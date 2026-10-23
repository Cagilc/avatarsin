import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditEntry } from '@vex/operator';

/** Keeps the last entries in memory and appends every one to a JSONL file when a path is given. */
export class AuditLog {
  readonly entries: AuditEntry[] = [];
  private readonly file: string | null;
  private readonly max: number;

  constructor(file: string | null, max = 1000) {
    this.file = file;
    this.max = max;
    if (file) mkdirSync(dirname(file), { recursive: true });
  }

  record(entry: AuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    if (this.file) appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  forSession(sessionId: string): AuditEntry[] {
    return this.entries.filter((e) => e.sessionId === sessionId);
  }
}
