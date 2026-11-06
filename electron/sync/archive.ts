import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto';
import { gunzip as gunzipCb, gzip as gzipCb, type ZlibOptions } from 'node:zlib';

/**
 * The .applyflow container.
 *
 *   "APPLYFLW" | version (1 byte) | flags (1 byte) | [encrypted: log2 N (1) | salt (16) | iv (12)] | body | [encrypted: GCM tag (16)]
 *
 * The body is a gzip stream of entries: u16 name length | name | u64 data length | data.
 * Entries are manifest.json, data.json and files/<sha256>. When encrypted, the body is AES-256-GCM with a key derived
 * from the password by scrypt; the header is authenticated too, so any change to the file is detected.
 */

const MAGIC = Buffer.from('APPLYFLW', 'ascii');
const CONTAINER_VERSION = 1;
const FLAG_ENCRYPTED = 1;
const DEFAULT_LOG_N = 15;
const SALT = 16;
const IV = 12;
const TAG = 16;
/** Largest export ApplyFlow will create or open, before and after decompression. */
export const MAX_ARCHIVE_BYTES = 1536 * 1024 * 1024;
const MAX_ENTRIES = 200_000;
const ENTRY_NAME = /^(manifest\.json|data\.json|files\/[0-9a-f]{64})$/;

export const FORMAT_ID = 'applyflow-sync';
export const FORMAT_VERSION = 1;

export type ArchiveErrorCode = 'not-applyflow' | 'unsupported' | 'password-required' | 'bad-password' | 'corrupt' | 'too-large';

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export interface ArchiveEntry {
  name: string;
  data: Buffer;
}

const gzip = (b: Buffer, o: ZlibOptions) => new Promise<Buffer>((res, rej) => gzipCb(b, o, (e, out) => (e ? rej(e) : res(out))));
const gunzip = (b: Buffer, o: ZlibOptions) => new Promise<Buffer>((res, rej) => gunzipCb(b, o, (e, out) => (e ? rej(e) : res(out))));
const scrypt = (pw: string, salt: Buffer, o: ScryptOptions) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw.normalize('NFC'), salt, 32, o, (e, k) => (e ? rej(e) : res(k))));
const kdf = (pw: string, salt: Buffer, logN: number) => scrypt(pw, salt, { N: 2 ** logN, r: 8, p: 1, maxmem: 512 * 1024 * 1024 });

export const sha256 = (b: Buffer | Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

export function isApplyFlowArchive(buf: Buffer): boolean {
  return buf.length >= MAGIC.length + 2 && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function isEncryptedArchive(buf: Buffer): boolean {
  return isApplyFlowArchive(buf) && (buf[MAGIC.length + 1]! & FLAG_ENCRYPTED) !== 0;
}

function encodeEntries(entries: ArchiveEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    if (!ENTRY_NAME.test(e.name)) throw new ArchiveError('corrupt', `Invalid entry name ${e.name}.`);
    const name = Buffer.from(e.name, 'utf8');
    const head = Buffer.alloc(2 + name.length + 8);
    head.writeUInt16BE(name.length, 0);
    name.copy(head, 2);
    head.writeBigUInt64BE(BigInt(e.data.length), 2 + name.length);
    parts.push(head, e.data);
  }
  return Buffer.concat(parts);
}

function decodeEntries(buf: Buffer): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  const seen = new Set<string>();
  let at = 0;
  while (at < buf.length) {
    if (out.length >= MAX_ENTRIES) throw new ArchiveError('too-large', 'The file has too many entries.');
    if (at + 2 > buf.length) throw new ArchiveError('corrupt', 'The file is truncated.');
    const nameLen = buf.readUInt16BE(at);
    at += 2;
    if (nameLen === 0 || nameLen > 200 || at + nameLen + 8 > buf.length) throw new ArchiveError('corrupt', 'The file is damaged (bad entry header).');
    const name = buf.subarray(at, at + nameLen).toString('utf8');
    at += nameLen;
    const len = buf.readBigUInt64BE(at);
    at += 8;
    if (len > BigInt(buf.length - at)) throw new ArchiveError('corrupt', 'The file is truncated.');
    if (!ENTRY_NAME.test(name)) throw new ArchiveError('corrupt', `The file contains an unexpected entry (${name.slice(0, 60)}).`);
    if (seen.has(name)) throw new ArchiveError('corrupt', `The file contains ${name} twice.`);
    seen.add(name);
    const n = Number(len);
    out.push({ name, data: buf.subarray(at, at + n) });
    at += n;
  }
  return out;
}

export async function packArchive(entries: ArchiveEntry[], password?: string | null): Promise<Buffer> {
  const plain = encodeEntries(entries);
  if (plain.length > MAX_ARCHIVE_BYTES) throw new ArchiveError('too-large', 'There is too much data to export into one file.');
  const body = await gzip(plain, { level: 6 });
  if (!password) return Buffer.concat([MAGIC, Buffer.from([CONTAINER_VERSION, 0]), body]);
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const header = Buffer.concat([MAGIC, Buffer.from([CONTAINER_VERSION, FLAG_ENCRYPTED, DEFAULT_LOG_N]), salt, iv]);
  const key = await kdf(password, salt, DEFAULT_LOG_N);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const enc = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([header, enc, cipher.getAuthTag()]);
}

