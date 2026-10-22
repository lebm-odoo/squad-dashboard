<script lang="ts">
import type { Snippet } from 'svelte';
import { tooltip } from '#lib/tip.svelte.ts';

let { onopen, tip, pinned = false, children }: { onopen: () => void; tip: Snippet; pinned?: boolean; children: Snippet } = $props();
</script>

<!-- A div, not a button: it holds the + of the to-dos and the links of its tags. -->
<div
  class="line group/line"
  class:has-todo={pinned}
  tabindex="0"
  role="button"
  onclick={onopen}
  onkeydown={(event) => event.key === 'Enter' && onopen()}
  {@attach tooltip(tip)}
>
  {@render children()}
</div>
