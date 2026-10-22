import { domainOf, moduleOf, type RuleFiles, renamedPath } from './classify';
import type { FeatureSources, MergedCommit } from './features';
import type { MemberCommit, MemberRplus } from './groups';
import { coauthorsOf, isPortTitle, parseTrailers, portSubject, prRefs, relatedPrs } from './messages';
import { re, strip } from './py';
import type { TrailerReview } from './reviews';
import { type FileStat, type Mechanical, worthMechanics } from './weight';

/** A commit of a version branch as git log gives it: `files` is its numstat with raw paths, a binary file counted `null`. */
export type VersionCommit = {
  sha: string;
  authorName: string;
  authorEmail: string;
  at: number;
  ct: number;
  subject: string;
  body: string;
  files: [string, number | null, number | null][];
  /** For a forward-port: the author at the start of its X-original-commit chain. */
  rootAuthor?: string | null;
};

const localPart = (email: string) => email.toLowerCase().split('@')[0] as string;
const prOf = (repo: string, commit: VersionCommit) => {
  const [closes] = prRefs(commit.body);
  return closes ? `${closes[0]}#${closes[1]}` : `${repo}@${commit.sha.slice(0, 12)}`;
};
const signersOf = (body: string) =>
  [...body.matchAll(new RegExp(`${re.lineStart}Signed-off-by: [^<\\n]*<([^>]+)>`, 'gu'))].map((match) => localPart(match[1] as string));

export const commitFiles = (commit: VersionCommit) =>
  commit.files.map(([path, ins, dels]): FileStat => [renamedPath(path), ins ?? 0, dels ?? 0]);

/** The forward-ports whose reviewer must be told apart from their original author: signed off at least twice. */
export const needsRootAuthor = (commit: VersionCommit) =>
  (commit.body.includes('X-original-commit:') || isPortTitle(commit.subject)) && signersOf(commit.body).length >= 2;

/** The moved lines of a change as the collector read them, for the changes big enough to be searched. */
export function recordedMechanics(recorded: ReadonlyMap<string, Mechanical>, ruleFiles: RuleFiles): FeatureSources['mechanics'] {
  return (repo, files, revs) => {
    if (!worthMechanics(repo, files, ruleFiles)) return {};
    const key = `${repo}:${revs.map((rev) => rev.slice(0, 12)).join(':')}`;
    const lines = recorded.get(key);
    if (!lines) throw new Error(`lignes mécaniques non lues : ${key}`);
    return lines;
  };
}

/** The commits the V1 selected with `git log -i --author=<member>@odoo.com`, where the dots match any character. */
export function authoredBy(members: ReadonlySet<string>) {
  const pattern = new RegExp(`(?:${[...members].join('|')})@odoo.com`, 'is');
  return (commit: VersionCommit) => members.size > 0 && pattern.test(`${commit.authorName} <${commit.authorEmail}>`);
}

/** The commits the V1 selected with `git log -E -i --grep='<trailer>: .*<(members)@odoo\.com>'`, line by line. */
export function trailerNames(trailer: string, members: ReadonlySet<string>) {
  const pattern = new RegExp(`${trailer}: .*<(?:${[...members].join('|')})@odoo\\.com>`, 'is');
  return (commit: VersionCommit) => members.size > 0 && [commit.subject, ...commit.body.split('\n')].some((line) => pattern.test(line));
}

/** The first row of each id, as the V1 kept them across branches and runs. */
export function firstOfEach<T extends { id: string }>(rows: T[]) {
  const kept = new Map<string, T>();
  for (const row of rows) if (!kept.has(row.id)) kept.set(row.id, row);
  return [...kept.values()];
}

