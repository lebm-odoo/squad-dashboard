import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { VersionCommit } from '../domain/commits';
import type { BranchRecord, Push } from '../domain/features';
import type { Mechanical } from '../domain/weight';
import type { Snapshot, Transitions } from '../sources/git-branches';
import type { Database } from './client';
import { insertRows, toDate, toUnix } from './rows';
import { gitBranch, gitCommit, gitContribution, gitMechanical, gitPush, gitSnapshot, gitTransition, syncCursor } from './schema';

export type StoredBranch = BranchRecord & { patch_id?: string | null };

const split = (key: string) => [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)] as [string, string];

export async function loadCursor<T>(db: Database, source: string, key: string): Promise<T | undefined> {
  const [row] = await db
    .select({ value: syncCursor.value })
    .from(syncCursor)
    .where(and(eq(syncCursor.source, source), eq(syncCursor.key, key)));
  return row?.value as T | undefined;
}

export const saveCursor = (db: Database, source: string, key: string, value: unknown) =>
  db
    .insert(syncCursor)
    .values({ source, key, value })
    .onConflictDoUpdate({ target: [syncCursor.source, syncCursor.key], set: { value, updatedAt: new Date() } });

/** The branches ever scanned, `${repo}:${branch}` → the record as the V1 kept it, with every push seen. */
export async function loadBranches(db: Database): Promise<Record<string, StoredBranch>> {
  const [rows, pushes] = await Promise.all([db.select().from(gitBranch), db.select().from(gitPush).orderBy(gitPush.at)]);
  const pushesOf = new Map<string, Push[]>();
  for (const push of pushes) {
    const key = `${push.repo}:${push.branch}`;
    const record: Push = { kind: push.kind, delta: push.delta, added_commits: push.addedCommits, at: toUnix(push.at), sha: push.sha };
    const list = pushesOf.get(key) ?? (pushesOf.set(key, []).get(key) as Push[]);
    list.push(push.source === 'reflog' ? record : { ...record, src: push.source });
  }
  return Object.fromEntries(
    rows.map((row) => {
      const key = `${row.repo}:${row.name}`;
      const record = {
        head: row.head,
        url: row.url,
        owner: row.owner,
        contributors: row.contributors,
        on_remote: row.onRemote,
        pushes: pushesOf.get(key) ?? [],
        base: row.base,
        base_ref: row.baseRef,
        commit_count: row.commitCount,
        noisy: row.noisy,
        commits: row.commits,
        files: row.files,
        patch_id: row.patchId,
        trailers: row.trailers,
        coauthors: row.coauthors,
        new_models: row.newModels,
        new_fields: row.newFields,
        new_tests: row.newTests,
      };
      return [key, record as StoredBranch];
    }),
  );
}

/** Saves the branches just scanned; the others are gone from the clones, so off the remote too. */
export async function saveBranches(db: Database, records: Record<string, StoredBranch>) {
  const rows = Object.entries(records).map(([key, record]) => {
    const [repo, name] = split(key);
    return {
      repo,
      name,
      head: record.head,
      owner: record.owner ?? null,
      url: record.url,
      onRemote: record.on_remote ?? null,
      contributors: record.contributors ?? [],
      base: record.base,
      baseRef: record.base_ref ?? null,
      commitCount: record.commit_count,
      noisy: record.noisy ?? null,
      patchId: record.patch_id ?? null,
      commits: record.commits,
      files: record.files,
      trailers: record.trailers,
      coauthors: record.coauthors ?? null,
      newModels: record.new_models ?? null,
      newFields: record.new_fields ?? null,
      newTests: record.new_tests ?? null,
    };
  });
  const pushes = Object.entries(records).flatMap(([key, record]) => {
    const [repo, branch] = split(key);
    return record.pushes.map((push) => ({
      repo,
      branch,
      sha: push.sha,
      at: toDate(push.at),
      kind: push.kind,
      delta: push.delta,
      addedCommits: push.added_commits,
      source: push.src ?? 'reflog',
    }));
  });
  await db.transaction(async (tx) => {
    const columns = Object.keys(rows[0] ?? {}).filter(
      (column) => column !== 'repo' && column !== 'name',
    ) as (keyof (typeof rows)[number])[];
    await insertRows(tx, gitBranch, rows, columns);
    await insertRows(tx, gitPush, pushes);
    const seen = Object.keys(records);
    await tx
      .update(gitBranch)
      .set({ onRemote: false })
      .where(notInArray(sql`${gitBranch.repo} || ':' || ${gitBranch.name}`, seen));
  });
}

