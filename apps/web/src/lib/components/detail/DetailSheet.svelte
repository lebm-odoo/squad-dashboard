<script lang="ts">
import { createQuery } from '@tanstack/svelte-query';
import { parseResponse } from 'hono/client';
import { prefersReducedMotion } from 'svelte/motion';
import { fly } from 'svelte/transition';
import { api } from '#lib/api.ts';
import Loading from '#lib/components/shell/Loading.svelte';
import * as Sheet from '#lib/components/ui/sheet/index.ts';
import { closeDetail, type Detail, openedDetail } from '#lib/detail.ts';
import { tr } from '#lib/i18n.svelte.ts';
import { words } from '#lib/me/words.ts';
import { Board } from '#lib/squad/model.ts';
import { squadQuery } from '#lib/squad/query.svelte.ts';
import type { SquadData } from '#lib/squad/types.ts';
import { unitOf } from '#lib/squad/unit.ts';
import { page } from '$app/state';
import CardHead from './CardHead.svelte';
import WorkCard from './WorkCard.svelte';

/** The card of a feature, a review or a task, beside any page: the address says which. */
const target = $derived(openedDetail(page.url.searchParams));
const query = squadQuery(() => !!target);
const w = $derived(tr(words).card);
// The card stays drawn while the sheet slides out.
let shown = $state<Detail | null>(null);
$effect.pre(() => {
  if (target) shown = target;
});
// A feature the squad never touched: the squad's data read again with it and its family.
const outside = $derived(shown?.kind === 'feature' && !!query.data && !query.data.feature(shown.key));
const extra = createQuery(() => ({
  queryKey: ['squad', 'card', shown?.key],
  enabled: outside,
  queryFn: async () => new Board((await parseResponse(api.squad.data.$get({ query: { feature: shown?.key } }))) as unknown as SquadData),
}));
const board = $derived(outside ? extra.data : query.data);
const failure = $derived(query.error ?? (outside ? extra.error : null));
</script>

<Sheet.Root open={!!target} onOpenChange={(open) => !open && closeDetail()}>
  <Sheet.Content side="right" class="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
    {#if shown && board}
      {#key `${shown.kind}:${shown.key}`}
        {@const u = unitOf(board, shown.kind, shown.key)}
        <div in:fly={{ x: 24, duration: prefersReducedMotion.current ? 0 : 220 }}>
          {#if u}
            <WorkCard {board} {u} />
          {:else}
            <CardHead kind={w.kinds[shown.kind] ?? ''} title={shown.key}>
              {#snippet status()}{w.missing(shown?.key ?? '')}{/snippet}
            </CardHead>
          {/if}
        </div>
      {/key}
    {:else}
      <Sheet.Title class="sr-only">{w.loading}</Sheet.Title>
      {#if failure}
        <p class="p-6 text-sm text-muted-foreground">{failure.message}</p>
      {:else}
        <div class="p-6"><Loading label={w.loading} shape="card" /></div>
      {/if}
    {/if}
  </Sheet.Content>
</Sheet.Root>
