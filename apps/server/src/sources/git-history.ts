import { isRecentVersionRef } from '../domain/branches';
import { authoredBy, commitFiles, needsRootAuthor, trailerNames, type VersionCommit } from '../domain/commits';
import { re, strip } from '../domain/py';
import { type Mechanical, mechanicalLines, worthMechanics } from '../domain/weight';
import type { Git } from './git';

export type Refs = Record<string, string>;
export type HistoryCursor = { heads: string[]; members: string[] };

export async function readRefs(git: Git): Promise<Refs> {
  const out = await git.run(['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/remotes/']);
  return Object.fromEntries(out.split('\n').flatMap((line) => (line ? [line.split('\0') as [string, string]] : [])));
}

export const versionRefs = (refs: Refs) =>
  Object.keys(refs).filter((ref) => ref.startsWith('refs/remotes/origin/') && isRecentVersionRef(ref));

/** The heads of every version branch, old ones included: a person's history goes back to their first commit. */
const versionHeads = (refs: Refs) =>
  [
    ...new Set(Object.entries(refs).flatMap(([ref, sha]) => (/^refs\/remotes\/origin\/(master|(saas-)?\d+\.\d+)$/.test(ref) ? [sha] : []))),
  ].sort();

/**
 * The commits of the version branches a member wrote, co-wrote or signed off, newest first. Reading the whole history and
 * filtering here takes 8 s for odoo; asking git to match 80 authors takes 40 s. Only the commits added since `cursor` are
 * read, unless the members changed.
 */
export async function versionCommits(git: Git, refs: Refs, members: ReadonlySet<string>, cursor?: HistoryCursor) {
  const heads = versionHeads(refs);
  const sameMembers = cursor?.members.join() === [...members].sort().join();
  const relevant = [authoredBy(members), trailerNames('Co-authored-by', members), trailerNames('Signed-off-by', members)];
  const commits: VersionCommit[] = [];
  const known = sameMembers && cursor ? ['--not', ...cursor.heads] : [];
  if (!sameMembers || heads.join() !== cursor?.heads.join()) {
    const format = '--format=%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s%x1f%b%x1d';
    for await (const record of git.records(['log', ...heads, ...known, '--no-merges', format])) {
      const end = record.indexOf('\x1d');
      if (end < 0) continue;
      const [sha, authorName, authorEmail, at, ct, subject, ...body] = record.slice(0, end).split('\x1f');
      const commit: VersionCommit = {
        sha: sha as string,
        authorName: authorName as string,
        authorEmail: authorEmail as string,
        at: Number(at),
        ct: Number(ct),
        subject: subject as string,
        body: body.join('\x1f'),
        files: [],
      };
      if (relevant.some((selected) => selected(commit))) commits.push(commit);
    }
  }
  await withNumstat(git, commits);
  return { commits, cursor: { heads, members: [...members].sort() } };
}

/** Each commit's numstat, read for those commits only and in parallel: the diffs are what costs. */
async function withNumstat(git: Git, commits: VersionCommit[]) {
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const size = Math.max(200, Math.ceil(commits.length / 12));
  const chunks = Array.from({ length: Math.ceil(commits.length / size) }, (_, i) => commits.slice(i * size, (i + 1) * size));
  await Promise.all(
    chunks.map(async (chunk) => {
      const out = await git.run(['log', '--no-walk=unsorted', '--stdin', '--numstat', '--format=%x1e%H'], {
        input: chunk.map((commit) => commit.sha).join('\n'),
      });
      for (const record of out.split('\x1e')) {
        const [sha, ...lines] = record.split('\n');
        const commit = bySha.get(sha as string);
        if (!commit) continue;
        commit.files = lines.flatMap((line) => {
          const [ins, dels, path] = splitTabs(line);
          return path === undefined ? [] : [[path, ins === '-' ? null : Number(ins), dels === '-' ? null : Number(dels)]];
        });
      }
    }),
  );
}

/** `line.split('\t', 2)`: a path may hold a tab. */
function splitTabs(line: string) {
  const first = line.indexOf('\t');
  const second = first < 0 ? -1 : line.indexOf('\t', first + 1);
  return second < 0 ? [line] : [line.slice(0, first), line.slice(first + 1, second), line.slice(second + 1)];
}

