<script lang="ts">
import { Button } from '#lib/components/ui/button/index.ts';
import * as Card from '#lib/components/ui/card/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import type { Board } from '#lib/squad/model.ts';
import { addTodo, refAsked, refOf, saveTodos, todos } from '#lib/todos.svelte.ts';
import TodoItem from './TodoItem.svelte';

let { board }: { board: Board | null } = $props();
let text = $state('');
const open = $derived(todos.items.filter((todo) => !todo.done));
const done = $derived(todos.items.filter((todo) => todo.done).sort((a, b) => (b.done_at || 0) - (a.done_at || 0)));
const asked = $derived(open.filter((todo) => refAsked(board, refOf(todo))).length);
const add = () => {
  if (addTodo(text)) text = '';
};
</script>

<Card.Root class="gap-2 py-4">
  <Card.Header class="px-[18px]">
    <Card.Title class="text-[15px]">{m().todos.title(open.length)}</Card.Title>
    <Card.Description class="text-xs">
      {#if todos.offline}
        {m().todos.offline}
      {:else if asked}
        <b class="text-foreground">{m().todos.asked(asked)}</b>
      {:else}
        {m().me.todosSub}
      {/if}
    </Card.Description>
  </Card.Header>
  <Card.Content class="px-[18px]">
    <div class="mb-2.5 flex items-start gap-2">
      <textarea
        bind:value={text}
        rows="1"
        class="min-h-[34px] min-w-0 flex-1 resize-y rounded-lg border bg-card px-2.5 py-1.5 text-[13.5px]"
        placeholder={todos.offline ? m().todos.offline : m().todos.placeholder}
        disabled={todos.offline}
        aria-label={m().todos.placeholder}
        onkeydown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            add();
          }
        }}
      ></textarea>
      <Button variant="outline" disabled={todos.offline} onclick={add}>{m().todos.add}</Button>
    </div>
    {#if open.length}
      <ul>{#each open as todo (todo.id)}<TodoItem {board} {todo} />{/each}</ul>
    {:else}
      <p class="my-1 text-[13px] text-muted-foreground">{m().todos.nothing}</p>
    {/if}
    {#if done.length}
      <details class="mt-2.5 text-[13px]">
        <summary class="cursor-pointer text-muted-foreground">{m().todos.done(done.length)}</summary>
        <ul>{#each done as todo (todo.id)}<TodoItem {board} {todo} />{/each}</ul>
        {#if !todos.offline}<button class="linkish mt-1.5" onclick={() => saveTodos(open)}>{m().todos.clearDone}</button>{/if}
      </details>
    {/if}
  </Card.Content>
</Card.Root>
