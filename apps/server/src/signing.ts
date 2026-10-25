import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson, fromBase64Url, generateSigningKeys, keyIdOf, toBase64Url } from '@vexstudio/format';

/**
 * The studio's Ed25519 key. Published packages and integration grants are signed with it; host
 * pages carry only the public half. In production it comes from STUDIO_SIGNING_KEY (PKCS#8,
 * base64url); in development a key file is generated on first start.
 */
export interface Signer {
  privateKey: CryptoKey;
  publicKey: string;
  keyId: string;
  /** Detached signature over the canonical JSON of `value`. */
  sign(value: unknown): Promise<string>;
}

async function fromPkcs8(pkcs8: string): Promise<Signer> {
  const subtle = globalThis.crypto.subtle;
  const privateKey = await subtle.importKey('pkcs8', fromBase64Url(pkcs8), { name: 'Ed25519' }, true, ['sign']);
  // The public key is derived from the private one through its JWK form.
  const jwk = await subtle.exportKey('jwk', privateKey);
  const publicKey = jwk.x;
  if (!publicKey) throw new Error('No se pudo derivar la clave pública.');
  const keyId = await keyIdOf(publicKey);
  return {
    privateKey,
    publicKey,
    keyId,
    async sign(value) {
      return toBase64Url(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(canonicalJson(value)))));
    },
  };
}

export async function generatePkcs8(): Promise<string> {
  const keys = await generateSigningKeys();
  return toBase64Url(new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', keys.privateKey)));
}

export async function loadSigner(opts: { env?: string; file?: string }): Promise<{ signer: Signer; source: 'env' | 'file' | 'generated' | 'ephemeral' }> {
  if (opts.env) return { signer: await fromPkcs8(opts.env), source: 'env' };
  if (opts.file) {
    if (existsSync(opts.file)) return { signer: await fromPkcs8((JSON.parse(readFileSync(opts.file, 'utf8')) as { pkcs8: string }).pkcs8), source: 'file' };
    const pkcs8 = await generatePkcs8();
    mkdirSync(dirname(opts.file), { recursive: true });
    writeFileSync(opts.file, JSON.stringify({ pkcs8 }), { mode: 0o600 });
    return { signer: await fromPkcs8(pkcs8), source: 'generated' };
  }
  return { signer: await fromPkcs8(await generatePkcs8()), source: 'ephemeral' };
}

