import { type Todo, todos } from '@sd/shared';
import { getTableName, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client';
import {
  appMeta,
  archiveEntry,
  gitBranch,
  gitContribution,
  githubForcePush,
  githubPr,
  githubReview,
  githubRplus,
  githubRplusScan,
  gitMechanical,
  gitPush,
  gitSnapshot,
  gitTransition,
  mergebotPr,
  odooTask,
  personLogin,
  runbotBundle,
  syncCursor,
  v1Archive,
} from '../db/schema';
import type { TaskChange } from '../sources/odoo';

type Unix = number;
type V1Branch = {
  head: string;
  url?: string;
  owner?: string | null;
  contributors?: string[];
  on_remote?: boolean | null;
  pushes?: { kind: string; delta: number; added_commits: number; at: Unix; sha: string; src?: string }[];
  base?: string;
  base_ref?: string;
  commit_count?: number;
  noisy?: boolean;
  patch_id?: string;
  commits?: unknown[];
  files?: unknown[];
  trailers?: unknown;
  coauthors?: string[];
  new_models?: number;
  new_fields?: number;
  new_tests?: number;
};
type V1GithubPr = {
  state: string;
  draft?: boolean;
  author?: string | null;
  created_at?: Unix;
  closed_at?: Unix | null;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  comments?: number;
  reviews?: { login: string | null; state: string; at: Unix }[];
  force_pushes?: { at: Unix; actor: string | null; before: string; after: string; kind: string; delta: number }[];
  ready_at?: Unix[];
  fetched?: Unix;
};
type V1GhReview = { reviewer: string; pr: string; t: Unix; state: string; author_login: string; head_ref?: string; subject: string };
type V1Mergebot = {
  repo: string;
  number: number;
  state: string;
  phase?: string;
  draft?: boolean;
  blocked?: boolean;
  missing_r?: boolean;
  review?: string | null;
  title?: string;
  created_by?: string;
  label?: string;
  merged_at?: Unix | null;
  merged_by?: string | null;
  ci?: unknown;
  linked?: unknown;
  desc_words?: number;
  tasks?: string[];
  opws?: string[];
  fetched: Unix;
};
type V1Bundle = { id: number; url: string; branches: unknown; prs: unknown; batches: unknown };

export type V1History = {
  branches?: Record<string, V1Branch>;
  contributed?: Record<string, string[]>;
  github?: Record<string, V1GithubPr>;
  gh_reviews?: Record<string, V1GhReview>;
  github_search?: Record<string, { login?: string }>;
  team_logins?: Record<string, string>;
  github_meta?: { viewer?: string };
  odoo_tasks?: Record<string, { changes: TaskChange[] }>;
  rplus?: Record<string, { at: Unix; r: [string, Unix][]; missing?: boolean }>;
  [section: string]: unknown;
};
type V1Push = { kind: string; delta: number; added_commits: number; at: Unix; sha: string };
export type V1Cache = {
  mergebot?: Record<string, V1Mergebot>;
  runbot?: { bundles?: Record<string, V1Bundle> };
  snap?: Record<string, unknown>;
  pushes?: Record<string, V1Push>;
  mechanics?: Record<string, unknown>;
  remote_heads?: Record<string, string[]>;
  github_requests?: { me?: unknown };
  [section: string]: unknown;
};

const at = (unix: Unix) => new Date(unix * 1000);
const optionalAt = (unix: Unix | null | undefined) => (unix == null ? null : at(unix));
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parsePr(key: string) {
  const match = key.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  return match?.[1] && match[2] ? { repo: match[1], number: Number(match[2]) } : null;
}

async function insertMissing(db: Pick<Database, 'insert' | 'execute'>, table: PgTable, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 1000)
    await db
      .insert(table)
      .values(rows.slice(i, i + 1000))
      .onConflictDoNothing();
  const [counted] = await db.execute<{ total: number }>(sql`select count(*)::int as total from ${table}`);
  return { prepared: rows.length, total: counted?.total ?? 0 };
}

/**
 * Takes over what the V1 kept, once, before the first collection: its history, its cache of mergebot and runbot, the changes
 * of stage of the Odoo tasks, which Odoo does not keep, and the to-dos. Rows already in the database are never overwritten.
 */
