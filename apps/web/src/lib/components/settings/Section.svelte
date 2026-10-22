<script lang="ts">
import type { Snippet } from 'svelte';
import * as Card from '#lib/components/ui/card/index.ts';

let { title, sub, action, children }: { title: string; sub?: string; action?: Snippet; children: Snippet } = $props();
</script>

<Card.Root class="gap-3 py-5">
  <Card.Header class="px-6">
    <Card.Title class="text-base">{title}</Card.Title>
    {#if sub}<Card.Description class="text-[13px]">{sub}</Card.Description>{/if}
    {#if action}<Card.Action>{@render action()}</Card.Action>{/if}
  </Card.Header>
  <Card.Content class="px-6">{@render children()}</Card.Content>
</Card.Root>
