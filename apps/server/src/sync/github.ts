import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { loadGitInput } from '../db/dashboard-input';
import { loadContributions, loadCursor, saveCursor } from '../db/git';
import {
  loadCursors,
  loadDeducedLogins,
  loadPullRequests,
  loadRplus,
  saveCursors,
  saveDeducedLogins,
  saveFoundReviews,
  savePullRequests,
  saveRplus,
} from '../db/github';
import { archiveEntry } from '../db/schema';
import { loadMergebot, loadRunbot } from '../db/sources';
import { ownerOf } from '../domain/branches';
import { githubLoginSources, memberLogin } from '../domain/logins';
import type { TrailerReview } from '../domain/reviews';
import type { Clone } from '../sources/clones';
import type { Github } from '../sources/github';
import { resolveLogins } from '../sources/github-logins';
import { readPullRequests, readRplus } from '../sources/github-prs';
import { type RequestedPr, readReviewRequests, type SearchCursor, searchReviews, updatedPrs } from '../sources/github-search';

/** One GitHub reading, done in parts the collection calls in its own order: Moi's first, then the squad's. */
export type GithubContext = {
  db: Database;
  gh: Github;
  clones: Clone[];
  /** The people read whole: me, then my squad when it is followed. */
  people: string[];
  me: string;
  lead: string | null;
  forced: Record<string, string>;
  now: number;
  sinceDays: number;
  step?: (label: string) => void;
  /** What the parts left unread, for the status. */
  pending?: { prs: number; rplus: number };
};

const labelBranch = (label: string) => (label.includes(':') ? label.slice(label.indexOf(':') + 1) : label);

/** Each member's login: deduced from the data, read from GitHub for whoever is still unknown, forced by config.json. */
export async function githubLogins(ctx: GithubContext) {
  const { db, gh, clones, now } = ctx;
  const names = new Set(ctx.people);
  ctx.step?.('github : logins');
  const mergebot = await loadMergebot(db);
  const labels = Object.fromEntries(Object.entries(mergebot).map(([key, pr]) => [key, pr.label]));
  const sources = async () =>
    githubLoginSources({
      github: (await loadPullRequests(db)) as Record<string, { author?: string | null }>,
      labels,
      names,
      me: ctx.me,
      viewer: (await loadCursor<string>(db, 'github', 'viewer')) ?? null,
      deduced: await loadDeducedLogins(db),
      forced: ctx.forced,
    });
  const deduced = await loadDeducedLogins(db);
  const missing = ctx.people.filter((member) => !(member in deduced) || (deduced[member] && !memberLogin(member, deduced[member], names)));
  const found = await sources();
  await saveDeducedLogins(db, await resolveLogins(gh, clones, new Set(missing.filter((member) => !found.has(member))), names, now));
  return Object.fromEntries([...(await sources())].map(([member, [login]]) => [member, login]));
}

/** The reviews GitHub asks of the lead (or of oneself): Moi's first part, a few seconds. */
export async function githubRequests(ctx: GithubContext, logins: Record<string, string>) {
  ctx.step?.('github : reviews demandées');
  const asked = logins[ctx.lead ?? ctx.me];
  const previous = await loadCursor<{ v?: number; login?: string; prs?: RequestedPr[]; followed?: RequestedPr[] }>(
    ctx.db,
    'github',
    'requests',
  );
  const kept = previous?.v === 2 && previous.login === asked ? previous : {};
  const requests = asked ? await readReviewRequests(ctx.gh, asked, ctx.now, kept.prs, kept.followed) : null;
  if (requests) await saveCursor(ctx.db, 'github', 'requests', requests);
}

/**
 * The PRs of `people`: of their merged commits, of their runbot bundles, those mergebot knows by their branch, and those
 * they updated; forward-ports left out. Only what changed since the last collection is read: a PR not read yet, one
 * GitHub says was updated since it was read, and a few open ones untouched for a week, the oldest first. When the search
 * for updated PRs fails, every open PR is read again.
 */
