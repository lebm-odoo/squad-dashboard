import { mergebotCommand } from '../domain/messages';
import { re } from '../domain/py';
import { answered, rplusBy } from '../domain/reviews';
import { type Data, type Github, isoTs } from './github';
import { readUpdatedAt } from './github-prs';

/** Where a member's search stopped: done `until` a day, or halfway at `cursor`, with the login it was made for. */
export type SearchCursor = {
  login: string;
  until?: string;
  at?: number;
  start?: string;
  cursor?: string | null;
  offset?: number;
  v?: number;
  stop?: string;
  before?: string | null;
  newest?: string | null;
  error?: boolean;
};
export type FoundReview = {
  member: string;
  pr: string;
  submittedAt: string;
  state: string;
  title: string;
  authorLogin: string;
  headRef: string;
};

const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);
const safe = (text: string | null | undefined) => /^[A-Za-z0-9+/=_-]+$/.test(text ?? '');

/**
 * Reviews each member submitted on GitHub (comments, approvals, change requests) on the PRs of others, resumed where the
 * last search stopped; a member searched less than `freshFor` seconds ago is skipped. Five members per call, oldest update
 * first: a search stops at 1000 results, so past 900 the next one starts again from the last update date.
 */
export async function searchReviews(
  gh: Github,
  logins: Record<string, string>,
  progress: Record<string, SearchCursor | undefined>,
  { now, start, freshFor = 0 }: { now: number; start: string; freshFor?: number },
) {
  const found: FoundReview[] = [];
  const cursors: Record<string, SearchCursor> = {};
  const until = day(now - 86400);
  type Item = { member: string; login: string; start: string; cursor: string | null; offset: number; moved: boolean };
  const pending: Item[] = [];
  for (const [member, login] of Object.entries(logins)) {
    if (!/^[A-Za-z0-9-]+$/.test(login)) continue;
    const state: SearchCursor | Record<string, undefined> = progress[member]?.login === login ? (progress[member] as SearchCursor) : {};
    if (state.until && now - (state.at ?? 0) < freshFor) continue;
    const cursor = state.v === 2 ? (state.cursor ?? null) : null;
    pending.push({
      member,
      login,
      start: state.start || state.until || start,
      cursor,
      offset: cursor ? (state.offset ?? 0) : 0,
      moved: false,
    });
  }
  const pause = (item: Item) => {
    cursors[item.member] = { login: item.login, start: item.start, cursor: item.cursor, offset: item.offset, v: 2 };
  };
  while (pending.length && !gh.stopped) {
    const chunk = pending.slice(0, 5);
    const fields = chunk.map((item, j) => {
      const search = `type:pr reviewed-by:${item.login} -author:${item.login} repo:odoo/odoo repo:odoo/enterprise repo:odoo/upgrade updated:>=${item.start} sort:updated-asc`;
      const after = item.cursor && safe(item.cursor) ? `, after: "${item.cursor}"` : '';
      return (
        `s${j}: search(query: "${search}", type: ISSUE, first: 50${after}) { pageInfo { hasNextPage endCursor } ` +
        `nodes { ... on PullRequest { number title headRefName updatedAt repository { nameWithOwner } author { login } ` +
        `reviews(author: "${item.login}", first: 10) { nodes { state submittedAt } } } } }`
      );
    });
    const data = await gh.query(`query { rateLimit { cost remaining resetAt } ${fields.join(' ')} }`, { searches: chunk.length });
    if (!data) break;
    chunk.forEach((item, j) => {
      const result = data[`s${j}`];
      if (!result) {
        // This search failed alone: kept for the next refresh.
        pending.splice(pending.indexOf(item), 1);
        pause(item);
        return;
      }
      item.moved = true;
      const nodes = (result.nodes as Data[]).filter(Boolean);
      for (const node of nodes) {
        if (node.author?.login === item.login) continue;
        const pr = `${node.repository.nameWithOwner}#${node.number}`;
        for (const review of node.reviews.nodes as Data[]) {
          if (!review.submittedAt) continue;
          const [title, authorLogin, headRef] = [node.title, node.author?.login ?? '', node.headRefName ?? ''];
          found.push({ member: item.member, pr, submittedAt: review.submittedAt, state: review.state, title, authorLogin, headRef });
        }
      }
      if (!result.pageInfo.hasNextPage) {
        cursors[item.member] = { login: item.login, until, at: now, v: 2 };
        pending.splice(pending.indexOf(item), 1);
        return;
      }
      [item.cursor, item.offset] = [result.pageInfo.endCursor, item.offset + nodes.length];
      if (item.offset >= 900 && nodes.length)
        [item.start, item.cursor, item.offset] = [(nodes.at(-1) as Data).updatedAt.slice(0, 10), null, 0];
    });
  }
  // Cut by the quota: whoever was halfway resumes at their cursor.
  for (const item of pending) if (item.moved) pause(item);
  return { found, cursors };
}

