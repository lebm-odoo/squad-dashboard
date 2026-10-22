<script lang="ts">
import { fdt } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { type Board, type Feat, statusKey } from '#lib/squad/model.ts';

let { board, f }: { board: Board; f: Feat } = $props();
const icons: Record<string, string> = { merged: '✓', open: '●', draft: '◌', closed: '×', wip: '○' };
const key = $derived(statusKey(f));
</script>

<span class="inline-flex flex-col items-start gap-[3px]">
  {#if f.status === 'merged' && f.merged_at}
    <span class="badge st-merged" title={m().tip.mergedOn(fdt(f.merged_at))}><span class="ico">✓</span>{m().mergedIn(board.mergedIn(f.version, f.merged_at))}</span>
  {:else}
    <span class="badge st-{key}"><span class="ico">{icons[key]}</span>{m().status[key]}</span>
  {/if}
  {#if f.status === 'open' && f._ciFail}<span class="text-xs text-muted-foreground">{m().work.ciToCheck}</span>{/if}
  {#if f.deleted && f.status !== 'merged'}<span class="text-xs text-muted-foreground">{m().work.branchDeleted}</span>{/if}
</span>
