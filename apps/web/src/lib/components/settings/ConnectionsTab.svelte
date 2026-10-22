<script lang="ts">
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { rel } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import SecretField from './SecretField.svelte';
import Section from './Section.svelte';
import TokenHelp from './TokenHelp.svelte';
import type { Checks, Settings } from './types.ts';
import VaultForm from './VaultForm.svelte';

let { settings, checks = $bindable() }: { settings: Settings; checks: Checks | null } = $props();
let busy = $state(false);
const words = $derived(m().settings.connections);
const vault = $derived(settings.secrets);

async function check() {
  busy = true;
  try {
    checks = await parseResponse(api.settings.check.$post());
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

{#snippet result(ok: boolean, label: string, detail: string)}
  <li class="flex items-baseline gap-2 border-t py-1.5 first:border-t-0">
    <span class="w-4 flex-none text-center font-bold" class:text-good={ok} class:text-critical={!ok}>{ok ? '✓' : '×'}</span>
    <span class="w-44 flex-none font-semibold">{label}</span>
    <span class="min-w-0 break-words text-foreground/80">{detail}</span>
  </li>
{/snippet}

<div class="grid gap-4">
  <Section title={words.vault}>
    <p class="text-[13px]">
      {vault.kind === 'keyring' ? words.keyring : !vault.exists ? words.fileNone : vault.locked ? words.fileLocked : words.fileOpen}
    </p>
    {#if vault.kind === 'file'}<div class="mt-2.5"><VaultForm status={vault} /></div>{/if}
  </Section>
  <SecretField name="github_token" title={words.githubTitle} sub={words.githubSub} present={vault.github_token}>
    {#snippet help()}<TokenHelp kind="github" docker={vault.kind === 'file'} />{/snippet}
  </SecretField>
  <SecretField name="odoo_api_key" title={words.odooTitle} sub={words.odooSub} present={vault.odoo_api_key}>
    {#snippet help()}<TokenHelp kind="odoo" />{/snippet}
  </SecretField>
  <Section title={words.check} sub={words.checkSub}>
    {#snippet action()}
      <Button size="sm" disabled={busy} onclick={check}>{busy ? words.checking : words.check}</Button>
    {/snippet}
    {#if checks}
      <ul class="text-[13px]">
        {@render result(
          checks.github.ok,
          'GitHub',
          checks.github.ok
            ? `${words.github(checks.github.login ?? '?', (checks.github.scopes ?? []).join(', '), checks.github.remaining)} · ${words.sources.github[checks.github.source]}`
            : checks.github.detail,
        )}
        {@render result(checks.odoo.ok, 'Odoo', checks.odoo.ok ? `${checks.odoo.user} · ${words.sources.odoo[checks.odoo.source]}` : checks.odoo.detail)}
        {#each checks.clones as clone (clone.repo)}
          {@render result(
            clone.ok,
            words.clone(clone.repo),
            `${clone.path} · ${Object.entries(clone.remotes)
              .map(([remote, url]) => `${remote} ${url}`)
              .join(', ')}${clone.fetched_at ? ` · ${words.fetched(rel(clone.fetched_at))}` : ''}${clone.ok ? '' : ` · ${clone.detail}`}`,
          )}
        {/each}
        {@render result(checks.runbot.ok, 'runbot', checks.runbot.detail)}
        {@render result(checks.mergebot.ok, 'mergebot', checks.mergebot.detail)}
      </ul>
    {/if}
  </Section>
</div>
