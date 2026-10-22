<script lang="ts">
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import { keysChanged } from '#lib/setup.svelte.ts';

/** A field that saves a secret, never shown again. */
let { name, label, replace = false }: { name: 'github_token' | 'odoo_api_key'; label: string; replace?: boolean } = $props();
let value = $state('');
let busy = $state(false);
const words = $derived(m().settings.connections);

async function save() {
  busy = true;
  try {
    await parseResponse(api.settings.secrets[':name'].$put({ param: { name }, json: { value } }));
    value = '';
    await keysChanged();
    toast.success(m().settings.saved);
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

<Input
  type="password"
  class="h-8 w-80"
  bind:value
  placeholder={words.newValue}
  autocomplete="off"
  spellcheck="false"
  aria-label={label}
  onkeydown={(event) => event.key === 'Enter' && value.trim() && save()}
/>
<Button size="sm" disabled={busy || !value.trim()} onclick={save}>{replace ? words.replace : m().settings.save}</Button>
