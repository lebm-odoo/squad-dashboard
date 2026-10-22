<script lang="ts">
import Route from '@lucide/svelte/icons/route';
import { openDetail } from '#lib/detail.ts';
import { m } from '#lib/i18n.svelte.ts';
import { journeyHref } from '#lib/links.ts';
import type { Board } from '#lib/squad/model.ts';
import type { TodoRef } from '#lib/todos.svelte.ts';
import { goto } from '$app/navigation';

let { board, todoRef }: { board: Board | null; todoRef: TodoRef } = $props();
const feature = $derived(todoRef.type === 'feature' ? board?.feature(todoRef.key) : undefined);
const key = $derived(
  todoRef.type === 'pr'
    ? todoRef.key.replace(/^odoo\//, '')
    : todoRef.type === 'task'
      ? todoRef.key
      : feature
        ? feature.version
        : todoRef.type === 'journey' && todoRef.window
          ? (m().periods[todoRef.window] ?? '')
          : '',
);
const title = $derived(todoRef.type === 'journey' ? m().todos.openJourney : m().todos.openCard(todoRef.key));
const icon = $derived({ feature: '●', pr: '◆', task: '▢', journey: '' }[todoRef.type]);
const tone = $derived(
  { feature: 'text-link', pr: 'text-[var(--p6)]', task: 'text-[var(--p6)]', journey: 'text-[var(--p2)]' }[todoRef.type],
);

function open(event: MouseEvent) {
  event.stopPropagation();
  if (todoRef.type === 'journey') return goto(journeyHref(todoRef.who, todoRef.window));
  return openDetail(todoRef.type, todoRef.key);
}
</script>

<button
  class="inline-flex max-w-full min-w-0 cursor-pointer items-baseline gap-1.5 rounded-md border bg-muted px-2 py-px text-left text-[12.5px] hover:bg-accent"
  {title}
  onclick={open}
>
  <span class="flex-none self-center text-[11px] {tone}">{#if todoRef.type === 'journey'}<Route class="size-3" />{:else}{icon}{/if}</span>
  <span class="min-w-0 truncate">{(feature && (feature.title || feature.name)) || todoRef.label}</span>
  {#if key}<span class="flex-none text-[11.5px] text-muted-foreground">{key}</span>{/if}
</button>
