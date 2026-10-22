<script lang="ts">
import { fdate } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { type Code, codeMoving } from '#lib/squad/model.ts';
import PortTag from './PortTag.svelte';

let { code, moving: showMoving = true }: { code: Code | null; moving?: boolean } = $props();
const moving = $derived(showMoving && code?.merged ? codeMoving(code) : undefined);
</script>

{#if moving}
  <PortTag step={moving} />
{:else if code?.closed}
  <span class="rtag fw-closed">× {m().ports.closed}</span>
{:else if code?.merged}
  <span class="rtag fw-merged" title={m().tip.mergedOn(fdate(code.at))}>✓ {m().ports.merged}</span>
{/if}
