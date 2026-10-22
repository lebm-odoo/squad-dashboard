import { describe, expect, test } from 'bun:test';
import { loadMergebot } from '../db/sources';
import { testDatabaseUrl, withTestDatabase } from '../db/testing';
import { syncWeb } from './web';

describe.skipIf(!testDatabaseUrl)('runbot and mergebot', () => {
  test(
    'runbot is searched for the people followed, mergebot read for the related PRs too',
    () =>
      withTestDatabase(async (db) => {
        const asked: string[] = [];
        const fetcher = (async (url: string) => {
          asked.push(url);
          return new Response('', { status: 404 });
        }) as unknown as typeof fetch;
        const status = await syncWeb(db, [], { followed: new Set(['anne']), related: new Set(['odoo/enterprise#5']), now: 1_000, fetcher });
        expect(asked).toEqual([
          'https://runbot.odoo.com/runbot/r-d-1?search=anne&limit=500',
          'https://mergebot.odoo.com/odoo/enterprise/pull/5',
        ]);
        expect(status.runbot_error).toBeTruthy();
        expect((await loadMergebot(db))['odoo/enterprise#5']?.state).toBe('missing');
      }),
    60_000,
  );
});
