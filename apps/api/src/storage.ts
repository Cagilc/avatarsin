import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { ConnectorManifest } from '@vex/connectors';
import type { Announcement, AuditEntry, ChatMessage, Principal } from '@vex/operator';

/** An announcement the server keeps: drafted from a connector approval, published by an administrator. */
export type StoredAnnouncement = Announcement & {
  status: 'draft' | 'published';
  createdAt: string;
  createdBy?: string;
  /** The connector whose approval drafted it. */
  connector?: string;
  publishedAt?: string;
  publishedBy?: string;
};

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
  listAnnouncements(): StoredAnnouncement[];
  saveAnnouncement(announcement: StoredAnnouncement): void;
  deleteAnnouncement(id: string): void;
  /** Ids of the announcements this person has dismissed. */
  seenAnnouncements(principalId: string): string[];
  markSeen(principalId: string, announcementId: string): void;
  /** Ids of the tours this person completed. */
  doneTours(principalId: string): string[];
  markTourDone(principalId: string, tourId: string): void;
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

  private readonly announcements = new Map<string, StoredAnnouncement>();
  private readonly seen = new Map<string, Set<string>>();

  listAnnouncements(): StoredAnnouncement[] {
    return [...this.announcements.values()].map((a) => structuredClone(a));
  }

  saveAnnouncement(announcement: StoredAnnouncement): void {
    this.announcements.set(announcement.id, structuredClone(announcement));
  }

  deleteAnnouncement(id: string): void {
    this.announcements.delete(id);
  }

  seenAnnouncements(principalId: string): string[] {
    return [...(this.seen.get(principalId) ?? [])];
  }

  markSeen(principalId: string, announcementId: string): void {
    const set = this.seen.get(principalId) ?? new Set<string>();
    set.add(announcementId);
    this.seen.set(principalId, set);
  }

  private readonly tours = new Map<string, Set<string>>();

  doneTours(principalId: string): string[] {
    return [...(this.tours.get(principalId) ?? [])];
  }

  markTourDone(principalId: string, tourId: string): void {
    const set = this.tours.get(principalId) ?? new Set<string>();
    set.add(tourId);
    this.tours.set(principalId, set);
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
  private readonly selectAnnouncements: StatementSync;
  private readonly upsertAnnouncement: StatementSync;
  private readonly removeAnnouncement: StatementSync;
  private readonly selectSeen: StatementSync;
  private readonly insertSeen: StatementSync;
  private readonly selectToursDone: StatementSync;
  private readonly insertTourDone: StatementSync;

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
      create table if not exists announcements (
        id text primary key,
        status text not null,
        announcement text not null,
        updated_at text not null
      );
      create table if not exists announcement_seen (
        principal_id text not null,
        announcement_id text not null,
        seen_at text not null,
        primary key (principal_id, announcement_id)
      );
      create table if not exists tour_done (
        principal_id text not null,
        tour_id text not null,
        done_at text not null,
        primary key (principal_id, tour_id)
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
    this.selectAnnouncements = this.db.prepare('select announcement from announcements order by updated_at, id');
    this.upsertAnnouncement = this.db.prepare(
      'insert into announcements (id, status, announcement, updated_at) values (?, ?, ?, ?) on conflict (id) do update set status = excluded.status, announcement = excluded.announcement, updated_at = excluded.updated_at',
    );
    this.removeAnnouncement = this.db.prepare('delete from announcements where id = ?');
    this.selectSeen = this.db.prepare('select announcement_id from announcement_seen where principal_id = ?');
    this.insertSeen = this.db.prepare('insert or ignore into announcement_seen (principal_id, announcement_id, seen_at) values (?, ?, ?)');
    this.selectToursDone = this.db.prepare('select tour_id from tour_done where principal_id = ?');
    this.insertTourDone = this.db.prepare('insert or ignore into tour_done (principal_id, tour_id, done_at) values (?, ?, ?)');
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

  listAnnouncements(): StoredAnnouncement[] {
    return (this.selectAnnouncements.all() as Array<{ announcement: string }>).map((r) => JSON.parse(r.announcement) as StoredAnnouncement);
  }

  saveAnnouncement(announcement: StoredAnnouncement): void {
    this.upsertAnnouncement.run(announcement.id, announcement.status, JSON.stringify(announcement), new Date().toISOString());
  }

  deleteAnnouncement(id: string): void {
    this.removeAnnouncement.run(id);
  }

  seenAnnouncements(principalId: string): string[] {
    return (this.selectSeen.all(principalId) as Array<{ announcement_id: string }>).map((r) => r.announcement_id);
  }

  markSeen(principalId: string, announcementId: string): void {
    this.insertSeen.run(principalId, announcementId, new Date().toISOString());
  }

  doneTours(principalId: string): string[] {
    return (this.selectToursDone.all(principalId) as Array<{ tour_id: string }>).map((r) => r.tour_id);
  }

  markTourDone(principalId: string, tourId: string): void {
    this.insertTourDone.run(principalId, tourId, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
