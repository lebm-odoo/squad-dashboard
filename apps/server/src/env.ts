import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';

export function readEnv(source: Record<string, string | undefined> = process.env) {
  const root = resolve(import.meta.dir, '../../..');
  return z
    .object({
      HOST: z.string().default('127.0.0.1'),
      PORT: z.coerce.number().int().positive().default(8766),
      DATABASE_URL: z.string().default('postgres:///squad_dashboard?host=/var/run/postgresql'),
      CONFIG_PATH: z.string().default(resolve(root, 'config.json')),
      DATA_DIR: z.string().default(resolve(homedir(), '.local/share/squad-dashboard')),
      WEB_DIR: z.string().default(resolve(root, 'apps/web/build')),
      // The directory holding the odoo, enterprise and upgrade clones: next to this one, as for the V1.
      CLONES_DIR: z.string().default(resolve(root, '..')),
      ALLOWED_HOSTS: z
        .string()
        .default('localhost,127.0.0.1')
        .transform((hosts) =>
          hosts
            .split(',')
            .map((host) => host.trim())
            .filter(Boolean),
        ),
      SECRET_STORE: z.enum(['keyring', 'file']).default('keyring'),
      /** How the server runs, for the page to give the right update command. */
      RUNTIME: z.enum(['bun', 'docker']).default('bun'),
      PUBLIC_URL: z.url().optional(),
    })
    .parse(source);
}

export type Env = ReturnType<typeof readEnv>;
