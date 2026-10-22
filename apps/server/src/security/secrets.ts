import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { derive, kdfParams, newKdf, seal, sealedBox, unseal } from './crypto';

export class SecretError extends Error {}

export type SecretStatus = { kind: 'keyring' | 'file'; exists: boolean; locked: boolean };

export interface SecretStore {
  status(): Promise<SecretStatus>;
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

const vaultFile = sealedBox.extend({ version: z.literal(1), kdf: kdfParams, salt: z.base64() });

// For Docker, which has no keyring: one file, AES-256-GCM, its key derived from a passphrase by scrypt and kept in memory only.
export class FileStore implements SecretStore {
  #key: Buffer | null = null;
  #salt = Buffer.alloc(0);
  #kdf = newKdf();
  #entries: Record<string, string> = {};

  constructor(readonly path: string) {}

  async status(): Promise<SecretStatus> {
    return { kind: 'file', exists: await this.#exists(), locked: this.#key === null };
  }

  async create(passphrase: string) {
    if (await this.#exists()) throw new SecretError('un coffre existe déjà');
    if (passphrase.length < 12) throw new SecretError('la phrase de passe compte au moins 12 caractères');
    this.#salt = randomBytes(16);
    this.#key = await derive(passphrase, this.#salt, this.#kdf);
    this.#entries = {};
    await this.#write(this.#key);
  }

  async unlock(passphrase: string) {
    const raw = await readFile(this.path, 'utf8').catch(() => {
      throw new SecretError('aucun coffre : en créer un');
    });
    let vault: z.infer<typeof vaultFile>;
    try {
      vault = vaultFile.parse(JSON.parse(raw));
    } catch {
      throw new SecretError('coffre illisible ou altéré');
    }
    const salt = Buffer.from(vault.salt, 'base64');
    const key = await derive(passphrase, salt, vault.kdf);
    try {
      this.#entries = JSON.parse(unseal(key, vault, 'secrets-vault').toString('utf8'));
    } catch {
      throw new SecretError('phrase de passe incorrecte, ou coffre altéré');
    }
    this.#key = key;
    this.#salt = salt;
    this.#kdf = vault.kdf;
  }

  lock() {
    this.#key?.fill(0);
    this.#key = null;
    this.#entries = {};
  }

  async get(name: string) {
    this.#unlocked();
    return this.#entries[name] ?? null;
  }

  async set(name: string, value: string) {
    const key = this.#unlocked();
    this.#entries[name] = value;
    await this.#write(key);
  }

  async delete(name: string) {
    const key = this.#unlocked();
    delete this.#entries[name];
    await this.#write(key);
  }

  #exists() {
    return access(this.path).then(
      () => true,
      () => false,
    );
  }

  #unlocked() {
    if (!this.#key) throw new SecretError('coffre verrouillé');
    return this.#key;
  }

  async #write(key: Buffer) {
    const box = seal(key, Buffer.from(JSON.stringify(this.#entries)), 'secrets-vault');
    const vault = { version: 1, kdf: this.#kdf, salt: this.#salt.toString('base64'), ...box };
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, JSON.stringify(vault), { mode: 0o600 });
    await chmod(this.path, 0o600);
  }
}
