import { getTableColumns, sql } from 'drizzle-orm';
import { getTableConfig, type PgTable, type PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Database } from './client';

export type Writer = Pick<Database, 'insert'>;

export const toDate = (unix: number) => new Date(unix * 1000);
export const toUnix = (date: Date) => date.getTime() / 1000;

/** Inserts by chunks of 1000 rows: a row whose key exists is kept as it is, or gets the new values of `update`. */
export async function insertRows<T extends PgTable>(
  db: Writer,
  table: T,
  rows: T['$inferInsert'][],
  update: (keyof T['$inferInsert'])[] = [],
) {
  const columns = getTableColumns(table);
  const { primaryKeys } = getTableConfig(table);
  const target = primaryKeys[0]?.columns ?? Object.values(columns).filter((column) => column.primary);
  const set = Object.fromEntries(update.map((key) => [key, sql.raw(`excluded."${columns[key as string]?.name}"`)])) as PgUpdateSetSource<T>;
  for (let i = 0; i < rows.length; i += 1000) {
    const query = db.insert(table).values(rows.slice(i, i + 1000));
    await (update.length ? query.onConflictDoUpdate({ target, set }) : query.onConflictDoNothing());
  }
}
