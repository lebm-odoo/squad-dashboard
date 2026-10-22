import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type CollectSettings, collectSettings, type DashboardConfig, type Todo, todos } from '@sd/shared';
import { eq, sql } from 'drizzle-orm';
import type { ConnectionChecks, DashboardStore, SettingsPort, UpdateState } from './api/store';
import { followed, followedSquad, saveConfig, squadOf } from './config';
import type { Database } from './db/client';
import { loadDeducedLogins } from './db/github';
import { appMeta } from './db/schema';
import { type LoginSource, loginReport } from './domain/logins';
import { answered } from './domain/reviews';
import { latestRelease, newer, type Release } from './release';
import { dockerSecret, type SecretStore } from './security/secrets';
import type { Clone } from './sources/clones';
import { Github, ghToken } from './sources/github';
import { Odoo, squadOdooKey } from './sources/odoo';
import { deriveAndSave } from './sync/derive';

type SettingsDeps = {
  db: Database;
  store: DashboardStore;
  clones: Clone[];
  configPath: string;
  loadConfig: () => Promise<DashboardConfig>;
  secrets: SecretStore;
  whoami: () => Promise<string>;
  /** This version, the GitHub repository its releases are published on, and how the server runs. */
  release: { version: string; repo: string; runtime: 'bun' | 'docker'; commit: string | null; startedAt: number };
  fetcher?: typeof fetch;
};

