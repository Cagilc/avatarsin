import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AvatarDocument, AvatarPackage, Risk } from '@vexstudio/format';
import type { Principal, Role } from './auth.ts';

export interface UserRow extends Principal {
  passwordHash: string;
}

export interface AvatarRow {
  id: string;
  name: string;
  doc: AvatarDocument;
  revision: number;
  updatedAt: string;
}

export interface RevisionRow {
  n: number;
  actor: 'user' | 'ai';
  userId: string;
  summary: string;
  createdAt: string;
}

export interface AssetRow {
  hash: string;
  type: 'image/svg+xml' | 'image/png';
  size: number;
  width: number;
  height: number;
}

export interface EmbedKey {
  id: string;
  avatarId: string;
  label: string;
  /** Exact origins (scheme://host[:port]) allowed to load the avatar. */
  origins: string[];
  /** Tool ceiling for this integration; the effective set is the intersection with the avatar's. */
  tools: string[] | null;
  maxRisk: Risk;
  createdAt: string;
  revokedAt: string | null;
}

export interface AuditRow {
  ts: string;
  userId: string;
  action: string;
  target: string;
  detail: unknown;
}

/**
 * Everything the studio keeps, in one SQLite file through Node's built-in `node:sqlite` (no
 * native addon). Published packages, revisions and the audit are append-only; uploaded assets
 * are stored by hash, so the same bytes are kept once and never change.
 */
