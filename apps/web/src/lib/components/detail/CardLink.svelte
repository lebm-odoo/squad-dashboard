<script lang="ts">
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import type { Snippet } from 'svelte';

/** A line of a card that opens another card. */
let { onclick, children }: { onclick: () => void; children: Snippet } = $props();
</script>

<button class="group -mx-2 flex w-[calc(100%+1rem)] min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted" {onclick}>
  {@render children()}
  <ChevronRight class="ml-auto size-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" />
</button>