/** The commits of each recent version branch since `since`, newest first, as `git log --since` walks them. */
export async function versionWindows(git: Git, refs: Refs, since: number) {
  return Promise.all(
    versionRefs(refs).map(async (ref) => {
      const out = await git.run(['log', refs[ref] as string, `--since=@${since}`, '--no-merges', '--format=%H'], { check: false });
      return [ref, out.split('\n').filter(Boolean)] as [string, string[]];
    }),
  );
}

/** Author of the commit a forward-port chain started from, following its X-original-commit links. */
export async function rootAuthor(git: Git, sha: string) {
  let [current, author]: [string, string | null] = [sha, null];
  for (let step = 0; step < 12; step++) {
    const out = await git.run(['log', '-1', '--format=%ae%x1f%B', current], { check: false });
    if (!out) break;
    const separator = out.indexOf('\x1f');
    author = strip(out.slice(0, separator)).toLowerCase().split('@')[0] as string;
    const origin = new RegExp(`${re.lineStart}X-original-commit: ([0-9a-f]{7,40})`, 'u').exec(out.slice(separator + 1));
    if (!origin) break;
    current = origin[1] as string;
  }
  return author;
}

/** The moved and renamed lines of a commit (one rev) or of a diff between two revs. */
export async function readMechanics(git: Git, revs: string[]): Promise<Mechanical> {
  const args = revs.length === 1 ? ['show', '--format=', revs[0] as string] : ['diff', ...revs];
  return Object.fromEntries(mechanicalLines(await git.run([...args, '-U0', '--no-color', '-M', '--no-ext-diff'], { check: false })));
}

/** When each version branch left master: what master was at a given time. */
export async function versionForks(git: Git, refs: Refs) {
  const master = 'refs/remotes/origin/master';
  if (!refs[master]) return {};
  const forks = await Promise.all(
    versionRefs(refs)
      .filter((ref) => ref !== master)
      .map(async (ref) => {
        const base = (await git.run(['merge-base', master, ref], { check: false })).trim();
        const stamp = base ? (await git.run(['show', '-s', '--format=%ct', base], { check: false })).trim() : '';
        return /^\d+$/.test(stamp) ? [[ref.replace('refs/remotes/origin/', ''), Number(stamp)]] : [];
      }),
  );
  return Object.fromEntries(forks.flat()) as Record<string, number>;
}

/** Payroll logic lives in XML records too: the files of master whose records hold Python code. */
export async function ruleFiles(git: Git) {
  const out = await git.run(['grep', '-l', '-E', 'amount_python_compute|condition_python', 'refs/remotes/origin/master', '--', '*.xml'], {
    check: false,
  });
  return out.split('\n').flatMap((line) => (line.includes(':') ? [line.slice(line.indexOf(':') + 1)] : []));
}

/**
 * Everything the version branches of a clone tell: the members' commits, the window of each recent branch, the forks. Only the
 * commits added since `cursor` are read, and the moved lines of those not `known` yet.
 */
export async function collectHistory(
  repo: string,
  git: Git,
  members: ReadonlySet<string>,
  since: number,
  { cursor, known = new Set() }: { cursor?: HistoryCursor; known?: ReadonlySet<string> } = {},
) {
  const refs = await readRefs(git);
  const [history, windows, forks, rules] = await Promise.all([
    versionCommits(git, refs, members, cursor),
    versionWindows(git, refs, since),
    repo === 'odoo' ? versionForks(git, refs) : {},
    ruleFiles(git),
  ]);
  const inWindow = new Set(windows.flatMap(([, shas]) => shas));
  await Promise.all(
    history.commits
      .filter((commit) => inWindow.has(commit.sha) && needsRootAuthor(commit))
      .map(async (commit) => {
        commit.rootAuthor = await rootAuthor(git, commit.sha);
      }),
  );
  // Whatever the rule files, a file that counts for the threshold counts the same.
  const worth = history.commits.filter((commit) => !known.has(commit.sha.slice(0, 12)) && worthMechanics(repo, commitFiles(commit), {}));
  const mechanics = new Map(
    await Promise.all(worth.map(async (commit) => [commit.sha.slice(0, 12), await readMechanics(git, [commit.sha])] as const)),
  );
  return { repo, refs, ...history, windows, forks, rules, mechanics };
}
