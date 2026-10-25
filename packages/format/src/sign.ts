import { z } from 'zod';
import { hashSchema, idSchema, type AvatarDocument } from './schema.ts';
import { parseDocument, type Issue } from './validate.ts';

/**
 * Published packages. The server signs each published version with its Ed25519 key; the
 * embedded avatar verifies the signature and every asset's SHA-256 before drawing anything, so a
 * package or asset altered anywhere between the studio and the page is refused.
 *
 * Only WebCrypto is used, so the same code runs in Node and in the browser.
 */

export const ASSET_TYPES = ['image/svg+xml', 'image/png'] as const;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

export const assetRefSchema = z.strictObject({
  hash: hashSchema,
  type: z.enum(ASSET_TYPES),
  size: z.number().int().min(1).max(MAX_ASSET_BYTES),
});
export type AssetRef = z.infer<typeof assetRefSchema>;

export const packageSchema = z.strictObject({
  format: z.literal('vex-avatar-package'),
  packageVersion: z.literal(1),
  avatarId: idSchema,
  revision: z.number().int().min(1),
  publishedAt: z.string().max(40),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  document: z.unknown(),
  assets: z.array(assetRefSchema).max(40),
  signature: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/),
});
export type AvatarPackage = z.infer<typeof packageSchema>;
export type UnsignedPackage = Omit<AvatarPackage, 'signature' | 'keyId'>;

/** JSON with sorted keys and no whitespace: the exact bytes that get signed. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Número no finito.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const subtle = () => globalThis.crypto.subtle;
const utf8 = (s: string) => new TextEncoder().encode(s);

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function generateSigningKeys(): Promise<CryptoKeyPair> {
  return (await subtle().generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return toBase64Url(new Uint8Array(await subtle().exportKey('raw', key)));
}

export async function importPublicKey(raw: string): Promise<CryptoKey> {
  return subtle().importKey('raw', fromBase64Url(raw), { name: 'Ed25519' }, true, ['verify']);
}

/** A short, stable id for a public key, so a page can tell which key signed a package. */
export async function keyIdOf(rawPublicKey: string): Promise<string> {
  return (await sha256Hex(fromBase64Url(rawPublicKey))).slice(0, 16);
}

export async function signPackage(unsigned: UnsignedPackage, privateKey: CryptoKey, rawPublicKey: string): Promise<AvatarPackage> {
  const body = { ...unsigned, keyId: await keyIdOf(rawPublicKey) };
  const signature = new Uint8Array(await subtle().sign({ name: 'Ed25519' }, privateKey, utf8(canonicalJson(body))));
  return { ...body, signature: toBase64Url(signature) };
}

export type VerifyResult = { ok: true; pkg: AvatarPackage; doc: AvatarDocument } | { ok: false; reason: string; issues?: Issue[] };

/**
 * Checks shape, key, signature and document, in that order. The signature is verified over the
 * bytes as received, before anything in the package is trusted.
 */
export async function verifyPackage(input: unknown, publicKey: CryptoKey, expectedKeyId: string): Promise<VerifyResult> {
  const parsed = packageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'El paquete no tiene el formato esperado.' };
  const pkg = parsed.data;
  if (pkg.keyId !== expectedKeyId) return { ok: false, reason: 'El paquete está firmado con otra clave.' };
  const { signature, ...body } = pkg;
  let valid = false;
  try {
    valid = await subtle().verify({ name: 'Ed25519' }, publicKey, fromBase64Url(signature), utf8(canonicalJson(body)));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'La firma no es válida: el paquete se ha modificado.' };
  const doc = parseDocument(pkg.document);
  if (!doc.ok) return { ok: false, reason: 'El documento del avatar no es válido.', issues: doc.issues };
  const listed = new Set(pkg.assets.map((a) => a.hash));
  const missing = doc.doc.sources.find((s) => !listed.has(s.asset));
  if (missing) return { ok: false, reason: `Falta el recurso ${missing.asset} en el paquete.` };
  return { ok: true, pkg, doc: doc.doc };
}

/** Checks a downloaded asset against the hash the signed package lists for it. */
export async function verifyAsset(bytes: Uint8Array<ArrayBuffer>, ref: AssetRef): Promise<boolean> {
  return bytes.byteLength === ref.size && (await sha256Hex(bytes)) === ref.hash;
}
