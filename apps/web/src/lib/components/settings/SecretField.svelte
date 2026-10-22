<script lang="ts">
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import { queryClient } from '#lib/live.svelte.ts';
import Section from './Section.svelte';

let { name, title, sub, present }: { name: 'github_token' | 'odoo_api_key'; title: string; sub: string; present: boolean | null } =
  $props();
let value = $state('');
let busy = $state(false);
const words = $derived(m().settings.connections);

async function run(request: Promise<Response>) {
  busy = true;
  try {
    await parseResponse(request as never);
    value = '';
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
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
    <Input
      type="password"
      class="h-8 w-80"
      bind:value
      placeholder={words.newValue}
      autocomplete="off"
      spellcheck="false"
      aria-label={title}
      onkeydown={(event) => event.key === 'Enter' && value.trim() && run(api.settings.secrets[':name'].$put({ param: { name }, json: { value } }))}
    />
    <Button size="sm" disabled={busy || !value.trim()} onclick={() => run(api.settings.secrets[':name'].$put({ param: { name }, json: { value } }))}>
      {present ? words.replace : m().settings.save}
    </Button>
    {#if present}
      <Button size="sm" variant="outline" disabled={busy} onclick={() => run(api.settings.secrets[':name'].$delete({ param: { name } }))}>{m().settings.remove}</Button>
    {/if}
  </div>
</Section>
