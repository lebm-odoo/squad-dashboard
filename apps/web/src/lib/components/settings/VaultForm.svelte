<script lang="ts">
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import { keysChanged } from '#lib/setup.svelte.ts';

/** Docker's vault: its passphrase creates or unlocks it, a button locks it, a forgotten passphrase erases it. */
let {
  status,
  autofocus = false,
  class: className = '',
}: { status: { exists: boolean; locked: boolean }; autofocus?: boolean; class?: string } = $props();
let passphrase = $state('');
let busy = $state(false);
let forgot = $state(false);
const words = $derived(m().settings.connections);

async function act(action: 'create' | 'unlock' | 'lock' | 'reset') {
  busy = true;
  try {
    await parseResponse(
      action === 'lock' || action === 'reset' ? api.secrets[action].$post() : api.secrets[action].$post({ json: { passphrase } }),
    );
    passphrase = '';
    forgot = false;
    await keysChanged();
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

<div class={['flex flex-wrap items-center gap-2', className]}>
  {#if !status.exists || status.locked}
    {@const action = status.exists ? 'unlock' : 'create'}
    <Input
      type="password"
      class="h-8 w-72"
      bind:value={passphrase}
      placeholder={words.passphrase}
      autocomplete="off"
      {autofocus}
      onkeydown={(event) => event.key === 'Enter' && passphrase && act(action)}
    />
    <Button size="sm" disabled={busy || !passphrase} onclick={() => act(action)}>{words[action]}</Button>
    {#if status.exists && !forgot}
      <Button size="sm" variant="link" class="text-muted-foreground" onclick={() => (forgot = true)}>{words.forgot}</Button>
    {/if}
  {:else}
    <Button size="sm" variant="outline" disabled={busy} onclick={() => act('lock')}>{words.lock}</Button>
  {/if}
</div>
{#if forgot && status.exists && status.locked}
  <div class="mt-2.5 grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[13px]">
    <p>{words.resetSure}</p>
    <div class="flex gap-2">
      <Button size="sm" variant="destructive" disabled={busy} onclick={() => act('reset')}>{words.reset}</Button>
      <Button size="sm" variant="outline" onclick={() => (forgot = false)}>{words.cancel}</Button>
    </div>
  </div>
{/if}
