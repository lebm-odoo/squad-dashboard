import { join, relative, resolve } from 'node:path';
import { serveStatic } from 'hono/bun';
import pkg from '../../../package.json';
import { createApp } from './app';
import { runningCommit } from './commit';
import { loadConfig } from './config';
import { connect, database, ensureDatabase, migrateDatabase } from './db/client';
import { dashboardStore } from './db/dashboard';
import { readEnv } from './env';
import { KeyringStore } from './security/keyring';
import { FileStore } from './security/secrets';
import { settingsPort } from './settings';
import { openClones } from './sources/clones';
import { Collection } from './sync/collect';

const env = readEnv();
const commit = runningCommit(resolve(import.meta.dir, '../../..'));
await ensureDatabase(env.DATABASE_URL);
const sql = connect(env.DATABASE_URL);
const db = database(sql);
await migrateDatabase(db);

const secrets = env.SECRET_STORE === 'file' ? new FileStore(join(env.DATA_DIR, 'secrets.vault')) : new KeyringStore();
const config = () => loadConfig(env.CONFIG_PATH);
const clones = openClones(env.CLONES_DIR);
const store = dashboardStore(db);
const whoami = async () => (await clones[0]?.git.run(['config', 'user.email'], { check: false }))?.trim().toLowerCase().split('@')[0] ?? '';
const settings = settingsPort({
  db,
  store,
  clones,
  configPath: env.CONFIG_PATH,
  loadConfig: config,
  secrets,
  whoami,
  release: {
    version: pkg.version,
    repo: pkg.repository.replace(/^github:/, ''),
    runtime: env.RUNTIME,
    commit,
    startedAt: Date.now() / 1000,
  },
});
const app = createApp({
  version: pkg.version,
  hosts: env.ALLOWED_HOSTS,
  ping: () => sql`select 1`.execute(),
  loadConfig: config,
  secrets,
  store,
  settings,
  whoami,
  openUrl: env.RUNTIME === 'bun' ? (url) => void Bun.spawn(['xdg-open', url], { stdio: ['ignore', 'ignore', 'ignore'] }) : undefined,
  collection: new Collection({ db, clones, loadConfig: config, secrets, settings: () => settings.collectSettings() }),
});
const web = relative(process.cwd(), env.WEB_DIR);
app.all('/api/*', (c) => c.json({ error: 'route inconnue' }, 404));
app.use('/*', serveStatic({ root: web }));
app.get('/*', serveStatic({ path: join(web, 'index.html') }));

Bun.serve({ hostname: env.HOST, port: env.PORT, fetch: app.fetch, idleTimeout: 60 });
console.log(`squad-dashboard ${pkg.version} (${commit ?? 'commit inconnu'}) : ${env.PUBLIC_URL ?? `http://localhost:${env.PORT}/`}`);