export function settingsPort({
  db,
  store,
  clones,
  configPath,
  loadConfig,
  secrets,
  whoami,
  release,
  fetcher = fetch,
}: SettingsDeps): SettingsPort {
  const meta = async <T>(key: string) => (await db.select().from(appMeta).where(eq(appMeta.key, key)))[0]?.value as T | undefined;
  const saveMeta = (key: string, value: unknown) =>
    db
      .insert(appMeta)
      .values({ key, value })
      .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: new Date() } });
  const reach = async (url: string) => {
    try {
      const response = await fetcher(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': `squad-dashboard/${release.version}` },
      });
      return { ok: response.status < 500, detail: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  };

  const updateState = (checked?: { latest: Release | null; at: number; error: string | null }): UpdateState => ({
    current: release.version,
    repo: release.repo,
    runtime: release.runtime,
    commit: release.commit,
    started_at: release.startedAt,
    latest: checked?.latest ?? null,
    newer: !!checked?.latest && newer(checked.latest.version, release.version),
    checked_at: checked?.at ?? null,
    error: checked?.error ?? null,
  });

  return {
    saveConfig: (patch) => saveConfig(configPath, patch),

    updates: async () => updateState(await meta('update_check')),
    async checkUpdates() {
      const token = (await secrets.get('github_token').catch(() => null)) ?? (await ghToken());
      const previous = await meta<{ latest: Release | null }>('update_check');
      const checked = await latestRelease(release.repo, token, fetcher).then(
        (latest) => ({ latest, at: Date.now() / 1000, error: null }),
        (error: Error) => ({ latest: previous?.latest ?? null, at: Date.now() / 1000, error: error.message }),
      );
      await saveMeta('update_check', checked);
      return updateState(checked);
    },

    async loginReport() {
      const config = await loadConfig();
      const people = followed(config, config.me ?? (await whoami()));
      const sources = (await store.part<Record<string, [string, LoginSource]>>('login_sources'))?.data ?? {};
      return loginReport(people, sources, config.github_logins, await loadDeducedLogins(db), new Set(people));
    },

    todos: async () => (await meta<Todo[]>('todos')) ?? [],
    async saveTodos(items) {
      const checked = todos.parse(items);
      await saveMeta('todos', checked);
      return checked;
    },

    discardedRequests: async () => (await meta<Record<string, number>>('discarded_requests')) ?? {},
    async discardRequest(pr) {
      const now = Date.now() / 1000;
      const kept = Object.entries((await meta<Record<string, number>>('discarded_requests')) ?? {}).filter(
        ([, at]) => now - at < 180 * 86400,
      );
      await saveMeta('discarded_requests', Object.fromEntries([...kept, [pr, now]]));
      const [requests, viewer] = await Promise.all([
        store.cursor<{ login: string; prs: { pr: string; direct?: boolean; asked_at?: number | null; rplus: [string, number][] }[] }>(
          'github',
          'requests',
        ),
        store.cursor<string>('github', 'viewer'),
      ]);
      // Only a request of my own, asked of me: a GitHub team's would take the whole team off, and another login is not mine to
      // change.
      // One I gave the r+ to is only hidden.
      const mine = !!viewer && viewer.toLowerCase() === requests?.login.toLowerCase();
      const asked = requests?.prs.some((p) => p.pr === pr && p.direct && !answered(p, requests.login));
      if (!mine || !asked) return { removed: false, error: null };
      const token = (await secrets.get('github_token').catch(() => null)) ?? (await ghToken());
      if (!token) return { removed: false, error: 'aucun jeton GitHub' };
      return new Github(token).removeReviewer(pr, viewer).then(
        () => ({ removed: true, error: null }),
        (error: Error) => ({ removed: false, error: error.message }),
      );
    },

    collectSettings: async () => collectSettings.parse((await meta('collect_settings')) ?? {}),
    async saveCollectSettings(settings: CollectSettings) {
      const checked = collectSettings.parse(settings);
      await saveMeta('collect_settings', checked);
      return checked;
    },

    async check() {
      const secret = (name: string) => secrets.get(name).catch(() => null);
      const sourceOf = async (vault: string | null, name: string, env: string | undefined, key: string | null) =>
        vault ? 'vault' : (await dockerSecret(name)) ? 'secret' : env ? 'env' : key ? 'host' : 'none';
      const vault = await secret('github_token');
      const token = vault ?? (await ghToken());
      const tokenSource = await sourceOf(vault, 'github_token', process.env.GH_TOKEN || process.env.GITHUB_TOKEN, token);
      let github: ConnectionChecks['github'] = { ok: false, detail: 'aucun jeton', source: 'none' };
      if (token) {
        const headers = { authorization: `bearer ${token}`, 'user-agent': `squad-dashboard/${release.version}` };
        try {
          const [user, limits] = await Promise.all([
            fetcher('https://api.github.com/user', { headers, signal: AbortSignal.timeout(10_000) }),
            fetcher('https://api.github.com/rate_limit', { headers, signal: AbortSignal.timeout(10_000) }),
          ]);
          const body = (await user.json()) as { login?: string };
          const quota = (await limits.json()) as { resources?: { graphql?: { remaining?: number } } };
          github = {
            ok: user.ok,
            detail: user.ok ? 'jeton accepté' : `HTTP ${user.status}`,
            source: tokenSource,
            login: body.login,
            scopes: (user.headers.get('x-oauth-scopes') ?? '')
              .split(',')
              .map((scope) => scope.trim())
              .filter(Boolean),
            remaining: quota.resources?.graphql?.remaining,
          };
        } catch (error) {
          github = { ok: false, detail: (error as Error).message, source: tokenSource };
        }
      }
      const vaultKey = await secret('odoo_api_key');
      const key = vaultKey ?? (await squadOdooKey());
      const keySource = await sourceOf(vaultKey, 'odoo_api_key', process.env.ODOO_API_KEY, key);
      let odoo: ConnectionChecks['odoo'] = { ok: false, detail: 'aucune clé', source: 'none' };
      if (key) {
        try {
          const me = (await loadConfig()).me ?? (await whoami());
          const [user] = await new Odoo(key, undefined, fetcher).searchRead('res.users', [['login', '=', `${me}@odoo.com`]], ['name']);
          odoo = user
            ? { ok: true, detail: 'clé acceptée', source: keySource, user: user.name }
            : { ok: false, detail: `aucun utilisateur ${me}@odoo.com`, source: keySource };
        } catch (error) {
          odoo = { ok: false, detail: (error as Error).message, source: keySource };
        }
      }
      const checkedClones = await Promise.all(
        clones.map(async ({ repo, git }) => {
          const remotes = Object.fromEntries(
            (await git.run(['remote', '-v'], { check: false }))
              .split('\n')
              .flatMap((line) => (line.endsWith('(fetch)') ? [line.split(/\s+/).slice(0, 2) as [string, string]] : [])),
          );
          const fetched = await stat(join(git.path, '.git', 'FETCH_HEAD')).then(
            (file) => file.mtimeMs / 1000,
            () => null,
          );
          const ok = await git.ok(['rev-parse', '--git-dir']);
          return { repo, path: git.path, ok, detail: ok ? 'clone lisible' : 'pas de clone git ici', remotes, fetched_at: fetched };
        }),
      );
      const [runbot, mergebot] = await Promise.all([reach('https://runbot.odoo.com/runbot'), reach('https://mergebot.odoo.com/')]);
      return { github, odoo, clones: checkedClones, runbot, mergebot };
    },

    async dataStats() {
      const [size] = await db.execute<{ size: string }>(sql`select pg_database_size(current_database())::text as size`);
      const tables = await db.execute<{ name: string; rows: string }>(
        sql`select relname as name, n_live_tup::text as rows from pg_stat_user_tables order by relname`,
      );
      return { size: Number(size?.size ?? 0), tables: Object.fromEntries([...tables].map((row) => [row.name, Number(row.rows)])) };
    },

    async derive() {
      const config = await loadConfig();
      const me = config.me ?? (await whoami());
      const { historyDays } = collectSettings.parse((await meta('collect_settings')) ?? {});
      return deriveAndSave(db, {
        repos: clones.map(({ repo }) => repo),
        followed: new Set(followed(config, me)),
        squad: squadOf(config, me),
        lead: followedSquad(config)?.lead ?? me,
        me,
        forced: config.github_logins,
        now: Date.now() / 1000,
        sinceDays: historyDays,
      });
    },
  };
}
