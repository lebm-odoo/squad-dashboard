import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ownerOf, versionOf } from '../domain/branches';
import { renamedPath } from '../domain/classify';
import { authoredBy, trailerNames } from '../domain/commits';
import type { BranchCommit, BranchRecord, Push } from '../domain/features';
import { coauthorsOf, isMergedCommit, parseTrailers } from '../domain/messages';
import { splitLines, strip } from '../domain/py';
import { schemaCounts } from '../domain/schema-counts';
import type { Clone } from './clones';
import type { Git } from './git';
import { type Refs, versionRefs } from './git-history';

export type Snapshot = Omit<BranchRecord, 'head' | 'url' | 'owner' | 'contributors' | 'on_remote' | 'pushes'> & { patch_id: string };
/** What a reflog entry did to its branch, read once: `${repo}:${old}:${new}:${logged at}` → the push. */
export type Transitions = Map<string, Omit<Push, 'repo' | 'src'>>;

const count = async (git: Git, args: string[], check = true) =>
  Number((await git.run(['rev-list', '--count', ...args], { check })).trim() || 0);
const tabs = (line: string) => {
  const first = line.indexOf('\t');
  const second = line.indexOf('\t', first + 1);
  return [line.slice(0, first), line.slice(first + 1, second), line.slice(second + 1)] as const;
};

/** Where a branch may start: the parent branches its name suggests, its version, master, then every version branch. */
export function baseCandidates(refs: Refs, remote: string, branch: string) {
  const parts = branch.split('-');
  const prefixes = parts.slice(2).map((_, i) => `refs/remotes/${remote}/${parts.slice(0, parts.length - 1 - i).join('-')}`);
  const ordered = [...prefixes, `refs/remotes/origin/${versionOf(branch)}`, 'refs/remotes/origin/master', ...versionRefs(refs).sort()];
  return [...new Set(ordered)].filter((ref) => ref in refs);
}

/** The closest ancestor among the candidates: the one leaving the fewest commits on the branch. */
async function pickBase(git: Git, head: string, candidates: string[]): Promise<[string, string]> {
  const floor = await count(git, [head, '--not', ...candidates], false);
  let best: [number, string, string] | null = null;
  for (const ref of candidates) {
    const mergeBase = (await git.run(['merge-base', ref, head], { check: false })).trim();
    const commits = mergeBase ? await count(git, [`${mergeBase}..${head}`]) : 0;
    if (commits && (!best || commits < best[0])) {
      best = [commits, mergeBase, ref];
      if (commits <= floor) break;
    }
  }
  return best ? [best[1], best[2]] : [head, candidates[0] ?? ''];
}

