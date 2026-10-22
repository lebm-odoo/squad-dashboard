import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { dashboardStore } from '../db/dashboard';
import { testDatabaseUrl, withTestDatabase } from '../db/testing';
import { FileStore } from '../security/secrets';
import { settingsPort } from '../settings';
import { Git, Slots } from '../sources/git';
import { makeClone } from '../sources/testing';

describe.skipIf(!testDatabaseUrl)('the settings', () => {
  test('write config.json keeping what they do not change, keep to-dos and secrets, check the connections on demand', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sd-settings-'));
    const clone = await makeClone();
    try {
      const configPath = join(dir, 'config.json');
      await writeFile(configPath, JSON.stringify({ follow: 'squad', github_logins: { bob: 'bob-gh' }, arrivals: { bob: '2025-09' } }));
      const secrets = new FileStore(join(dir, 'secrets.vault'));
      await secrets.create('a long enough passphrase');
      const fetcher = (async (url: string) => {
        if (url.endsWith('/user')) return Response.json({ login: 'anne-odoo' }, { headers: { 'x-oauth-scopes': 'repo, read:org' } });
        if (url.endsWith('/rate_limit')) return Response.json({ resources: { graphql: { remaining: 4321 } } });
        if (url.includes('/json/2/res.users/')) return Response.json([{ id: 1, name: 'Anne (anne)' }]);
        if (url.endsWith('/repos/o/r/releases/latest')) return Response.json({ tag_name: 'v2.1.0', html_url: 'https://github.com/o/r' });
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch;
      await withTestDatabase(async (db) => {
        const config = () => loadConfig(configPath);
        const store = dashboardStore(db);
        const clones = [{ repo: 'odoo', remote: 'dev', slug: 'odoo-dev/odoo', git: new Git(clone.path, new Slots(2)) }];
        const settings = settingsPort({
          db,
          store,
          clones,
          configPath,
          loadConfig: config,
          secrets,
          whoami: async () => 'anne',
          release: { version: '2.0.0', repo: 'o/r', runtime: 'bun', commit: 'abc1234', startedAt: 1000 },
          fetcher,
        });
        const app = createApp({
          version: 'test',
          hosts: ['localhost'],
          ping: async () => {},
          loadConfig: config,
          secrets,
          store,
          settings,
          whoami: async () => 'anne',
          collection: {
            state: { running: false, scope: null, current: [], ready: [], started: null, finished: null, errors: {}, steps: [] },
            start: () => null,
            subscribe: () => () => {},
          },
        });
        const call = async (method: string, path: string, body?: unknown) => {
          const response = await app.request(path, {
            method,
            headers: { host: 'localhost', 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          return [response.status, await response.json()] as const;
        };

        expect(
          (
            await call('PUT', '/api/settings/config', { me: 'anne', squad: { lead: 'anne', members: ['bob'] }, github_logins: { bob: '' } })
          )[0],
        ).toBe(200);
        expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
          follow: 'squad',
          me: 'anne',
          squad: { lead: 'anne', members: ['bob'] },
          github_logins: {},
          arrivals: { bob: '2025-09' },
        });
        expect((await call('PUT', '/api/settings/config', { squad: { lead: 'anne', members: ['Not A Trigram'] } }))[0]).toBe(400);
        expect((await call('GET', '/api/settings'))[1].logins.map((row: { member: string }) => row.member)).toEqual(['anne', 'bob']);

        const todo = {
          id: 'a1',
          text: 'review it',
          done: false,
          at: 1,
          ref: { type: 'pr', key: 'odoo/odoo#1', url: 'https://github.com/odoo/odoo/pull/1' },
        };
        expect(await call('PUT', '/api/todos', [todo])).toEqual([200, [todo]]);
        expect((await call('PUT', '/api/todos', [{ id: 'a2', text: '', done: false, at: 1 }]))[0]).toBe(400);
        expect((await call('GET', '/api/todos'))[1]).toEqual([todo]);

        expect((await call('PUT', '/api/settings/secrets/odoo_api_key', { value: 'secret-key' }))[0]).toBe(200);
        expect((await call('PUT', '/api/settings/secrets/github_token', { value: 'ghp_token' }))[0]).toBe(200);
        const [, shown] = await call('GET', '/api/settings');
        expect(shown.secrets).toMatchObject({ kind: 'file', github_token: true, odoo_api_key: true });
        expect(JSON.stringify(shown)).not.toContain('secret-key');
        expect(shown.collect).toEqual({ historyDays: 730, githubReserve: 500, githubConcurrency: 1 });
        expect((await call('PUT', '/api/settings/secrets/password', { value: 'x' }))[0]).toBe(400);

        const [, checked] = await call('POST', '/api/settings/check');
        expect(checked.github).toMatchObject({
          ok: true,
          source: 'vault',
          login: 'anne-odoo',
          scopes: ['repo', 'read:org'],
          remaining: 4321,
        });
        expect(checked.odoo).toMatchObject({ ok: true, user: 'Anne (anne)' });
        expect(checked.clones).toMatchObject([{ repo: 'odoo', ok: true }]);
        expect(checked.runbot.ok).toBe(true);

        expect((await call('GET', '/api/version'))[1]).toMatchObject({
          current: '2.0.0',
          commit: 'abc1234',
          started_at: 1000,
          latest: null,
        });
        const [, update] = await call('POST', '/api/version/check');
        expect(update).toMatchObject({ current: '2.0.0', newer: true, latest: { version: '2.1.0' }, error: null });

        const [, stats] = await call('GET', '/api/settings/data');
        expect(stats.size).toBeGreaterThan(0);
        expect(stats.tables).toHaveProperty('git_commit');
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(clone.path, { recursive: true, force: true });
    }
  }, 60_000);
});
