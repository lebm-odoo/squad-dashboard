import type { CollectScope, CollectState } from '@sd/shared';
import { QueryClient } from '@tanstack/svelte-query';
import { parseResponse } from 'hono/client';
import { api } from './api.ts';

/** The data stays as read until a collection brings its space up to date: nothing is polled. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false, retry: 1 } },
});

export const live = $state<{ state: CollectState | null; connected: boolean | null }>({ state: null, connected: null });

/** Follows the collection as it goes: Moi and Squad share their data, read again as soon as each is ready. */
export function followCollection() {
  const events = new EventSource('/api/collect/events');
  events.addEventListener('state', (event) => {
    const state = JSON.parse(event.data) as CollectState;
    const fresh = state.ready.filter((space) => !live.state?.running || !live.state.ready.includes(space));
    if (fresh.length) void queryClient.invalidateQueries({ queryKey: ['squad'] });
    if (live.state?.running && !state.running) {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['version'] });
    }
    live.state = state;
    live.connected = true;
  });
  // EventSource reconnects on its own: the server is said down only when it stays so a few seconds.
  let down: ReturnType<typeof setTimeout> | undefined;
  events.onopen = () => {
    clearTimeout(down);
    live.connected = true;
  };
  events.onerror = () => {
    clearTimeout(down);
    down = setTimeout(() => {
      live.connected = false;
    }, 5000);
  };
  return () => {
    clearTimeout(down);
    events.close();
  };
}

export const collect = (scope: CollectScope) => parseResponse(api.collect.$post({ json: { scope } })).catch(() => null);

/**
 * While a page is in sight, what Moi needs is read again on its own, 5 minutes after the last collection, and at once on
 * coming back to the page after as long: nothing is read while no page shows.
 */
export function watchDesk() {
  const tick = () => {
    const since = Date.now() / 1000 - (live.state?.finished ?? 0);
    if (document.visibilityState === 'visible' && live.connected && live.state && !live.state.running && since > 300) void collect('watch');
  };
  const timer = setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', tick);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', tick);
  };
}
