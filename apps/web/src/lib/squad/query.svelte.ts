import { createQuery } from '@tanstack/svelte-query';
import { parseResponse } from 'hono/client';
import { api } from '../api.ts';
import { Board } from './model.ts';
import type { SquadData } from './types.ts';

/** Moi and Squad compute on the same data, read once and again when a collection brings them up to date. */
export const squadQuery = (enabled: () => boolean = () => true) =>
  createQuery(() => ({
    queryKey: ['squad'],
    enabled: enabled(),
    queryFn: async () => new Board((await parseResponse(api.squad.data.$get({ query: {} }))) as unknown as SquadData),
  }));
