import { mergebotCommand, parseTrailers } from '../domain/messages';
import { splitWords } from '../domain/py';
import { type Data, type Github, isoTs } from './github';

export type ForcePush = { at: number; actor: string | null; before: string; after: string; kind: string; delta: number };
export type PrDetail = {
  title: string;
  head_ref: string;
  head_owner: string | null;
  merged_at: number | null;
  tasks: string[];
  opws: string[];
  desc_words: number;
  state: string;
  draft: boolean;
  author: string | null;
  created_at: number;
  closed_at: number | null;
  additions: number;
  deletions: number;
  changed_files: number;
  reviews: { login: string | null; state: string; at: number }[];
  comments: number;
  force_pushes: ForcePush[];
  ready_at: number[];
  fetched: number;
};
export type MissingPr = { state: 'MISSING'; fetched: number };

const prKey = (key: string) => {
  const [slug, number] = key.split('#') as [string, string];
  const [owner, name] = slug.split('/') as [string, string];
  return { owner, name, number: Number(number) };
};

/** A query for a batch of PRs; `light` leaves out the diff sizes of the force-pushed commits, which make GitHub time out. */
export function prQuery(keys: string[], light: boolean) {
  const commit = light ? 'oid' : 'oid additions deletions changedFilesIfAvailable';
  const aliases = keys.map((key, i) => {
    const { owner, name, number } = prKey(key);
    return `p${i}: repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${number}) { ...F } }`;
  });
  return `query { viewer { login } rateLimit { cost remaining resetAt } ${aliases.join(' ')} }
    fragment F on PullRequest {
      title headRefName headRepositoryOwner { login } mergedAt bodyText
      state isDraft createdAt closedAt additions deletions changedFiles author { login }
      reviews(first: 50) { nodes { author { login } state submittedAt } }
      comments { totalCount }
      timelineItems(first: 100, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT, READY_FOR_REVIEW_EVENT]) {
        nodes {
          __typename
          ... on HeadRefForcePushedEvent { createdAt actor { login } beforeCommit { ${commit} } afterCommit { ${commit} } }
          ... on ReadyForReviewEvent { createdAt }
        }
      }
    }`;
}

/** What the dashboard keeps of a PR. Odoo PRs are mostly one commit per repo: an unchanged head diff size is a plain rebase. */
export function readPr(node: Data, now: number): PrDetail {
  const stats = (commit: Data) => [commit.additions, commit.deletions, commit.changedFilesIfAvailable];
  const items: Data[] = node.timelineItems.nodes;
  const forcePushes = items.flatMap((item): ForcePush[] => {
    if (item.__typename !== 'HeadRefForcePushedEvent' || !item.afterCommit) return [];
    const before: Data = item.beforeCommit ?? {};
    const after: Data = item.afterCommit;
    const known = 'additions' in after && 'additions' in before;
    const same = known && Bun.deepEquals(stats(before), stats(after));
    const delta = Math.abs((after.additions ?? 0) - (before.additions ?? 0)) + Math.abs((after.deletions ?? 0) - (before.deletions ?? 0));
    return [
      {
        at: isoTs(item.createdAt),
        actor: item.actor?.login ?? null,
        before: (before.oid ?? '').slice(0, 12),
        after: after.oid.slice(0, 12),
        kind: !known ? 'unknown' : same ? 'rebase' : 'rebase+code',
        delta: same || !known ? 0 : delta,
      },
    ];
  });
  const trailers = parseTrailers(node.bodyText ?? '');
  return {
    title: node.title,
    head_ref: node.headRefName,
    head_owner: node.headRepositoryOwner?.login ?? null,
    merged_at: node.mergedAt ? isoTs(node.mergedAt) : null,
    tasks: trailers.tasks,
    opws: trailers.opws,
    desc_words: splitWords(node.bodyText ?? '').length,
    state: node.state,
    draft: node.isDraft,
    author: node.author?.login ?? null,
    created_at: isoTs(node.createdAt),
    closed_at: node.closedAt ? isoTs(node.closedAt) : null,
    additions: node.additions,
    deletions: node.deletions,
    changed_files: node.changedFiles,
    reviews: (node.reviews.nodes as Data[])
      .filter((review) => review.submittedAt)
      .map((review) => ({ login: review.author?.login ?? null, state: review.state, at: isoTs(review.submittedAt) })),
    comments: node.comments.totalCount,
    force_pushes: forcePushes,
    ready_at: items.filter((item) => item.__typename === 'ReadyForReviewEvent').map((item) => isoTs(item.createdAt)),
    fetched: now,
  };
}

