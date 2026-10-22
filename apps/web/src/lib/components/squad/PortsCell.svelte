<script lang="ts">
import ArrowDownLeft from '@lucide/svelte/icons/arrow-down-left';
import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
import PortTag from '#lib/components/board/PortTag.svelte';
import { m } from '#lib/i18n.svelte.ts';
import { type Board, type Feat, portsStopped } from '#lib/squad/model.ts';

let { board, f }: { board: Board; f: Feat } = $props();
const chain = $derived(board.forwardChain(f));
const ports = $derived(board.manualPorts(f));
const tones = { merged: 'fw-merged', open: 'fw-open', blocked: 'fw-blocked', closed: 'fw-closed' };
</script>

{#if !chain.length && !ports.length}
  <span class="text-xs text-muted-foreground">
    {f.version === 'master' || f.status === 'closed' || portsStopped(f.merged_at) ? '—' : f.merged_at ? m().work.notCreated : m().work.afterMerge}
  </span>
{:else}
  {#each ports as x (x.f.name)}
    {@const Arrow = x.back ? ArrowDownLeft : ArrowUpRight}
    <span class="rtag {tones[x.state]}" title={m().work.byHand(x.back, x.f.version, m().ports[x.state] ?? '')}><Arrow class="size-3" />{x.f.version}</span>
    {#each x.chain as step (step.branch)}<PortTag {step} title={m().work.backportOf(step.branch, x.f.version)} />{/each}
  {/each}
  {#each chain as step (step.branch)}<PortTag {step} />{/each}
{/if}
