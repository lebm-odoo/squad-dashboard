import type postgres from 'postgres';
import { connect, type Database, database, ensureDatabase, migrateDatabase } from './client';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let created = 0;

/** Runs `run` on a database of its own, migrated, dropped afterwards. */
export async function withTestDatabase(run: (db: Database, sql: postgres.Sql) => Promise<void>, server = testDatabaseUrl ?? '') {
  const target = new URL(server);
  const name = `sd_test_${process.pid}_${created++}`;
  target.pathname = `/${name}`;
  await ensureDatabase(target.toString());
  const sql = connect(target.toString());
  try {
    const db = database(sql);
    await migrateDatabase(db);
    await run(db, sql);
  } finally {
    await sql.end();
    target.pathname = '/postgres';
    const dropper = connect(target.toString());
    await dropper`drop database if exists ${dropper(name)}`;
    await dropper.end();
  }
}