/**
 * When GitHub last saw each PR change, a comment, a push, a review or its merge, and whether it merges into its branch: one
 * query for many. `null` when it failed.
 */
export async function readUpdatedAt(gh: Github, keys: string[], size = 50) {
  const updated = new Map<string, { at: number; mergeable: string }>();
  for (let i = 0; i < keys.length; i += size) {
    const chunk = keys.slice(i, i + size);
    const aliases = chunk.map((key, j) => {
      const { owner, name, number } = prKey(key);
      return `p${j}: repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${number}) { updatedAt mergeable } }`;
    });
    const data = await gh.query(`query { rateLimit { cost remaining resetAt } ${aliases.join(' ')} }`);
    if (!data) return null;
    chunk.forEach((key, j) => {
      const pr = data[`p${j}`]?.pullRequest;
      if (pr?.updatedAt) updated.set(key, { at: isoTs(pr.updatedAt), mergeable: pr.mergeable });
    });
  }
  return updated;
}

/**
 * Batches of `size` PRs; one GitHub fails on is split, a lone PR then read without diff sizes, which `light` leaves out
 * from the start.
 */
export async function readPullRequests(gh: Github, keys: string[], now: number, { size = 25, light = false } = {}) {
  const read = new Map<string, PrDetail | MissingPr>();
  let viewer = null as string | null;
  const queue: [string[], boolean][] = [];
  for (let i = 0; i < keys.length; i += size) queue.push([keys.slice(i, i + size), light]);
  const worker = async () => {
    for (let next = queue.shift(); next && !gh.stopped; next = queue.shift()) {
      const [chunk, light] = next;
      const data = await gh.query(prQuery(chunk, light), { countFailure: light });
      if (!data) {
        if (gh.stopped) break;
        if (chunk.length > 1) queue.unshift([chunk.slice(0, chunk.length >> 1), light], [chunk.slice(chunk.length >> 1), light]);
        else if (!light) queue.unshift([chunk, true]);
        else read.set(chunk[0] as string, { state: 'MISSING', fetched: now });
        continue;
      }
      viewer = data.viewer?.login ?? viewer;
      chunk.forEach((key, i) => {
        const node = data[`p${i}`]?.pullRequest;
        read.set(key, node ? readPr(node, now) : { state: 'MISSING', fetched: now });
      });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { read, viewer };
}

/**
 * When each r+ was given: the `robodoo r+` comments and reviews of merged PRs. The Signed-off-by trailer tells who approved,
 * but its commit is dated by the merge, which the mergebot does on its own, hours or days later. A batch GitHub fails on is
 * split; a lone PR still failing is marked missing, to be tried again in a week.
 */
export async function readRplus(gh: Github, keys: string[], now: number, size = 20) {
  const read = new Map<string, { at: number; r: [string, number][]; missing?: true }>();
  const queue: string[][] = [];
  for (let i = 0; i < keys.length; i += size) queue.push(keys.slice(i, i + size));
  for (let chunk = queue.shift(); chunk && !gh.stopped; chunk = queue.shift()) {
    const aliases = chunk.map((key, i) => {
      const { owner, name, number } = prKey(key);
      return (
        `p${i}: repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${number}) { ` +
        'comments(last: 100) { nodes { author { login } createdAt body } } reviews(last: 50) { nodes { author { login } submittedAt body } } } }'
      );
    });
    const data = await gh.query(`query { rateLimit { cost remaining resetAt } ${aliases.join(' ')} }`, {
      countFailure: chunk.length === 1,
    });
    if (!data) {
      if (gh.stopped) break;
      if (chunk.length > 1) queue.unshift(chunk.slice(0, chunk.length >> 1), chunk.slice(chunk.length >> 1));
      else read.set(chunk[0] as string, { at: now, missing: true, r: [] });
      continue;
    }
    chunk.forEach((key, i) => {
      const node = data[`p${i}`]?.pullRequest;
      if (!node) {
        read.set(key, { at: now, missing: true, r: [] });
        return;
      }
      const given: [string, number][] = [
        ...(node.comments.nodes as Data[])
          .filter((comment) => comment?.createdAt && mergebotCommand(comment.body, 'r+'))
          .map((comment): [string, number] => [comment.author?.login ?? '', isoTs(comment.createdAt)]),
        ...(node.reviews.nodes as Data[])
          .filter((review) => review?.submittedAt && mergebotCommand(review.body, 'r+'))
          .map((review): [string, number] => [review.author?.login ?? '', isoTs(review.submittedAt)]),
      ];
      read.set(key, { at: now, r: given.sort((a, b) => a[1] - b[1]) });
    });
  }
  return read;
}
