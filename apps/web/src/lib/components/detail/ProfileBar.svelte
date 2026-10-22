<script lang="ts">
import { fmt, pct } from '#lib/format.ts';
import { tr } from '#lib/i18n.svelte.ts';
import { sum } from '#lib/squad/model.ts';
import { tooltip } from '#lib/tip.svelte.ts';
import { profiles, words } from './measures.ts';

/** The split of a person's lines over the stack, one fixed hue per part whatever the person: the colours never follow a rank. */
let { counts, legend = false, height = 10 }: { counts: number[]; legend?: boolean; height?: number } = $props();
const total = $derived(sum(counts));
const parts = $derived(profiles.map((k, i) => [k, counts[i] ?? 0] as const).filter(([, n]) => n));
const w = $derived(tr(words));
const colors: Record<string, string> = { back: 'var(--p0)', front: 'var(--p1)', views: 'var(--p2)', data: 'var(--p3)', test: 'var(--p4)' };
</script>

{#if total}
  <div class="flex w-full min-w-20 gap-0.5 overflow-hidden rounded" style:height="{height}px">
    {#each parts as [k, n] (k)}
      {#snippet tip()}
        <div class="font-semibold">{w.profiles[k]}</div>
        <div>{pct(n / total)} · {fmt(n)}</div>
        <div class="text-muted-foreground">{w.profileHints[k]}</div>
      {/snippet}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <span class="block min-w-[3px]" style:flex={n} style:background={colors[k]} tabindex="0" {@attach tooltip(tip)}></span>
    {/each}
  </div>
  {#if legend}
    <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground/70">
      {#each [...parts].sort((a, b) => b[1] - a[1]) as [k, n] (k)}
        <span class="inline-flex items-center gap-1" title={w.profileHints[k]}><i class="inline-block size-2.5 rounded-sm" style:background={colors[k]}></i>{w.profiles[k]} {pct(n / total)}</span>
      {/each}
    </div>
  {/if}
{:else}
  <span class="text-muted-foreground">—</span>
{/if}