export async function githubPrs(ctx: GithubContext, logins: Record<string, string>, people: ReadonlySet<string>) {
  if (!people.size) return;
  const { db, gh, now } = ctx;
  const [mergebot, runbot, known, git, contributions, previous, sweeps] = await Promise.all([
    loadMergebot(db),
    loadRunbot(db),
    loadPullRequests(db),
    loadGitInput(
      db,
      ctx.clones.map(({ repo }) => repo),
      people,
    ),
    loadContributions(db),
    loadCursor<{ at: number }>(db, 'github', 'status'),
    loadCursors<{ at: number }>(db, 'github-sweep'),
  ]);
  const contributed = new Set(
    Object.entries(contributions).flatMap(([key, by]) =>
      by.some((person) => people.has(person)) ? [key.slice(key.indexOf(':') + 1)] : [],
    ),
  );
  const theirs = (branch: string) => (ownerOf(branch, people) || contributed.has(branch)) && !branch.endsWith('-fw');
  const candidates = new Map<string, [number, number]>();
  for (const commit of git.merged) {
    if (!people.has(commit.owner) || commit.fw) continue;
    for (const [slug, number] of commit.closes) candidates.set(`${slug}#${number}`, [1, -commit.ct]);
  }
  for (const [name, bundle] of Object.entries(runbot)) {
    if (!theirs(name)) continue;
    for (const pr of bundle.prs)
      if (!candidates.has(`${pr.repo}#${pr.number}`)) candidates.set(`${pr.repo}#${pr.number}`, [pr.closed ? 1 : 0, -now]);
  }
  for (const [key, pr] of Object.entries(mergebot)) {
    if (pr.state === 'missing') continue;
    const branch = labelBranch(pr.label ?? '');
    if (theirs(branch)) candidates.set(key, [pr.state !== 'open' ? 1 : 0, -(pr.merged_at || now)]);
    else if (branch.endsWith('-fw')) candidates.delete(key);
  }
  // Since each one's last search, which a reading of Moi alone does not move.
  const last = Math.min(...[...people].map((member) => sweeps[member]?.at ?? previous?.at ?? now - 2 * 86400));
  const since = new Date((last - 600) * 1000).toISOString().slice(0, 19);
  const updated = await updatedPrs(
    gh,
    [...people].flatMap((member) => logins[member] ?? []),
    `${since}Z`,
  );
  for (const key of updated?.keys() ?? []) if (!candidates.has(key)) candidates.set(key, [0, -now]);
  const stale = Object.entries(known)
    .filter(
      ([key, pr]) => pr.state === 'OPEN' && candidates.has(key) && now - pr.fetched > 7 * 86400 && !((updated?.get(key) ?? 0) > pr.fetched),
    )
    .sort((a, b) => a[1].fetched - b[1].fetched)
    .slice(0, 50)
    .map(([key]) => key);
  const wanted = [...candidates].flatMap(([key, [closed, merged]]) => {
    const cached = known[key];
    if (!/^odoo\/[\w-]+#\d+$/.test(key)) return [];
    const moved = updated ? (updated.get(key) ?? 0) > (cached?.fetched ?? 0) || stale.includes(key) : cached?.state === 'OPEN';
    return !cached || moved ? [[closed, merged, key] as const] : [];
  });
  wanted.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1));
  ctx.step?.(`github : ${wanted.length} PR`);
  // The diff sizes of force-pushed commits tell a rebase from new code, but GitHub computes each diff and times out on
  // heavy batches: only the PRs open or closed in the last 60 days get them, the older ones keep their pushes unsized.
  const recent = wanted.filter(([closed, merged]) => !closed || -merged >= now - 60 * 86400).map(([, , key]) => key);
  const older = wanted.filter(([closed, merged]) => closed && -merged < now - 60 * 86400).map(([, , key]) => key);
  const first = await readPullRequests(gh, recent, now, { size: 10 });
  const second = await readPullRequests(gh, older, now, { light: true });
  await savePullRequests(db, new Map([...first.read, ...second.read]));
  const viewer = first.viewer ?? second.viewer;
  if (viewer) await saveCursor(db, 'github', 'viewer', viewer);
  if (ctx.pending) ctx.pending.prs += wanted.length - first.read.size - second.read.size;
  if (updated && !gh.stopped) await saveCursors(db, 'github-sweep', Object.fromEntries([...people].map((member) => [member, { at: now }])));
}