export type RequestedPr = {
  pr: string;
  url: string;
  title: string;
  draft: boolean;
  author: string;
  head: string;
  base: string;
  created_at: number;
  updated_at: number;
  asked_at: number | null;
  direct: boolean;
  teams: string[];
  other_teams: number;
  ids: Record<string, string[]>;
  reviews: [string, string, number][];
  rplus: [string, number][];
  /** Read since my r+ could undo it: whether GitHub merges it (`CONFLICTING`), its last push, the r- given to it. */
  mergeable?: string | null;
  pushed_at?: number | null;
  rminus?: [string, number][];
};

/**
 * Open PRs where GitHub asks `login` for a review, directly or through one of their GitHub teams, in any repository: when
 * it was last asked, the ids of the PR description, and who already reviewed it or gave the r+; with the members of their
 * small teams, their colleagues. A light search lists them with when each last changed; only the ones new or changed since
 * `previous` are read in full, by batches, the others kept as they were. A batch GitHub fails on is read again smaller; a
 * search cut short keeps what was read. A PR GitHub no longer asks for is read once more: given the r+ by `login`, it stays
 * `followed` for a month, for the mergebot to merge and port, and read again when it changes: a push, an r- or a conflict can
 * undo the r+. So does an open PR `login` gave the r+ unasked, found in their last comments and reviews.
 */
