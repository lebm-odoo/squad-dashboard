import { describe, expect, test } from 'bun:test';
import { dashboardConfig } from '@sd/shared';
import { createApp } from '../app';
import { dashboardStore } from '../db/dashboard';
import { insertRows } from '../db/rows';
import { dashboardFeature, dashboardPart, dashboardReview, odooTask, syncCursor } from '../db/schema';
import { testDatabaseUrl, withTestDatabase } from '../db/testing';
import { settingsPort } from '../settings';

const feature = (name: string, owner: string, extra: Record<string, unknown> = {}) => ({
  name,
  owner,
  title: `[FIX] hr: ${name}`,
  kind: 'fix',
  status: 'merged',
  contributors: [],
  size: 10,
  last_at: 1_790_000_000,
  prs: [{ repo: 'odoo/odoo', number: 1, url: 'https://github.com/odoo/odoo/pull/1', linked: [] }],
  commits: [
    { sha: 'a'.repeat(40), repo: 'odoo', email: `${owner}@odoo.com`, author: owner, at: 1, ct: 2, subject: 'mine' },
    { sha: 'b'.repeat(40), repo: 'odoo', email: 'zed@odoo.com', author: 'zed', at: 3, ct: 4, subject: 'stacked' },
  ],
  pushes: [{ at: 5, kind: 'push', delta: 3, added_commits: 1, sha: 'c'.repeat(40), repo: 'odoo' }],
  runbot: null,
  ...extra,
});

