import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { DashboardStore, FeatureQuery, FeatureSummary, ReviewQuery } from '../api/store';
import type { Feature } from '../domain/features';
import type { Database } from './client';
import { dashboardFeature, dashboardPart, dashboardReview, odooTask, syncCursor } from './schema';
import { loadMergebot } from './sources';

const field = (name: string) => sql.raw(`(data->>'${name}')`);

/** One part of the dashboard as last computed, and when. */
export async function loadPart<T>(db: Database, name: string) {
  const [row] = await db.select().from(dashboardPart).where(eq(dashboardPart.part, name));
  return row ? { data: row.data as T, computedAt: row.computedAt.getTime() / 1000 } : null;
}

/** The dashboard as the last collection computed it, read by parts: the page asks for what it shows. */
export function dashboardStore(db: Database): DashboardStore {
  return {
    async features(query: FeatureQuery) {
      const where: SQL[] = [];
      if (query.owner?.length) where.push(inArray(dashboardFeature.owner, query.owner));
      if (query.person?.length) {
        where.push(sql`(${inArray(dashboardFeature.owner, query.person)} or (data->'contributors') ?| ${sql.param(query.person)}::text[])`);
      }
      if (query.kind?.length) where.push(sql`${field('kind')} in ${query.kind}`);
      if (query.status?.length) where.push(sql`${field('status')} in ${query.status}`);
      if (query.archived !== undefined) where.push(eq(dashboardFeature.archived, query.archived));
      if (query.q) where.push(sql`(${dashboardFeature.name} ilike ${`%${query.q}%`} or ${field('title')} ilike ${`%${query.q}%`})`);
      if (query.since !== undefined) where.push(sql`${field('last_at')}::float8 >= ${query.since}`);
      if (query.until !== undefined) where.push(sql`${field('last_at')}::float8 < ${query.until}`);
      const filter = where.length ? and(...where) : undefined;
      const key = query.sort === 'name' ? dashboardFeature.name : sql`${field(query.sort)}::float8`;
      const [rows, [counted]] = await Promise.all([
        db
          .select({
            data: sql<FeatureSummary>`(data - 'prs' - 'commits' - 'pushes' - 'runbot' - 'gh' - 'complexity_factors' - 'branches')
              || jsonb_build_object('pr_count', jsonb_array_length(coalesce(data->'prs', '[]'::jsonb)))`,
          })
          .from(dashboardFeature)
          .where(filter)
          .orderBy(query.order === 'asc' ? sql`${key} asc nulls first` : sql`${key} desc nulls last`, asc(dashboardFeature.name))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ total: sql<number>`count(*)::int` }).from(dashboardFeature).where(filter),
      ]);
      return { total: counted?.total ?? 0, items: rows.map((row) => row.data) };
    },

    async feature(name: string) {
      const [row] = await db.select({ data: dashboardFeature.data }).from(dashboardFeature).where(eq(dashboardFeature.name, name));
      return (row?.data as Feature | undefined) ?? null;
    },

    async reviews(query: ReviewQuery) {
      const where: SQL[] = [];
      if (query.reviewer?.length) where.push(inArray(dashboardReview.reviewer, query.reviewer));
      if (query.author?.length) where.push(sql`${field('author')} in ${query.author}`);
      if (query.since !== undefined) where.push(sql`${dashboardReview.at} >= to_timestamp(${query.since})`);
      if (query.until !== undefined) where.push(sql`${dashboardReview.at} < to_timestamp(${query.until})`);
      const filter = where.length ? and(...where) : undefined;
      const [rows, [counted]] = await Promise.all([
        db
          .select({ data: dashboardReview.data })
          .from(dashboardReview)
          .where(filter)
          .orderBy(desc(dashboardReview.at), asc(dashboardReview.id))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ total: sql<number>`count(*)::int` }).from(dashboardReview).where(filter),
      ]);
      return { total: counted?.total ?? 0, items: rows.map((row) => row.data as Record<string, unknown>) };
    },

    part: <T>(name: string) => loadPart<T>(db, name),

    async cursor<T>(source: string, key: string) {
      const [row] = await db
        .select({ value: syncCursor.value })
        .from(syncCursor)
        .where(and(eq(syncCursor.source, source), eq(syncCursor.key, key)));
      return (row?.value as T | undefined) ?? null;
    },

    /** Where each source stands: its last collection, its errors, the quota left. */
    async sources() {
      const rows = await db
        .select({ source: syncCursor.source, key: syncCursor.key, value: syncCursor.value, at: syncCursor.updatedAt })
        .from(syncCursor)
        .where(inArray(syncCursor.source, ['collect', 'web', 'github', 'odoo', 'fetch', 'git']));
      const status = (source: string, key: string) => rows.find((row) => row.source === source && row.key === key)?.value ?? null;
      const git = rows
        .filter((row) => row.source === 'git')
        .map((row) => {
          const { fetchedAt, since } = row.value as { fetchedAt: number | null; since: number };
          return [row.key, { fetched_at: fetchedAt, since, read_at: row.at.getTime() / 1000 }];
        });
      return {
        collect: status('collect', 'last'),
        git: Object.fromEntries(git),
        web: status('web', 'status'),
        github: status('github', 'status'),
        odoo: status('odoo', 'status'),
      };
    },

    /** When each version branch left master, read from the odoo clone. */
    async versionForks() {
      const [row] = await db
        .select({ value: syncCursor.value })
        .from(syncCursor)
        .where(and(eq(syncCursor.source, 'git'), eq(syncCursor.key, 'odoo')));
      return (row?.value as { forks?: Record<string, number> } | undefined)?.forks ?? {};
    },

    async featuresOf(people: string[]) {
      const rows = await db
        .select({ data: dashboardFeature.data })
        .from(dashboardFeature)
        .where(sql`${inArray(dashboardFeature.owner, people)} or (data->'contributors') ?| ${sql.param(people)}::text[]`);
      return rows.map((row) => row.data as Feature);
    },

    async featuresLinked(prs: string[], names: string[]) {
      if (!prs.length && !names.length) return [];
      const found = await db
        .select({ data: dashboardFeature.data })
        .from(dashboardFeature)
        .where(
          sql`${dashboardFeature.name} = any(${sql.param(names)}::text[]) or exists (select 1 from jsonb_array_elements(${dashboardFeature.data}->'prs') p
            where (p->>'repo') || '#' || (p->>'number') = any(${sql.param(prs)}::text[]))`,
        );
      const features = found.map((row) => row.data as Feature);
      const linked = features.map((f) => f.name);
      const ported = features.flatMap((f) => (f.port_of ? [f.port_of] : []));
      const ports = await db
        .select({ data: dashboardFeature.data })
        .from(dashboardFeature)
        .where(
          sql`(data->>'fw_of') = any(${sql.param(linked)}::text[]) or (data->>'port_of') = any(${sql.param(linked)}::text[])
            or ${dashboardFeature.name} = any(${sql.param(ported)}::text[])`,
        );
      return [...features, ...ports.map((row) => row.data as Feature)];
    },

    async reviewsOf(people: string[]) {
      const rows = await db
        .select({ data: dashboardReview.data })
        .from(dashboardReview)
        .where(inArray(dashboardReview.reviewer, people))
        .orderBy(desc(dashboardReview.at));
      return rows.map((row) => row.data as Record<string, unknown>);
    },

    async mergebot(keys: string[]) {
      const records = await loadMergebot(db);
      return Object.fromEntries(keys.flatMap((key) => (records[key] && records[key].state !== 'missing' ? [[key, records[key]]] : [])));
    },

    async odoo() {
      const [rows, status] = await Promise.all([
        db.select({ id: odooTask.id, data: odooTask.data }).from(odooTask).where(sql`${odooTask.data} is not null`),
        this.cursor<{ at: number; stages: Record<string, unknown>; not_found: string[] }>('odoo', 'status'),
      ]);
      return {
        tasks: Object.fromEntries(rows.map((row) => [row.id, row.data])),
        stages: status?.stages ?? {},
        at: status?.at ?? null,
        not_found: status?.not_found ?? [],
      };
    },

    async tasks(people: string[]) {
      const rows = await db
        .select({ data: odooTask.data })
        .from(odooTask)
        .where(people.length ? sql`(${odooTask.data}->'people') ?| ${sql.param(people)}::text[]` : sql`${odooTask.data} is not null`);
      return rows.map((row) => row.data as Record<string, unknown>);
    },
  };
}
