import type { MiddlewareHandler } from 'hono';

// Against DNS rebinding: once a hostile name resolves to 127.0.0.1, its pages reach this server under their own Host.
export const allowHosts =
  (hosts: string[]): MiddlewareHandler =>
  async (c, next) => {
    const host = (c.req.header('host') ?? '').replace(/:\d+$/, '');
    if (!hosts.includes(host)) return c.text('Hôte non autorisé', 421);
    await next();
  };
