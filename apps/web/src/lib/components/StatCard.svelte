<script lang="ts">
import type { Component, Snippet } from 'svelte';
import { cubicOut } from 'svelte/easing';
import { prefersReducedMotion, Tween } from 'svelte/motion';
import * as Card from '#lib/components/ui/card/index.ts';

let {
  label,
  value,
  hint = '',
  icon: Icon,
  href,
  tone = '',
  delta,
  children,
}: {
  label: string;
  value?: string | number;
  hint?: string;
  icon?: Component;
  href?: string;
  tone?: string;
  /** The change against a previous period, and whether going up is good. */
  delta?: { text: string; up: boolean; good: boolean | null } | null;
  /** Shown in place of the value: a figure that is not a number. */
  children?: Snippet;
} = $props();
const counted = Tween.of(() => (typeof value === 'number' ? value : 0), {
  duration: () => (prefersReducedMotion.current ? 0 : 450),
  easing: cubicOut,
});
const shown = $derived(Number.isInteger(value) ? Math.round(counted.current) : value);
</script>

<Card.Root class="@container/card relative gap-2 bg-gradient-to-t from-primary/[0.03] to-card py-4 shadow-xs transition-colors {href ? 'hover:border-ring/60' : ''}">
  <Card.Header class="px-4">
    <Card.Description class="flex items-center gap-1.5">
      {#if Icon}<Icon class="size-4" />{/if}
      {#if href}<a {href} class="after:absolute after:inset-0">{label}</a>{:else}{label}{/if}
    </Card.Description>
    {#if children}
      <div class="mt-0.5 min-w-0">{@render children()}</div>
    {:else}
      <Card.Title class="flex items-baseline gap-2 text-2xl font-semibold {tone}">
        <span class="tabular-nums">{shown}</span>
        {#if delta}
          <span class="text-xs font-medium {delta.good == null ? 'text-muted-foreground' : delta.good ? 'text-good-text' : 'text-critical'}">{delta.up ? '▲' : '▼'} {delta.text}</span>
        {/if}
      </Card.Title>
    {/if}
  </Card.Header>
  {#if hint}<Card.Footer class="px-4 text-xs text-muted-foreground">{hint}</Card.Footer>{/if}
</Card.Root>
