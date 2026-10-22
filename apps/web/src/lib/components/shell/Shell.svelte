<script lang="ts">
import type { Snippet } from 'svelte';
import { messageOf } from '#lib/api.ts';
import DetailSheet from '#lib/components/detail/DetailSheet.svelte';
import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
import { watchDesk } from '#lib/live.svelte.ts';
import { prefs } from '#lib/prefs.svelte.ts';
import { setupQuery } from '#lib/setup.svelte.ts';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import AppSidebar from './AppSidebar.svelte';
import SiteHeader from './SiteHeader.svelte';

/** The pages around their sidebar, once the first page said what to follow; until then, that page. */
let { children }: { children: Snippet } = $props();
const setup = setupQuery();
$effect(() => {
  if (setup.data && !setup.data.follow) void goto('/setup', { replaceState: true });
});
$effect(() => (setup.data?.follow ? watchDesk() : undefined));
// Squad hidden: its pages go back to Moi, even from a bookmark.
$effect(() => {
  if (prefs.hidden && /^\/squad(\/|$)/.test(page.url.pathname)) void goto('/', { replaceState: true });
});
</script>

{#if setup.data?.follow}
  <Sidebar.Provider>
    <AppSidebar />
    <Sidebar.Inset class="min-w-0">
      <SiteHeader />
      <main class="mx-auto w-full max-w-[1480px] min-w-0 px-4 py-5 lg:px-6">
        {@render children()}
      </main>
    </Sidebar.Inset>
  </Sidebar.Provider>
  <DetailSheet />
{:else if setup.isError}
  <p class="p-6 text-critical">{messageOf(setup.error)}</p>
{/if}
