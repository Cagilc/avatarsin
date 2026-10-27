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

/** One completion's tokens and estimated cost, charged to a person. */
export interface SpendRecord {
  ts: string;
  principalId: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  usd: number;
}

export interface SpendTotal {
  tokens: number;
  usd: number;
  calls: number;
}

export interface StoredSession {
  id: string;
  principal: Principal;
  history: ChatMessage[];
}

export interface SessionSummary {
  id: string;
  principal: Principal;
  /** User messages in the conversation. */
  turns: number;
  updatedAt: string;
}

/** A person's thumbs up or down on one reply, with their reason. */
export interface FeedbackRecord {
  ts: string;
  sessionId: string;
  principalId: string;
  turn: number;
  verdict: 'up' | 'down';
  reason?: string;
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
  /** Most recently updated conversations first. */
  listSessions(limit?: number): SessionSummary[];
  recordFeedback(record: FeedbackRecord): void;
  feedbackFor(sessionId: string): FeedbackRecord[];
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
  recordSpend(record: SpendRecord): void;
  /** Totals since an instant (ISO), for everyone or for one person. */
  spendSince(sinceIso: string, principalId?: string): SpendTotal;
  spendByPrincipalSince(sinceIso: string): Array<SpendTotal & { principalId: string }>;
  /** Small named values that must survive a restart (the pause switch). */
  getSetting(key: string): string | null;
  setSetting(key: string, value: string | null): void;
  close(): void;
}

const DEFAULT_AUDIT_LIMIT = 500;

/** For tests and local demos. Copies on save so it behaves like real persistence. */
// A user message that carries tool results continues a turn (its text is what a check saw), it does not start one.
const countTurns = (history: ChatMessage[]) => history.filter((m) => m.role === 'user' && m.content.some((b) => b.type === 'text') && !m.content.some((b) => b.type === 'tool_result')).length;

export class MemoryStore implements OperatorStore {
  readonly auditEntries: AuditEntry[] = [];
  private readonly sessions = new Map<string, StoredSession>();
  private readonly sessionTimes = new Map<string, string>();
  readonly feedback: FeedbackRecord[] = [];

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
    this.sessionTimes.set(session.id, new Date().toISOString());
  }

  listSessions(limit = 50): SessionSummary[] {
    return [...this.sessions.values()]
      .map((s) => ({ id: s.id, principal: structuredClone(s.principal), turns: countTurns(s.history), updatedAt: this.sessionTimes.get(s.id) ?? '' }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, limit);
  }

  recordFeedback(record: FeedbackRecord): void {
    this.feedback.push({ ...record });
  }

  feedbackFor(sessionId: string): FeedbackRecord[] {
    return this.feedback.filter((f) => f.sessionId === sessionId).map((f) => ({ ...f }));
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

  readonly spend: SpendRecord[] = [];
  private readonly settings = new Map<string, string>();

  recordSpend(record: SpendRecord): void {
    this.spend.push({ ...record });
  }

  spendSince(sinceIso: string, principalId?: string): SpendTotal {
    return sum(this.spend.filter((r) => r.ts >= sinceIso && (principalId === undefined || r.principalId === principalId)));
  }

  spendByPrincipalSince(sinceIso: string): Array<SpendTotal & { principalId: string }> {
    const by = new Map<string, SpendRecord[]>();
    for (const r of this.spend) if (r.ts >= sinceIso) by.set(r.principalId, [...(by.get(r.principalId) ?? []), r]);
    return [...by].map(([principalId, rows]) => ({ principalId, ...sum(rows) })).sort((a, b) => b.tokens - a.tokens);
  }

  getSetting(key: string): string | null {
    return this.settings.get(key) ?? null;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) this.settings.delete(key);
    else this.settings.set(key, value);
  }

  close(): void {}
}

