// Runs a collection from the command line, as the page's button does: `bun run collect [all|git|ci|github|odoo]`.

import { type CollectScope, collectScopes, collectSettings } from '@sd/shared';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config';
import { connect, database, ensureDatabase, migrateDatabase } from '../db/client';
import { dashboardStore } from '../db/dashboard';
import { appMeta } from '../db/schema';
import { readEnv } from '../env';
import { KeyringStore } from '../security/keyring';
import { openClones } from '../sources/clones';
import { Collection } from '../sync/collect';

const scope = (process.argv[2] ?? 'all') as CollectScope;
if (!collectScopes.includes(scope)) throw new Error(`portée inconnue : ${scope}, parmi ${collectScopes.join(', ')}`);
const env = readEnv();
await ensureDatabase(env.DATABASE_URL);
const sql = connect(env.DATABASE_URL);
const db = database(sql);
await migrateDatabase(db);
const collection = new Collection({
  db,
  clones: openClones(env.CLONES_DIR),
  loadConfig: () => loadConfig(env.CONFIG_PATH),
  secrets: new KeyringStore(),
  settings: async () => collectSettings.parse((await db.select().from(appMeta).where(eq(appMeta.key, 'collect_settings')))[0]?.value ?? {}),
});
const started = performance.now();
const elapsed = () => `${((performance.now() - started) / 1000).toFixed(0).padStart(5)} s`;
const seen = new Set<string>();
const spaces = { me: 'Moi', squad: 'Squad' };
collection.subscribe((state) => {
  for (const step of [...state.current, ...state.ready.map((space) => `→ ${spaces[space]} à jour`)]) {
    if (!seen.has(step)) console.log(`${elapsed()}  ${step}`);
    seen.add(step);
  }
});
await collection.start(scope);
console.log(`\nCollecte ${scope} en ${elapsed().trim()} ; durée de chaque étape :`);
for (const [step, seconds] of collection.state.steps) console.log(`${seconds.toFixed(0).padStart(7)} s  ${step}`);
const { github, web, odoo } = await dashboardStore(db).sources();
console.log(`\nGitHub : ${JSON.stringify(github)}\nRunbot et mergebot : ${JSON.stringify(web)}\nOdoo : ${JSON.stringify(odoo)}`);
for (const [source, error] of Object.entries(collection.state.errors)) console.error(`Erreur, ${source} : ${error}`);
await sql.end();
process.exit(Object.keys(collection.state.errors).length ? 1 : 0);
