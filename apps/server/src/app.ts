import { zValidator } from '@hono/zod-validator';
import { type CollectScope, type CollectState, collectScopes, type DashboardConfig } from '@sd/shared';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { type SSEStreamingApi, streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { dataRoutes } from './api/data';
import { settingsRoutes } from './api/settings';
import { spaceRoutes } from './api/spaces';
import type { DashboardStore, SettingsPort } from './api/store';
import { ConfigError } from './config';
import { allowHosts } from './security/hosts';
import { FileStore, SecretError, type SecretStore } from './security/secrets';

export type AppDeps = {
  version: string;
  hosts: string[];
  ping: () => Promise<unknown>;
  loadConfig: () => Promise<DashboardConfig>;
  secrets: SecretStore;
  store: DashboardStore;
  settings: SettingsPort;
  /** Who uses this machine, when config.json does not say: `git config user.email` of the odoo clone. */
  whoami: () => Promise<string>;
  collection: {
    state: CollectState;
    start(scope: CollectScope): Promise<void> | null;
    subscribe(listener: (state: CollectState) => void): () => void;
  };
};

// A beat now and then: a silent stream is closed by Bun after its idle timeout, and its reader would take it as down.
async function beat(stream: SSEStreamingApi) {
  while (!stream.aborted) {
    await stream.sleep(15_000);
    await stream.writeSSE({ event: 'ping', data: '' });
  }
}

export function createApp(deps: AppDeps) {
  const passphrase = zValidator('json', z.object({ passphrase: z.string().min(1).max(1024) }));
  const openers = new Set<(url: string) => void>();
  const vault = () => {
    if (!(deps.secrets instanceof FileStore)) throw new SecretError('les secrets sont gardés par le trousseau du système');
    return deps.secrets;
  };

  const api = new Hono()
    .get('/health', async (c) => {
      const db = await deps.ping().then(
        () => 'ok' as const,
        () => 'error' as const,
      );
      return c.json({ version: deps.version, db }, db === 'ok' ? 200 : 503);
    })
    // The page in its own window sends here the links leaving it, for the browser where I am logged in.
    .post('/open', zValidator('json', z.object({ url: z.url({ protocol: /^https?$/ }) })), (c) => {
      if (!openers.size) return c.json({ error: "aucune fenêtre de l'app ne suit les liens" }, 404);
      for (const open of openers) open(c.req.valid('json').url);
      return c.body(null, 204);
    })
    // scripts/app.sh reads them here and opens them on the desktop: the server itself may run in Docker.
    .get('/open', (c) =>
      streamSSE(c, async (stream) => {
        const open = (url: string) => void stream.writeSSE({ event: 'open', data: url });
        openers.add(open);
        stream.onAbort(() => void openers.delete(open));
        await beat(stream);
      }),
    )
    .get('/config', async (c) => c.json(await deps.loadConfig()))
    .get('/secrets', async (c) => c.json(await deps.secrets.status()))
    .post('/secrets/create', passphrase, async (c) => {
      await vault().create(c.req.valid('json').passphrase);
      return c.json(await deps.secrets.status());
    })
    .post('/secrets/unlock', passphrase, async (c) => {
      await vault().unlock(c.req.valid('json').passphrase);
      return c.json(await deps.secrets.status());
    })
    .post('/secrets/lock', async (c) => {
      vault().lock();
      return c.json(await deps.secrets.status());
    })
    .post('/secrets/reset', async (c) => {
      await vault().reset();
      return c.json(await deps.secrets.status());
    })
    .get('/collect', (c) => c.json(deps.collection.state))
    .post('/collect', zValidator('json', z.object({ scope: z.enum(collectScopes) })), (c) => {
      const { scope } = c.req.valid('json');
      const started = deps.collection.start(scope);
      // One request to GitHub along with what the click reads: a new release is known without anything polling.
      if (started && scope === 'all') void deps.settings.checkUpdates().catch(() => {});
      return c.json(deps.collection.state, started ? 202 : 409);
    })
    // The progress of the collection, as it goes: the page needs no polling.
    .get('/collect/events', (c) =>
      streamSSE(c, async (stream) => {
        const send = (state: unknown) => stream.writeSSE({ event: 'state', data: JSON.stringify(state) });
        const unsubscribe = deps.collection.subscribe((state) => void send(state));
        stream.onAbort(unsubscribe);
        await send(deps.collection.state);
        await beat(stream);
      }),
    );

  return new Hono()
    .use(allowHosts(deps.hosts), secureHeaders(), csrf())
    .onError((error, c) => {
      if (error instanceof HTTPException) return error.getResponse();
      if (error instanceof SecretError) return c.json({ error: error.message }, 400);
      if (error instanceof ConfigError) return c.json({ error: error.message }, 500);
      console.error(error);
      return c.json({ error: 'erreur interne' }, 500);
    })
    .route('/api', api)
    .route('/api', dataRoutes(deps.store))
    .route('/api', spaceRoutes(deps))
    .route('/api', settingsRoutes(deps));
}

export type AppType = ReturnType<typeof createApp>;
