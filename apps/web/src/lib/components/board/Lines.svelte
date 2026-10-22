<script lang="ts" generics="T">
import type { Snippet } from 'svelte';
import { m } from '#lib/i18n.svelte.ts';

let { items, limit, item, more }: { items: T[]; limit: number; item: Snippet<[T]>; more?: () => void } = $props();
</script>

{#if items.length}
  <div class="flex min-w-0 flex-col gap-px">
    {#each items.slice(0, limit) as entry, index (index)}{@render item(entry)}{/each}
    {#if items.length > limit}
      <button class="linkish mt-0.5 self-start" onclick={more}>{m().more(items.length - limit)}</button>
    {/if}
  </div>
{:else}
  <span class="text-muted-foreground">—</span>
{/if}
