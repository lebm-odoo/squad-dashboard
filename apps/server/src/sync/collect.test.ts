import { describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import type { CollectState } from '@sd/shared';
import { collectSettings, dashboardConfig } from '@sd/shared';
import { dashboardFeature, dashboardPart } from '../db/schema';
import { testDatabaseUrl, withTestDatabase } from '../db/testing';
import { Git, Slots } from '../sources/git';
import { makeClone } from '../sources/testing';
import { Collection } from './collect';

describe.skipIf(!testDatabaseUrl)('a collection', () => {
  test('reads the clones and saves the dashboard computed from them, telling each step', async () => {
    const clone = await makeClone();
    try {
      const fix = clone.commit('anne@odoo.com', '[FIX] hr: a fix\n\ncloses odoo/odoo#1\n\nSigned-off-by: Bob (bob) <bob@odoo.com>');
      clone.git(['update-ref', 'refs/remotes/origin/master', fix]);
      clone.git(['update-ref', 'refs/remotes/dev/master-hr-thing-anne', clone.commit('anne@odoo.com', '[IMP] hr: a thing')]);
      await withTestDatabase(async (db) => {
        const collection = new Collection({
          db,
          clones: [{ repo: 'odoo', remote: 'dev', slug: 'odoo-dev/odoo', git: new Git(clone.path, new Slots(4)) }],
          loadConfig: async () => dashboardConfig.parse({ me: 'anne', follow: 'squad', squad: { lead: 'anne', members: ['bob'] } }),
          secrets: {
            status: async () => ({ kind: 'keyring', exists: true, locked: false }),
            get: async () => null,
            set: async () => {},
            delete: async () => {},
          },
          settings: async () => collectSettings.parse({}),
        });
        const seen: string[] = [];
        collection.subscribe((state: CollectState) => {
          for (const step of state.current) if (!seen.includes(step)) seen.push(step);
        });
        const running = collection.start('git');
        expect(collection.start('git')).toBeNull();
        await running;
        expect(collection.state).toMatchObject({ running: false, scope: 'git', errors: {} });
        expect(seen).toContain('calcul du tableau de bord');
        const features = await db.select({ name: dashboardFeature.name, owner: dashboardFeature.owner }).from(dashboardFeature);
        expect(features).toContainEqual({ name: 'master-hr-thing-anne', owner: 'anne' });
        const parts = await db.select({ part: dashboardPart.part }).from(dashboardPart);
        expect(parts.map((row) => row.part).sort()).toEqual(['history_since', 'login_sources', 'logins', 'review_requests']);
        expect(collection.state.ready).toEqual(['squad']);
      });
    } finally {
      await rm(clone.path, { recursive: true, force: true });
    }
  }, 60_000);
});
