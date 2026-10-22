// Takes over the V1's files, once: `bun run import-v1 [folder of history.json, cache.json and todos.json]`.
import { join, resolve } from 'node:path';
import type { Todo } from '@sd/shared';
import { connect, database, ensureDatabase, migrateDatabase } from '../db/client';
import { readEnv } from '../env';
import { unreadable } from '../files';
import { importV1, type V1Cache, type V1History } from '../v1/import';

const dir = resolve(process.argv[2] ?? resolve(import.meta.dir, '../../../..'));
const read = (name: string) =>
  Bun.file(join(dir, name))
    .json()
    .catch((error) => {
      throw new Error(unreadable(join(dir, name), error));
    });
const [history, cache, items]: [V1History, V1Cache, Todo[] | null] = await Promise.all([
  read('history.json'),
  read('cache.json'),
  read('todos.json').catch(() => null),
]);

const env = readEnv();
await ensureDatabase(env.DATABASE_URL);
const sql = connect(env.DATABASE_URL);
try {
  const db = database(sql);
  await migrateDatabase(db);
  const started = performance.now();
  const report = await importV1(db, history, cache, items);
  console.table(report.tables);
  if (report.unmappedReviewers.length) console.warn(`Reviews ignorées, login GitHub inconnu : ${report.unmappedReviewers.join(', ')}`);

  const expected: Record<string, number> = {
    ...Object.fromEntries(Object.entries(history).map(([section, entries]) => [section, Object.keys(entries ?? {}).length])),
    mergebot: Object.keys(cache.mergebot ?? {}).length,
    runbot: Object.keys(cache.runbot?.bundles ?? {}).length,
  };
  const archived = Object.fromEntries(
    (await sql<{ section: string; total: number }[]>`select section, count(*)::int as total from v1_archive group by section`).map(
      (row) => [row.section, row.total],
    ),
  );
  const gaps = Object.entries(expected).filter(([section, total]) => (archived[section] ?? 0) !== total);
  console.log(
    gaps.length
      ? `Écarts avec la V1 : ${gaps.map(([section, total]) => `${section} ${archived[section] ?? 0}/${total}`).join(', ')}`
      : `Archive V1 complète : ${Object.keys(expected).length} sections, mêmes comptes que les fichiers`,
  );
  console.log(`Import en ${((performance.now() - started) / 1000).toFixed(1)} s`);
} finally {
  await sql.end();
}