export async function unpackArchive(buf: Buffer, password?: string | null): Promise<ArchiveEntry[]> {
  if (!isApplyFlowArchive(buf)) throw new ArchiveError('not-applyflow', 'This is not an ApplyFlow data file.');
  if (buf.length > MAX_ARCHIVE_BYTES) throw new ArchiveError('too-large', 'The file is larger than ApplyFlow can import.');
  const version = buf[MAGIC.length]!;
  const flags = buf[MAGIC.length + 1]!;
  if (version !== CONTAINER_VERSION || (flags & ~FLAG_ENCRYPTED) !== 0) {
    throw new ArchiveError('unsupported', 'This file was made by a newer version of ApplyFlow. Update ApplyFlow on this computer and try again.');
  }
  let body: Buffer;
  if (flags & FLAG_ENCRYPTED) {
    if (!password) throw new ArchiveError('password-required', 'This file is protected with a password.');
    const at = MAGIC.length + 2;
    if (buf.length < at + 1 + SALT + IV + TAG) throw new ArchiveError('corrupt', 'The file is truncated.');
    const logN = buf[at]!;
    if (logN < 14 || logN > 20) throw new ArchiveError('corrupt', 'The file is damaged (bad key settings).');
    const salt = buf.subarray(at + 1, at + 1 + SALT);
    const iv = buf.subarray(at + 1 + SALT, at + 1 + SALT + IV);
    const header = buf.subarray(0, at + 1 + SALT + IV);
    const tag = buf.subarray(buf.length - TAG);
    const enc = buf.subarray(header.length, buf.length - TAG);
    const key = await kdf(password, salt, logN);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    try {
      body = Buffer.concat([decipher.update(enc), decipher.final()]);
    } catch {
      throw new ArchiveError('bad-password', 'That password does not open this file, or the file was changed after it was exported.');
    }
  } else {
    body = buf.subarray(MAGIC.length + 2);
  }
  let plain: Buffer;
  try {
    plain = await gunzip(body, { maxOutputLength: MAX_ARCHIVE_BYTES });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ERR_BUFFER_TOO_LARGE' || /larger than|too large/i.test(String((e as Error).message))) {
      throw new ArchiveError('too-large', 'The file expands to more data than ApplyFlow can import.');
    }
    throw new ArchiveError('corrupt', 'The file is damaged and cannot be read.');
  }
  return decodeEntries(plain);
}

export interface ArchiveManifest {
  format: typeof FORMAT_ID;
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  exportedAt: string;
  device: { id: string; name: string; platform: string };
  counts: Record<string, number>;
  dataSha256: string;
  files: { sha256: string; size: number }[];
}

export interface OpenedArchive {
  manifest: ArchiveManifest;
  data: unknown;
  files: Map<string, Buffer>;
}

export async function writeBundle(manifest: Omit<ArchiveManifest, 'dataSha256' | 'files'>, data: unknown, files: Map<string, Buffer>, password?: string | null): Promise<Buffer> {
  const dataBuf = Buffer.from(JSON.stringify(data), 'utf8');
  const full: ArchiveManifest = {
    ...manifest,
    dataSha256: sha256(dataBuf),
    files: [...files.entries()].map(([sha, b]) => ({ sha256: sha, size: b.length })),
  };
  const entries: ArchiveEntry[] = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(full, null, 2), 'utf8') },
    { name: 'data.json', data: dataBuf },
    ...[...files.entries()].map(([sha, b]) => ({ name: `files/${sha}`, data: b })),
  ];
  return packArchive(entries, password);
}

/** Opens a bundle and verifies every checksum before anything is trusted. */
export async function readBundle(buf: Buffer, password?: string | null): Promise<OpenedArchive> {
  const entries = await unpackArchive(buf, password);
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const mBuf = byName.get('manifest.json');
  const dBuf = byName.get('data.json');
  if (!mBuf || !dBuf) throw new ArchiveError('corrupt', 'The file is missing its contents list.');
  let manifest: ArchiveManifest;
  try {
    manifest = JSON.parse(mBuf.toString('utf8')) as ArchiveManifest;
  } catch {
    throw new ArchiveError('corrupt', 'The file’s contents list is damaged.');
  }
  if (manifest?.format !== FORMAT_ID) throw new ArchiveError('not-applyflow', 'This is not an ApplyFlow data file.');
  if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > FORMAT_VERSION) {
    throw new ArchiveError('unsupported', `This file was made by ApplyFlow ${String(manifest.appVersion ?? '(newer)')}, which uses a newer data format. Update ApplyFlow on this computer and try again.`);
  }
  if (sha256(dBuf) !== manifest.dataSha256) throw new ArchiveError('corrupt', 'The file’s data does not match its checksum. It may be damaged or incomplete.');
  const files = new Map<string, Buffer>();
  const listed = Array.isArray(manifest.files) ? manifest.files : [];
  for (const f of listed) {
    const b = byName.get(`files/${f.sha256}`);
    if (!b) throw new ArchiveError('corrupt', 'A document listed in the file is missing.');
    if (b.length !== f.size || sha256(b) !== f.sha256) throw new ArchiveError('corrupt', 'A document in the file does not match its checksum. The file may be damaged.');
    files.set(f.sha256, b);
  }
  let data: unknown;
  try {
    data = JSON.parse(dBuf.toString('utf8'));
  } catch {
    throw new ArchiveError('corrupt', 'The file’s data is damaged.');
  }
  return { manifest, data, files };
}
