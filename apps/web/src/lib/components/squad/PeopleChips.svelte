<script lang="ts">
import Swatch from '#lib/components/board/Swatch.svelte';
import { label } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import type { Board } from '#lib/squad/model.ts';

let { board, who, pick }: { board: Board; who: string | null; pick: (who: string | null) => void } = $props();
</script>

{#snippet chip(person: string | null, text: string)}
  <button
    class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-card py-1 pr-[11px] pl-[9px] text-[13px] hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
    aria-pressed={who === person}
    onclick={() => pick(person)}
  >
    {#if person}<Swatch {board} {person} />{/if}{text}
  </button>
{/snippet}

<div class="inline-flex flex-wrap items-center gap-1.5">
  {@render chip(null, m().work.whole)}
  {#each board.members.filter((person) => person !== board.me) as person (person)}{@render chip(person, label(person))}{/each}
</div>
