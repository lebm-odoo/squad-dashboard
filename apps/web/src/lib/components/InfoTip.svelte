<script lang="ts">
import Info from '@lucide/svelte/icons/info';
import { tooltip } from '#lib/tip.svelte.ts';

let { text }: { text: string } = $props();
</script>

{#snippet tip()}<div class="max-w-80 leading-relaxed">{text}</div>{/snippet}

<button type="button" class="inline-flex cursor-help align-middle text-muted-foreground hover:text-foreground" aria-label={text} {@attach tooltip(tip)}>
  <Info class="size-3.5" />
</button>
