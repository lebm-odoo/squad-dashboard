/** A commit of a member merged on a version branch, one row per member who wrote or co-wrote it. */
export type MemberCommit = {
  id: string;
  member: string;
  coauthor: boolean;
  pr: string;
  related?: string[];
  subject?: string;
  at: number;
  ct: number;
};
/** An r+ given by a member, read from the Signed-off-by trailers mergebot writes. */
export type MemberRplus = { id: string; reviewer: string; t: number; author: string; prs?: string[] };
export type GhReview = {
  reviewer: string;
  pr: string;
  repo: string;
  t: number;
  state: string;
  author_login: string;
  head_ref?: string;
  subject: string;
  fix: boolean;
};

/**
 * The feature a PR belongs to, the same for its odoo, enterprise and upgrade PRs: PRs are joined by the Related trailers of
 * the merged commits, by ports by hand, and by their branch name, which also joins the PRs not merged yet.
 */
export function featureGroups(input: {
  reviewRows: { prs?: string[] }[];
  commits: MemberCommit[];
  archivedReviews: { pr: string; related?: string[] }[];
  ghReviews: { pr: string; head_ref?: string }[];
  labels: Record<string, string | undefined>;
}) {
  const parent = new Map<string, string>();
  const find = (key: string) => {
    let x = key;
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x) as string) as string);
      x = parent.get(x) as string;
    }
    return x;
  };
  // The smallest PR names the feature, a branch name only when no PR does: each group is named after its smallest member.
  const rank = (key: string) => [key.startsWith('branch:') ? 1 : 0, key] as const;
  const union = (a: string, b: string) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra === rb) return;
    const [x, y] = [rank(ra), rank(rb)];
    const aFirst = x[0] !== y[0] ? x[0] < y[0] : x[1] < y[1];
    parent.set(aFirst ? rb : ra, aFirst ? ra : rb);
  };

  const linked: string[][] = [
    ...input.reviewRows.map((row) => row.prs ?? []),
    ...input.archivedReviews.map((row) => [row.pr, ...(row.related ?? [])]),
    ...input.commits.filter((commit) => commit.related?.length).map((commit) => [commit.pr, ...(commit.related ?? [])]),
  ];
  // Ports by hand: the same subject by the same person, merged within 4 months, on another version.
  const bySubject = new Map<string, MemberCommit[]>();
  for (const commit of input.commits) {
    if (!commit.subject) continue;
    const key = `${commit.member}\u0000${commit.subject}`;
    bySubject.set(key, [...(bySubject.get(key) ?? []), commit]);
  }
  for (const commits of bySubject.values()) {
    commits.sort((a, b) => a.ct - b.ct);
    commits.slice(1).forEach((b, i) => {
      const a = commits[i] as MemberCommit;
      if (b.ct - a.ct <= 120 * 86400 && a.pr !== b.pr) linked.push([a.pr, b.pr]);
    });
  }
  for (const [first, ...rest] of linked) for (const pr of rest) union(first as string, pr);
  const branches: [string, string | undefined][] = [
    ...input.ghReviews.map((review) => [review.pr, review.head_ref] as [string, string | undefined]),
    ...Object.entries(input.labels).map(([key, label]) => {
      const text = label ?? '';
      return [key, text.includes(':') ? text.slice(text.indexOf(':') + 1) : text] as [string, string];
    }),
  ];
  // Forward-port branches of fw-bot carry the name of the original one with a suffix: they stay apart.
  for (const [pr, branch] of branches) if (branch && !branch.endsWith('-fw') && pr.includes('#')) union(pr, `branch:${branch}`);
  return find;
}

/** The members who wrote or co-wrote each feature: a PR opened by someone else still belongs to them, and their own review of
 * it is no review. */
export function writersOf(commits: MemberCommit[], featureOf: (pr: string) => string) {
  const writers = new Map<string, Map<string, number>>();
  for (const commit of commits) {
    const feature = featureOf(commit.pr);
    const counter = writers.get(feature) ?? (writers.set(feature, new Map()).get(feature) as Map<string, number>);
    counter.set(commit.member, (counter.get(commit.member) ?? 0) + 1);
  }
  return writers;
}
