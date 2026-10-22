<script lang="ts">
import Eye from '@lucide/svelte/icons/eye';
import EyeOff from '@lucide/svelte/icons/eye-off';
import Languages from '@lucide/svelte/icons/languages';
import Moon from '@lucide/svelte/icons/moon';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import Sun from '@lucide/svelte/icons/sun';
import { toggleMode } from 'mode-watcher';
import LiveStatus from '#lib/components/LiveStatus.svelte';
import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import * as Popover from '#lib/components/ui/popover/index.ts';
import { Separator } from '#lib/components/ui/separator/index.ts';
import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
import { i18n, m, setLocale } from '#lib/i18n.svelte.ts';
import { collect, live } from '#lib/live.svelte.ts';
import { prefs, setHidden } from '#lib/prefs.svelte.ts';
import { setupQuery, spaces } from '#lib/setup.svelte.ts';
import { page } from '$app/state';
import { mePages, squadPages } from './nav.ts';
import SearchPalette from './SearchPalette.svelte';

const trail = $derived.by((): [string, string | null] => {
  const path = page.url.pathname;
  const me = mePages.find(([href]) => href === path);
  if (me) return [m().nav.me, m().nav.mePages[me[1]] ?? null];
  const squad = squadPages.find(([href]) => href === path);
  if (squad) return [m().nav.squad, m().nav.squadPages[squad[1]] ?? null];
  return [m().settings.title, null];
});
const running = $derived(!!live.state?.running);
const setup = setupQuery();
const chosen = $derived(spaces(setup.data, false));
</script>

<header class="@container sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur">
  <div class="flex w-full min-w-0 items-center gap-2 px-4 lg:px-6">
    <Sidebar.Trigger class="-ms-1" title={m().nav.collapse} />
    <Separator orientation="vertical" class="mx-1 data-[orientation=vertical]:h-4" />
    <Breadcrumb.Root class="min-w-0 @xl:shrink-0">
      <Breadcrumb.List class="flex-nowrap">
        <Breadcrumb.Item class={trail[1] ? 'hidden shrink-0 @xl:inline-flex' : 'min-w-0'}>
          <Breadcrumb.Page class="truncate {trail[1] ? 'text-muted-foreground' : ''}">{trail[0]}</Breadcrumb.Page>
        </Breadcrumb.Item>
        {#if trail[1]}
          <Breadcrumb.Separator class="hidden @xl:block" />
          <Breadcrumb.Item class="min-w-0"><Breadcrumb.Page class="truncate">{trail[1]}</Breadcrumb.Page></Breadcrumb.Item>
        {/if}
      </Breadcrumb.List>
    </Breadcrumb.Root>
    <div class="ms-auto flex min-w-0 items-center gap-2">
      <SearchPalette />
      <Popover.Root>
        <Popover.Trigger class="flex min-w-0 max-w-80 rounded-md px-2 py-1 hover:bg-accent"><LiveStatus /></Popover.Trigger>
        <Popover.Content align="end" class="w-80 text-sm">
          {#if live.state?.running}
            <p class="mb-2 font-medium">{m().live.running(live.state.current.join(', ') || '…')}</p>
          {:else}
            <p class="mb-2 text-muted-foreground">{m().nav.noCollect}</p>
          {/if}
          {#if live.state?.steps.length}
            <p class="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{m().nav.steps}</p>
            <ul class="max-h-64 space-y-0.5 overflow-auto text-xs">
              {#each live.state.steps as [step, seconds], index (index)}
                <li class="flex justify-between gap-3"><span class="truncate">{step}</span><span class="tabular-nums text-muted-foreground">{seconds.toFixed(1)} s</span></li>
              {/each}
            </ul>
          {/if}
          {#each Object.entries(live.state?.errors ?? {}) as [source, error] (source)}
            <p class="mt-2 text-xs text-critical"><b>{source}</b> : {error}</p>
          {/each}
        </Popover.Content>
      </Popover.Root>
      <Button size="sm" disabled={running} title={m().updateTitle} onclick={() => collect('all')}>
        <RefreshCw class={running ? 'animate-spin' : ''} /><span class="hidden @lg:inline">{m().update}</span>
      </Button>
      {#if chosen.squad}
        {@const label = prefs.hidden ? m().nav.show : m().nav.hide}
        <Button variant="ghost" size="icon" class="size-8" title={label} aria-label={label} onclick={() => setHidden(!prefs.hidden)}>
          {#if prefs.hidden}<Eye />{:else}<EyeOff />{/if}
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        title={i18n.locale === 'fr' ? 'English' : 'Français'}
        aria-label={i18n.locale === 'fr' ? 'English' : 'Français'}
        onclick={() => setLocale(i18n.locale === 'fr' ? 'en' : 'fr')}><Languages /></Button
      >
      <Button variant="ghost" size="icon" class="size-8" title={m().theme} aria-label={m().theme} onclick={toggleMode}>
        <Moon class="dark:hidden" /><Sun class="hidden dark:block" />
      </Button>
    </div>
  </div>
</header>
