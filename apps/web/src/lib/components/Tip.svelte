<script lang="ts">
import { hideTip, tip } from '#lib/tip.svelte.ts';

let width = $state(0);
let height = $state(0);
// Next to the pointer, flipped to the other side near the window's edges.
const left = $derived(Math.max(8, tip.x + 14 + width > innerWidth - 8 ? tip.x - width - 14 : tip.x + 14));
const top = $derived(Math.max(8, tip.y + 14 + height > innerHeight - 8 ? tip.y - height - 14 : tip.y + 14));
</script>

<!-- A line redrawn under the pointer never gets its pointerleave: a click or a scroll closes the tooltip. -->
<svelte:window onclickcapture={hideTip} onscroll={hideTip} />

{#if tip.content}
  <div
    role="tooltip"
    bind:offsetWidth={width}
    bind:offsetHeight={height}
    class="pointer-events-none fixed z-50 max-w-90 rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
    style:left="{left}px"
    style:top="{top}px"
  >
    {@render tip.content()}
  </div>
{/if}
