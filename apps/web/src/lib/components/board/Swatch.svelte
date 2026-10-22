<script lang="ts">
import type { Board } from '#lib/squad/model.ts';

let { board, person, size = 10 }: { board: Board; person: string; size?: number } = $props();
const index = $derived(board.everyone.indexOf(person));
</script>

<span
  class="inline-block flex-none rounded-full"
  style:width="{size}px"
  style:height="{size}px"
  style:background={index >= 0 && index < 8 ? `var(--p${index})` : 'var(--muted-foreground)'}
></span>
