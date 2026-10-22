<script lang="ts">
import type { Snippet } from 'svelte';

let { label, children }: { label: string; children: Snippet } = $props();
</script>

<dt class="pt-px text-muted-foreground">{label}</dt>
<dd class="flex min-w-0 flex-wrap items-center gap-1.5 [overflow-wrap:anywhere]">{@render children()}</dd>
