<script lang="ts">
import type { Snippet } from 'svelte';
import * as Sheet from '#lib/components/ui/sheet/index.ts';

let {
  kind,
  overline = '',
  title,
  status,
  actions,
}: { kind: string; overline?: string; title: string; status?: Snippet; actions?: Snippet } = $props();
</script>

<header class="border-b bg-gradient-to-b from-muted/70 to-transparent px-5 pt-5 pb-4">
  <p class="flex flex-wrap items-baseline gap-x-1.5 pr-8 text-[11.5px] text-muted-foreground">
    <span class="font-semibold tracking-wide uppercase">{kind}</span>
    {#if overline}<span aria-hidden="true">·</span><span>{overline}</span>{/if}
  </p>
  <Sheet.Title class="mt-1 pr-8 text-lg leading-snug">{title}</Sheet.Title>
  {#if status}<div class="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">{@render status()}</div>{/if}
  {#if actions}<div class="mt-3 flex flex-wrap gap-1.5">{@render actions()}</div>{/if}
</header>