/** A branch as it stands at `head`: its base, commits, files, trailers and the models, fields and tests it adds. */
export async function snapshot(git: Git, refs: Refs, remote: string, branch: string, head: string): Promise<Snapshot> {
  const [base, baseRef] = await pickBase(git, head, baseCandidates(refs, remote, branch));
  const range = [base, head];
  const [log, numstat, fullDiff, commitCount, pythonDiff, testsDiff] = await Promise.all([
    git.run(['log', '-n', '150', '--format=%H%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s%x1f%b%x1e', `${base}..${head}`]),
    git.run(['diff', '--numstat', ...range]),
    git.run(['diff', ...range]),
    count(git, [`${base}..${head}`]),
    git.run(['diff', '-U0', ...range, '--', '*.py', ':(exclude)*/tests/*'], { check: false }),
    git.run(['diff', '-U0', ...range, '--', '*/tests/*'], { check: false }),
  ]);
  const commits: BranchCommit[] = [];
  const messages: string[] = [];
  for (const record of log.split('\x1e')) {
    const trimmed = record.replace(/^\n+|\n+$/g, '');
    if (!trimmed) continue;
    const [sha, author, email, at, ct, subject, body] = trimmed.split('\x1f') as string[];
    commits.push({
      sha: (sha as string).slice(0, 12),
      author: author as string,
      email: (email as string).toLowerCase(),
      at: Number(at),
      ct: Number(ct),
      subject: subject as string,
      merged: isMergedCommit(body as string),
    });
    messages.push(`${subject}\n${body}`);
  }
  const patchId = fullDiff ? ((await git.run(['patch-id', '--stable'], { input: fullDiff })).split(' ')[0] as string) : 'empty';
  const schema = schemaCounts(pythonDiff, testsDiff);
  return {
    base: base.slice(0, 12),
    base_ref: baseRef.replace(/^refs\/remotes\//, ''),
    commit_count: commitCount,
    noisy: commitCount > 60,
    commits,
    files: splitLines(numstat).map((line) => {
      const [ins, dels, path] = tabs(line);
      return [renamedPath(path), ins === '-' ? 0 : Number(ins), dels === '-' ? 0 : Number(dels)];
    }),
    patch_id: patchId,
    trailers: parseTrailers(messages.join('\n')),
    coauthors: [...coauthorsOf(messages.join('\n'))].sort(),
    new_models: schema.newModels,
    new_fields: schema.newFields,
    new_tests: schema.newTests,
  };
}

/** Each added or removed line of a `-U0` diff, by file and side: what a rebase keeps and what it changes. */
async function diffLines(git: Git, base: string, head: string) {
  const lines = new Map<string, number>();
  let current = '';
  for (const line of splitLines(await git.run(['diff', '-U0', base, head], { check: false }))) {
    if (line.startsWith('--- a/') || line.startsWith('+++ b/')) current = line.slice(6);
    else if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
    else if (line[0] === '+' || line[0] === '-') {
      const key = `${current}\u0000${line[0]}\u0000${strip(line.slice(1))}`;
      lines.set(key, (lines.get(key) ?? 0) + 1);
    }
  }
  return lines;
}

/** What a push did: added commits, rewrote them (rebase, amend), or only moved them onto a newer base. */
async function transition(git: Git, refs: Refs, remote: string, branch: string, old: string, next: string) {
  if (!((await git.exists(old)) && (await git.exists(next)))) return { kind: 'unknown', delta: 0, added_commits: 0 };
  const [before, after] = await Promise.all([snapshot(git, refs, remote, branch, old), snapshot(git, refs, remote, branch, next)]);
  if (before.noisy || after.noisy) return { kind: 'noise', delta: 0, added_commits: 0 };
  if (await git.ok(['merge-base', '--is-ancestor', old, next])) {
    const delta = splitLines(await git.run(['diff', '--numstat', old, next]))
      .map(tabs)
      .filter(([ins]) => ins !== '-')
      .reduce((total, [ins, dels]) => total + Number(ins) + Number(dels), 0);
    return { kind: 'push', delta, added_commits: await count(git, [`${old}..${next}`]) };
  }
  if (before.patch_id !== after.patch_id) {
    const [was, is] = await Promise.all([diffLines(git, before.base, old), diffLines(git, after.base, next)]);
    let delta = 0;
    for (const key of new Set([...was.keys(), ...is.keys()])) delta += Math.abs((was.get(key) ?? 0) - (is.get(key) ?? 0));
    if (delta)
      return {
        kind: before.base !== after.base ? 'rebase+code' : 'amend',
        delta,
        added_commits: after.commit_count - before.commit_count,
      };
  }
  return { kind: 'rebase', delta: 0, added_commits: 0 };
}

/**
 * The pushes the reflog of a remote branch saw, one per fetch that moved it. The reflog stamps the fetch: the commit date is
 * closer to the push when it falls after the previous fetch. Entries read before come from `known`.
 */
export async function reflogPushes(clone: Clone, refs: Refs, branch: string, head: string, snap: Snapshot, known: Transitions) {
  const { git, remote } = clone;
  const text = await readFile(join(git.path, '.git', 'logs', 'refs', 'remotes', remote, branch)).then(
    (bytes) => new TextDecoder().decode(bytes),
    () => null,
  );
  const pushes: Omit<Push, 'repo' | 'src'>[] = [];
  let previous = 0;
  for (const line of splitLines(text ?? '')) {
    const parts = line.split('\t')[0]?.split(' ') as string[];
    const [old, next, logged] = [parts[0] as string, parts[1] as string, Number(parts.at(-2))];
    const key = `${clone.repo}:${old}:${next}:${logged}`;
    let entry = known.get(key);
    if (!entry) {
      const ct = Number((await git.run(['log', '-1', '--format=%ct', next], { check: false })).trim() || logged);
      const at = ct <= logged ? Math.max(ct, previous) : logged;
      const change = /^0+$/.test(old)
        ? { kind: 'new', delta: 0, added_commits: next === head ? snap.commit_count : 0 }
        : await transition(git, refs, remote, branch, old, next).catch(() => ({ kind: 'unknown', delta: 0, added_commits: 0 }));
      entry = { ...change, at, sha: next.slice(0, 12) };
      known.set(key, entry);
    }
    pushes.push(entry);
    previous = logged;
  }
  return pushes;
}

export type ScanInput = {
  names: ReadonlySet<string>;
  /** The branches of others where the people followed wrote: `${repo}:${branch}` → who. */
  contributed: Record<string, string[]>;
  /** The branches each clone's remote still had at the last fetch, unknown before any. */
  remoteHeads: Record<string, ReadonlySet<string> | undefined>;
  /** The branches kept from earlier scans, `${repo}:${branch}`: a deleted branch stays, its pushes too. */
  archive: Record<string, BranchRecord & { patch_id?: string | null }>;
  transitions: Transitions;
  /** Snapshots already taken, by `${repo}:${head}`: a branch that did not move is not read again. */
  snapshots: Map<string, Snapshot>;
};

/** The branches of the people followed and those they contributed to, as V1's scan_git returned them. */
export async function scanBranches(clones: Clone[], refsOf: Record<string, Refs>, input: ScanInput) {
  const branches: Record<string, Record<string, BranchRecord>> = {};
  const records: Record<string, BranchRecord & { patch_id?: string | null }> = {};
  const seen = new Set<string>();
  await Promise.all(
    clones.flatMap((clone) => {
      const refs = refsOf[clone.repo] as Refs;
      const prefix = `refs/remotes/${clone.remote}/`;
      return Object.entries(refs).map(async ([ref, head]) => {
        const branch = ref.slice(prefix.length);
        const owner = ownerOf(branch, input.names);
        const key = `${clone.repo}:${branch}`;
        if (!ref.startsWith(prefix) || branch === 'HEAD' || !(owner || key in input.contributed)) return;
        let snap = input.snapshots.get(`${clone.repo}:${head}`);
        try {
          snap ??= await snapshot(clone.git, refs, clone.remote, branch, head);
        } catch {
          return;
        }
        input.snapshots.set(`${clone.repo}:${head}`, snap);
        seen.add(key);
        const pushes = await reflogPushes(clone, refs, branch, head, snap, input.transitions);
        const read = new Set(pushes.map((push) => `${push.sha}:${push.at}`));
        const kept = (input.archive[key]?.pushes ?? []).filter((push) => !read.has(`${push.sha}:${push.at}`));
        const remote = input.remoteHeads[clone.repo];
        records[key] = {
          head: head.slice(0, 12),
          url: `https://github.com/${clone.slug}/tree/${branch}`,
          owner,
          contributors: input.contributed[key] ?? [],
          on_remote: remote ? remote.has(branch) : null,
          pushes: [...pushes, ...kept].sort((a, b) => a.at - b.at),
          ...snap,
        };
      });
    }),
  );
  // Sorted as the clones list their refs: the V1 filled its records in that order.
  for (const clone of clones) {
    const prefix = `refs/remotes/${clone.remote}/`;
    for (const ref of Object.keys(refsOf[clone.repo] as Refs)) {
      const key = `${clone.repo}:${ref.slice(prefix.length)}`;
      const record = ref.startsWith(prefix) ? records[key] : undefined;
      if (record) branches[ref.slice(prefix.length)] = { ...branches[ref.slice(prefix.length)], [clone.repo]: record };
    }
  }
  for (const [key, record] of Object.entries(input.archive)) {
    const [repo, branch] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (!seen.has(key) && (ownerOf(branch, input.names) || key in input.contributed)) {
      branches[branch] = { ...branches[branch], [repo]: { ...record, on_remote: false } };
    }
  }
  return { branches, records };
}

/**
 * The branches of others holding a commit the people followed wrote or co-wrote, not merged yet: a PR opened for them.
 * A branch still on the remote is judged again on each run; one gone keeps what it was.
 */
export async function discoverContributed(
  clones: Clone[],
  refsOf: Record<string, Refs>,
  names: ReadonlySet<string>,
  since: number,
  store: Record<string, string[]>,
) {
  const out = { ...store };
  const authored = authoredBy(names);
  const coauthored = trailerNames('Co-authored-by', names);
  for (const { repo, remote, git } of clones) {
    const refs = refsOf[repo] as Refs;
    const found = new Map<string, Set<string>>();
    const format = '--format=%x1e%H%x1f%S%x1f%an%x1f%ae%x1f%B';
    for await (const record of git.records(['log', `--remotes=${remote}/*`, `--since=@${since}`, '--no-merges', '--source', format])) {
      const trimmed = record.replace(/^\n+|\n+$/g, '');
      if (!trimmed) continue;
      const [sha, source, authorName, authorEmail, ...rest] = trimmed.split('\x1f') as string[];
      const message = rest.join('\x1f');
      const commit = {
        sha: sha as string,
        authorName: authorName as string,
        authorEmail: authorEmail as string,
        at: 0,
        ct: 0,
        subject: '',
        body: message,
        files: [],
      };
      // Already merged elsewhere (mergebot trailers): the branch is only based on a newer master than ours.
      if (!(authored(commit) || coauthored(commit)) || isMergedCommit(message)) continue;
      const branch = (source as string).replace(/^refs\/remotes\//, '').replace(new RegExp(`^${remote}/`), '');
      const coauthors = coauthorsOf(message);
      if (branch.includes('onboarding') && ![...coauthors].some((name) => names.has(name))) continue;
      if (
        ownerOf(branch, names) ||
        !(`refs/remotes/${remote}/${branch}` in refs) ||
        /^(?:master|saas-\d+\.\d+|\d+\.\d+|HEAD)$/.test(branch) ||
        /^(?:tmp|staging)\./.test(branch)
      )
        continue;
      const bases = [`refs/remotes/origin/${versionOf(branch)}`, 'refs/remotes/origin/master'].filter((ref) => ref in refs);
      let merged = false;
      for (const ref of new Set(bases)) merged ||= await git.ok(['merge-base', '--is-ancestor', sha as string, ref]);
      if (merged) continue;
      const people = found.get(`${repo}:${branch}`) ?? new Set<string>();
      for (const name of [...coauthors, (authorEmail as string).toLowerCase().split('@')[0] as string])
        if (names.has(name)) people.add(name);
      found.set(`${repo}:${branch}`, people);
    }
    for (const key of Object.keys(out)) {
      if (key.startsWith(`${repo}:`) && `refs/remotes/${remote}/${key.slice(repo.length + 1)}` in refs && !found.has(key)) delete out[key];
    }
    for (const [key, people] of found) if (people.size) out[key] = [...people].sort();
  }
  return out;
}
