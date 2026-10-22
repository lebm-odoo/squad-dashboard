import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

// postgres.js ignores libpq's ?host=<socket directory>: it is passed as an option instead.
export function connect(url: string, options: { max?: number } = {}) {
  const parsed = new URL(url);
  const socket = parsed.searchParams.get('host');
  parsed.searchParams.delete('host');
  return postgres(parsed.toString(), { onnotice: () => {}, ...options, ...(socket ? { host: socket } : {}) });
}

export const database = (sql: postgres.Sql) => drizzle(sql, { schema, casing: 'snake_case' });

export type Database = ReturnType<typeof database>;

// Running outside Docker, the database is created on first start; in Docker the postgres image creates it.
export async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  target.pathname = '/postgres';
  const admin = connect(target.toString(), { max: 1 });
  try {
    const [found] = await admin`select 1 from pg_database where datname = ${name}`;
    if (!found) await admin`create database ${admin(name)}`;
  } finally {
    await admin.end();
  }
}

export const migrateDatabase = (db: Database) => migrate(db, { migrationsFolder: resolve(import.meta.dir, '../../drizzle') });
