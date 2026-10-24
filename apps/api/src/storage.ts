import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { ConnectorManifest } from '@vex/connectors';
import type { AuditEntry, ChatMessage, Principal } from '@vex/operator';

export interface StoredSession {
  id: string;
  principal: Principal;
  history: ChatMessage[];
}

export interface AuditQuery {
  principalId: string;
  sessionId?: string;
  limit?: number;
}

/**
 * Where Vex Core keeps what must survive a restart: the audit trail, the conversations and the
 * connectors with their human reviews. Pending confirmations are not stored: after a restart they
 * count as rejected.
 */
export interface OperatorStore {
  recordAudit(entry: AuditEntry): void;
  audit(query: AuditQuery): AuditEntry[];
  loadSession(id: string): StoredSession | null;
  saveSession(session: StoredSession): void;
  listConnectors(): ConnectorManifest[];
  saveConnector(manifest: ConnectorManifest): void;
  deleteConnector(id: string): void;
  close(): void;
}

const DEFAULT_AUDIT_LIMIT = 500;

/** For tests and local demos. Copies on save so it behaves like real persistence. */
export class MemoryStore implements OperatorStore {
  readonly auditEntries: AuditEntry[] = [];
  private readonly sessions = new Map<string, StoredSession>();

  recordAudit(entry: AuditEntry): void {
    this.auditEntries.push(entry);
  }

  audit(query: AuditQuery): AuditEntry[] {
    const rows = this.auditEntries.filter((e) => e.principal.id === query.principalId && (query.sessionId === undefined || e.sessionId === query.sessionId));
    return rows.slice(-(query.limit ?? DEFAULT_AUDIT_LIMIT));
  }

  loadSession(id: string): StoredSession | null {
    const s = this.sessions.get(id);
    return s ? structuredClone(s) : null;
  }

  saveSession(session: StoredSession): void {
    this.sessions.set(session.id, structuredClone(session));
  }

  private readonly connectors = new Map<string, ConnectorManifest>();

  listConnectors(): ConnectorManifest[] {
    return [...this.connectors.values()].map((m) => structuredClone(m));
  }

  saveConnector(manifest: ConnectorManifest): void {
    this.connectors.set(manifest.id, structuredClone(manifest));
  }

  deleteConnector(id: string): void {
    this.connectors.delete(id);
  }

  close(): void {}
}

/**
 * SQLite through Node's built-in `node:sqlite`: no native addon, so it runs on machines that
 * block unsigned binaries. One file holds the audit (append only) and the conversations.
 */
export class SqliteStore implements OperatorStore {
  private readonly db: DatabaseSync;
  private readonly insertAudit: StatementSync;
  private readonly auditBySession: StatementSync;
  private readonly auditByPrincipal: StatementSync;
  private readonly selectSession: StatementSync;
  private readonly upsertSession: StatementSync;
  private readonly selectConnectors: StatementSync;
  private readonly upsertConnector: StatementSync;
  private readonly removeConnector: StatementSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists audit (
        id integer primary key,
        ts text not null,
        session_id text not null,
        principal_id text not null,
        tool text not null,
        outcome text not null,
        entry text not null
      );
      create index if not exists audit_principal_session on audit (principal_id, session_id);
      create table if not exists sessions (
        id text primary key,
        principal_id text not null,
        principal text not null,
        history text not null,
        updated_at text not null
      );
      create table if not exists connectors (
        id text primary key,
        manifest text not null,
        updated_at text not null
      );
    `);
    this.insertAudit = this.db.prepare('insert into audit (ts, session_id, principal_id, tool, outcome, entry) values (?, ?, ?, ?, ?, ?)');
    this.auditBySession = this.db.prepare('select entry from audit where principal_id = ? and session_id = ? order by id desc limit ?');
    this.auditByPrincipal = this.db.prepare('select entry from audit where principal_id = ? order by id desc limit ?');
    this.selectSession = this.db.prepare('select principal, history from sessions where id = ?');
    this.upsertSession = this.db.prepare(
      'insert into sessions (id, principal_id, principal, history, updated_at) values (?, ?, ?, ?, ?) ' +
        'on conflict (id) do update set history = excluded.history, updated_at = excluded.updated_at',
    );
    this.selectConnectors = this.db.prepare('select manifest from connectors order by id');
    this.upsertConnector = this.db.prepare(
      'insert into connectors (id, manifest, updated_at) values (?, ?, ?) on conflict (id) do update set manifest = excluded.manifest, updated_at = excluded.updated_at',
    );
    this.removeConnector = this.db.prepare('delete from connectors where id = ?');
  }

  recordAudit(entry: AuditEntry): void {
    this.insertAudit.run(entry.ts, entry.sessionId, entry.principal.id, entry.tool, entry.outcome, JSON.stringify(entry));
  }

  audit(query: AuditQuery): AuditEntry[] {
    const limit = query.limit ?? DEFAULT_AUDIT_LIMIT;
    const rows = (query.sessionId === undefined ? this.auditByPrincipal.all(query.principalId, limit) : this.auditBySession.all(query.principalId, query.sessionId, limit)) as Array<{ entry: string }>;
    return rows.reverse().map((r) => JSON.parse(r.entry) as AuditEntry);
  }

  loadSession(id: string): StoredSession | null {
    const row = this.selectSession.get(id) as { principal: string; history: string } | undefined;
    if (!row) return null;
    return { id, principal: JSON.parse(row.principal) as Principal, history: JSON.parse(row.history) as ChatMessage[] };
  }

  saveSession(session: StoredSession): void {
    this.upsertSession.run(session.id, session.principal.id, JSON.stringify(session.principal), JSON.stringify(session.history), new Date().toISOString());
  }

  listConnectors(): ConnectorManifest[] {
    return (this.selectConnectors.all() as Array<{ manifest: string }>).map((r) => JSON.parse(r.manifest) as ConnectorManifest);
  }

  saveConnector(manifest: ConnectorManifest): void {
    this.upsertConnector.run(manifest.id, JSON.stringify(manifest), manifest.updatedAt);
  }

  deleteConnector(id: string): void {
    this.removeConnector.run(id);
  }

  close(): void {
    this.db.close();
  }
}