/** The reviews `members` submitted on others' PRs; a member searched less than `freshFor` seconds ago is skipped. */
export async function githubMemberReviews(ctx: GithubContext, logins: Record<string, string>, members: string[], freshFor: number) {
  const { db, now } = ctx;
  ctx.step?.('github : reviews de chaque membre');
  const searched = await loadCursors<SearchCursor>(db, 'github-search');
  const start = `${new Date((now - ctx.sinceDays * 86400) * 1000).toISOString().slice(0, 7)}-01`;
  const ordered = [...members].sort((a, b) => (searched[a]?.at ?? 0) - (searched[b]?.at ?? 0));
  const picked = Object.fromEntries(ordered.flatMap((member) => (logins[member] ? [[member, logins[member]]] : [])));
  const search = await searchReviews(ctx.gh, picked, searched, { now, start, freshFor });
  await saveFoundReviews(db, search.found, logins);
  await saveCursors(db, 'github-search', search.cursors);
}

/** The PRs of others the people followed touch: read once, then again while open. */
export async function githubRelatedPrs(ctx: GithubContext, keys: string[]) {
  const known = await loadPullRequests(ctx.db);
  const wanted = keys.filter((key) => !known[key] || known[key].state === 'OPEN');
  if (!wanted.length) return;
  ctx.step?.(`github : ${wanted.length} PR liées`);
  const { read } = await readPullRequests(ctx.gh, wanted, ctx.now, { size: 10 });
  await savePullRequests(ctx.db, read);
  if (ctx.pending) ctx.pending.prs += wanted.length - read.size;
}

/** When each r+ of the window was given: the trailer r+ first, newest first, then the merged PRs, then the older r+. */
export async function githubRplus(ctx: GithubContext) {
  const { db, now } = ctx;
  const names = new Set(ctx.people);
  const [git, archived, stored] = await Promise.all([
    loadGitInput(
      db,
      ctx.clones.map(({ repo }) => repo),
      names,
    ),
    db.select({ data: archiveEntry.data }).from(archiveEntry).where(eq(archiveEntry.section, 'reviews')),
    loadRplus(db),
  ]);
  const newest = <T>(rows: T[], at: (row: T) => number) => [...rows].sort((a, b) => at(b) - at(a));
  // Within the dashboard's window: an older r+ is dated by its merge, as the V1 did past its budget.
  const window = now - ctx.sinceDays * 86400;
  const order = [
    ...newest([...git.reviews, ...archived.map(({ data }) => data as TrailerReview)], (review) => review.t)
      .filter((review) => names.has(review.reviewer) && review.t >= window)
      .map((review) => review.pr),
    ...newest(git.merged, (commit) => commit.ct)
      .filter((commit) => names.has(commit.owner) && commit.ct >= window)
      .flatMap((commit) => commit.closes.map(([slug, number]) => `${slug}#${number}`)),
    ...newest(git.signed, (review) => review.t)
      .filter((review) => review.t >= window)
      .flatMap((review) => review.prs?.slice(0, 1) ?? []),
  ];
  const todo = [...new Set(order)].filter(
    (key) => /^odoo\/[\w-]+#\d+$/.test(key) && (!stored[key] || (stored[key].missing && now - stored[key].at > 7 * 86400)),
  );
  ctx.step?.(`github : r+ de ${todo.length} PR`);
  const rplus = await readRplus(ctx.gh, todo, now);
  await saveRplus(db, rplus);
  if (ctx.pending) ctx.pending.rplus += todo.length - rplus.size;
}

/** Where this reading leaves GitHub: its quota, what it waited, and why it stopped if it did. */
export async function saveGithubStatus(ctx: GithubContext) {
  const { gh } = ctx;
  const status = {
    at: ctx.now,
    calls: gh.calls,
    spent: gh.spent,
    remaining: gh.remaining,
    reset_at: gh.resetAt,
    stopped: gh.stopped,
    timeouts: gh.timeouts,
    waited: Math.round(gh.waited / 1000),
    pending: ctx.pending?.prs ?? 0,
    rplus_pending: ctx.pending?.rplus ?? 0,
  };
  await saveCursor(ctx.db, 'github', 'status', status);
  return status;
}
