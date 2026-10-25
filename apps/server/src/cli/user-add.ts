import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, MIN_PASSWORD, ROLES, type Role } from '../auth.ts';
import { StudioStore } from '../store.ts';

/**
 * Creates a studio account (there is no sign-up page).
 *   pnpm user:add <email> <name> [owner|editor]
 * The password comes from STUDIO_NEW_PASSWORD; without it one is generated and shown once.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [email, name, roleArg = 'editor'] = process.argv.slice(2);
if (!email || !name || !(ROLES as readonly string[]).includes(roleArg)) {
  console.error('Uso: pnpm user:add <correo> <nombre> [owner|editor]');
  process.exit(1);
}
const role = roleArg as Role;
const given = process.env['STUDIO_NEW_PASSWORD'];
if (given !== undefined && given.length < MIN_PASSWORD) {
  console.error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
  process.exit(1);
}
const password = given ?? randomBytes(15).toString('base64url');
const dbSetting = process.env['STUDIO_DB'] ?? 'data/studio.db';
const store = new StudioStore(isAbsolute(dbSetting) ? dbSetting : join(root, dbSetting));
if (store.userByEmail(email)) {
  console.error('Ya existe una cuenta con ese correo.');
  process.exit(1);
}
const id = `u-${randomBytes(6).toString('hex')}`;
store.addUser({ id, email, name, role, passwordHash: await hashPassword(password) });
store.audit('cli', 'user.add', id, { role });
store.close();
console.log(`Cuenta creada: ${email} (${role}).`);
if (given === undefined) console.log(`Contraseña generada (se muestra solo ahora): ${password}`);