describe.skipIf(!testDatabaseUrl)('the API', () => {
  test('serves features and reviews by pages, a feature whole, Moi and the squad', async () => {
    await withTestDatabase(async (db) => {
      const features = [
        feature('master-hr-a-anne', 'anne', { size: 30 }),
        feature('master-hr-b-bob', 'bob', { contributors: ['anne'], kind: 'feature', status: 'open', last_at: 1_791_000_000 }),
        feature('17.0-hr-c-carl', 'carl', { last_at: 1_780_000_000 }),
      ];
      await insertRows(
        db,
        dashboardFeature,
        features.map((data) => ({ name: data.name, owner: data.owner, archived: data.owner === 'carl', data })),
      );
      await insertRows(db, dashboardReview, [
        {
          id: 'bob:odoo/odoo#1',
          reviewer: 'bob',
          at: new Date(1_790_000_000_000),
          data: { id: 'bob:odoo/odoo#1', reviewer: 'bob', author: 'anne', t: 1_790_000_000 },
        },
        {
          id: 'anne:odoo/odoo#2',
          reviewer: 'anne',
          at: new Date(1_791_000_000_000),
          data: { id: 'anne:odoo/odoo#2', reviewer: 'anne', author: 'bob', t: 1_791_000_000 },
        },
      ]);
      const now = new Date();
      await insertRows(db, dashboardPart, [{ part: 'logins', data: { anne: 'anne-odoo' }, computedAt: now }]);
      await insertRows(db, odooTask, [{ id: 7, data: { id: 7, people: ['anne'] }, changes: [], fetchedAt: now }]);
      await insertRows(db, syncCursor, [
        {
          source: 'github',
          key: 'requests',
          value: {
            login: 'anne-odoo',
            v: 2,
            prs: [
              { pr: 'odoo/odoo#9', author: 'bob-odoo', head: 'master-x-bob', reviews: [], rplus: [] },
              { pr: 'odoo/odoo#10', author: 'dan-odoo', direct: true, asked_at: 100, reviews: [], rplus: [['anne-odoo', 200]] },
            ],
          },
        },
        { source: 'github', key: 'viewer', value: 'anne-odoo' },
      ]);
      const app = createApp({
        version: 'test',
        hosts: ['localhost'],
        ping: async () => {},
        loadConfig: async () => dashboardConfig.parse({ me: 'anne', follow: 'squad', squad: { lead: 'anne', members: ['bob'] } }),
        secrets: {
          status: async () => ({ kind: 'keyring', exists: true, locked: false }),
          get: async () => null,
          set: async () => {},
          delete: async () => {},
        },
        store: dashboardStore(db),
        settings: settingsPort({
          db,
          store: dashboardStore(db),
          clones: [],
          configPath: '/nonexistent/config.json',
          loadConfig: async () => dashboardConfig.parse({ me: 'anne' }),
          release: { version: 'test', repo: 'o/r', runtime: 'bun', commit: null, startedAt: 0 },
          secrets: {
            status: async () => ({ kind: 'keyring', exists: true, locked: false }),
            get: async () => null,
            set: async () => {},
            delete: async () => {},
          },
          whoami: async () => 'anne',
        }),
        whoami: async () => 'anne',
        collection: {
          state: { running: false, scope: null, current: [], ready: [], started: null, finished: null, errors: {}, steps: [] },
          start: () => null,
          subscribe: () => () => {},
        },
      });
      const local = { host: 'localhost' };
      const get = async (path: string) => {
        const response = await app.request(path, { headers: local });
        return [response.status, await response.json()] as const;
      };

      const [, mine] = await get('/api/features?person=anne');
      expect(mine.items.map((f: { name: string }) => f.name)).toEqual(['master-hr-b-bob', 'master-hr-a-anne']);
      expect(mine.items[0]).toMatchObject({ pr_count: 1 });
      expect(mine.items[0].prs).toBeUndefined();
      const [, fixes] = await get('/api/features?kind=fix&archived=false&sort=size&order=asc');
      expect(fixes).toMatchObject({ total: 1, items: [{ name: 'master-hr-a-anne' }] });
      const [, paged] = await get('/api/features?limit=1&offset=1&q=hr-');
      expect(paged).toMatchObject({ total: 3, items: [{ name: 'master-hr-a-anne' }] });
      expect((await get('/api/features?limit=1000'))[0]).toBe(400);

      const [, whole] = await get(`/api/feature?name=${encodeURIComponent('17.0-hr-c-carl')}`);
      expect(whole.prs).toEqual([{ repo: 'odoo/odoo', number: 1, url: 'https://github.com/odoo/odoo/pull/1', linked: [] }]);
      expect((await get('/api/feature?name=nothing'))[0]).toBe(404);

      const [, reviews] = await get('/api/reviews?reviewer=bob');
      expect(reviews).toMatchObject({ total: 1, items: [{ id: 'bob:odoo/odoo#1' }] });
      const [, me] = await get('/api/me');
      expect(me).toMatchObject({
        me: 'anne',
        requests: { prs: [{ pr: 'odoo/odoo#9', who: 'bob', colleague: true }], followed: [{ pr: 'odoo/odoo#10', rplus_at: 200 }] },
        tasks: [{ id: 7 }],
      });
      const [, squad] = await get('/api/squad');
      expect(squad).toMatchObject({ lead: 'anne', members: ['bob'], tasks: [{ id: 7 }] });
      const [, board] = await get('/api/squad/data');
      expect(board).toMatchObject({
        me: 'anne',
        squad: { lead: 'anne', members: ['bob'] },
        logins: { anne: 'anne-odoo', bob: null },
        review_requests: { prs: [{ who: 'bob' }] },
        odoo: { tasks: { 7: { id: 7 } } },
      });
      expect(board.features.map((f: { name: string }) => f.name).sort()).toEqual(['master-hr-a-anne', 'master-hr-b-bob']);
      expect(board.reviews.map((r: { id: string }) => r.id)).toEqual(['anne:odoo/odoo#2', 'bob:odoo/odoo#1']);
      // Set aside, a request asked of a GitHub team is only hidden: no GitHub call, until it is asked again.
      const discarded = await app.request('/api/requests/discard', {
        method: 'POST',
        headers: { ...local, 'content-type': 'application/json' },
        body: JSON.stringify({ pr: 'odoo/odoo#9' }),
      });
      expect(await discarded.json()).toEqual({ removed: false, error: null });
      expect((await get('/api/me'))[1].requests.prs).toEqual([]);
      // Asked of me directly but given my r+: hidden, I stay its reviewer.
      const hidden = await app.request('/api/requests/discard', {
        method: 'POST',
        headers: { ...local, 'content-type': 'application/json' },
        body: JSON.stringify({ pr: 'odoo/odoo#10' }),
      });
      expect(await hidden.json()).toEqual({ removed: false, error: null });
      expect((await get('/api/me'))[1].requests.followed).toEqual([]);
    });
  }, 60_000);
});
