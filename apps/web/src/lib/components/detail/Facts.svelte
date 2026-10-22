<script lang="ts">
import type { Snippet } from 'svelte';

let { children }: { children: Snippet } = $props();
</script>

<dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2 text-[13px]">{@render children()}</dl>
