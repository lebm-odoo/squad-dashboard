<script lang="ts">
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import { keysChanged } from '#lib/setup.svelte.ts';

/** Docker's vault: its passphrase creates or unlocks it, a button locks it. */
let { status }: { status: { exists: boolean; locked: boolean } } = $props();
let passphrase = $state('');
let busy = $state(false);
const words = $derived(m().settings.connections);

async function act(action: 'create' | 'unlock' | 'lock') {
  busy = true;
  try {
    await parseResponse(action === 'lock' ? api.secrets.lock.$post() : api.secrets[action].$post({ json: { passphrase } }));
    passphrase = '';
    await keysChanged();
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

<div class="flex flex-wrap items-center gap-2">
  {#if !status.exists || status.locked}
    {@const action = status.exists ? 'unlock' : 'create'}
    <Input
      type="password"
      class="h-8 w-72"
      bind:value={passphrase}
      placeholder={words.passphrase}
      autocomplete="off"
      onkeydown={(event) => event.key === 'Enter' && passphrase && act(action)}
    />
    <Button size="sm" disabled={busy || !passphrase} onclick={() => act(action)}>{words[action]}</Button>
  {:else}
    <Button size="sm" variant="outline" disabled={busy} onclick={() => act('lock')}>{words.lock}</Button>
  {/if}
</div>
