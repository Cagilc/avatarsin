// Restore a backup over the live SQLite file (stop the server first):
//   node scripts/restore.ts <copia> [<db>]
//   node scripts/restore.ts --check <copia>      only says whether the copy is healthy
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupError, checkDatabase, restoreDatabase } from '../src/backup.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const abs = (p: string) => (isAbsolute(p) ? p : join(root, p));
const args = process.argv.slice(2);
const checkOnly = args[0] === '--check';
const backup = args[checkOnly ? 1 : 0];
if (!backup) {
  console.error('Uso: node scripts/restore.ts [--check] <copia> [<db>]');
  process.exit(2);
}

if (checkOnly) {
  const result = checkDatabase(abs(backup));
  if (!result.ok) {
    console.error(`La copia no sirve: ${result.reason}`);
    process.exit(1);
  }
  console.log(`Copia correcta: ${abs(backup)} (tablas: ${result.tables.join(', ')})`);
} else {
  const dest = abs(args[1] ?? process.env['VEX_DB'] ?? 'data/vex.db');
  try {
    const { tables } = restoreDatabase(abs(backup), dest);
    console.log(`Restaurada ${dest} desde ${abs(backup)} (tablas: ${tables.join(', ')}). Arranca el servidor.`);
  } catch (err) {
    console.error(err instanceof BackupError ? err.message : err);
    process.exit(1);
  }
}
