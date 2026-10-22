import { describe, expect, test } from 'bun:test';
import { savePullRequests } from '../db/github';
import { insertRows, toDate } from '../db/rows';
import { dashboardFeature, odooTask } from '../db/schema';
import { saveMergebot } from '../db/sources';
import { testDatabaseUrl, withTestDatabase } from '../db/testing';
import { Github } from '../sources/github';
import type { PrDetail } from '../sources/github-prs';
import { syncDesk } from './desk';

describe.skipIf(!testDatabaseUrl)('my desk', () => {
  test(
    'read again where it moved: on GitHub what changed since read, on mergebot that and the pages an hour old or never read',
    () =>
      withTestDatabase(async (db) => {
        const now = Date.parse('2026-10-17T10:00:00Z') / 1000;
        const iso = (at: number) => new Date(at * 1000).toISOString();
        await insertRows(db, dashboardFeature, [
          {
            name: 'master-a-anne',
            owner: 'anne',
            archived: false,
            data: {
              prs: [1, 2, 4].map((number) => ({ repo: 'odoo/odoo', number })),
            },
          },
        ]);
        await insertRows(db, odooTask, [{ id: 7, data: { links: { prs: ['odoo/odoo#3'] } }, changes: [], fetchedAt: toDate(now) }]);
        const page = (number: number, state: string, fetched: number) => ({
          repo: 'odoo/odoo',
          number,
          state,
          label: 'odoo-dev:master-a-anne',
          fetched,
        });
        await saveMergebot(db, [page(1, 'open', now - 600), page(2, 'open', now - 2 * 3600), page(4, 'merged', now - 86400)]);
        const github = (fetched: number): PrDetail => ({
          title: '[IMP] hr: a thing',
          head_ref: 'master-a-anne',
          head_owner: 'odoo-dev',
          merged_at: null,
          tasks: [],
          opws: [],
          desc_words: 0,
          state: 'OPEN',
          draft: false,
          author: 'anne-odoo',
          created_at: now - 86400,
          closed_at: null,
          additions: 1,
          deletions: 0,
          changed_files: 1,
          reviews: [],
          comments: 0,
          force_pushes: [],
          ready_at: [],
          fetched,
        });
        await savePullRequests(
          db,
          new Map([
            ['odoo/odoo#1', github(now - 60)],
            ['odoo/odoo#2', github(now - 60)],
          ]),
        );
        // #1 changed after both readings, #2 before them, #3 was never read.
        const updated: Record<string, number> = { 1: now - 30, 2: now - 3 * 3600, 3: now - 3 * 3600 };
        const details: number[] = [];
        const graphql = (async (_url: string, init: RequestInit) => {
          const { query } = JSON.parse(init.body as string) as { query: string };
          const aliases = [...query.matchAll(/(p\d+): repository\(owner: "odoo", name: "odoo"\) \{ pullRequest\(number: (\d+)\)/g)];
          const node = (number: string) => {
            if (query.includes('{ updatedAt mergeable }')) return { updatedAt: iso(updated[number] as number), mergeable: 'MERGEABLE' };
            details.push(Number(number));
            return {
              title: '[IMP] hr: a thing',
              headRefName: 'master-a-anne',
              headRepositoryOwner: { login: 'odoo-dev' },
              mergedAt: null,
              bodyText: '',
              state: 'OPEN',
              isDraft: false,
              createdAt: iso(now - 86400),
              closedAt: null,
              additions: 1,
              deletions: 0,
              changedFiles: 1,
              author: { login: 'anne-odoo' },
              reviews: { nodes: [] },
              comments: { totalCount: 0 },
              timelineItems: { nodes: [] },
            };
          };
          const data = Object.fromEntries(aliases.map(([, alias, number]) => [alias, { pullRequest: node(number as string) }]));
          return Response.json({ data: { rateLimit: { cost: 1, remaining: 4000, resetAt: iso(now + 3600) }, ...data } });
        }) as unknown as typeof fetch;
        const pages: string[] = [];
        const mergebot = (async (url: string) => {
          pages.push(url);
          return new Response('', { status: 404 });
        }) as unknown as typeof fetch;
        const gh = new Github('token', { fetch: graphql, searchPause: 0, retryBase: 1 });
        const ctx = { db, gh, clones: [], people: ['anne'], me: 'anne', lead: 'anne', forced: {}, now, sinceDays: 30 };
        const desk = await syncDesk(ctx, mergebot);
        expect(details.sort()).toEqual([1, 3]);
        expect(pages.sort()).toEqual([1, 2, 3].map((number) => `https://mergebot.odoo.com/odoo/odoo/pull/${number}`));
        expect(desk).toEqual({ recompute: true, refresh: true, errors: [] });
      }),
    60_000,
  );
});
