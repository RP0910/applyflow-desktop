import { createCipheriv, createDecipheriv, randomBytes, type CipherKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MAGIC = Buffer.from('AMKEY1');

export interface KeyWrapper {
  wrap(plain: Uint8Array): Uint8Array | Promise<Uint8Array>;
  unwrap(wrapped: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

export interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

function asKey(key: Uint8Array): CipherKey {
  if (key.byteLength !== 32) throw new Error('ApplyMind encryption key has the wrong length.');
  return Buffer.from(key);
}

export function encryptString(key: Uint8Array, plain: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', asKey(key), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptString(key: Uint8Array, sealed: Sealed): string {
  try {
    const decipher = createDecipheriv('aes-256-gcm', asKey(key), Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('ApplyMind could not read an encrypted value. The key or the data is damaged.');
  }
}

export function sealJson(key: Uint8Array, value: unknown): string {
  return JSON.stringify(encryptString(key, JSON.stringify(value)));
}

export function openJson<T>(key: Uint8Array, blob: string): T {
  const sealed = JSON.parse(blob) as Sealed;
  return JSON.parse(decryptString(key, sealed)) as T;
}

/** Wraps a data key with AES-256-GCM. Used by tests. The app uses Windows data protection instead. */
export function aesKeyWrapper(kek: Uint8Array): KeyWrapper {
  return {
    wrap(plain) {
      const sealed = encryptString(kek, Buffer.from(plain).toString('base64'));
      return Buffer.from(JSON.stringify(sealed), 'utf8');
    },
    unwrap(wrapped) {
      const sealed = JSON.parse(Buffer.from(wrapped).toString('utf8')) as Sealed;
      return new Uint8Array(Buffer.from(decryptString(kek, sealed), 'base64'));
    },
  };
}

export async function loadOrCreateDek(path: string, wrapper: KeyWrapper): Promise<Uint8Array> {
  if (existsSync(path)) {
    const buf = readFileSync(path);
    if (buf.length < MAGIC.length + 8 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('ApplyMind key file is not valid.');
    }
    return new Uint8Array(await wrapper.unwrap(new Uint8Array(buf.subarray(MAGIC.length))));
  }
  const dek = new Uint8Array(randomBytes(32));
  const wrapped = new Uint8Array(await wrapper.wrap(dek));
  writeFileSync(path, Buffer.concat([MAGIC, Buffer.from(wrapped)]));
  return dek;
}