function sum(rows: SpendRecord[]): SpendTotal {
  return rows.reduce((t, r) => ({ tokens: t.tokens + r.input + r.output + r.cacheRead + r.cacheWrite, usd: t.usd + r.usd, calls: t.calls + 1 }), { tokens: 0, usd: 0, calls: 0 });
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
  private readonly selectSessions: StatementSync;
  private readonly insertFeedback: StatementSync;
  private readonly selectFeedback: StatementSync;
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
  private readonly insertSpend: StatementSync;
  private readonly sumSpend: StatementSync;
  private readonly sumSpendByPrincipal: StatementSync;
  private readonly sumSpendPerPrincipal: StatementSync;
  private readonly selectSetting: StatementSync;
  private readonly upsertSetting: StatementSync;
  private readonly deleteSetting: StatementSync;

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
      create table if not exists spend (
        id integer primary key,
        ts text not null,
        principal_id text not null,
        model text not null,
        input integer not null,
        output integer not null,
        cache_read integer not null,
        cache_write integer not null,
        usd real not null
      );
      create index if not exists spend_ts on spend (ts);
      create index if not exists spend_principal_ts on spend (principal_id, ts);
      create table if not exists settings (
        key text primary key,
        value text not null
      );
      create table if not exists feedback (
        id integer primary key,
        ts text not null,
        session_id text not null,
        principal_id text not null,
        turn integer not null,
        verdict text not null,
        reason text
      );
      create index if not exists feedback_session on feedback (session_id);
    `);
    this.insertAudit = this.db.prepare('insert into audit (ts, session_id, principal_id, tool, outcome, entry) values (?, ?, ?, ?, ?, ?)');
    this.auditBySession = this.db.prepare('select entry from audit where principal_id = ? and session_id = ? order by id desc limit ?');
    this.auditByPrincipal = this.db.prepare('select entry from audit where principal_id = ? order by id desc limit ?');
    this.selectSession = this.db.prepare('select principal, history from sessions where id = ?');
    this.upsertSession = this.db.prepare(
      'insert into sessions (id, principal_id, principal, history, updated_at) values (?, ?, ?, ?, ?) ' +
        'on conflict (id) do update set history = excluded.history, updated_at = excluded.updated_at',
    );
    this.selectSessions = this.db.prepare('select id, principal, history, updated_at from sessions order by updated_at desc limit ?');
    this.insertFeedback = this.db.prepare('insert into feedback (ts, session_id, principal_id, turn, verdict, reason) values (?, ?, ?, ?, ?, ?)');
    this.selectFeedback = this.db.prepare('select ts, session_id, principal_id, turn, verdict, reason from feedback where session_id = ? order by id');
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
    this.insertSpend = this.db.prepare('insert into spend (ts, principal_id, model, input, output, cache_read, cache_write, usd) values (?, ?, ?, ?, ?, ?, ?, ?)');
    const totals = 'coalesce(sum(input + output + cache_read + cache_write), 0) as tokens, coalesce(sum(usd), 0) as usd, count(*) as calls';
    this.sumSpend = this.db.prepare(`select ${totals} from spend where ts >= ?`);
    this.sumSpendByPrincipal = this.db.prepare(`select ${totals} from spend where ts >= ? and principal_id = ?`);
    this.sumSpendPerPrincipal = this.db.prepare(`select principal_id, ${totals} from spend where ts >= ? group by principal_id order by tokens desc`);
    this.selectSetting = this.db.prepare('select value from settings where key = ?');
    this.upsertSetting = this.db.prepare('insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value');
    this.deleteSetting = this.db.prepare('delete from settings where key = ?');
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

  listSessions(limit = 50): SessionSummary[] {
    return (this.selectSessions.all(limit) as Array<{ id: string; principal: string; history: string; updated_at: string }>).map((r) => ({
      id: r.id,
      principal: JSON.parse(r.principal) as Principal,
      turns: countTurns(JSON.parse(r.history) as ChatMessage[]),
      updatedAt: r.updated_at,
    }));
  }

  recordFeedback(f: FeedbackRecord): void {
    this.insertFeedback.run(f.ts, f.sessionId, f.principalId, f.turn, f.verdict, f.reason ?? null);
  }

  feedbackFor(sessionId: string): FeedbackRecord[] {
    return (this.selectFeedback.all(sessionId) as Array<{ ts: string; session_id: string; principal_id: string; turn: number; verdict: 'up' | 'down'; reason: string | null }>).map((r) => ({
      ts: r.ts,
      sessionId: r.session_id,
      principalId: r.principal_id,
      turn: r.turn,
      verdict: r.verdict,
      ...(r.reason ? { reason: r.reason } : {}),
    }));
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

  recordSpend(r: SpendRecord): void {
    this.insertSpend.run(r.ts, r.principalId, r.model, r.input, r.output, r.cacheRead, r.cacheWrite, r.usd);
  }

  spendSince(sinceIso: string, principalId?: string): SpendTotal {
    const row = (principalId === undefined ? this.sumSpend.get(sinceIso) : this.sumSpendByPrincipal.get(sinceIso, principalId)) as { tokens: number; usd: number; calls: number };
    return { tokens: Number(row.tokens), usd: Number(row.usd), calls: Number(row.calls) };
  }

  spendByPrincipalSince(sinceIso: string): Array<SpendTotal & { principalId: string }> {
    return (this.sumSpendPerPrincipal.all(sinceIso) as Array<{ principal_id: string; tokens: number; usd: number; calls: number }>).map((r) => ({ principalId: r.principal_id, tokens: Number(r.tokens), usd: Number(r.usd), calls: Number(r.calls) }));
  }

  getSetting(key: string): string | null {
    const row = this.selectSetting.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) this.deleteSetting.run(key);
    else this.upsertSetting.run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