/** The commits of a version branch's window written or co-written by the people followed, one row per person. */
export function mergedOn(repo: string, ref: string, commits: VersionCommit[], names: ReadonlySet<string>) {
  const rows = new Map<string, MergedCommit>();
  for (const selected of [authoredBy(names), trailerNames('Co-authored-by', names)]) {
    for (const commit of commits.filter(selected)) {
      const author = localPart(commit.authorEmail);
      const owners = [...new Set([author, ...coauthorsOf(commit.body)])].filter((name) => names.has(name)).sort();
      for (const owner of owners) {
        rows.set(`${commit.sha}:${owner}`, {
          id: `${commit.sha}:${owner}`,
          repo,
          sha: commit.sha.slice(0, 12),
          owner,
          author,
          coauthor: owner !== author,
          at: commit.at,
          ct: commit.ct,
          target: ref.replace(/^refs\/remotes\/origin\//, ''),
          subject: commit.subject,
          fw: commit.body.includes('X-original-commit:'),
          files: commitFiles(commit),
          ...parseTrailers(`${commit.subject}\n${commit.body}`),
        });
      }
    }
  }
  return [...rows.values()];
}

/** The r+ of the people followed in a version branch's window, read from the Signed-off-by trailers mergebot writes. */
export function reviewsOn(repo: string, ref: string, commits: VersionCommit[], names: ReadonlySet<string>) {
  const rows: TrailerReview[] = [];
  for (const commit of commits.filter(trailerNames('Signed-off-by', names))) {
    const author = localPart(commit.authorEmail);
    const forwardPort = commit.body.includes('X-original-commit:') || isPortTitle(commit.subject);
    // A forward-port repeats the original sign-offs and appends the one who approved the port; the original author
    // approving their own port is no review, even when the port was re-authored by whoever fixed it.
    const all = signersOf(commit.body);
    const signers = !forwardPort ? all : all.length >= 2 ? all.slice(-1).filter((signer) => signer !== commit.rootAuthor) : [];
    const pr = prOf(repo, commit);
    const related = relatedPrs(commit.body);
    const modules = new Set(commit.files.map(([path]) => moduleOf(repo, renamedPath(path))));
    const writers = new Set([author, ...coauthorsOf(commit.body)]);
    for (const signer of signers) {
      if (writers.has(signer) || !names.has(signer)) continue;
      rows.push({
        id: `${signer}:${pr}`,
        reviewer: signer,
        pr,
        related,
        feature: [pr, ...related].sort()[0] as string,
        repo,
        t: commit.ct,
        author,
        subject: commit.subject,
        target: ref.replace(/^refs\/remotes\/origin\//, ''),
        fw: forwardPort,
        hr: [...modules].some((module) => !['Other', 'Framework', 'Localization'].includes(domainOf(module))),
        fix: strip(commit.subject).toUpperCase().startsWith('[FIX]'),
      });
    }
  }
  return rows;
}

/** What each member wrote, or co-wrote, over the whole history of the version branches; ports left out. */
export function writtenOn(repo: string, commits: VersionCommit[], names: ReadonlySet<string>, coauthored: boolean) {
  const rows: MemberCommit[] = [];
  for (const commit of commits.filter(coauthored ? trailerNames('Co-authored-by', names) : authoredBy(names))) {
    const author = localPart(commit.authorEmail);
    const members = coauthored
      ? [...coauthorsOf(commit.body)].filter((member) => names.has(member) && member !== author).sort()
      : [author].filter((member) => names.has(member));
    if (!members.length || commit.body.includes('X-original-commit:')) continue;
    for (const member of members) {
      rows.push({
        id: coauthored ? `${commit.sha}:${member}` : commit.sha,
        member,
        coauthor: coauthored,
        pr: prOf(repo, commit),
        related: relatedPrs(commit.body),
        subject: portSubject(commit.subject),
        at: commit.at,
        ct: commit.ct,
      });
    }
  }
  return rows;
}

/** The r+ members gave on original changes over the whole history: a port is no review. */
export function signedOn(repo: string, commits: VersionCommit[], names: ReadonlySet<string>) {
  const rows: MemberRplus[] = [];
  for (const commit of commits.filter(trailerNames('Signed-off-by', names))) {
    if (`${commit.subject}\n${commit.body}`.includes('X-original-commit:') || isPortTitle(commit.subject)) continue;
    const author = localPart(commit.authorEmail);
    const coauthors = coauthorsOf(commit.body);
    // One r+ per feature: the linked PRs of the other repos are approved along with it.
    const prs = [prOf(repo, commit), ...relatedPrs(commit.body)];
    const signers = [...new Set(signersOf(commit.body))].filter((s) => names.has(s) && s !== author && !coauthors.has(s)).sort();
    for (const signer of signers) rows.push({ id: `${signer}:${[...prs].sort()[0]}`, reviewer: signer, t: commit.ct, author, prs });
  }
  return rows;
}

/** What the version branches tell of the people read: their merged commits and r+ in the window, and over the whole history. */
export function versionRows(
  histories: { repo: string; commits: VersionCommit[]; windows: [string, string[]][] }[],
  names: ReadonlySet<string>,
) {
  const windowed = <R>(read: (repo: string, ref: string, commits: VersionCommit[]) => R[]) =>
    histories.flatMap(({ repo, commits, windows }) => {
      const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
      return windows.flatMap(([ref, shas]) =>
        read(
          repo,
          ref,
          shas.flatMap((sha) => bySha.get(sha) ?? []),
        ),
      );
    });
  return {
    merged: firstOfEach(windowed((repo, ref, commits) => mergedOn(repo, ref, commits, names))),
    reviews: firstOfEach(windowed((repo, ref, commits) => reviewsOn(repo, ref, commits, names))),
    written: firstOfEach(histories.flatMap(({ repo, commits }) => writtenOn(repo, commits, names, false))),
    coauthored: firstOfEach(histories.flatMap(({ repo, commits }) => writtenOn(repo, commits, names, true))),
    signed: firstOfEach(histories.flatMap(({ repo, commits }) => signedOn(repo, commits, names))),
  };
}
