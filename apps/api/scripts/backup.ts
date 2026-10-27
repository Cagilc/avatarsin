// Hot backup of the live SQLite file:  node scripts/backup.ts [<db>] [<dest>]
// Defaults: the database named by VEX_DB (or data/vex.db) and data/backups/vex-<fecha>.db.
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupError, backupDatabase } from '../src/backup.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const abs = (p: string) => (isAbsolute(p) ? p : join(root, p));
const src = abs(process.argv[2] ?? process.env['VEX_DB'] ?? 'data/vex.db');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = abs(process.argv[3] ?? join('data', 'backups', `vex-${stamp}.db`));

try {
  const { bytes } = backupDatabase(src, dest);
  console.log(`Copia escrita: ${dest} (${bytes} bytes)`);
} catch (err) {
  console.error(err instanceof BackupError ? err.message : err);
  process.exit(1);
}
