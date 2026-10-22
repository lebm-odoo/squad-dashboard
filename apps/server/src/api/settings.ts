import { zValidator } from '@hono/zod-validator';
import {
  type CollectState,
  collectSettings,
  configPatch,
  type DashboardConfig,
  dashboardConfig,
  secretNames,
  setupInput,
  todos,
} from '@sd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SecretStore } from '../security/secrets';
import type { SettingsPort } from './store';

type SettingsDeps = {
  settings: SettingsPort;
  secrets: SecretStore;
  loadConfig: () => Promise<DashboardConfig>;
  whoami: () => Promise<string>;
  collection: { state: CollectState };
};

/** The settings: who I am, my squad and its logins, the connections, the collection, the data; my to-dos. */
export function settingsRoutes({ settings, secrets, loadConfig, whoami, collection }: SettingsDeps) {
  const secret = zValidator('param', z.object({ name: z.enum(secretNames) }));
  // Whether a secret is set, never its value; a locked vault cannot tell.
  const present = (name: string) =>
    secrets.get(name).then(
      (value) => value !== null,
      () => null,
    );
  // A config.json of the V1 names the squad by `lead` and `members`: the first page starts from them.
  const setupOf = async (config: DashboardConfig | null) => {
    const v1 = dashboardConfig.pick({ me: true, squad: true }).safeParse({ me: config?.lead, squad: config });
    return {
      follow: config?.follow ?? null,
      me: config?.me ?? (v1.success ? v1.data.me : undefined) ?? null,
      whoami: await whoami(),
      squad: config?.squad ?? (v1.success ? v1.data.squad : undefined) ?? null,
      keys: await settings.keySources(),
    };
  };
  return (
    new Hono()
      // Open before config.json exists or says what to follow: the page asks on its first opening.
      .get('/setup', async (c) => c.json(await setupOf(await loadConfig().catch(() => null))))
      .put('/setup', zValidator('json', setupInput), async (c) => {
        const { follow, me, squad } = c.req.valid('json');
        // Following me alone keeps the squad config.json names, for the day the squad is followed again.
        return c.json(await setupOf(await settings.saveConfig({ follow, me, squad: follow === 'me' ? undefined : squad })));
      })
      .get('/settings', async (c) => {
        const config = await loadConfig();
        const [logins, collect, status, github, odoo] = await Promise.all([
          settings.loginReport(),
          settings.collectSettings(),
          secrets.status(),
          present('github_token'),
          present('odoo_api_key'),
        ]);
        return c.json({
          config,
          whoami: await whoami(),
          logins,
          collect,
          secrets: { ...status, github_token: github, odoo_api_key: odoo },
        });
      })
      .put('/settings/config', zValidator('json', configPatch), async (c) => c.json(await settings.saveConfig(c.req.valid('json'))))
      .put('/settings/collect', zValidator('json', collectSettings), async (c) =>
        c.json(await settings.saveCollectSettings(c.req.valid('json'))),
      )
      .put('/settings/secrets/:name', secret, zValidator('json', z.object({ value: z.string().min(1).max(500) })), async (c) => {
        await secrets.set(c.req.valid('param').name, c.req.valid('json').value.trim());
        return c.json({ saved: true });
      })
      .delete('/settings/secrets/:name', secret, async (c) => {
        await secrets.delete(c.req.valid('param').name);
        return c.json({ saved: false });
      })
      .post('/settings/check', async (c) => c.json(await settings.check()))
      .get('/settings/data', async (c) => c.json(await settings.dataStats()))
      .post('/settings/derive', async (c) => {
        if (collection.state.running) return c.json({ error: 'une collecte tourne : elle recalculera le tableau' }, 409);
        return c.json(await settings.derive());
      })
      .get('/version', async (c) => c.json(await settings.updates()))
      .post('/version/check', async (c) => c.json(await settings.checkUpdates()))
      .post('/requests/discard', zValidator('json', z.object({ pr: z.string().regex(/^[\w.-]+\/[\w.-]+#\d+$/) })), async (c) =>
        c.json(await settings.discardRequest(c.req.valid('json').pr)),
      )
      .get('/todos', async (c) => c.json(await settings.todos()))
      .put('/todos', zValidator('json', todos), async (c) => c.json(await settings.saveTodos(c.req.valid('json'))))
  );
}
