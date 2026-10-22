import { sql } from 'drizzle-orm';
import { savePullRequests } from '../db/github';
import { toUnix } from '../db/rows';
import { dashboardFeature, githubPr, odooTask } from '../db/schema';
import { loadMergebot, saveMergebot } from '../db/sources';
import { type PrDetail, readPullRequests, readUpdatedAt } from '../sources/github-prs';
import { type MergebotRecord, readMergebotAll } from '../sources/web';
import type { GithubContext } from './github';
import { leadReviewedPrs } from './web';

/**
 * What waits on my desk, read again only where it moved: my PRs, those the tasks read link to and those the lead reviewed,
 * while open or their ports are. One query asks GitHub when each last changed: a PR that moved is read again on GitHub, and
 * on mergebot too, as is one whose CI was still running, and a few pages an hour old. Says whether the dashboard must be
 * computed again (a new review or push, a PR merged or closed), whether the page only shows newer pages (CI, r+, blocks),
 * and the mergebot pages that could not be read.
 */
export async function syncDesk(ctx: GithubContext, fetcher = fetch) {
  const { db, gh, me, lead, now } = ctx;
  ctx.step?.('bureau : PR qui ont bougé');
  const [mine, tasks, reviewed, mergebot, known] = await Promise.all([
    db
      .select({ data: dashboardFeature.data })
      .from(dashboardFeature)
      .where(sql`${dashboardFeature.owner} = ${me} or ${dashboardFeature.data}->'contributors' ? ${me}`),
    db.select({ data: odooTask.data }).from(odooTask),
    leadReviewedPrs(db, lead, now),
    loadMergebot(db),
    db.select({ repo: githubPr.repo, number: githubPr.number, fetchedAt: githubPr.fetchedAt }).from(githubPr),
  ]);
  const read = new Map(known.flatMap(({ repo, number, fetchedAt }) => (fetchedAt ? [[`${repo}#${number}`, toUnix(fetchedAt)]] : [])));
  const live = [
    ...new Set([
      ...mine.flatMap(({ data }) => (data as { prs: { repo: string; number: number }[] }).prs.map((pr) => `${pr.repo}#${pr.number}`)),
      ...tasks.flatMap(({ data }) => (data as { links?: { prs?: string[] } } | null)?.links?.prs ?? []),
      ...reviewed,
    ]),
  ].filter((key) => {
    const pr = mergebot[key];
    return (
      /^odoo\/[\w-]+#\d+$/.test(key) &&
      (!pr || pr.state === 'open' || (pr.state === 'merged' && !!pr.linked?.some((link) => link.state === 'open')))
    );
  });
  const updated = await readUpdatedAt(gh, live);
  const moved = (key: string, since: number) => (updated?.get(key)?.at ?? 0) > since;
  const details = await readPullRequests(
    gh,
    live.filter((key) => moved(key, read.get(key) ?? 0)),
    now,
    { size: 10 },
  );
  await savePullRequests(db, details.read);
  // A comment alone changes nothing the dashboard computes: a review, a push or the end of the PR does.
  const reshaped = [...details.read].some(([key, pr]) => {
    if (pr.state === 'MISSING') return false;
    const { state, reviews, force_pushes, ready_at } = pr as PrDetail;
    const since = read.get(key) ?? 0;
    return (
      state !== 'OPEN' ||
      [...reviews.map((review) => review.at), ...force_pushes.map((push) => push.at), ...ready_at].some((at) => at > since)
    );
  });
  const due = live.filter((key) => {
    const pr = mergebot[key];
    return !pr || moved(key, pr.fetched) || Object.values(pr.ci ?? {}).includes('pending');
  });
  // The pages an hour old, eight at a time: a collection read them all at once, they would all come due together.
  const old = live
    .filter((key) => !due.includes(key) && now - (mergebot[key]?.fetched ?? 0) > 3600)
    .sort((a, b) => (mergebot[a]?.fetched ?? 0) - (mergebot[b]?.fetched ?? 0))
    .slice(0, 8);
  const pages = [...due, ...old];
  ctx.step?.(`mergebot : ${pages.length} PR du bureau`);
  const { read: records, errors } = await readMergebotAll(pages, mergebot, now, fetcher);
  const fresh = records.filter((record) => record !== mergebot[`${record.repo}#${record.number}`]);
  await saveMergebot(db, fresh);
  const signature = (pr: MergebotRecord | undefined) =>
    JSON.stringify([
      pr?.state,
      pr?.phase,
      pr?.blocked,
      pr?.missing_r,
      pr?.review,
      pr?.merged_at,
      Object.entries(pr?.ci ?? {}).sort(),
      (pr?.linked ?? []).map((link) => [link.repo, link.number, link.state]),
    ]);
  const before = (record: MergebotRecord) => mergebot[`${record.repo}#${record.number}`];
  const ended = fresh.some((record) => record.state !== before(record)?.state || record.merged_at !== before(record)?.merged_at);
  const shown = fresh.some((record) => signature(record) !== signature(before(record)));
  return { recompute: reshaped || ended, refresh: reshaped || shown, errors };
}