export async function loadContributions(db: Database) {
  const rows = await db.select().from(gitContribution);
  return Object.fromEntries(rows.map((row) => [`${row.repo}:${row.branch}`, row.people]));
}

export const saveContributions = (db: Database, contributed: Record<string, string[]>) =>
  db.transaction(async (tx) => {
    await tx.delete(gitContribution);
    const rows = Object.entries(contributed).map(([key, people]) => ({ repo: split(key)[0], branch: split(key)[1], people }));
    await insertRows(tx, gitContribution, rows);
  });

export async function loadSnapshots(db: Database) {
  const rows = await db.select().from(gitSnapshot);
  return new Map(rows.map((row) => [`${row.repo}:${row.head}`, row.data as Snapshot]));
}

export const saveSnapshots = (db: Database, snapshots: [string, Snapshot][]) =>
  insertRows(
    db,
    gitSnapshot,
    snapshots.map(([key, data]) => ({ repo: split(key)[0], head: split(key)[1], data })),
  );

export async function loadTransitions(db: Database): Promise<Transitions> {
  const rows = await db.select().from(gitTransition);
  return new Map(
    rows.map((row) => [
      `${row.repo}:${row.old}:${row.next}:${toUnix(row.loggedAt)}`,
      { kind: row.kind, delta: row.delta, added_commits: row.addedCommits, at: toUnix(row.at), sha: row.sha },
    ]),
  );
}

export const saveTransitions = (db: Database, transitions: Transitions) =>
  insertRows(
    db,
    gitTransition,
    [...transitions].map(([key, push]) => {
      const [repo, old, next, logged] = key.split(':') as [string, string, string, string];
      return {
        repo,
        old,
        next,
        loggedAt: toDate(Number(logged)),
        kind: push.kind,
        delta: push.delta,
        addedCommits: push.added_commits,
        at: toDate(push.at),
        sha: push.sha,
      };
    }),
  );

/** The commits of each clone the people read wrote, co-wrote or signed off, newest first as git log lists them. */
export async function loadCommits(db: Database) {
  const rows = await db.select().from(gitCommit).orderBy(sql`${gitCommit.ordinal} desc`);
  const byRepo = new Map<string, VersionCommit[]>();
  for (const row of rows) {
    const commit: VersionCommit = {
      sha: row.sha,
      authorName: row.authorName,
      authorEmail: row.authorEmail,
      at: toUnix(row.at),
      ct: toUnix(row.ct),
      subject: row.subject,
      body: row.body,
      files: row.files as VersionCommit['files'],
      rootAuthor: row.rootAuthor,
    };
    (byRepo.get(row.repo) ?? (byRepo.set(row.repo, []).get(row.repo) as VersionCommit[])).push(commit);
  }
  return byRepo;
}

/** Commits read newest first; those of a later read come before, a whole read again gives the order anew. */
export async function saveCommits(db: Database, repo: string, commits: VersionCommit[]) {
  const [last] = await db
    .select({ ordinal: sql<number>`coalesce(max(${gitCommit.ordinal}), 0)` })
    .from(gitCommit)
    .where(eq(gitCommit.repo, repo));
  const base = Number(last?.ordinal ?? 0) + commits.length;
  await insertRows(
    db,
    gitCommit,
    commits.map((commit, i) => ({
      repo,
      sha: commit.sha,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      at: toDate(commit.at),
      ct: toDate(commit.ct),
      subject: commit.subject,
      body: commit.body,
      files: commit.files,
      rootAuthor: commit.rootAuthor ?? null,
      ordinal: base - i,
    })),
    ['ordinal'],
  );
}

/** Moved lines read so far, `${repo}:${revs}` with 12-character shas. */
export async function loadMechanics(db: Database) {
  const rows = await db.select().from(gitMechanical);
  return new Map(rows.map((row) => [`${row.repo}:${row.revs}`, row.lines as Mechanical]));
}

export const saveMechanics = (db: Database, mechanics: [string, Mechanical][]) =>
  insertRows(
    db,
    gitMechanical,
    mechanics.map(([key, lines]) => ({ repo: split(key)[0], revs: split(key)[1], lines })),
  );
