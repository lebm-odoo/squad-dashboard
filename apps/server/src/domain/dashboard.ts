import {
  archived,
  assemble,
  type BranchRecord,
  type FeatureSources,
  type GithubPr,
  loginName,
  type MergebotPr,
  type MergedCommit,
  type RunbotBundle,
} from './features';
import { featureGroups, type GhReview, type MemberCommit, type MemberRplus, writersOf } from './groups';
import { githubLoginSources } from './logins';
import { featureRplus, type RplusStore, requestsReport, reviewRows, rplusAt, type TrailerReview } from './reviews';

/** The facts the dashboard is computed from, whatever stores them: the V1 archive, or the database. */
export type DashboardInput = Omit<FeatureSources, 'loginNames' | 'prs'> & {
  /** Now, in seconds: the activity of the last `sinceDays` days is shown. */
  now: number;
  sinceDays: number;
  me: string;
  forcedLogins: Record<string, string>;
  deducedLogins: Record<string, string>;
  viewer: string | null;
  branches: Record<string, Record<string, BranchRecord>>;
  merged: MergedCommit[];
  trailerReviews: TrailerReview[];
  archivedReviews: Record<string, TrailerReview>;
  /** Over the whole history: what the people read wrote and gave the r+ to, which joins the PRs of a feature. */
  written: MemberCommit[];
  signed: MemberRplus[];
  ghReviews: Record<string, GhReview>;
  rplus: RplusStore;
  mergebot: Record<string, MergebotPr>;
  runbot: Record<string, RunbotBundle>;
  github: Record<string, GithubPr>;
  archivedFeatures: Record<string, ReturnType<typeof assemble>[number]>;
  requests: Parameters<typeof requestsReport>[0];
  /** The PRs of others the people followed touch: shown whole, though their authors are not followed. */
  related: string[];
  /** Me and my squad: their PRs and reviews make a review request a colleague's. */
  squad: ReadonlySet<string>;
};

export function deriveDashboard(input: DashboardInput) {
  const labels = Object.fromEntries(Object.entries(input.mergebot).map(([key, pr]) => [key, pr.label]));
  const featureOf = featureGroups({
    reviewRows: input.signed,
    commits: input.written,
    archivedReviews: Object.values(input.archivedReviews),
    ghReviews: Object.values(input.ghReviews),
    labels,
  });
  const writers = writersOf(input.written, featureOf);

  const mergedAt = new Map<string, number>();
  for (const commit of input.merged) {
    for (const [slug, number] of commit.closes) {
      const key = `${slug}#${number}`;
      mergedAt.set(key, Math.min(mergedAt.get(key) ?? commit.ct, commit.ct));
    }
  }
  // A merge is git's to tell: outside the squad a mergebot page is not read again, and GitHub only says closed.
  const mergedUnseen = (pr: { repo: string; number: number; state?: string }) =>
    pr.state !== 'merged' && mergedAt.has(`${pr.repo}#${pr.number}`);
  // The PRs mergebot already knows, of the runbot bundles, of the merged commits, of the related work and of the branches git
  // read, a draft runbot has no bundle for yet; sorted, where the V1 iterated a Python set and so ordered the pushes of the
  // same second differently from run to run.
  const keys = new Set([
    ...Object.values(input.runbot).flatMap((bundle) => bundle.prs.map((pr) => `${pr.repo}#${pr.number}`)),
    ...mergedAt.keys(),
    ...input.related,
    ...Object.keys(input.mergebot).filter((key) => Object.hasOwn(input.branches, input.mergebot[key]?.label?.split(':').pop() ?? '')),
  ]);
  const prs = Object.fromEntries(
    [...keys].sort().flatMap((key) => {
      const pr = input.mergebot[key];
      if (!pr || pr.state === 'missing') return [];
      const linked = (pr.linked as { repo: string; number: number; state: string }[] | undefined)?.map((link) =>
        mergedUnseen(link) ? { ...link, state: 'merged' } : link,
      );
      const merged = mergedUnseen(pr) && { state: 'merged', phase: 'Merged', blocked: false, merged_at: pr.merged_at ?? mergedAt.get(key) };
      return [[key, { ...pr, ...merged, ...(linked && { linked }) }]];
    }),
  );

  const logins = githubLoginSources({
    github: input.github,
    labels,
    names: input.names,
    me: input.me,
    viewer: input.viewer,
    deduced: input.deducedLogins,
    forced: input.forcedLogins,
  });
  const loginNames = Object.fromEntries([...logins].map(([member, [login]]) => [login.toLowerCase(), member]));
  const sources: FeatureSources = { ...input, prs, loginNames };
  const nameOf = (login: string | null) => loginName(sources, login);
  const datedRplus = (reviewer: string, prs: string[], merged: number) => rplusAt(input.rplus, nameOf, reviewer, prs, merged);

  const features = archived(assemble(sources), { ...input.archivedFeatures }, input.names).map((f) => ({
    ...f,
    rplus: featureRplus(input.rplus, nameOf, f),
  }));
  // Every feature seen is kept, with its r+, to be shown again once no source reports it.
  const keptFeatures = { ...input.archivedFeatures, ...Object.fromEntries(features.filter((f) => !f.archived).map((f) => [f.name, f])) };
  // The archive keeps the r+ read by older rules: whoever wrote part of the feature did not review it.
  const stored = new Map(Object.entries(input.archivedReviews));
  for (const review of input.trailerReviews) stored.set(review.id, review);
  for (const [key, review] of stored) {
    if (review.reviewer === review.author || writers.get(featureOf(review.pr))?.has(review.reviewer)) stored.delete(key);
  }
  const reviews = reviewRows({
    stored,
    ghReviews: Object.entries(input.ghReviews),
    names: input.names,
    features,
    featureOf,
    writers,
    labels,
    loginName: nameOf,
    rplusAt: datedRplus,
  });
  const dated = [...features.flatMap((f) => (f.first_at ? [f.first_at] : [])), ...reviews.map((row) => row.t as number)];
  return {
    features,
    reviews,
    review_requests: requestsReport(input.requests, input.squad, nameOf),
    logins: Object.fromEntries([...logins].map(([member, [login]]) => [member, login])),
    login_sources: Object.fromEntries(logins),
    history_since: dated.length ? Math.min(...dated) : null,
    archive: { features: keptFeatures, reviews: Object.fromEntries(stored) },
  };
}
