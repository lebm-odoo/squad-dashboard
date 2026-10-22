<script lang="ts">
import './layout.css';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { ModeWatcher } from 'mode-watcher';
import { onMount } from 'svelte';
import favicon from '#lib/assets/favicon.svg';
import Shell from '#lib/components/shell/Shell.svelte';
import Tip from '#lib/components/Tip.svelte';
import { Toaster } from '#lib/components/ui/sonner/index.ts';
import { i18n, m } from '#lib/i18n.svelte.ts';
import { openOutside } from '#lib/links.ts';
import { followCollection, queryClient } from '#lib/live.svelte.ts';
import { loadTodos } from '#lib/todos.svelte.ts';
import { page } from '$app/state';
import type { LayoutProps } from './$types';

let { children }: LayoutProps = $props();

onMount(() => {
  document.documentElement.lang = i18n.locale;
  void loadTodos();
  const stops = [openOutside(), followCollection()];
  return () => {
    for (const stop of stops) stop();
  };
});
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>{m().brand}</title>
</svelte:head>

<ModeWatcher disableHeadScriptInjection />
<Toaster position="bottom-right" />
<Tip />

<QueryClientProvider client={queryClient}>
  {#if page.url.pathname === '/setup'}
    {@render children()}
  {:else}
    <Shell>{@render children()}</Shell>
  {/if}
</QueryClientProvider>
