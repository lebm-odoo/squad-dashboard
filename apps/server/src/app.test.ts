import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSettings, dashboardConfig } from '@sd/shared';
import { type AppDeps, createApp } from './app';
import { ConfigError, followed, loadConfig, saveConfig, squadOf } from './config';
import { FileStore, type SecretStore } from './security/secrets';

const keyring: SecretStore = {
  status: async () => ({ kind: 'keyring', exists: true, locked: false }),
  get: async () => null,
  set: async () => {},
  delete: async () => {},
};
const app = (overrides: Partial<AppDeps> = {}) =>
  createApp({
    version: 'test',
    hosts: ['localhost'],
    ping: async () => {},
    loadConfig: async () => dashboardConfig.parse({ me: 'abcd' }),
    secrets: keyring,
    store: {
      features: async () => ({ total: 0, items: [] }),
      feature: async () => null,
      reviews: async () => ({ total: 0, items: [] }),
      part: async () => null,
      cursor: async () => null,
      sources: async () => ({ collect: null, git: {}, web: null, github: null, odoo: null }),
      versionForks: async () => ({}),
      tasks: async () => [],
      featuresOf: async () => [],
      featuresLinked: async () => [],
      reviewsOf: async () => [],
      mergebot: async () => ({}),
      odoo: async () => ({ tasks: {}, stages: {}, at: null, not_found: [] }),
    },
    settings: {
      saveConfig: async () => dashboardConfig.parse({ me: 'abcd' }),
      loginReport: async () => [],
      keySources: async () => ({ github: 'host', odoo: 'none' }),
      todos: async () => [],
      saveTodos: async (items) => items,
      collectSettings: async () => collectSettings.parse({}),
      saveCollectSettings: async (settings) => settings,
      check: async () => {
        throw new Error('pas dans ce test');
      },
      dataStats: async () => ({ size: 0, tables: {} }),
      derive: async () => ({ features: 0, reviews: 0, seconds: 0 }),
      updates: async () => ({
        current: 'test',
        repo: 'o/r',
        runtime: 'bun',
        commit: null,
        started_at: 0,
        latest: null,
        newer: false,
        checked_at: null,
        error: null,
      }),
      checkUpdates: async () => {
        throw new Error('pas dans ce test');
      },
      discardedRequests: async () => ({}),
      discardRequest: async () => ({ removed: false, error: null }),
    },
    whoami: async () => 'abcd',
    collection: {
      state: { running: false, scope: null, current: [], ready: [], started: null, finished: null, errors: {}, steps: [] },
      start: () => null,
      subscribe: () => () => {},
    },
    ...overrides,
  });
const local = { host: 'localhost:8766' };
const json = (body: unknown) => ({ method: 'POST', headers: { ...local, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('answers under its own host only', async () => {
  expect((await app().request('/api/health', { headers: { host: 'evil.example' } })).status).toBe(421);
  expect(await (await app().request('/api/health', { headers: local })).json()).toEqual({ version: 'test', db: 'ok' });
});

test('reports a database that does not answer', async () => {
  const res = await app({ ping: () => Promise.reject(new Error('down')) }).request('/api/health', { headers: local });
  expect(res.status).toBe(503);
});

test('refuses a form posted from another site', async () => {
  const res = await app().request('/api/secrets/lock', {
    method: 'POST',
    headers: { ...local, origin: 'http://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(res.status).toBe(403);
});

test('opens a web link in the default browser, when the server has one', async () => {
  const opened: string[] = [];
  const desktop = app({ openUrl: (url) => opened.push(url) });
  expect((await desktop.request('/api/open', json({ url: 'https://github.com/odoo/odoo/pull/1' }))).status).toBe(204);
  expect((await desktop.request('/api/open', json({ url: 'file:///etc/passwd' }))).status).toBe(400);
  expect(opened).toEqual(['https://github.com/odoo/odoo/pull/1']);
  expect((await app().request('/api/open', json({ url: 'https://github.com' }))).status).toBe(404);
});

test('reports a broken config.json', async () => {
  const res = await app({ loadConfig: () => Promise.reject(new ConfigError('config.json introuvable')) }).request('/api/config', {
    headers: local,
  });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'config.json introuvable' });
});

test('the vault routes answer only with the file store', async () => {
  const res = await app().request('/api/secrets/unlock', json({ passphrase: 'x' }));
  expect(res.status).toBe(400);
});

test('creates, locks and unlocks the vault', async () => {
  const server = app({ secrets: new FileStore(join(await mkdtemp(join(tmpdir(), 'sd-app-')), 'secrets.vault')) });
  expect(await (await server.request('/api/secrets/create', json({ passphrase: 'correct horse battery staple' }))).json()).toEqual({
    kind: 'file',
    exists: true,
    locked: false,
  });
  expect(await (await server.request('/api/secrets/lock', json({}))).json()).toMatchObject({ locked: true });
  expect((await server.request('/api/secrets/unlock', json({ passphrase: 'wrong passphrase!' }))).status).toBe(400);
  expect(await (await server.request('/api/secrets/unlock', json({ passphrase: 'correct horse battery staple' }))).json()).toMatchObject({
    locked: false,
  });
}, 30_000);

test('asks what to follow on the first opening, before config.json exists, and writes it', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'sd-setup-')), 'config.json');
  const settings = {
    saveConfig: (patch: Parameters<typeof saveConfig>[1]) => saveConfig(path, patch),
    keySources: async () => ({ github: 'host', odoo: 'none' }),
  } as AppDeps['settings'];
  const server = app({ loadConfig: () => loadConfig(path), settings });
  const put = (body: unknown) => server.request('/api/setup', { ...json(body), method: 'PUT' });
  expect(await (await server.request('/api/setup', { headers: local })).json()).toEqual({
    follow: null,
    me: null,
    whoami: 'abcd',
    squad: null,
    keys: { github: 'host', odoo: 'none' },
    vault: { kind: 'keyring', exists: true, locked: false },
  });
  expect((await put({ follow: 'squad', me: 'abcd', squad: null })).status).toBe(400);

  await put({ follow: 'squad', me: 'abcd', squad: { lead: 'abcd', members: ['efgh'] } });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ follow: 'squad', me: 'abcd', squad: { lead: 'abcd', members: ['efgh'] } });
  await put({ follow: 'me', me: 'abcd', squad: null });
  expect(await loadConfig(path)).toMatchObject({ follow: 'me', squad: { lead: 'abcd', members: ['efgh'] } });
});

