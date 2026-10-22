<script lang="ts">
import { fdate, label, personName } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { workHref } from '#lib/links.ts';
import type { Board } from '#lib/squad/model.ts';
import { tooltip } from '#lib/tip.svelte.ts';
import { goto } from '$app/navigation';

type Reviewer = ReturnType<Board['reviewersOf']>[number];
let { person, x, period }: { person: string; x: Reviewer; period: string } = $props();
const colors: Record<string, string> = {
  rplus: 'var(--link)',
  validation: 'var(--good)',
  changes: 'var(--p3)',
  comment: 'var(--muted-foreground)',
};
const tags: Record<string, string> = { rplus: 'r+', validation: '✓', changes: '✎', comment: '💬' };
const kinds = $derived(Object.entries(x.kinds).filter(([, n]) => n));
</script>

{#snippet tip()}
  <div class="font-semibold">{m().board.reviewerOn(personName(x.who), label(person))}</div>
  <div>{m().board.reviewerCount(x.items.length, fdate(x.last))}</div>
  <div class="text-muted-foreground">{kinds.map(([k, n]) => `${m().reviewerWords[k]} ${n}`).join(' · ')}</div>
  {#each x.items.slice(0, 6) as item, index (index)}<div>{tags[item.kind]} {item.f.title || item.f.name}</div>{/each}
  {#if x.items.length > 6}<div class="text-muted-foreground">{m().more(x.items.length - 6)}</div>{/if}
  <div class="text-muted-foreground">{m().board.seeInWork}</div>
{/snippet}

<button
  class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-card py-0.5 pr-2.5 pl-2 text-[12.5px] hover:bg-muted"
  onclick={() => goto(workHref({ who: person, period, role: 'own', reviewer: x.who }))}
  {@attach tooltip(tip)}
>
  <span class="inline-flex gap-0.5">{#each kinds as [k] (k)}<i class="inline-block size-1.5 rounded-full" style:background={colors[k]}></i>{/each}</span>
  {personName(x.who)}
  <span class="text-[11.5px] text-muted-foreground tabular-nums">{x.items.length}</span>
</button>
