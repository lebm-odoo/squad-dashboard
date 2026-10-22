import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, SecretError } from './secrets';

const passphrase = 'correct horse battery staple';
let path: string;

beforeEach(async () => {
  path = join(await mkdtemp(join(tmpdir(), 'sd-vault-')), 'secrets.vault');
});
afterEach(() => rm(join(path, '..'), { recursive: true, force: true }));

test('a secret survives a lock and an unlock, and never lands in clear on disk', async () => {
  const store = new FileStore(path);
  await store.create(passphrase);
  await store.set('odoo', 'key-1234567890');
  store.lock();
  await expect(store.get('odoo')).rejects.toThrow(SecretError);
  expect(await readFile(path, 'utf8')).not.toContain('key-1234567890');
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  const reopened = new FileStore(path);
  await reopened.unlock(passphrase);
  expect(await reopened.get('odoo')).toBe('key-1234567890');
}, 30_000);

test('a wrong passphrase or an altered vault is refused', async () => {
  const store = new FileStore(path);
  await store.create(passphrase);
  await store.set('odoo', 'key');
  await expect(new FileStore(path).unlock('wrong passphrase!')).rejects.toThrow('incorrecte');
  const vault = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...vault, data: Buffer.from('tampered').toString('base64') }));
  await expect(new FileStore(path).unlock(passphrase)).rejects.toThrow('altéré');
}, 30_000);

test('a short passphrase, or a second vault, is refused', async () => {
  await expect(new FileStore(path).create('short')).rejects.toThrow('12 caractères');
  await new FileStore(path).create(passphrase);
  await expect(new FileStore(path).create(passphrase)).rejects.toThrow('existe déjà');
}, 30_000);

test('a malformed vault is refused before any key derivation', async () => {
  await new FileStore(path).create(passphrase);
  const vault = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...vault, kdf: { N: 2 ** 30, r: 8, p: 1 } }));
  await expect(new FileStore(path).unlock(passphrase)).rejects.toThrow('illisible');
  await writeFile(path, 'not json');
  await expect(new FileStore(path).unlock(passphrase)).rejects.toThrow('illisible');
}, 30_000);
