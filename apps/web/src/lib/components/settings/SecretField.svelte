<script lang="ts">
import { parseResponse } from 'hono/client';
import type { Snippet } from 'svelte';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import { keysChanged } from '#lib/setup.svelte.ts';
import SecretInput from './SecretInput.svelte';
import Section from './Section.svelte';

let {
  name,
  title,
  sub,
  present,
  help,
}: { name: 'github_token' | 'odoo_api_key'; title: string; sub: string; present: boolean | null; help?: Snippet } = $props();
let busy = $state(false);
const words = $derived(m().settings.connections);

async function remove() {
  busy = true;
  try {
    await parseResponse(api.settings.secrets[':name'].$delete({ param: { name } }));
    await keysChanged();
    toast.success(m().settings.saved);
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

<Section {title} {sub}>
  <p class="mb-2.5 text-[13px]">{present === null ? words.lockedValue : present ? words.present : words.absent}</p>
  <div class="flex flex-wrap items-center gap-2">
    <SecretInput {name} label={title} replace={!!present} />
    {#if present}
      <Button size="sm" variant="outline" disabled={busy} onclick={remove}>{m().settings.remove}</Button>
    {/if}
  </div>
  {#if help}<div class="mt-3 border-t pt-3">{@render help()}</div>{/if}
</Section>
