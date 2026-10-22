<script lang="ts">
import type { Todo } from '@sd/shared';
import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
import { rel, shortDate } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { type Board, now } from '#lib/squad/model.ts';
import { refAsked, refOf, saveTodos, todos, updateTodo } from '#lib/todos.svelte.ts';
import RefChip from './RefChip.svelte';
import TaskTag from './TaskTag.svelte';

let { board, todo }: { board: Board | null; todo: Todo } = $props();
let editing = $state(false);
const todoRef = $derived(refOf(todo));
const editable = $derived(!todos.offline);
const asked = $derived(refAsked(board, todoRef));
const feature = $derived.by(() => {
  if (!board || !todoRef) return undefined;
  return todoRef.type === 'feature' ? board.feature(todoRef.key) : todoRef.type === 'pr' ? board.prFeature(todoRef.key) : undefined;
});
const task = $derived(todoRef?.type === 'task' ? board?.taskOf(todoRef.key) : undefined);
const mine = $derived(
  todoRef?.type === 'pr' && !feature
    ? board?.reviews.filter((r) => r.pr === todoRef.key && r.reviewer === board.me).sort((a, b) => b.t - a.t)[0]
    : undefined,
);

function finish(area: HTMLTextAreaElement, save: boolean) {
  if (!editing) return;
  editing = false;
  const value = area.value.trim();
  if (save && value !== todo.text && (value || todoRef)) void updateTodo(todo.id, { text: value });
}

const focusEnd = (area: HTMLTextAreaElement) => {
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
};
</script>

<li
  class="-mx-1.5 grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2 rounded-md border-t px-1.5 py-[7px] text-[13.5px] first:border-t-0 group/todo"
  class:attention={asked && !todo.done}
>
  <Checkbox
    class="mt-[3px]"
    checked={todo.done}
    disabled={!editable}
    aria-label={todo.done ? m().todos.markUndone : m().todos.markDone}
    onCheckedChange={(done) => updateTodo(todo.id, done ? { done: true, done_at: now() } : { done: false, done_at: undefined })}
  />
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="flex min-w-0 flex-col gap-1" ondblclick={(event) => editable && !(event.target as HTMLElement).closest('button, a') && (editing = true)}>
    {#if todoRef}
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        <RefChip {board} {todoRef} />
        {#if asked}<span class="rtag rplus" title={m().todos.askedTitle}>{m().todos.askedOfYou}</span>{/if}
        {#if task}
          <TaskTag t={task} />
        {:else if feature}
          <span class="text-xs text-muted-foreground">
            {feature.merged_at
              ? m().mergedIn(board?.mergedIn(feature.version, feature.merged_at) ?? feature.version).toLowerCase()
              : (m().status[feature.status === 'open' && feature._draft ? 'draft' : feature.status] ?? '').toLowerCase()}
          </span>
        {:else if mine}
          <span class="text-xs text-muted-foreground">
            {m().todos.youDid(mine.src === 'r+' ? m().gaveRplus : m().reviewStates[mine.state ?? ''] || m().reviewed, shortDate(mine.t))}
          </span>
        {/if}
      </div>
    {/if}
    {#if editing}
      <textarea
        class="min-h-16 w-full resize-y rounded-lg border bg-card px-2.5 py-1.5 text-[13.5px]"
        aria-label={m().todos.edit}
        placeholder={todoRef ? m().todos.commentPlaceholder : m().todos.todoPlaceholder}
        value={todo.text}
        {@attach focusEnd}
        onkeydown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            finish(event.currentTarget, true);
          }
          if (event.key === 'Escape') finish(event.currentTarget, false);
        }}
        onblur={(event) => finish(event.currentTarget, true)}
      ></textarea>
    {:else if todo.text}
      <div class="cursor-text leading-[1.45] break-words whitespace-pre-wrap" class:done={todo.done} title={editable ? m().todos.editHint : undefined}>
        {#each todo.text.split(/(https?:\/\/[^\s]+|\b(?:odoo\/)?(?:odoo|enterprise|upgrade|design-themes|documentation)#\d+)/) as part, index (index)}
          {#if index % 2 && /^https?:/.test(part)}
            <a class="text-link" href={part} target="_blank" rel="noopener">{part.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</a>
          {:else if index % 2}
            <a class="text-link" href="https://github.com/odoo/{part.replace(/^odoo\//, '').replace('#', '/pull/')}" target="_blank" rel="noopener">{part}</a>
          {:else}{part}{/if}
        {/each}
      </div>
    {/if}
    <span class="text-[11.5px] text-muted-foreground">{todo.done && todo.done_at ? m().todos.doneAgo(rel(todo.done_at)) : m().todos.addedAgo(rel(todo.at))}</span>
  </div>
  {#if editable}
    <span class="inline-flex gap-0.5 opacity-0 group-hover/todo:opacity-100 focus-within:opacity-100">
      <button class="cursor-pointer rounded px-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" title={m().todos.edit} aria-label={m().todos.edit} onclick={() => (editing = true)}>✎</button>
      <button
        class="cursor-pointer rounded px-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-critical"
        title={m().todos.delete}
        aria-label={m().todos.delete}
        onclick={() => saveTodos(todos.items.filter((x) => x.id !== todo.id))}>×</button
      >
    </span>
  {:else}
    <span></span>
  {/if}
</li>

<style>
  .attention {
    background: color-mix(in srgb, var(--link) 8%, var(--card));
    box-shadow: inset 3px 0 0 var(--link);
  }
  .done {
    color: var(--muted-foreground);
    text-decoration: line-through;
  }
</style>
