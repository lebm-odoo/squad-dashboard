import { ownerOf } from './branches';
import type { Feature } from './features';
import type { GhReview } from './groups';
import { isPortTitle } from './messages';
import { mostCommon } from './py';

/** The `robodoo r+` of merged PRs: who gave each r+ and when, the merge coming later on its own. */
export type RplusStore = Record<string, { r: [string, number][] } | undefined>;
/** An r+ read from the Signed-off-by trailers of a merged commit, for the people whose work is followed. */
export type TrailerReview = {
  id: string;
  reviewer: string;
  pr: string;
  related?: string[];
  feature?: string;
  repo: string;
  t: number;
  author: string;
  subject: string;
  target: string;
  fw: boolean;
  hr: boolean;
  fix: boolean;
};
type LoginName = (login: string | null) => string | null;

/** When the reviewer gave the r+ that let the PR merge: their last `robodoo r+` up to the merge, else the merge. */
export function rplusAt(store: RplusStore, loginName: LoginName, reviewer: string, prs: string[], merged: number) {
  const times = prs.flatMap((pr) =>
    (store[pr]?.r ?? []).filter(([login, at]) => loginName(login) === reviewer && at <= merged + 3600).map(([, at]) => at),
  );
  return times.length ? Math.max(...times) : merged;
}

/** The r+ of each reviewer of a feature, dated by their `robodoo r+` on its merged PRs. */
export function featureRplus(store: RplusStore, loginName: LoginName, feature: Pick<Feature, 'reviewers' | 'prs'>) {
  const reviewers = new Set(feature.reviewers ?? []);
  const out: Record<string, number> = {};
  for (const pr of feature.prs ?? []) {
    if (pr.state !== 'merged') continue;
    for (const [login, at] of store[`${pr.repo}#${pr.number}`]?.r ?? []) {
      const who = loginName(login) as string;
      if (reviewers.has(who) && (!pr.merged_at || at <= pr.merged_at + 3600)) out[who] = Math.max(out[who] ?? 0, at);
    }
  }
  return out;
}

/** The reviews of the people followed: their r+, dated by the r+ comment, and their GitHub reviews on the work of others. */
export function reviewRows(input: {
  stored: Map<string, TrailerReview>;
  ghReviews: [string, GhReview][];
  names: ReadonlySet<string>;
  features: Feature[];
  featureOf: (pr: string) => string;
  writers: Map<string, Map<string, number>>;
  labels: Record<string, string | undefined>;
  loginName: LoginName;
  rplusAt: (reviewer: string, prs: string[], merged: number) => number;
}) {
  const rows: Record<string, unknown>[] = [...input.stored.values()]
    .filter((review) => input.names.has(review.reviewer))
    .map((review) => ({
      ...review,
      t: input.rplusAt(review.reviewer, [review.pr], review.t),
      merged_at: review.t,
      src: 'r+',
      feature: input.featureOf(review.pr),
    }));
  for (const [key, review] of input.ghReviews) {
    if (!input.names.has(review.reviewer)) continue;
    let author = input.loginName(review.author_login);
    const forwardPort = /bot|robodoo/i.test(review.author_login);
    if (forwardPort) {
      // Forward-ports are opened by fw-bot: the branch name tells whose change it carries.
      const label = input.labels[review.pr] ?? '';
      const branch = review.head_ref || (label.includes(':') ? label.slice(label.indexOf(':') + 1) : label);
      author = ownerOf(branch, input.names) ?? author;
    }
    const writers = input.writers.get(input.featureOf(review.pr)) ?? new Map<string, number>();
    if (writers.size && !writers.has(author as string)) author = mostCommon(writers)[0]?.[0] as string;
    if (author === review.reviewer || writers.has(review.reviewer)) continue;
    rows.push({
      id: key,
      reviewer: review.reviewer,
      pr: review.pr,
      repo: review.repo,
      t: review.t,
      author,
      subject: review.subject,
      target: '',
      fw: forwardPort,
      hr: false,
      fix: review.fix,
      src: 'github',
      state: review.state,
      onboarding: (review.head_ref ?? '').includes('onboarding'),
      feature: input.featureOf(review.pr),
    });
  }
  // Reviews on the PRs of a port (another version of a change merged first) are no review work.
  const portPrs = new Set(
    input.features.filter((f) => f.kind === 'forward-port').flatMap((f) => f.prs.map((pr) => `${pr.repo}#${pr.number}`)),
  );
  for (const row of rows) if (portPrs.has(row.pr as string) || isPortTitle(row.subject as string)) row.fw = true;
  return rows;
}

type RequestedPr = {
  pr: string;
  author: string;
  head?: string;
  asked_at?: number | null;
  reviews: [string, string, number][];
  rplus: [string, number][];
  rminus?: [string, number][];
  [key: string]: unknown;
};

/** When `login` last gave the r+ to a PR, 0 if never. */
export const rplusBy = (pr: Pick<RequestedPr, 'rplus'>, login: string) =>
  Math.max(0, ...pr.rplus.filter(([who]) => who.toLowerCase() === login.toLowerCase()).map(([, at]) => at));

/** A review asked of `login`, answered with their r+ since: the mergebot's to merge now. */
export const answered = (pr: Pick<RequestedPr, 'rplus' | 'asked_at'>, login: string) => rplusBy(pr, login) > (pr.asked_at ?? 0);

/**
 * The reviews GitHub asks of oneself, told apart: a PR of a colleague, the reviews of colleagues, the r+ given by anyone else.
 * Colleagues are my squad and the members of my GitHub teams, as GitHub listed them with the requests. Those I gave the r+ to
 * are followed apart, with when.
 */
export function requestsReport(
  found:
    | { login: string; prs: RequestedPr[]; followed?: RequestedPr[]; colleagues?: string[]; v?: number; [key: string]: unknown }
    | null
    | undefined,
  squad: ReadonlySet<string>,
  loginName: LoginName,
) {
  if (found?.v !== 2) return null;
  const { followed = [], colleagues = [], ...requests } = found;
  const me = found.login.toLowerCase();
  const logins = new Set(colleagues.map((login) => login.toLowerCase()));
  const colleague = (login: string) => logins.has(login.toLowerCase()) || squad.has(loginName(login) as string);
  const report = ({ reviews, rplus, rminus = [], ...pr }: RequestedPr) => {
    const who = loginName(pr.author);
    return {
      ...pr,
      who,
      colleague: colleague(pr.author) || ownerOf(pr.head ?? '', squad) !== null,
      validations: reviews
        .filter(([login]) => login.toLowerCase() !== me && colleague(login) && loginName(login) !== who)
        .map(([login, state, at]) => [loginName(login), state, at]),
      rplus: rplus.filter(([login]) => login.toLowerCase() !== me).map(([login, at]) => [loginName(login), at]),
      rminus: rminus.map(([login, at]) => [loginName(login), at]),
    };
  };
  return {
    ...requests,
    prs: found.prs.filter((pr) => !answered(pr, me)).map(report),
    followed: [...found.prs.filter((pr) => answered(pr, me)), ...followed].map((pr) => ({ ...report(pr), rplus_at: rplusBy(pr, me) })),
  };
}
