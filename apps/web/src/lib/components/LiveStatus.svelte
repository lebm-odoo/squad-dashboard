<script lang="ts">
import { createQuery } from '@tanstack/svelte-query';
import { parseResponse } from 'hono/client';
import { api } from '#lib/api.ts';
import { rel } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { live } from '#lib/live.svelte.ts';

const sources = createQuery(() => ({ queryKey: ['sources'], queryFn: () => parseResponse(api.sources.$get()) }));
const last = $derived((sources.data?.collect ?? null) as { finished?: number; errors?: Record<string, string> } | null);
const state = $derived(live.state);
const errors = $derived(Object.entries(state?.finished ? state.errors : (last?.errors ?? {})));
const finished = $derived(state?.finished ?? last?.finished ?? null);
const tone = $derived(
  live.connected === false
    ? 'bg-critical'
    : state?.running
      ? 'bg-link animate-pulse'
      : errors.length
        ? 'bg-warn'
        : finished
          ? 'bg-good'
          : 'bg-muted-foreground',
);
</script>

<div class="flex min-w-0 items-center gap-2 text-[13px] text-foreground/70" title={errors.map(([source, error]) => `${source} : ${error}`).join('\n')}>
  <span class="size-2 shrink-0 rounded-full {tone}"></span>
  <span class="hidden truncate @xl:inline">
    {#if live.connected === false}
      {m().live.unreachable}
    {:else if live.connected === null}
      {m().live.connecting}
    {:else if state?.running}
      {m().live.running(state.current.join(', ') || '…')}
    {:else if finished}
      {m().live.updated(rel(finished))}{#if errors.length}<span class="text-muted-foreground"> · {m().live.errors(errors.length)}</span>{/if}
    {:else}
      {m().live.never}
    {/if}
  </span>
</div>
