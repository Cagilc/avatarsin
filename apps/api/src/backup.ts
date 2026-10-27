import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Hot backup and restore of the SQLite file, with node:sqlite only. `VACUUM INTO` writes a
 * consistent snapshot while the server keeps running (WAL mode), so a backup never needs a stop;
 * a restore does, because the server holds the file open.
 */

export class BackupError extends Error {}

/** Writes a consistent copy of the live database to `dest` (parent directories are created). */
export function backupDatabase(src: string, dest: string): { bytes: number } {
  if (!existsSync(src)) throw new BackupError(`No existe la base de datos ${src}.`);
  if (existsSync(dest)) throw new BackupError(`Ya existe ${dest}; elige otro nombre o bórralo antes.`);
  mkdirSync(dirname(dest), { recursive: true });
  const db = new DatabaseSync(src, { readOnly: true });
  try {
    // SQLite parameters cannot name a file: the path is quoted as a string literal.
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  return { bytes: statSync(dest).size };
}

/** True when the file is a healthy SQLite database with Vex's tables; the reason otherwise. */
export function checkDatabase(path: string): { ok: true; tables: string[] } | { ok: false; reason: string } {
  if (!existsSync(path)) return { ok: false, reason: `No existe ${path}.` };
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (err) {
    return { ok: false, reason: `No se puede abrir: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    const integrity = db.prepare('pragma integrity_check').all() as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') return { ok: false, reason: `integrity_check: ${integrity.map((r) => r.integrity_check).join('; ')}` };
    const tables = (db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as Array<{ name: string }>).map((r) => r.name);
    if (!tables.includes('audit') || !tables.includes('sessions')) return { ok: false, reason: `No parece una base de datos de Vex (tablas: ${tables.join(', ') || 'ninguna'}).` };
    return { ok: true, tables };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    db.close();
  }
}

/**
 * Puts a backup in place of the live database. Refuses when the backup is not healthy or when
 * the server seems to be running (a WAL file with pending pages): stop it first.
 */
export function restoreDatabase(backup: string, dest: string): { tables: string[] } {
  const check = checkDatabase(backup);
  if (!check.ok) throw new BackupError(`La copia no sirve: ${check.reason}`);
  const wal = `${dest}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) throw new BackupError(`${dest} está en uso (hay páginas pendientes en ${wal}): para el servidor antes de restaurar.`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(backup, dest);
  return { tables: check.tables };
}
