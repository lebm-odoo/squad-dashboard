import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '../db/client';
import {
  loadBranches,
  loadContributions,
  loadCursor,
  loadMechanics,
  loadSnapshots,
  loadTransitions,
  saveBranches,
  saveCommits,
  saveContributions,
  saveCursor,
  saveMechanics,
  saveSnapshots,
  saveTransitions,
} from '../db/git';
import { type Mechanical, worthMechanics } from '../domain/weight';
import type { Clone } from '../sources/clones';
import { discoverContributed, scanBranches } from '../sources/git-branches';
import { collectHistory, type HistoryCursor, type Refs, readMechanics } from '../sources/git-history';

export type GitCursor = HistoryCursor & {
  since: number;
  windows: [string, string[]][];
  rules: string[];
  forks: Record<string, number>;
  /** When the clone was last fetched, from its FETCH_HEAD. */
  fetchedAt: number | null;
};

/** The first of the month `days` ago, at midnight: a window that moves monthly keeps the incremental reads valid. */
export function windowStart(now: number, days: number) {
  const start = new Date((now - days * 86400) * 1000);
  return new Date(start.getFullYear(), start.getMonth(), 1).getTime() / 1000;
}

type GitSyncOptions = {
  members: ReadonlySet<string>;
  /** The branches of others read as well, `${repo}:${branch}` → nobody: those of the related work. */
  related?: Record<string, string[]>;
  since: number;
  now: number;
  step?: (label: string) => void;
};

/** Reads the clones into the database; what is there already is not read again. */
export async function syncGit(db: Database, clones: Clone[], options: GitSyncOptions) {
  await syncGitBranches(db, clones, await syncGitHistory(db, clones, options), options);
}

/** The version branches' history: what the other sources need first, the merged commits and their PRs. */
export async function syncGitHistory(db: Database, clones: Clone[], { members, since, step = () => {} }: GitSyncOptions) {
  const mechanics = await loadMechanics(db);
  const refsOf: Record<string, Refs> = {};
  // One clone after the other: in parallel, decoding their diffs on one thread holds the git processes back.
  for (const { repo, git } of clones) {
    step(`git ${repo} : historique`);
    const known = new Set([...mechanics.keys()].filter((key) => key.startsWith(`${repo}:`)).map((key) => key.slice(repo.length + 1)));
    const history = await collectHistory(repo, git, members, since, { cursor: await loadCursor<GitCursor>(db, 'git', repo), known });
    refsOf[repo] = history.refs;
    await saveCommits(db, repo, history.commits);
    const read = [...history.mechanics].map(([sha, lines]) => [`${repo}:${sha}`, lines] as [string, Mechanical]);
    await saveMechanics(db, read);
    for (const [key, lines] of read) mechanics.set(key, lines);
    const fetchedAt = await stat(join(git.path, '.git', 'FETCH_HEAD')).then(
      (file) => file.mtimeMs / 1000,
      () => null,
    );
    const cursor: GitCursor = { ...history.cursor, since, windows: history.windows, rules: history.rules, forks: history.forks, fetchedAt };
    await saveCursor(db, 'git', repo, cursor);
  }
  return refsOf;
}

/** The branches, their pushes and moved lines: the longest part of a first reading. */
export async function syncGitBranches(
  db: Database,
  clones: Clone[],
  refsOf: Record<string, Refs>,
  { members, related = {}, now, step = () => {} }: GitSyncOptions,
) {
  const mechanics = await loadMechanics(db);
  step('git : branches');
  const [archive, stored, transitions, snapshots] = await Promise.all([
    loadBranches(db),
    loadContributions(db),
    loadTransitions(db),
    loadSnapshots(db),
  ]);
  const contributed = await discoverContributed(clones, refsOf, members, now - 180 * 86400, stored);
  await saveContributions(db, contributed);
  const remoteHeads = Object.fromEntries(
    await Promise.all(
      clones.map(async ({ repo }) => {
        const fetched = await loadCursor<{ heads: string[] }>(db, 'fetch', repo);
        return [repo, fetched && new Set(fetched.heads)] as const;
      }),
    ),
  );
  const [knownTransitions, knownSnapshots] = [new Set(transitions.keys()), new Set(snapshots.keys())];
  const { records } = await scanBranches(clones, refsOf, {
    names: members,
    contributed: { ...related, ...contributed },
    remoteHeads,
    archive,
    transitions,
    snapshots,
  });
  await saveSnapshots(
    db,
    [...snapshots].filter(([key]) => !knownSnapshots.has(key)),
  );
  await saveTransitions(db, new Map([...transitions].filter(([key]) => !knownTransitions.has(key))));
  await saveBranches(db, records);

  step('git : lignes déplacées des branches');
  const branches = Object.entries({ ...archive, ...records }).flatMap(([key, record]) => {
    const repo = key.slice(0, key.indexOf(':'));
    const clone = clones.find((candidate) => candidate.repo === repo);
    const revs = `${repo}:${record.base?.slice(0, 12)}:${record.head.slice(0, 12)}`;
    const worth = clone && record.base && !record.noisy && !mechanics.has(revs) && worthMechanics(repo, record.files ?? [], {});
    return worth ? [{ git: clone.git, revs, range: [record.base, record.head] }] : [];
  });
  await saveMechanics(
    db,
    await Promise.all(branches.map(async ({ git, revs, range }) => [revs, await readMechanics(git, range)] as [string, Mechanical])),
  );
}
