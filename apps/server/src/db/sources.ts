import { inArray } from 'drizzle-orm';
import type { RunbotBundle } from '../domain/features';
import type { MergebotRecord } from '../sources/web';
import type { Database } from './client';
import { insertRows, toDate, toUnix } from './rows';
import { mergebotPr, runbotBundle } from './schema';

/** Mergebot's page of each PR as the V1 kept it, `repo#number` → the PR, a 404 kept as `missing`. */
export async function loadMergebot(db: Database): Promise<Record<string, MergebotRecord>> {
  const rows = await db.select().from(mergebotPr);
  return Object.fromEntries(
    rows.map((row) => {
      const key = `${row.repo}#${row.number}`;
      const fetched = toUnix(row.fetchedAt);
      if (row.state === 'missing') return [key, { repo: row.repo, number: row.number, state: 'missing', fetched }];
      return [
        key,
        {
          repo: row.repo,
          number: row.number,
          url: `https://github.com/${row.repo}/pull/${row.number}`,
          mergebot_url: `https://mergebot.odoo.com/${row.repo}/pull/${row.number}`,
          state: row.state,
          phase: row.phase ?? '',
          draft: row.draft ?? false,
          blocked: row.blocked ?? false,
          missing_r: row.missingR ?? false,
          title: row.title ?? '',
          created_by: row.createdBy ?? '',
          label: row.label ?? '',
          merged_at: row.mergedAt && toUnix(row.mergedAt),
          merged_by: row.mergedBy,
          ci: (row.ci ?? {}) as Record<string, string>,
          review: row.review,
          linked: (row.linked ?? []) as MergebotRecord['linked'],
          desc_words: row.descWords ?? 0,
          tasks: row.tasks ?? [],
          opws: row.opws ?? [],
          fetched,
        },
      ];
    }),
  );
}

export const saveMergebot = (db: Database, prs: MergebotRecord[]) =>
  insertRows(
    db,
    mergebotPr,
    prs.map((pr) => ({
      repo: pr.repo,
      number: pr.number,
      state: pr.state,
      phase: pr.phase ?? null,
      draft: pr.draft ?? null,
      blocked: pr.blocked ?? null,
      missingR: pr.missing_r ?? null,
      review: pr.review ?? null,
      title: pr.title ?? null,
      createdBy: pr.created_by ?? null,
      label: pr.label ?? null,
      mergedAt: pr.merged_at ? toDate(pr.merged_at) : null,
      mergedBy: pr.merged_by ?? null,
      ci: pr.ci ?? null,
      linked: pr.linked ?? null,
      descWords: pr.desc_words ?? null,
      tasks: pr.tasks ?? null,
      opws: pr.opws ?? null,
      fetchedAt: toDate(pr.fetched),
    })),
    [
      'state',
      'phase',
      'draft',
      'blocked',
      'missingR',
      'review',
      'title',
      'createdBy',
      'label',
      'mergedAt',
      'mergedBy',
      'ci',
      'linked',
      'descWords',
      'tasks',
      'opws',
      'fetchedAt',
    ],
  );

export async function loadRunbot(db: Database): Promise<Record<string, RunbotBundle>> {
  const rows = await db.select().from(runbotBundle);
  return Object.fromEntries(
    rows.map((row) => [
      row.name,
      {
        id: row.bundleId,
        url: row.url,
        branches: row.branches as RunbotBundle['branches'],
        prs: row.prs as RunbotBundle['prs'],
        batches: row.batches as RunbotBundle['batches'],
      },
    ]),
  );
}

/** The bundles read again replace those of the same people: a bundle runbot no longer lists is gone. */
export async function saveRunbot(db: Database, replaced: string[], bundles: Record<string, RunbotBundle>, now: number) {
  await db.transaction(async (tx) => {
    if (replaced.length) await tx.delete(runbotBundle).where(inArray(runbotBundle.name, replaced));
    await insertRows(
      tx,
      runbotBundle,
      Object.entries(bundles).map(([name, bundle]) => ({
        name,
        bundleId: bundle.id,
        url: bundle.url,
        branches: bundle.branches,
        prs: bundle.prs,
        batches: bundle.batches,
        fetchedAt: toDate(now),
      })),
      ['bundleId', 'url', 'branches', 'prs', 'batches', 'fetchedAt'],
    );
  });
}
