<script lang="ts">
import type { Snippet } from 'svelte';

let { title, count, children }: { title: string; count?: number; children: Snippet } = $props();
</script>

<section class="px-5 py-4 not-first:border-t">
  <h3 class="col-title flex items-center gap-1.5">{title}{#if count != null}<span class="text-foreground/60 tabular-nums">{count}</span>{/if}</h3>
  {@render children()}
</section>
