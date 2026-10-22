import { describe, expect, test } from 'bun:test';
import { rplusBy } from '../domain/reviews';
import { type Data, Github } from './github';
import { readPullRequests, readRplus, readUpdatedAt } from './github-prs';
import { type RequestedPr, readReviewRequests, searchReviews, updatedPrs } from './github-search';

/** A GraphQL server answering each query with `answer`, or an HTTP status alone. */
function server(answer: (query: string) => Data | number) {
  const queries: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(init.body as string);
    queries.push(query);
    const result = answer(query);
    if (typeof result === 'number') return new Response('{}', { status: result, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ data: { rateLimit: { cost: 1, remaining: 4000, resetAt: '2026-10-17T10:00:00Z' }, ...result } }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { queries, gh: new Github('token', { fetch: fetcher, searchPause: 0, retryBase: 1 }) };
}

const pr = (state = 'MERGED') => ({
  pullRequest: {
    title: '[FIX] hr: a fix',
    headRefName: 'master-hr-fix-anne',
    headRepositoryOwner: { login: 'odoo-dev' },
    mergedAt: '2026-10-03T10:00:00Z',
    bodyText: 'Fixes it, task-1234567',
    state,
    isDraft: false,
    createdAt: '2026-10-01T10:00:00Z',
    closedAt: null,
    additions: 3,
    deletions: 1,
    changedFiles: 1,
    author: { login: 'anne-odoo' },
    reviews: { nodes: [{ author: { login: 'bob-odoo' }, state: 'APPROVED', submittedAt: '2026-10-02T10:00:00Z' }] },
    comments: { totalCount: 2 },
    timelineItems: {
      nodes: [
        {
          __typename: 'HeadRefForcePushedEvent',
          createdAt: '2026-10-01T12:00:00Z',
          actor: { login: 'anne-odoo' },
          beforeCommit: { oid: 'a'.repeat(40), additions: 3, deletions: 1, changedFilesIfAvailable: 1 },
          afterCommit: { oid: 'b'.repeat(40), additions: 3, deletions: 1, changedFilesIfAvailable: 1 },
        },
      ],
    },
  },
});

describe('GitHub', () => {
  test('a batch GitHub fails on is split, then a lone PR read without diff sizes, then marked missing', async () => {
    const heavy = 'odoo/odoo#3';
    const { gh, queries } = server((query) => {
      if (query.includes('number: 3') && query.includes('additions deletions changedFilesIfAvailable')) return 502;
      if (query.includes('number: 3')) return 502;
      const aliases = [...query.matchAll(/(p\d+): repository/g)].map((match) => match[1] as string);
      return { viewer: { login: 'anne-odoo' }, ...Object.fromEntries(aliases.map((alias) => [alias, { pullRequest: pr().pullRequest }])) };
    });
    const { read, viewer } = await readPullRequests(gh, ['odoo/odoo#1', 'odoo/odoo#2', heavy, 'odoo/odoo#4'], 1000, { size: 4 });
    expect(viewer).toBe('anne-odoo');
    expect(read.get('odoo/odoo#1')).toMatchObject({ state: 'MERGED', author: 'anne-odoo', comments: 2, reviews: [{ login: 'bob-odoo' }] });
    expect(read.get('odoo/odoo#1')).toMatchObject({ force_pushes: [{ kind: 'rebase', delta: 0, after: 'bbbbbbbbbbbb' }] });
    expect(read.get('odoo/odoo#1')).toMatchObject({
      head_owner: 'odoo-dev',
      head_ref: 'master-hr-fix-anne',
      tasks: ['1234567'],
      desc_words: 3,
    });
    expect(read.get(heavy)).toEqual({ state: 'MISSING', fetched: 1000 });
    expect(read.size).toBe(4);
    expect(queries.some((query) => query.includes('number: 3') && !query.includes('changedFilesIfAvailable'))).toBe(true);
    expect(gh.stopped).toBeNull();
    expect(gh.timeouts).toBe(4);
  });

  test('stops once the quota reaches the reserve, and when the token is refused', async () => {
    let remaining = 600;
    const fetcher = (async () => {
      remaining -= 200;
      return new Response(JSON.stringify({ data: { rateLimit: { cost: 1, remaining, resetAt: 'later' } } }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const gh = new Github('token', { fetch: fetcher, reserve: 300, retryBase: 1 });
    expect(await gh.query('query { a }')).not.toBeNull();
    expect(await gh.query('query { b }')).not.toBeNull();
    expect(await gh.query('query { c }')).toBeNull();
    expect(gh.stopped).toContain('quota GraphQL bas');
    const refused = server(() => 401);
    expect(await refused.gh.query('query { a }')).toBeNull();
    expect(refused.gh.stopped).toBe('jeton GitHub refusé');
  });

  test("on GitHub's secondary limit, waits what it says and goes on; stops past three", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      if (calls === 1 || calls >= 3)
        return new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit' }), {
          status: 403,
          headers: { 'content-type': 'application/json', 'retry-after': '0' },
        });
      return Response.json({ data: { rateLimit: { cost: 1, remaining: 4000, resetAt: 'later' }, ok: true } });
    }) as unknown as typeof fetch;
    const gh = new Github('token', { fetch: fetcher, retryBase: 1, slowPause: 0 });
    expect(await gh.query('query { a }')).toMatchObject({ ok: true });
    expect(gh.stopped).toBeNull();
    expect(await gh.query('query { b }')).toBeNull();
    expect(await gh.query('query { c }')).toBeNull();
    expect(gh.stopped).toContain('limite secondaire');
  });

  test('the r+ are the robodoo commands of comments and reviews; a PR GitHub has not is missing', async () => {
    const { gh } = server(() => ({
      p0: {
        pullRequest: {
          comments: { nodes: [{ author: { login: 'bob-odoo' }, createdAt: '2026-10-03T10:00:00Z', body: 'robodoo r+' }] },
          reviews: {
            nodes: [{ author: { login: 'carl-odoo' }, submittedAt: '2026-10-02T10:00:00Z', body: 'looks good\n@robodoo r+ rebase-ff' }],
          },
        },
      },
      p1: null,
    }));
    const read = await readRplus(gh, ['odoo/odoo#1', 'odoo/odoo#2'], 1000);
    expect(read.get('odoo/odoo#1')).toEqual({
      at: 1000,
      r: [
        ['carl-odoo', Date.parse('2026-10-02T10:00:00Z') / 1000],
        ['bob-odoo', Date.parse('2026-10-03T10:00:00Z') / 1000],
      ],
    });
    expect(read.get('odoo/odoo#2')).toEqual({ at: 1000, missing: true, r: [] });
  });

  test("a member's review search resumes at its cursor, then ends dated the day before", async () => {
    let page = 0;
    const node = (number: number) => ({
      number,
      title: '[FIX] hr: x',
      headRefName: 'master-x-carl',
      updatedAt: '2026-10-02T10:00:00Z',
      repository: { nameWithOwner: 'odoo/odoo' },
      author: { login: 'carl-odoo' },
      reviews: { nodes: [{ state: 'APPROVED', submittedAt: '2026-10-02T09:00:00Z' }] },
    });
    const { gh, queries } = server(() => {
      page++;
      return { s0: { pageInfo: { hasNextPage: page === 1, endCursor: 'next' }, nodes: [node(page)] } };
    });
    const now = Date.parse('2026-10-17T10:00:00Z') / 1000;
    const { found, cursors } = await searchReviews(gh, { anne: 'anne-odoo' }, {}, { now, start: '2024-10-01' });
    expect(found.map((review) => [review.member, review.pr, review.authorLogin])).toEqual([
      ['anne', 'odoo/odoo#1', 'carl-odoo'],
      ['anne', 'odoo/odoo#2', 'carl-odoo'],
    ]);
    expect(queries[1]).toContain('after: "next"');
    expect(cursors.anne).toEqual({ login: 'anne-odoo', until: '2026-10-16', at: now, v: 2 });
  });

  test('the PRs updated since the last collection, several authors a search, within 256 characters', async () => {
    const logins = Array.from({ length: 20 }, (_, i) => `member${i}-odoo`);
    const { gh, queries } = server((query) => {
      const aliases = [...query.matchAll(/(s\d+): search/g)].map((match) => match[1] as string);
      const node = { number: queries.length, updatedAt: '2026-10-17T09:00:00Z', repository: { nameWithOwner: 'odoo/odoo' } };
      return Object.fromEntries(aliases.map((alias) => [alias, { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node] }]));
    });
    const found = await updatedPrs(gh, logins, '2026-10-17T08:00:00Z');
    const searches = queries.flatMap((query) => [...query.matchAll(/query: "([^"]+)"/g)].map((match) => match[1] as string));
    expect(searches.every((search) => search.length <= 250)).toBe(true);
    expect(searches.join(' ').match(/author:/g)?.length).toBe(20);
    expect(found?.size).toBeGreaterThan(0);
  });

  test('the reviews asked: listed light, read in full only when new or changed since the last reading', async () => {
    const at = (hour: number) => `2026-10-17T${String(hour).padStart(2, '0')}:00:00Z`;
    const listed = [
      { number: 1, updatedAt: at(9), repository: { nameWithOwner: 'odoo/odoo' } },
      { number: 2, updatedAt: at(5), repository: { nameWithOwner: 'odoo/odoo' } },
      { number: 3, updatedAt: at(8), repository: { nameWithOwner: 'odoo/enterprise' } },
      { number: 4, updatedAt: at(4), repository: { nameWithOwner: 'odoo/odoo' } },
    ];
    const full = (number: number) => ({
      number,
      title: `PR ${number}`,
      url: `https://github.com/odoo/odoo/pull/${number}`,
      isDraft: false,
      createdAt: at(1),
      updatedAt: at(9),
      headRefName: `saas-19.2-thing-${number}-anne`,
      baseRefName: '19.0',
      body: 'task-1234567',
      repository: { nameWithOwner: number === 3 ? 'odoo/enterprise' : 'odoo/odoo' },
      author: { login: 'anne-odoo' },
      mergeable: 'MERGEABLE',
      reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'bob-odoo' } }] },
      timelineItems: { nodes: [{ createdAt: at(2), requestedReviewer: { __typename: 'User', login: 'bob-odoo' } }] },
      pushes: { nodes: [] },
      commits: { nodes: [] },
      reviews: { nodes: [] },
      comments: { nodes: [] },
    });
    const { gh, queries } = server((query) => {
      if (query.includes('search(')) {
        const team = (slug: string, logins: string[], totalCount = logins.length) => ({
          slug,
          members: { totalCount, nodes: logins.map((login) => ({ login })) },
        });
        return {
          org: { teams: { nodes: [team('rd-hr', ['carl-odoo', 'anne-odoo']), team('odoo-staff', ['zed-odoo'], 2000)] } },
          s: { issueCount: 4, pageInfo: { hasNextPage: false, endCursor: null }, nodes: listed },
        };
      }
      const aliases = [...query.matchAll(/(p\d+): repository\(owner: "odoo", name: "\w+"\) \{ pullRequest\(number: (\d+)\)/g)];
      return Object.fromEntries(aliases.map(([, alias, number]) => [alias, { pullRequest: full(Number(number)) }]));
    });
    const kept = (pr: string, updated: number): RequestedPr => ({
      pr,
      url: '',
      title: 'as read before',
      draft: false,
      author: 'anne-odoo',
      head: '',
      base: 'master',
      created_at: 0,
      updated_at: updated,
      asked_at: null,
      direct: true,
      teams: [],
      other_teams: 0,
      ids: {},
      reviews: [],
      rplus: [],
      mergeable: 'MERGEABLE',
    });
    // Read before its target branch was kept.
    const { base: _, ...unknownBase } = kept('odoo/odoo#4', Date.parse(at(4)) / 1000);
    const previous = [
      kept('odoo/odoo#1', Date.parse(at(6)) / 1000),
      kept('odoo/odoo#2', Date.parse(at(5)) / 1000),
      unknownBase as RequestedPr,
    ];
    const read = await readReviewRequests(gh, 'bob-odoo', 0, previous);
    expect(queries.at(-1)).toContain('pullRequest(number: 1)');
    expect(queries.at(-1)).toContain('pullRequest(number: 3)');
    expect(queries.at(-1)).toContain('pullRequest(number: 4)');
    expect(queries.at(-1)).not.toContain('pullRequest(number: 2)');
    expect(read?.prs.map((pr) => [pr.pr, pr.title, pr.base])).toEqual([
      ['odoo/odoo#1', 'PR 1', '19.0'],
      ['odoo/odoo#2', 'as read before', 'master'],
      ['odoo/enterprise#3', 'PR 3', '19.0'],
      ['odoo/odoo#4', 'PR 4', '19.0'],
    ]);
    expect(read?.prs[2]?.ids.task).toEqual(['1234567']);
    expect([read?.teams, read?.colleagues]).toEqual([
      ['odoo-staff', 'rd-hr'],
      ['anne-odoo', 'carl-odoo'],
    ]);
  });

  test('a review GitHub no longer asks for is read once more: given my r+, it is followed for a month', async () => {
    const day = 86400;
    const now = Date.parse('2026-10-17T09:00:00Z') / 1000;
    const { gh, queries } = server((query) => {
      if (query.includes('search(')) {
        const nodes = [{ number: 1, updatedAt: '2026-10-17T08:00:00Z', repository: { nameWithOwner: 'odoo/odoo' } }];
        return { org: { teams: { nodes: [] } }, s: { issueCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes } };
      }
      const aliases = [...query.matchAll(/(p\d+): repository\(owner: "odoo", name: "odoo"\) \{ pullRequest\(number: (\d+)\)/g)];
      return Object.fromEntries(
        aliases.map(([, alias, number]) => [
          alias,
          {
            pullRequest: {
              number: Number(number),
              title: `PR ${number}`,
              createdAt: '2026-10-10T09:00:00Z',
              updatedAt: '2026-10-16T09:00:00Z',
              repository: { nameWithOwner: 'odoo/odoo' },
              author: { login: 'anne-odoo' },
              reviewRequests: { nodes: [] },
              timelineItems: { nodes: [] },
              pushes: { nodes: [] },
              commits: { nodes: [] },
              reviews: {
                nodes:
                  number === '5'
                    ? [{ author: { login: 'bob-odoo' }, state: 'APPROVED', submittedAt: '2026-10-16T09:00:00Z', body: 'robodoo r+' }]
                    : [],
              },
              comments: { nodes: [] },
            },
          },
        ]),
      );
    });
    const known = (number: number, rplus: [string, number][] = []): RequestedPr => ({
      pr: `odoo/odoo#${number}`,
      url: '',
      title: 'as read before',
      draft: false,
      author: 'anne-odoo',
      head: '',
      base: 'master',
      created_at: 0,
      updated_at: now,
      asked_at: null,
      direct: true,
      teams: [],
      other_teams: 0,
      ids: {},
      reviews: [],
      rplus,
      mergeable: 'MERGEABLE',
    });
    const read = await readReviewRequests(
      gh,
      'bob-odoo',
      now,
      [known(1), known(5), known(6)],
      [known(7, [['bob-odoo', now - 40 * day]]), known(8, [['bob-odoo', now - 2 * day]])],
    );
    expect(queries.at(-1)).toContain('pullRequest(number: 5)');
    expect(queries.at(-1)).toContain('pullRequest(number: 6)');
    expect(read?.prs.map((pr) => pr.pr)).toEqual(['odoo/odoo#1']);
    expect(read?.followed.map((pr) => [pr.pr, pr.title])).toEqual([
      ['odoo/odoo#5', 'PR 5'],
      ['odoo/odoo#8', 'as read before'],
    ]);
  });

  test('given my r+, a PR is read again once it moved, for its pushes and r-; a conflict shows without it moving', async () => {
    const day = 86400;
    const now = Date.parse('2026-10-17T09:00:00Z') / 1000;
    const iso = (at: number) => new Date(at * 1000).toISOString();
    const { gh, queries } = server((query) => {
      if (query.includes('search(')) {
        return { org: { teams: { nodes: [] } }, s: { issueCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } };
      }
      const aliases = [...query.matchAll(/(p\d+): repository\(owner: "odoo", name: "odoo"\) \{ pullRequest\(number: (\d+)\)/g)];
      if (query.includes('{ updatedAt mergeable }')) {
        return Object.fromEntries(
          aliases.map(([, alias, number]) => [
            alias,
            {
              pullRequest:
                number === '8'
                  ? { updatedAt: iso(now - day), mergeable: 'UNKNOWN' }
                  : { updatedAt: iso(now - 3 * day), mergeable: 'CONFLICTING' },
            },
          ]),
        );
      }
      return Object.fromEntries(
        aliases.map(([, alias, number]) => [
          alias,
          {
            pullRequest: {
              number: Number(number),
              title: `PR ${number}`,
              createdAt: iso(now - 5 * day),
              updatedAt: iso(now - day),
              mergeable: 'MERGEABLE',
              repository: { nameWithOwner: 'odoo/odoo' },
              author: { login: 'anne-odoo' },
              reviewRequests: { nodes: [] },
              timelineItems: { nodes: [] },
              pushes: { nodes: [{ createdAt: iso(now - 4 * day) }, { createdAt: iso(now - day) }] },
              commits: { nodes: [{ commit: { committedDate: iso(now - 5 * day) } }] },
              reviews: {
                nodes: [{ author: { login: 'bob-odoo' }, state: 'APPROVED', submittedAt: iso(now - 2 * day), body: 'robodoo r+' }],
              },
              comments: { nodes: [{ author: { login: 'carl-odoo' }, createdAt: iso(now - day), body: '@robodoo r-' }] },
            },
          },
        ]),
      );
    });
    const approved = (number: number): RequestedPr => ({
      pr: `odoo/odoo#${number}`,
      url: '',
      title: 'as read before',
      draft: false,
      author: 'anne-odoo',
      head: '',
      base: 'master',
      created_at: 0,
      updated_at: now - 2 * day,
      asked_at: null,
      direct: true,
      teams: [],
      other_teams: 0,
      ids: {},
      reviews: [],
      rplus: [['bob-odoo', now - 2 * day]],
      mergeable: 'MERGEABLE',
      pushed_at: now - 4 * day,
      rminus: [],
    });
    const read = await readReviewRequests(gh, 'bob-odoo', now, [], [approved(8), approved(9)]);
    expect(queries.at(-1)).toContain('pullRequest(number: 8)');
    expect(queries.at(-1)).not.toContain('pullRequest(number: 9)');
    expect(read?.followed.map((pr) => [pr.pr, pr.title, pr.mergeable, pr.pushed_at, pr.rminus])).toEqual([
      ['odoo/odoo#8', 'PR 8', 'MERGEABLE', now - day, [['carl-odoo', now - day]]],
      ['odoo/odoo#9', 'as read before', 'CONFLICTING', now - 4 * day, []],
    ]);
  });

  test('a PR given my r+ unasked is found in my comments, my reviews and the search of what I reviewed, within the month', async () => {
    const day = 86400;
    const now = Date.parse('2026-10-17T09:00:00Z') / 1000;
    const iso = (at: number) => new Date(at * 1000).toISOString();
    const on = (number: number, state = 'OPEN') => ({ number, state, repository: { nameWithOwner: 'odoo/odoo' } });
    const { gh, queries } = server((query) => {
      if (query.includes('issueComments')) {
        return {
          user: {
            issueComments: {
              nodes: [
                { body: '@robodoo fw=skipmerge r+', createdAt: iso(now - day), pullRequest: on(40) },
                { body: 'nice', createdAt: iso(now - day), pullRequest: on(41) },
                { body: 'robodoo r+', createdAt: iso(now - day), pullRequest: on(43, 'CLOSED') },
                { body: 'robodoo r+', createdAt: iso(now - 40 * day), pullRequest: on(44) },
                { body: 'robodoo r+', createdAt: iso(now - day), pullRequest: null },
              ],
            },
            contributionsCollection: {
              pullRequestReviewContributions: {
                nodes: [{ pullRequestReview: { body: 'robodoo r+', createdAt: iso(now - day) }, pullRequest: on(42) }],
              },
            },
          },
        };
      }
      if (query.includes('reviewed-by:bob-odoo')) {
        const pr = (number: number, body: string) => ({
          ...on(number, 'CLOSED'),
          reviews: { nodes: [{ body, createdAt: iso(now - day) }] },
        });
        return { s: { pageInfo: { hasNextPage: false }, nodes: [pr(45, 'robodoo r+'), pr(46, 'looks good')] } };
      }
      if (query.includes('search(')) {
        return { org: { teams: { nodes: [] } }, s: { issueCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } };
      }
      const aliases = [...query.matchAll(/(p\d+): repository\(owner: "odoo", name: "odoo"\) \{ pullRequest\(number: (\d+)\)/g)];
      return Object.fromEntries(
        aliases.map(([, alias, number]) => [
          alias,
          {
            pullRequest: {
              number: Number(number),
              title: `PR ${number}`,
              createdAt: iso(now - 5 * day),
              updatedAt: iso(now - day),
              mergeable: 'MERGEABLE',
              repository: { nameWithOwner: 'odoo/odoo' },
              author: { login: 'anne-odoo' },
              reviewRequests: { nodes: [] },
              timelineItems: { nodes: [] },
              pushes: { nodes: [] },
              commits: { nodes: [] },
              reviews: { nodes: [] },
              comments: { nodes: [{ author: { login: 'bob-odoo' }, createdAt: iso(now - day), body: 'robodoo r+' }] },
            },
          },
        ]),
      );
    });
    const read = await readReviewRequests(gh, 'bob-odoo', now);
    for (const number of [40, 42, 43, 45]) expect(queries.at(-1)).toContain(`pullRequest(number: ${number})`);
    for (const number of [41, 44, 46]) expect(queries.at(-1)).not.toContain(`pullRequest(number: ${number})`);
    expect(read?.followed.map((pr) => [pr.pr, pr.asked_at, rplusBy(pr, 'bob-odoo')])).toEqual([
      ['odoo/odoo#40', null, now - day],
      ['odoo/odoo#43', null, now - day],
      ['odoo/odoo#42', null, now - day],
      ['odoo/odoo#45', null, now - day],
    ]);
  });

  test('my comments are read back to the last reading, a month the first time', async () => {
    const day = 86400;
    const now = Date.parse('2026-10-17T09:00:00Z') / 1000;
    const iso = (at: number) => new Date(at * 1000).toISOString();
    const comment = (number: number, at: number, body = 'nice') => ({
      body,
      createdAt: iso(at),
      updatedAt: iso(at),
      pullRequest: { number, state: 'MERGED', repository: { nameWithOwner: 'odoo/odoo' } },
    });
    const { gh, queries } = server((query) => {
      if (query.includes('issueComments') || query.includes('contributionsCollection')) {
        const second = query.includes('after: "page2"');
        return {
          user: {
            issueComments: second
              ? { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [comment(45, now - 3 * day, 'robodoo r+')] }
              : { pageInfo: { hasNextPage: true, endCursor: 'page2' }, nodes: [comment(46, now - 3600), comment(47, now - 2 * day)] },
            contributionsCollection: { pullRequestReviewContributions: { pageInfo: { hasNextPage: false }, nodes: [] } },
          },
        };
      }
      if (query.includes('search(')) {
        return { org: { teams: { nodes: [] } }, s: { issueCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } };
      }
      return {};
    });
    await readReviewRequests(gh, 'bob-odoo', now, [], [], now - 600);
    expect(queries.filter((query) => query.includes('issueComments'))).toHaveLength(1);
    await readReviewRequests(gh, 'bob-odoo', now);
    const pages = queries.filter((query) => query.includes('issueComments'));
    expect(pages).toHaveLength(3);
    expect(pages.at(-1)).toContain('after: "page2"');
    expect(pages.at(-1)).not.toContain('contributionsCollection');
    expect(queries.at(-1)).toContain('pullRequest(number: 45)');
  });

  test('when each PR last changed, many in a query; a PR GitHub has not is left out', async () => {
    const { gh, queries } = server((query) => {
      const aliases = [...query.matchAll(/(p\d+): repository\(owner: "odoo", name: "odoo"\) \{ pullRequest\(number: (\d+)\)/g)];
      return Object.fromEntries(
        aliases.map(([, alias, number]) => [
          alias,
          { pullRequest: number === '3' ? null : { updatedAt: '2026-10-17T09:00:00Z', mergeable: 'CONFLICTING' } },
        ]),
      );
    });
    const updated = await readUpdatedAt(gh, ['odoo/odoo#1', 'odoo/odoo#2', 'odoo/odoo#3'], 2);
    const at = Date.parse('2026-10-17T09:00:00Z') / 1000;
    expect(queries).toHaveLength(2);
    expect([...(updated ?? [])]).toEqual([
      ['odoo/odoo#1', { at, mergeable: 'CONFLICTING' }],
      ['odoo/odoo#2', { at, mergeable: 'CONFLICTING' }],
    ]);
  });
});
