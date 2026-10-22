import { ownerOf } from '../domain/branches';
import { recordedMechanics, versionRows } from '../domain/commits';
import type { DashboardInput } from '../domain/dashboard';
import type { BranchRecord, MergebotPr } from '../domain/features';
import type { SearchCursor } from '../sources/github-search';
import type { GitCursor } from '../sync/git';
import type { Database } from './client';
import { loadBranches, loadCommits, loadContributions, loadCursor, loadMechanics } from './git';
import { loadCursors, loadDeducedLogins, loadGithubAsMergebot, loadMemberReviews, loadPullRequests, loadRplus } from './github';
import { archiveEntry } from './schema';
import { loadMergebot, loadRunbot } from './sources';

/** What the dashboard reads from the clones, from the database: rows of the version branches, branches of the people shown. */
export async function loadGitInput(db: Database, repos: string[], names: ReadonlySet<string>) {
  const [commits, mechanics, branches, contributions, cursors] = await Promise.all([
    loadCommits(db),
    loadMechanics(db),
    loadBranches(db),
    loadContributions(db),
    Promise.all(repos.map((repo) => loadCursor<GitCursor>(db, 'git', repo))),
  ]);
  const ruleFiles = Object.fromEntries(repos.map((repo, i) => [repo, new Set(cursors[i]?.rules ?? [])]));
  const weighing = { ruleFiles, mechanics: recordedMechanics(mechanics, ruleFiles) };
  const histories = repos.map((repo, i) => ({ repo, commits: commits.get(repo) ?? [], windows: cursors[i]?.windows ?? [] }));
  const shown: Record<string, Record<string, BranchRecord>> = {};
  for (const [key, record] of Object.entries(branches)) {
    const [repo, branch] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (ownerOf(branch, names) || key in contributions) shown[branch] = { ...shown[branch], [repo]: record };
  }
  const fetched = cursors.flatMap((cursor) => cursor?.fetchedAt ?? []);
  return {
    ...versionRows(histories, names),
    ...weighing,
    branches: shown,
    versionForks: cursors[repos.indexOf('odoo')]?.forks ?? {},
    lastFetch: fetched.length ? Math.min(...fetched) : 0,
  };
}

/** Everything the dashboard is computed from, as the collections left it in the database. */
export async function loadDashboardInput(
  db: Database,
  options: {
    repos: string[];
    names: ReadonlySet<string>;
    squad: ReadonlySet<string>;
    related: string[];
    me: string;
    forced: Record<string, string>;
    now: number;
    sinceDays: number;
  },
): Promise<DashboardInput> {
  const { repos, names } = options;
  const [git, mergebot, runbot, pulls, github, searched, rplus, deduced, viewer, requests, kept] = await Promise.all([
    loadGitInput(db, repos, names),
    loadMergebot(db),
    loadRunbot(db),
    loadPullRequests(db),
    loadGithubAsMergebot(db),
    loadCursors<SearchCursor>(db, 'github-search'),
    loadRplus(db),
    loadDeducedLogins(db),
    loadCursor<string>(db, 'github', 'viewer'),
    loadCursor<DashboardInput['requests']>(db, 'github', 'requests'),
    db.select().from(archiveEntry),
  ]);
  const archive = (section: string) =>
    Object.fromEntries(kept.filter((entry) => entry.section === section).map((entry) => [entry.key, entry.data]));
  return {
    now: options.now,
    sinceDays: options.sinceDays,
    me: options.me,
    names,
    squad: options.squad,
    related: options.related,
    forcedLogins: options.forced,
    deducedLogins: deduced,
    viewer: viewer ?? null,
    branches: git.branches,
    merged: git.merged,
    trailerReviews: git.reviews,
    archivedReviews: archive('reviews') as DashboardInput['archivedReviews'],
    written: [...git.written, ...git.coauthored],
    signed: git.signed,
    ghReviews: await loadMemberReviews(db, searched),
    rplus,
    // Mergebot's own pages first, unless GitHub closed the PR since; a PR it was not asked about, or did not know, as GitHub gave it.
    mergebot: {
      ...github,
      ...Object.fromEntries(
        Object.entries(mergebot).flatMap(([key, pr]) => {
          const gh = github[key];
          if (pr.state === 'missing' && gh) return [];
          return [
            [
              key,
              pr.state === 'open' && gh?.state === 'closed' && gh.fetched > pr.fetched
                ? { ...pr, state: 'closed', phase: 'Closed', blocked: false }
                : pr,
            ],
          ];
        }),
      ),
    } as Record<string, MergebotPr>,
    runbot,
    github: pulls as unknown as DashboardInput['github'],
    archivedFeatures: archive('features') as DashboardInput['archivedFeatures'],
    requests,
    lastFetch: git.lastFetch,
    ruleFiles: git.ruleFiles,
    mechanics: git.mechanics,
  };
}
