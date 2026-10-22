<script lang="ts">
import { toast } from 'svelte-sonner';
import { Button } from '#lib/components/ui/button/index.ts';
import * as Dialog from '#lib/components/ui/dialog/index.ts';
import { Textarea } from '#lib/components/ui/textarea/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import type { Board } from '#lib/squad/model.ts';
import { addTodo, hasTodo, todos } from '#lib/todos.svelte.ts';
import RefChip from './RefChip.svelte';

let { board }: { board: Board | null } = $props();
let text = $state('');

function add() {
  if (todos.dialog && addTodo(text, todos.dialog)) {
    todos.dialog = null;
    text = '';
    toast(m().todos.added);
  }
}
</script>

<Dialog.Root open={!!todos.dialog} onOpenChange={(open) => !open && (todos.dialog = null)}>
  <Dialog.Content class="sm:max-w-[540px]">
    <Dialog.Header>
      <Dialog.Title>{m().todos.dialogTitle}</Dialog.Title>
    </Dialog.Header>
    {#if todos.dialog}
      <div><RefChip {board} todoRef={todos.dialog} /></div>
      {#if hasTodo(todos.dialog.type, todos.dialog.key)}<p class="text-xs text-muted-foreground">{m().todos.dialogAlready}</p>{/if}
    {/if}
    <Textarea
      bind:value={text}
      class="min-h-24"
      placeholder={m().todos.dialogPlaceholder}
      aria-label={m().todos.dialogPlaceholder}
      onkeydown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          add();
        }
      }}
    />
    <Dialog.Footer class="items-center sm:justify-start">
      <Button onclick={add}>{m().todos.add}</Button>
      <Button variant="outline" onclick={() => (todos.dialog = null)}>{m().todos.cancel}</Button>
      <span class="text-xs text-muted-foreground">{m().todos.dialogHint}</span>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
