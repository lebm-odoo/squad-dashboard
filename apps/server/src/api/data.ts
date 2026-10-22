import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { DashboardStore } from './store';

/** The dashboard's data shared by every space: features, reviews, the state of the sources. */
export function dataRoutes(store: DashboardStore) {
  // `?owner=abc,def`: a list in one parameter, as links keep it.
  const list = z
    .string()
    .max(2000)
    .optional()
    .transform((value) => value?.split(',').filter(Boolean));
  const seconds = z.coerce.number().optional();
  const flag = z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true'));
  const page = { limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) };
  return (
    new Hono()
      .get(
        '/features',
        zValidator(
          'query',
          z.object({
            person: list,
            owner: list,
            kind: list,
            status: list,
            archived: flag,
            q: z.string().max(200).optional(),
            since: seconds,
            until: seconds,
            sort: z.enum(['last_at', 'first_at', 'merged_at', 'size', 'weighted', 'complexity', 'name']).default('last_at'),
            order: z.enum(['asc', 'desc']).default('desc'),
            ...page,
          }),
        ),
        async (c) => c.json(await store.features(c.req.valid('query'))),
      )
      // By query: a feature's name holds slashes, spaces and #.
      .get('/feature', zValidator('query', z.object({ name: z.string().min(1).max(500) })), async (c) => {
        const feature = await store.feature(c.req.valid('query').name);
        return feature ? c.json(feature) : c.json({ error: 'feature inconnue' }, 404);
      })
      .get(
        '/reviews',
        zValidator('query', z.object({ reviewer: list, author: list, since: seconds, until: seconds, ...page })),
        async (c) => c.json(await store.reviews(c.req.valid('query'))),
      )
      .get('/sources', async (c) => c.json(await store.sources()))
  );
}