export async function readReviewRequests(
  gh: Github,
  login: string,
  now: number,
  previous: RequestedPr[] = [],
  followed: RequestedPr[] = [],
  /** When the last reading was: my comments and reviews are read back to it, a month at most the first time. */
  since = 0,
  limit = 300,
) {
  if (!/^[A-Za-z0-9-]+$/.test(login)) return null;
  const search = `type:pr state:open review-requested:${login} archived:false sort:updated-desc`;
  const who = '__typename ... on User { login } ... on Team { slug }';
  const mine = (reviewer: Data) => (reviewer.login ?? '').toLowerCase() === login.toLowerCase();
  const listed: [string, number][] = [];
  let [total, cursor, myTeams, complete]: [number | null, string | null, Set<string> | null, boolean] = [null, null, null, false];
  let colleagues: string[] = [];
  while (listed.length < limit) {
    const after = cursor && safe(cursor) ? `, after: "${cursor}"` : '';
    // The user's teams in the organisation, to tell which of the teams asked is theirs, and who is in them (needs read:org,
    // else unknown).
    const teamsField =
      myTeams === null
        ? `org: organization(login: "odoo") { teams(first: 100, userLogins: ["${login}"]) { nodes { slug members(first: 100) { totalCount nodes { login } } } } } `
        : '';
    const data = await gh.query(
      `query { rateLimit { cost remaining resetAt } ${teamsField}s: search(query: "${search}", type: ISSUE, first: 100${after}) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { ` +
        'number updatedAt repository { nameWithOwner } } } } }',
      { searches: 1 },
    );
    if (!data?.s) break;
    if (myTeams === null) {
      const nodes = ((data.org?.teams?.nodes ?? []) as Data[]).filter((team) => team?.slug);
      myTeams = new Set(nodes.map((team) => team.slug as string));
      // A team of the whole organisation is no team: only the small ones tell who works together.
      colleagues = nodes
        .filter((team) => (team.members?.totalCount ?? 0) <= 100)
        .flatMap((team) => ((team.members?.nodes ?? []) as Data[]).flatMap((member) => (member?.login ? [member.login as string] : [])));
    }
    total = data.s.issueCount;
    for (const node of data.s.nodes as Data[])
      if (node?.repository) listed.push([`${node.repository.nameWithOwner}#${node.number}`, isoTs(node.updatedAt)]);
    if (!data.s.pageInfo.hasNextPage) {
      complete = true;
      break;
    }
    cursor = data.s.pageInfo.endCursor;
  }
  if (total === null) return null;
  const requestOf = (node: Data): RequestedPr => {
    const asked = (node.reviewRequests.nodes as Data[]).flatMap((request) =>
      request?.requestedReviewer ? [request.requestedReviewer] : [],
    );
    const requested = new Set(
      asked.filter((reviewer) => reviewer.__typename === 'Team' && reviewer.slug).map((reviewer) => reviewer.slug as string),
    );
    const teams = [...requested].filter((slug) => !myTeams?.size || myTeams.has(slug)).sort();
    const events = (node.timelineItems.nodes as Data[]).filter((event) => event?.createdAt);
    // The last request that brought it to the user (or a team of theirs), else the last request of the PR.
    const toMe = events
      .filter((event) => event.requestedReviewer && (mine(event.requestedReviewer) || teams.includes(event.requestedReviewer.slug)))
      .map((event) => isoTs(event.createdAt));
    const body: string = node.body ?? '';
    const reviews = (node.reviews.nodes as Data[]).filter((review) => review?.submittedAt);
    const commands = (order: 'r+' | 'r-') => [
      ...(node.comments.nodes as Data[])
        .filter((comment) => comment?.createdAt && mergebotCommand(comment.body, order))
        .map((comment): [string, number] => [comment.author?.login ?? '', isoTs(comment.createdAt)]),
      ...reviews
        .filter((review) => mergebotCommand(review.body, order))
        .map((review): [string, number] => [review.author?.login ?? '', isoTs(review.submittedAt)]),
    ];
    const pushes = [
      ...(node.pushes.nodes as Data[]).flatMap((event) => (event?.createdAt ? [isoTs(event.createdAt)] : [])),
      ...(node.commits.nodes as Data[]).flatMap((commit) => (commit?.commit?.committedDate ? [isoTs(commit.commit.committedDate)] : [])),
    ];
    const ids = (kind: string) => {
      const pattern = new RegExp(`${re.boundary}${kind}[-:#${re.space.slice(1, -1)}]+(${re.digit}{4,12})${re.boundary}`, 'giu');
      return [...new Set([...body.matchAll(pattern)].map((match) => match[1] as string))].sort();
    };
    return {
      pr: `${node.repository.nameWithOwner}#${node.number}`,
      url: node.url,
      title: node.title,
      draft: node.isDraft,
      author: node.author?.login ?? '',
      head: node.headRefName ?? '',
      base: node.baseRefName ?? '',
      created_at: isoTs(node.createdAt),
      updated_at: isoTs(node.updatedAt),
      asked_at: toMe.length ? Math.max(...toMe) : events.length ? Math.max(...events.map((event) => isoTs(event.createdAt))) : null,
      direct: asked.some(mine),
      teams,
      other_teams: [...requested].filter((slug) => !teams.includes(slug)).length,
      ids: Object.fromEntries(['opw', 'sentry', 'upg', 'task'].map((kind) => [kind, ids(kind)])),
      reviews: reviews.map((review): [string, string, number] => [review.author?.login ?? '', review.state, isoTs(review.submittedAt)]),
      rplus: commands('r+'),
      rminus: commands('r-'),
      mergeable: node.mergeable ?? null,
      pushed_at: pushes.length ? Math.max(...pushes) : null,
    };
  };
  const known = new Map(previous.map((pr) => [pr.pr, pr]));
  const asked = new Set(listed.map(([key]) => key));
  const left = complete ? previous.filter((pr) => !asked.has(pr.pr)).map((pr) => pr.pr) : [];
  const kept = followed.filter((pr) => !asked.has(pr.pr) && !left.includes(pr.pr) && now - rplusBy(pr, login) < 30 * 86400);
  // The r+ given unasked, in my comments and reviews since the last reading: GitHub's search finds my comments late, or not at
  // all. Closed by the mergebot as it merges, a PR waits on Moi for its forward-ports.
  const floor = Math.max(now - 30 * 86400, since - 3600);
  const prFields = 'number state repository { nameWithOwner }';
  const pull = `pullRequest { ${prFields} }`;
  const said: [Data | undefined, Data | undefined][] = [];
  const pages: { comments?: string | null; reviews?: string | null } = {};
  // The next page of a list, while it goes back past the floor; null once read.
  const next = (list: Data | undefined, at: (node: Data) => string | undefined) => {
    const last = (list?.nodes as Data[] | undefined)?.at(-1);
    const old = !last || isoTs(at(last) ?? '1970-01-01T00:00:00Z') < floor;
    return list?.pageInfo?.hasNextPage && !old && safe(list.pageInfo.endCursor) ? (list.pageInfo.endCursor as string) : null;
  };
  for (let i = 0; i < 10 && (pages.comments !== null || pages.reviews !== null) && !gh.stopped; i++) {
    const after = (cursor: string | null | undefined) => (cursor ? `, after: "${cursor}"` : '');
    const fields = [
      pages.comments !== null
        ? `issueComments(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }${after(pages.comments)}) { pageInfo { hasNextPage endCursor } nodes { body createdAt updatedAt ${pull} } } `
        : '',
      pages.reviews !== null
        ? `contributionsCollection { pullRequestReviewContributions(first: 100, orderBy: { direction: DESC }${after(pages.reviews)}) { pageInfo { hasNextPage endCursor } nodes { occurredAt pullRequestReview { body createdAt } ${pull} } } }`
        : '',
    ];
    const data = await gh.query(`query { rateLimit { cost remaining resetAt } user(login: "${login}") { ${fields.join('')} } }`);
    if (!data?.user) break;
    const comments: Data | undefined = data.user.issueComments;
    const reviews: Data | undefined = data.user.contributionsCollection?.pullRequestReviewContributions;
    said.push(
      ...((comments?.nodes ?? []) as Data[]).map((comment): [Data, Data] => [comment, comment?.pullRequest]),
      ...((reviews?.nodes ?? []) as Data[]).map((review): [Data, Data] => [review?.pullRequestReview, review?.pullRequest]),
    );
    if (pages.comments !== null) pages.comments = next(comments, (comment) => comment.updatedAt);
    if (pages.reviews !== null) pages.reviews = next(reviews, (review) => review.occurredAt);
  }
  // My reviews in private repositories are missing from my contributions: the search lists the PRs I reviewed since, with them.
  const reviewedSince = `type:pr reviewed-by:${login} updated:>=${new Date(floor * 1000).toISOString().slice(0, 19)}Z`;
  let after: string | null = null;
  for (let i = 0; i < 4 && !gh.stopped; i++) {
    const data = await gh.query(
      `query { rateLimit { cost remaining resetAt } s: search(query: "${reviewedSince}", type: ISSUE, first: 50${after ? `, after: "${after}"` : ''}) { ` +
        `pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { ${prFields} reviews(last: 20, author: "${login}") { nodes { body createdAt } } } } } }`,
      { searches: 1 },
    );
    if (!data?.s) break;
    for (const pr of (data.s.nodes ?? []) as Data[]) for (const review of (pr?.reviews?.nodes ?? []) as Data[]) said.push([review, pr]);
    after = data.s.pageInfo.hasNextPage && safe(data.s.pageInfo.endCursor) ? data.s.pageInfo.endCursor : null;
    if (!after) break;
  }
  const tracked = new Set([...asked, ...left, ...kept.map((pr) => pr.pr)]);
  const unasked = [
    ...new Set(
      said
        .filter(
          ([comment, pr]) => pr && comment?.createdAt && now - isoTs(comment.createdAt) < 30 * 86400 && mergebotCommand(comment.body, 'r+'),
        )
        .map(([, pr]) => `${pr?.repository.nameWithOwner}#${pr?.number}`),
    ),
  ].filter((key) => !tracked.has(key));
  // Given my r+, a PR goes on without asking me: GitHub says when it changed, to read it again, and whether it still merges,
  // which a move of its target branch alone can undo.
  const approved = [...kept, ...previous.filter((pr) => asked.has(pr.pr) && answered(pr, login))].map((pr) => pr.pr);
  const moves = approved.length ? await readUpdatedAt(gh, approved) : null;
  // A PR read before its target branch, or what can undo an r+, was kept is read again.
  const stale = listed
    .filter(([key, at]) => {
      const pr = known.get(key);
      return pr?.base === undefined || pr.mergeable === undefined || pr.updated_at < at;
    })
    .map(([key]) => key)
    .concat(
      left,
      kept.filter((pr) => pr.mergeable === undefined || (moves?.get(pr.pr)?.at ?? 0) > pr.updated_at).map((pr) => pr.pr),
      unasked,
    );
  const read = new Map<string, RequestedPr>();
  const queue: string[][] = [];
  for (let i = 0; i < stale.length; i += 20) queue.push(stale.slice(i, i + 20));
  for (let chunk = queue.shift(); chunk && !gh.stopped; chunk = queue.shift()) {
    const aliases = chunk.map((key, i) => {
      const [owner, name, number] = key.split(/[/#]/);
      return (
        `p${i}: repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${number}) { ` +
        'number title url isDraft createdAt updatedAt headRefName baseRefName body mergeable repository { nameWithOwner } author { login } ' +
        `reviewRequests(first: 30) { nodes { requestedReviewer { ${who} } } } ` +
        `timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 30) { nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ${who} } } } } ` +
        'pushes: timelineItems(itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT], last: 20) { nodes { ... on HeadRefForcePushedEvent { createdAt } } } ' +
        'commits(last: 1) { nodes { commit { committedDate } } } ' +
        'reviews(last: 30) { nodes { author { login } state submittedAt body } } ' +
        'comments(last: 30) { nodes { author { login } createdAt body } } } }'
      );
    });
    const data = await gh.query(`query { rateLimit { cost remaining resetAt } ${aliases.join(' ')} }`);
    if (!data) {
      if (chunk.length > 1) queue.unshift(chunk.slice(0, chunk.length >> 1), chunk.slice(chunk.length >> 1));
      continue;
    }
    chunk.forEach((key, i) => {
      const node = data[`p${i}`]?.pullRequest;
      if (node) read.set(key, requestOf(node));
    });
  }
  const merges = (pr: RequestedPr) => {
    const mergeable = moves?.get(pr.pr)?.mergeable;
    return mergeable && mergeable !== 'UNKNOWN' ? { ...pr, mergeable } : pr;
  };
  const prs = listed.flatMap(([key]) => read.get(key) ?? known.get(key) ?? []).map(merges);
  const given = unasked.flatMap((key) => read.get(key) ?? []).filter((pr) => now - rplusBy(pr, login) < 30 * 86400);
  return {
    login,
    at: now,
    total,
    prs,
    followed: [
      ...left.flatMap((key) => read.get(key) ?? []).filter((pr) => now - rplusBy(pr, login) < 30 * 86400),
      ...kept.map((pr) => merges(read.get(pr.pr) ?? pr)),
      ...given,
    ],
    complete,
    teams: [...(myTeams ?? [])].sort(),
    colleagues: [...new Set(colleagues)].sort(),
    v: 2,
  };
}

/**
 * The PRs the members wrote, in any state, updated since `since`: what changed since the last collection, so that an open
 * PR nobody touched is not read again. One search covers several authors (repeated `author:` are or'ed), within GitHub's
 * 256 characters a query. `null` when GitHub could not answer all of them.
 */
export async function updatedPrs(gh: Github, logins: string[], since: string) {
  const base = `type:pr repo:odoo/odoo repo:odoo/enterprise repo:odoo/upgrade updated:>=${since}`;
  const groups: string[][] = [];
  for (const login of [...new Set(logins)].filter((login) => /^[A-Za-z0-9-]+$/.test(login)).sort()) {
    const last = groups.at(-1);
    if (last && `${base} ${[...last, login].map((author) => `author:${author}`).join(' ')}`.length <= 250) last.push(login);
    else groups.push([login]);
  }
  const pending = groups.map((group) => ({
    query: `${base} ${group.map((author) => `author:${author}`).join(' ')}`,
    cursor: null as string | null,
  }));
  const found = new Map<string, number>();
  while (pending.length) {
    const chunk = pending.slice(0, 5);
    const fields = chunk.map((item, j) => {
      const after = item.cursor && safe(item.cursor) ? `, after: "${item.cursor}"` : '';
      return (
        `s${j}: search(query: "${item.query}", type: ISSUE, first: 100${after}) { pageInfo { hasNextPage endCursor } ` +
        'nodes { ... on PullRequest { number updatedAt repository { nameWithOwner } } } }'
      );
    });
    const data = await gh.query(`query { rateLimit { cost remaining resetAt } ${fields.join(' ')} }`, { searches: chunk.length });
    if (!data || chunk.some((_, j) => !data[`s${j}`])) return null;
    chunk.forEach((item, j) => {
      const result = data[`s${j}`];
      for (const node of (result.nodes as Data[]).filter((node) => node?.repository)) {
        found.set(`${node.repository.nameWithOwner}#${node.number}`, isoTs(node.updatedAt));
      }
      if (result.pageInfo.hasNextPage) item.cursor = result.pageInfo.endCursor;
      else pending.splice(pending.indexOf(item), 1);
    });
  }
  return found;
}
