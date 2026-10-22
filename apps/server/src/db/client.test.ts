import { describe, expect, test } from 'bun:test';
import { migrateDatabase } from './client';
import { appMeta } from './schema';
import { testDatabaseUrl, withTestDatabase } from './testing';

describe.skipIf(!testDatabaseUrl)('database', () => {
  test(
    'is created, migrated twice without harm, and stores a row',
    () =>
      withTestDatabase(async (db) => {
        await migrateDatabase(db);
        await db.insert(appMeta).values({ key: 'probe', value: { ok: true } });
        expect(await db.select().from(appMeta)).toEqual([expect.objectContaining({ key: 'probe', value: { ok: true } })]);
      }),
    30_000,
  );
});
