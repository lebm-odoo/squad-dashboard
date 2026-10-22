import type { InferResponseType } from 'hono/client';
import type { api } from '#lib/api.ts';

export type Settings = InferResponseType<typeof api.settings.$get, 200>;
export type Checks = InferResponseType<typeof api.settings.check.$post, 200>;
