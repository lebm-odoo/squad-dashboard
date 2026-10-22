<script lang="ts">
import { m } from '#lib/i18n.svelte.ts';
import { hideTip } from '#lib/tip.svelte.ts';
import { type TodoRef, todos } from '#lib/todos.svelte.ts';

let { todoRef }: { todoRef: TodoRef } = $props();
</script>

{#if !todos.offline}
  <button
    class="flex-none cursor-pointer rounded px-1.5 text-[15px] leading-none text-muted-foreground opacity-0 group-hover/line:opacity-100 hover:bg-accent hover:text-link focus-visible:opacity-100"
    title={m().todos.addTitle}
    aria-label={m().todos.dialogTitle}
    onclick={(event) => {
      event.stopPropagation();
      event.preventDefault();
      hideTip();
      todos.dialog = todoRef;
    }}>+</button
  >
{/if}
