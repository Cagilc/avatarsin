import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { hostManifestSchema, type HostManifest } from '@vex/operator';

/**
 * Loads the host manifest (VEX_HOST_MANIFEST): a preset name, resolved to
 * <repo>/presets/<name>/manifest.json, or a path to a manifest file. It only runs on the server;
 * a manifest that does not validate stops the start with the exact field and reason.
 */

export const PRESETS_DIR = resolve(import.meta.dirname, '..', '..', '..', 'presets');

export class HostManifestError extends Error {}

export interface LoadOptions {
  /** Where relative paths resolve from. Default: the process working directory. */
  cwd?: string;
  presetsDir?: string;
}

const PRESET_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export function resolveManifestPath(setting: string, opts: LoadOptions = {}): string {
  if (PRESET_NAME.test(setting)) return join(opts.presetsDir ?? PRESETS_DIR, setting, 'manifest.json');
  return isAbsolute(setting) ? setting : resolve(opts.cwd ?? process.cwd(), setting);
}

/** Parses and validates manifest text; `where` names the file in every error. */
export function parseHostManifest(text: string, where: string): HostManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new HostManifestError(`${where}: no es JSON válido (${err instanceof Error ? err.message : String(err)}).`);
  }
  const parsed = hostManifestSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.map(String).join('.') || '(raíz)'}: ${i.message}`);
    throw new HostManifestError(`${where}: manifiesto del host no válido. ${issues.join('; ')}`);
  }
  return parsed.data;
}

export function loadHostManifest(setting: string, opts: LoadOptions = {}): HostManifest {
  const path = resolveManifestPath(setting, opts);
  if (!existsSync(path)) {
    const hint = PRESET_NAME.test(setting) ? ` (preset "${setting}")` : '';
    throw new HostManifestError(`No existe el manifiesto del host: ${path}${hint}.`);
  }
  return parseHostManifest(readFileSync(path, 'utf8'), path);
}
