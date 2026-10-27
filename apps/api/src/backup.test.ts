import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupDatabase, checkDatabase, restoreDatabase } from './backup.ts';
import { SqliteStore } from './storage.ts';

const entry = (i: number) => ({ ts: new Date(2026, 9, 27, 10, i).toISOString(), sessionId: 's-1', principal: { id: 'u-cesar', name: 'César', role: 'admin' }, actionId: `a-${i}`, tool: 'buscar', driver: 'platform' as const, risk: 'read' as const, params: { consulta: `Laura ${i}` }, summary: `Buscar ${i}`, outcome: 'ok' as const, durationMs: 1 });

describe('hot backup and restore of the SQLite file', () => {
  const dirs: string[] = [];
  // Windows cannot delete a file another handle holds open: every store is closed before the directory goes.
  const stores: SqliteStore[] = [];
  const open = (path: string) => {
    const store = new SqliteStore(path);
    stores.push(store);
    return store;
  };
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), 'vex-backup-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('copies a consistent snapshot while the store is open, and the copy reads the same', () => {
    const d = dir();
    const live = join(d, 'vex.db');
    const store = open(live);
    for (let i = 0; i < 3; i += 1) store.recordAudit(entry(i));
    const { bytes } = backupDatabase(live, join(d, 'copias', 'vex-1.db'));
    expect(bytes).toBeGreaterThan(0);
    // The live store keeps working after the snapshot.
    store.recordAudit(entry(3));
    expect(store.audit({ principalId: 'u-cesar', sessionId: 's-1' })).toHaveLength(4);
    const copy = open(join(d, 'copias', 'vex-1.db'));
    expect(copy.audit({ principalId: 'u-cesar', sessionId: 's-1' }).map((e) => e.actionId)).toEqual(['a-0', 'a-1', 'a-2']);
    expect(checkDatabase(join(d, 'copias', 'vex-1.db'))).toMatchObject({ ok: true, tables: expect.arrayContaining(['audit', 'sessions', 'spend']) });
    expect(() => backupDatabase(live, join(d, 'copias', 'vex-1.db'))).toThrow(/Ya existe/);
    expect(() => backupDatabase(join(d, 'nada.db'), join(d, 'x.db'))).toThrow(/No existe/);
  });

  it('restores a healthy copy over the file, and refuses a broken one or a database in use', () => {
    const d = dir();
    const live = join(d, 'vex.db');
    const store = open(live);
    store.recordAudit(entry(0));
    backupDatabase(live, join(d, 'copia.db'));
    store.recordAudit(entry(1));
    // In use: the WAL has pending pages while the store is open.
    expect(() => restoreDatabase(join(d, 'copia.db'), live)).toThrow(/en uso/);
    // Stopped (checkpointed): the copy takes the file's place and the later entry is gone, as expected of a restore.
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const { tables } = restoreDatabase(join(d, 'copia.db'), live);
    expect(tables).toContain('audit');
    expect(open(live).audit({ principalId: 'u-cesar', sessionId: 's-1' }).map((e) => e.actionId)).toEqual(['a-0']);

    writeFileSync(join(d, 'rota.db'), 'esto no es sqlite');
    expect(checkDatabase(join(d, 'rota.db'))).toMatchObject({ ok: false });
    expect(() => restoreDatabase(join(d, 'rota.db'), live)).toThrow(/no sirve/);
    const other = new SqliteStore(join(d, 'otra.db'));
    other.close();
    expect(checkDatabase(join(d, 'otra.db'))).toMatchObject({ ok: true });
  });
});
