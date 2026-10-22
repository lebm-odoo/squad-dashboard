<script lang="ts">
import { createQuery } from '@tanstack/svelte-query';
import { parseResponse } from 'hono/client';
import { api, messageOf } from '#lib/api.ts';
import AboutTab from '#lib/components/settings/AboutTab.svelte';
import CollectTab from '#lib/components/settings/CollectTab.svelte';
import ConnectionsTab from '#lib/components/settings/ConnectionsTab.svelte';
import DataTab from '#lib/components/settings/DataTab.svelte';
import DisplayTab from '#lib/components/settings/DisplayTab.svelte';
import MeTab from '#lib/components/settings/MeTab.svelte';
import SquadTab from '#lib/components/settings/SquadTab.svelte';
import type { Checks } from '#lib/components/settings/types.ts';
import Loading from '#lib/components/shell/Loading.svelte';
import * as Tabs from '#lib/components/ui/tabs/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import { replaceState } from '$app/navigation';
import { page } from '$app/state';

const settings = createQuery(() => ({ queryKey: ['settings'], queryFn: () => parseResponse(api.settings.$get()) }));
let checks = $state<Checks | null>(null);
const tabs = ['me', 'squad', 'connections', 'collect', 'display', 'data', 'about'];
const tab = $derived(tabs.includes(page.url.hash.slice(1)) ? page.url.hash.slice(1) : 'me');
</script>

<div class="mb-5">
  <h1 class="text-2xl font-semibold tracking-tight">{m().settings.title}</h1>
  <p class="mt-1 text-sm text-muted-foreground">{m().settings.sub}</p>
</div>
{#if settings.isPending}
  <Loading label={m().settings.loading} shape="settings" />
{:else if settings.isError}
  <p class="text-critical">{messageOf(settings.error)}</p>
{:else if settings.data}
  <Tabs.Root value={tab} onValueChange={(value) => replaceState(`#${value}`, {})}>
    <Tabs.List class="mb-4 h-auto flex-wrap">
      {#each tabs as name (name)}<Tabs.Trigger value={name}>{m().settings.tabs[name]}</Tabs.Trigger>{/each}
    </Tabs.List>
    <Tabs.Content value="me"><MeTab settings={settings.data} {checks} /></Tabs.Content>
    <Tabs.Content value="squad"><SquadTab settings={settings.data} /></Tabs.Content>
    <Tabs.Content value="connections"><ConnectionsTab settings={settings.data} bind:checks /></Tabs.Content>
    <Tabs.Content value="collect"><CollectTab settings={settings.data} /></Tabs.Content>
    <Tabs.Content value="display"><DisplayTab /></Tabs.Content>
    <Tabs.Content value="data"><DataTab /></Tabs.Content>
    <Tabs.Content value="about"><AboutTab /></Tabs.Content>
  </Tabs.Root>
{/if}