test('starts from the squad of a V1 config.json, which the first page then replaces', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'sd-setup-')), 'config.json');
  await writeFile(path, JSON.stringify({ lead: 'ijkl', members: ['abcd', 'efgh'], arrivals: { efgh: '2025-09' } }));
  const settings = {
    saveConfig: (patch: Parameters<typeof saveConfig>[1]) => saveConfig(path, patch),
    keySources: async () => ({ github: 'host', odoo: 'none' }),
  } as AppDeps['settings'];
  const server = app({ loadConfig: () => loadConfig(path), settings });
  expect(await (await server.request('/api/setup', { headers: local })).json()).toMatchObject({
    follow: null,
    me: 'ijkl',
    squad: { lead: 'ijkl', members: ['abcd', 'efgh'] },
  });
  await server.request('/api/setup', {
    ...json({ follow: 'squad', me: 'abcd', squad: { lead: 'ijkl', members: ['abcd', 'efgh'] } }),
    method: 'PUT',
  });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
    arrivals: { efgh: '2025-09' },
    follow: 'squad',
    me: 'abcd',
    squad: { lead: 'ijkl', members: ['abcd', 'efgh'] },
  });
});

test('keeps an empty config.json, as Docker mounts it, for the first page to fill', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'sd-setup-')), 'config.json');
  await writeFile(path, '{}');
  const res = await app({ loadConfig: () => loadConfig(path) }).request('/api/setup', { headers: local });
  expect(await res.json()).toMatchObject({ follow: null, squad: null });
});

test('reads me whole, and my squad once it is followed; my squad, followed or not, are my colleagues', () => {
  const config = (follow?: 'me' | 'squad') => dashboardConfig.parse({ follow, squad: { lead: 'ijkl', members: ['abcd', 'efgh'] } });
  expect(followed(config('me'), 'abcd')).toEqual(['abcd']);
  expect(followed(config('squad'), 'abcd')).toEqual(['abcd', 'ijkl', 'efgh']);
  expect([...squadOf(config('me'), 'abcd')]).toEqual(['abcd', 'ijkl', 'efgh']);
});

test('drops an emptied GitHub login or arrival', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'sd-config-')), 'config.json');
  await writeFile(path, JSON.stringify({ github_logins: { abcd: 'ab-cd' }, arrivals: { abcd: '2024-01', efgh: '2025-09' } }));
  await saveConfig(path, { github_logins: { abcd: '' }, arrivals: { efgh: '', ijkl: '2026-02' } });
  expect(await loadConfig(path)).toMatchObject({ github_logins: {}, arrivals: { abcd: '2024-01', ijkl: '2026-02' } });
});

test('rewrites config.json in place where it cannot be replaced, as when Docker mounts it alone', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'sd-mounted-')), 'config');
  await mkdir(dir);
  const path = join(dir, 'config.json');
  await writeFile(path, '{}');
  await chmod(dir, 0o555);
  try {
    await saveConfig(path, { follow: 'me', me: 'abcd' });
    expect(await loadConfig(path)).toMatchObject({ follow: 'me', me: 'abcd' });
  } finally {
    await chmod(dir, 0o755);
  }
});
