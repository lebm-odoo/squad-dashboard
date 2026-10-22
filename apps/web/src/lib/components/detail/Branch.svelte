<script lang="ts">
import Copy from '@lucide/svelte/icons/copy';
import { toast } from 'svelte-sonner';
import { tr } from '#lib/i18n.svelte.ts';
import { words } from '#lib/me/words.ts';

/** The branch closing a version's line, copied on a click. */
let { name }: { name: string } = $props();
const w = $derived(tr(words).card);

function copy() {
  navigator.clipboard?.writeText(name).then(
    () => toast(w.copied(name)),
    () => toast(name),
  );
}
</script>

<!-- Not ml-auto: a branch too long for this line starts on the left of the next one, under the version. -->
<span class="flex-1"></span>
<button
  class="-mx-1 flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 font-mono text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
  title={w.copyBranch}
  onclick={copy}
>
  <span class="truncate">{name}</span><Copy class="size-3 flex-none" />
</button>