export async function importV1(db: Database, history: V1History, cache: V1Cache, items: Todo[] | null = null) {
  const archive = [
    ...Object.entries(history).flatMap(([section, entries]) =>
      isRecord(entries) ? Object.entries(entries).map(([key, data]) => ({ file: 'history.json', section, key, data })) : [],
    ),
    ...Object.entries(cache.mergebot ?? {}).map(([key, data]) => ({ file: 'cache.json', section: 'mergebot', key, data })),
    ...Object.entries(cache.runbot?.bundles ?? {}).map(([key, data]) => ({ file: 'cache.json', section: 'runbot', key, data })),
  ];

  const branches = Object.entries(history.branches ?? {}).map(([key, branch]) => {
    const separator = key.indexOf(':');
    const repo = key.slice(0, separator);
    const name = key.slice(separator + 1);
    return {
      repo,
      name,
      head: branch.head,
      owner: branch.owner ?? null,
      url: branch.url ?? null,
      onRemote: branch.on_remote ?? null,
      contributors: branch.contributors ?? [],
      base: branch.base ?? null,
      baseRef: branch.base_ref ?? null,
      commitCount: branch.commit_count ?? null,
      noisy: branch.noisy ?? null,
      patchId: branch.patch_id ?? null,
      commits: branch.commits ?? null,
      files: branch.files ?? null,
      trailers: branch.trailers ?? null,
      coauthors: branch.coauthors ?? null,
      newModels: branch.new_models ?? null,
      newFields: branch.new_fields ?? null,
      newTests: branch.new_tests ?? null,
      pushes: (branch.pushes ?? []).map((push) => ({
        repo,
        branch: name,
        sha: push.sha,
        at: at(push.at),
        kind: push.kind,
        delta: push.delta,
        addedCommits: push.added_commits,
        source: push.src ?? 'reflog',
      })),
    };
  });

  const prs = new Map<string, Record<string, unknown>>();
  const reviews = new Map<string, Record<string, unknown>>();
  const forcePushes = new Map<string, Record<string, unknown>>();
  for (const [key, pr] of Object.entries(history.github ?? {})) {
    const id = parsePr(key);
    if (!id) continue;
    prs.set(key, {
      ...id,
      authorLogin: pr.author ?? null,
      state: pr.state,
      draft: pr.draft ?? null,
      createdAt: optionalAt(pr.created_at),
      closedAt: optionalAt(pr.closed_at),
      additions: pr.additions ?? null,
      deletions: pr.deletions ?? null,
      changedFiles: pr.changed_files ?? null,
      comments: pr.comments ?? null,
      readyAt: (pr.ready_at ?? []).map(at),
      fetchedAt: optionalAt(pr.fetched),
    });
    for (const review of pr.reviews ?? []) {
      const login = review.login ?? 'ghost';
      reviews.set(`${key}|${login}|${review.at}|${review.state}`, {
        ...id,
        login,
        submittedAt: at(review.at),
        state: review.state,
        detailed: true,
      });
    }
    for (const push of pr.force_pushes ?? []) {
      forcePushes.set(`${key}|${push.after}|${push.at}`, {
        ...id,
        after: push.after,
        at: at(push.at),
        before: push.before,
        actor: push.actor,
        kind: push.kind,
        delta: push.delta,
      });
    }
  }

  // V1 kept the reviewer of a review found by search as a trigram; the login its search used is in github_search.
  const loginOf = (member: string) => history.github_search?.[member]?.login || history.team_logins?.[member] || null;
  const unmapped = new Set<string>();
  for (const review of Object.values(history.gh_reviews ?? {})) {
    const id = parsePr(review.pr);
    const login = loginOf(review.reviewer);
    if (!id) continue;
    if (!login) {
      unmapped.add(review.reviewer);
      continue;
    }
    const pr = prs.get(review.pr) ?? { ...id };
    pr.title ??= review.subject;
    pr.authorLogin ??= review.author_login;
    pr.headRef ??= review.head_ref ?? null;
    prs.set(review.pr, pr);
    const key = `${review.pr}|${login}|${review.t}|${review.state}`;
    reviews.set(key, { ...id, login, submittedAt: at(review.t), state: review.state, ...reviews.get(key), searched: true });
  }

  const scans: Record<string, unknown>[] = [];
  const rplus = new Map<string, Record<string, unknown>>();
  for (const [key, entry] of Object.entries(history.rplus ?? {})) {
    const id = parsePr(key);
    if (!id) continue;
    scans.push({ ...id, scannedAt: at(entry.at), missing: Boolean(entry.missing) });
    for (const [login, when] of entry.r) rplus.set(`${key}|${login}|${when}`, { ...id, login, at: at(when) });
  }

  // An empty login: the member's PRs gave none, they are not asked again.
  const logins = Object.entries(history.team_logins ?? {}).map(([member, login]) => ({ member, login, source: 'deduced' }));

  const mergebot = Object.values(cache.mergebot ?? {}).map((pr) => ({
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
    mergedAt: optionalAt(pr.merged_at),
    mergedBy: pr.merged_by ?? null,
    ci: pr.ci ?? null,
    linked: pr.linked ?? null,
    descWords: pr.desc_words ?? null,
    tasks: pr.tasks ?? null,
    opws: pr.opws ?? null,
    fetchedAt: at(pr.fetched),
  }));
  const bundles = Object.entries(cache.runbot?.bundles ?? {}).map(([name, bundle]) => ({
    name,
    bundleId: bundle.id,
    url: bundle.url,
    branches: bundle.branches,
    prs: bundle.prs,
    batches: bundle.batches,
    fetchedAt: null,
  }));

  // Read once with the refs of their time: recomputed today, a snapshot or a push would be judged against today's branches.
  const split = (key: string) => [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)] as const;
  const snapshots = Object.entries(cache.snap ?? {}).map(([key, data]) => ({ repo: split(key)[0], head: split(key)[1], data }));
  const transitions = Object.entries(cache.pushes ?? {}).map(([key, push]) => {
    const [repo, old, next, logged] = key.split(':') as [string, string, string, string];
    const { kind, delta, added_commits, sha } = push;
    return { repo, old, next, loggedAt: at(Number(logged)), kind, delta, addedCommits: added_commits, at: at(push.at), sha };
  });
  const mechanics = Object.entries(cache.mechanics ?? {}).map(([key, lines]) => {
    const [repo, ...revs] = key.split(':') as [string, ...string[]];
    return { repo, revs: revs.map((rev) => rev.slice(0, 12)).join(':'), lines };
  });
  const contributions = Object.entries(history.contributed ?? {}).map(([key, people]) => ({
    repo: split(key)[0],
    branch: split(key)[1],
    people,
  }));
  const remoteHeads = Object.entries(cache.remote_heads ?? {}).map(([repo, heads]) => ({ source: 'fetch', key: repo, value: { heads } }));
  const kept = ['features', 'reviews'].flatMap((section) =>
    Object.entries((history[section] as Record<string, unknown> | undefined) ?? {}).map(([key, data]) => ({ section, key, data })),
  );
  // The V1 searches resume where they stopped: GitHub is not read again from the start.
  const cursors = Object.entries(history.github_search ?? {}).map(([key, value]) => ({ source: 'github-search', key, value }));
  const tasks = Object.entries(history.odoo_tasks ?? {}).map(([id, { changes }]) => ({
    id: Number(id),
    data: null,
    changes,
    fetchedAt: at(Math.max(0, ...changes.map(([when]) => when ?? 0))),
  }));
  const github = [
    ['viewer', history.github_meta?.viewer],
    ['requests', cache.github_requests?.me],
  ].flatMap(([key, value]) => (value ? [{ source: 'github', key: key as string, value }] : []));

  return db.transaction(async (tx) => {
    const steps: [PgTable, Record<string, unknown>[]][] = [
      [v1Archive, archive],
      [gitBranch, branches.map(({ pushes, ...branch }) => branch)],
      [gitPush, branches.flatMap((branch) => branch.pushes)],
      [githubPr, [...prs.values()]],
      [githubReview, [...reviews.values()]],
      [githubForcePush, [...forcePushes.values()]],
      [githubRplusScan, scans],
      [githubRplus, [...rplus.values()]],
      [personLogin, logins],
      [mergebotPr, mergebot],
      [runbotBundle, bundles],
      [gitSnapshot, snapshots],
      [gitTransition, transitions],
      [gitMechanical, mechanics],
      [gitContribution, contributions],
      [syncCursor, [...remoteHeads, ...cursors, ...github]],
      [archiveEntry, kept],
      [odooTask, tasks],
      [appMeta, items ? [{ key: 'todos', value: todos.parse(items) }] : []],
    ];
    const tables: Record<string, { prepared: number; total: number }> = {};
    for (const [table, rows] of steps) tables[getTableName(table)] = await insertMissing(tx, table, rows);
    return { tables, unmappedReviewers: [...unmapped].sort() };
  });
}