export class StudioStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma journal_mode = wal;
      pragma foreign_keys = on;
      create table if not exists users (
        id text primary key, email text not null unique, name text not null, role text not null,
        password_hash text not null, created_at text not null
      );
      create table if not exists avatars (
        id text primary key, name text not null, doc text not null, revision integer not null,
        created_by text not null, updated_at text not null
      );
      create table if not exists revisions (
        avatar_id text not null references avatars(id), n integer not null, doc text not null,
        actor text not null, user_id text not null, summary text not null, created_at text not null,
        primary key (avatar_id, n)
      );
      create table if not exists published (
        avatar_id text not null references avatars(id), revision integer not null, package text not null,
        created_by text not null, created_at text not null, primary key (avatar_id, revision)
      );
      create table if not exists assets (
        hash text primary key, type text not null, size integer not null, width real not null,
        height real not null, bytes blob not null, created_by text not null, created_at text not null
      );
      create table if not exists embed_keys (
        id text primary key, avatar_id text not null references avatars(id), label text not null,
        origins text not null, tools text, max_risk text not null, created_by text not null,
        created_at text not null, revoked_at text
      );
      create table if not exists audit (
        id integer primary key, ts text not null, user_id text not null, action text not null,
        target text not null, detail text not null
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // ── users ──
  countUsers(): number {
    return (this.db.prepare('select count(*) as n from users').get() as { n: number }).n;
  }

  addUser(user: UserRow): void {
    this.db.prepare('insert into users (id, email, name, role, password_hash, created_at) values (?, ?, ?, ?, ?, ?)').run(user.id, user.email.toLowerCase(), user.name, user.role, user.passwordHash, new Date().toISOString());
  }

  userByEmail(email: string): UserRow | null {
    const r = this.db.prepare('select id, email, name, role, password_hash from users where email = ?').get(email.toLowerCase()) as
      | { id: string; email: string; name: string; role: Role; password_hash: string }
      | undefined;
    return r ? { id: r.id, email: r.email, name: r.name, role: r.role, passwordHash: r.password_hash } : null;
  }

  firstOwner(): Principal | null {
    const r = this.db.prepare("select id, email, name, role from users where role = 'owner' order by created_at limit 1").get() as Principal | undefined;
    return r ?? null;
  }

  // ── avatars ──
  listAvatars(): Array<Omit<AvatarRow, 'doc'> & { published: number | null }> {
    const rows = this.db
      .prepare('select a.id, a.name, a.revision, a.updated_at, (select max(revision) from published p where p.avatar_id = a.id) as published from avatars a order by a.updated_at desc')
      .all() as Array<{ id: string; name: string; revision: number; updated_at: string; published: number | null }>;
    return rows.map((r) => ({ id: r.id, name: r.name, revision: r.revision, updatedAt: r.updated_at, published: r.published }));
  }

  getAvatar(id: string): AvatarRow | null {
    const r = this.db.prepare('select id, name, doc, revision, updated_at from avatars where id = ?').get(id) as
      | { id: string; name: string; doc: string; revision: number; updated_at: string }
      | undefined;
    return r ? { id: r.id, name: r.name, doc: JSON.parse(r.doc) as AvatarDocument, revision: r.revision, updatedAt: r.updated_at } : null;
  }

  createAvatar(doc: AvatarDocument, userId: string): void {
    const now = new Date().toISOString();
    this.db.exec('begin');
    try {
      this.db.prepare('insert into avatars (id, name, doc, revision, created_by, updated_at) values (?, ?, ?, 1, ?, ?)').run(doc.id, doc.name, JSON.stringify(doc), userId, now);
      this.db.prepare('insert into revisions (avatar_id, n, doc, actor, user_id, summary, created_at) values (?, 1, ?, ?, ?, ?, ?)').run(doc.id, JSON.stringify(doc), 'user', userId, 'Creado', now);
      this.db.exec('commit');
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
  }

  /** Saves a new revision only if nobody saved in between (optimistic concurrency). */
  saveRevision(id: string, base: number, doc: AvatarDocument, actor: 'user' | 'ai', userId: string, summary: string): number | null {
    const now = new Date().toISOString();
    this.db.exec('begin');
    try {
      const res = this.db.prepare('update avatars set doc = ?, name = ?, revision = revision + 1, updated_at = ? where id = ? and revision = ?').run(JSON.stringify(doc), doc.name, now, id, base);
      if (res.changes !== 1) {
        this.db.exec('rollback');
        return null;
      }
      this.db.prepare('insert into revisions (avatar_id, n, doc, actor, user_id, summary, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(id, base + 1, JSON.stringify(doc), actor, userId, summary.slice(0, 300), now);
      this.db.exec('commit');
      return base + 1;
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
  }

  history(id: string, limit = 100): RevisionRow[] {
    const rows = this.db.prepare('select n, actor, user_id, summary, created_at from revisions where avatar_id = ? order by n desc limit ?').all(id, limit) as Array<{ n: number; actor: 'user' | 'ai'; user_id: string; summary: string; created_at: string }>;
    return rows.map((r) => ({ n: r.n, actor: r.actor, userId: r.user_id, summary: r.summary, createdAt: r.created_at }));
  }

  revisionDoc(id: string, n: number): AvatarDocument | null {
    const r = this.db.prepare('select doc from revisions where avatar_id = ? and n = ?').get(id, n) as { doc: string } | undefined;
    return r ? (JSON.parse(r.doc) as AvatarDocument) : null;
  }

  // ── published ──
  publish(pkg: AvatarPackage, userId: string): void {
    this.db.prepare('insert into published (avatar_id, revision, package, created_by, created_at) values (?, ?, ?, ?, ?)').run(pkg.avatarId, pkg.revision, JSON.stringify(pkg), userId, pkg.publishedAt);
  }

  latestPackage(avatarId: string): AvatarPackage | null {
    const r = this.db.prepare('select package from published where avatar_id = ? order by revision desc limit 1').get(avatarId) as { package: string } | undefined;
    return r ? (JSON.parse(r.package) as AvatarPackage) : null;
  }

  publishedRevisions(avatarId: string): Array<{ revision: number; createdAt: string }> {
    return (this.db.prepare('select revision, created_at from published where avatar_id = ? order by revision desc').all(avatarId) as Array<{ revision: number; created_at: string }>).map((r) => ({ revision: r.revision, createdAt: r.created_at }));
  }

  // ── assets ──
  putAsset(row: AssetRow, bytes: Buffer, userId: string): void {
    this.db
      .prepare('insert into assets (hash, type, size, width, height, bytes, created_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict (hash) do nothing')
      .run(row.hash, row.type, row.size, row.width, row.height, bytes, userId, new Date().toISOString());
  }

  asset(hash: string): (AssetRow & { bytes: Buffer }) | null {
    const r = this.db.prepare('select hash, type, size, width, height, bytes from assets where hash = ?').get(hash) as (AssetRow & { bytes: Uint8Array }) | undefined;
    return r ? { ...r, bytes: Buffer.from(r.bytes) } : null;
  }

  assetMeta(hash: string): AssetRow | null {
    const r = this.db.prepare('select hash, type, size, width, height from assets where hash = ?').get(hash) as AssetRow | undefined;
    return r ?? null;
  }

  // ── embed keys ──
  addKey(key: EmbedKey, userId: string): void {
    this.db
      .prepare('insert into embed_keys (id, avatar_id, label, origins, tools, max_risk, created_by, created_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, ?, null)')
      .run(key.id, key.avatarId, key.label, JSON.stringify(key.origins), key.tools ? JSON.stringify(key.tools) : null, key.maxRisk, userId, key.createdAt);
  }

  private keyFromRow(r: { id: string; avatar_id: string; label: string; origins: string; tools: string | null; max_risk: Risk; created_at: string; revoked_at: string | null }): EmbedKey {
    return { id: r.id, avatarId: r.avatar_id, label: r.label, origins: JSON.parse(r.origins) as string[], tools: r.tools ? (JSON.parse(r.tools) as string[]) : null, maxRisk: r.max_risk, createdAt: r.created_at, revokedAt: r.revoked_at };
  }

  key(id: string): EmbedKey | null {
    const r = this.db.prepare('select * from embed_keys where id = ?').get(id) as Parameters<StudioStore['keyFromRow']>[0] | undefined;
    return r ? this.keyFromRow(r) : null;
  }

  keys(avatarId: string): EmbedKey[] {
    return (this.db.prepare('select * from embed_keys where avatar_id = ? order by created_at desc').all(avatarId) as Array<Parameters<StudioStore['keyFromRow']>[0]>).map((r) => this.keyFromRow(r));
  }

  revokeKey(id: string): boolean {
    return this.db.prepare('update embed_keys set revoked_at = ? where id = ? and revoked_at is null').run(new Date().toISOString(), id).changes === 1;
  }

  // ── audit ──
  audit(userId: string, action: string, target: string, detail: unknown = {}): void {
    this.db.prepare('insert into audit (ts, user_id, action, target, detail) values (?, ?, ?, ?, ?)').run(new Date().toISOString(), userId, action, target, JSON.stringify(detail));
  }

  auditLog(limit = 200): AuditRow[] {
    return (this.db.prepare('select ts, user_id, action, target, detail from audit order by id desc limit ?').all(limit) as Array<{ ts: string; user_id: string; action: string; target: string; detail: string }>).map((r) => ({
      ts: r.ts,
      userId: r.user_id,
      action: r.action,
      target: r.target,
      detail: JSON.parse(r.detail) as unknown,
    }));
  }
}
