import { and, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { loadGitInput } from '../db/dashboard-input';
import { loadContributions, loadCursor, saveCursor } from '../db/git';
import { dashboardReview, odooTask } from '../db/schema';
import { loadMergebot, loadRunbot, saveMergebot, saveRunbot } from '../db/sources';
import { ownerOf } from '../domain/branches';
import { answered } from '../domain/reviews';
import type { Clone } from '../sources/clones';
import type { RequestedPr } from '../sources/github-search';
import { type MergebotRecord, readMergebotAll, readRunbot } from '../sources/web';

const labelBranch = (label = '') => (label.includes(':') ? label.slice(label.indexOf(':') + 1) : label);

/**
 * The PRs the lead reviewed in the last 91 days, of others too: their merge, ports and tasks fill Moi's review column. With
 * the reviews asked of the lead they gave the r+ to, which Moi follows until merged and ported.
 */
export async function leadReviewedPrs(db: Database, lead: string | null, now: number) {
  if (!lead) return [];
  const [rows, requests] = await Promise.all([
    db
      .selectDistinct({ pr: sql<string>`${dashboardReview.data}->>'pr'` })
      .from(dashboardReview)
      .where(and(eq(dashboardReview.reviewer, lead), gte(dashboardReview.at, new Date((now - 91 * 86400) * 1000)))),
    loadCursor<{ login: string; prs?: RequestedPr[]; followed?: RequestedPr[] }>(db, 'github', 'requests'),
  ]);
  return [
    ...rows.flatMap(({ pr }) => (pr.includes('#') ? [pr] : [])),
    ...[...(requests?.prs ?? []).filter((pr) => answered(pr, requests?.login ?? '')), ...(requests?.followed ?? [])].map((pr) => pr.pr),
  ];
}

/**
 * Reads runbot and mergebot into the database. Runbot is searched for the people followed, four searches at a time. Mergebot,
 * for its forward-port tables, its blocks and its r+: the PRs of their bundles and merged commits, the ones the lead reviewed,
 * those their open tasks link to and the related ones, then the PRs linked to those, two pages at a time; GitHub tells the
 * rest.
 */
export async function syncWeb(
  db: Database,
  clones: Clone[],
  {
    followed,
    lead = null,
    related = new Set<string>(),
    now,
    fetcher = fetch,
    step = () => {},
  }: {
    followed: ReadonlySet<string>;
    lead?: string | null;
    /** The PRs of others the people followed touch. */
    related?: ReadonlySet<string>;
    now: number;
    fetcher?: typeof fetch;
    step?: (label: string) => void;
  },
) {
  const searched = [...followed].sort();
  const contributions = await loadContributions(db);
  const contributed = Object.entries(contributions).flatMap(([key, by]) =>
    by.some((person) => followed.has(person)) ? [key.slice(key.indexOf(':') + 1)] : [],
  );

  const status: Record<string, unknown> = { at: now };
  step(`runbot : ${searched.length} personnes`);
  try {
    const bundles = await readRunbot(searched, contributed, followed, fetcher);
    const known = Object.keys(await loadRunbot(db));
    const replaced = known.filter((name) => searched.includes(ownerOf(name, followed) ?? '') || contributed.includes(name));
    await saveRunbot(db, replaced, bundles, now);
    Object.assign(status, { runbot_at: now, runbot_error: null, runbot_searched: searched.length });
  } catch (error) {
    status.runbot_error = (error as Error).message;
  }

  const [runbot, mergebot, reviewed, tasks, git] = await Promise.all([
    loadRunbot(db),
    loadMergebot(db),
    leadReviewedPrs(db, lead, now),
    db.select({ data: odooTask.data }).from(odooTask),
    loadGitInput(
      db,
      clones.map(({ repo }) => repo),
      followed,
    ),
  ]);
  const theirs = (name: string) => ownerOf(name, followed) || contributed.includes(name);
  const targets = new Set([
    ...Object.entries(runbot).flatMap(([name, bundle]) => (theirs(name) ? bundle.prs.map((pr) => `${pr.repo}#${pr.number}`) : [])),
    ...git.merged
      .filter((commit) => followed.has(commit.owner))
      .flatMap((commit) => commit.closes.map(([slug, number]) => `${slug}#${number}`)),
    ...reviewed,
    ...tasks.flatMap(({ data }) => (data as { links?: { prs?: string[] } } | null)?.links?.prs ?? []),
    ...related,
  ]);
  step(`mergebot : ${targets.size} PR`);
  const fresh = (records: MergebotRecord[]) => records.filter((record) => record !== mergebot[`${record.repo}#${record.number}`]);
  const first = await readMergebotAll([...targets], mergebot, now, fetcher);
  await saveMergebot(db, fresh(first.read));
  const linked = new Set(
    first.read
      .filter((pr) => ownerOf(labelBranch(pr.label), followed) || related.has(`${pr.repo}#${pr.number}`))
      .flatMap((pr) => (pr.linked ?? []).map((link) => `${link.repo}#${link.number}`))
      .filter((key) => !targets.has(key)),
  );
  const second = await readMergebotAll([...linked], mergebot, now, fetcher);
  await saveMergebot(db, fresh(second.read));
  const errors = [...first.errors, ...second.errors];
  status.mergebot_error = errors.length ? `${errors.length} erreur(s), ex. ${errors[0]}` : null;
  await saveCursor(db, 'web', 'status', status);
  return status;
}
