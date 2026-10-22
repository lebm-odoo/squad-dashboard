<script lang="ts">
import ExternalLink from '@lucide/svelte/icons/external-link';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import { createQuery } from '@tanstack/svelte-query';
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { fdate, rel } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { queryClient } from '#lib/live.svelte.ts';
import Section from './Section.svelte';

const words = $derived(m().settings.about);
const version = createQuery(() => ({ queryKey: ['version'], queryFn: () => parseResponse(api.version.$get()) }));
let busy = $state(false);

async function check() {
  busy = true;
  try {
    const state = await parseResponse(api.version.check.$post());
    queryClient.setQueryData(['version'], state);
    if (state.error) toast.error(state.error);
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

{#if version.data}
  {@const v = version.data}
  <div class="grid gap-4">
    <Section title={words.title} sub={words.sub}>
      {#snippet action()}
        <Button variant="outline" size="sm" disabled={busy} onclick={check}><RefreshCw class={busy ? 'animate-spin' : ''} />{words.check}</Button>
      {/snippet}
      <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-[13px]">
        <dt class="text-muted-foreground">{words.installed}</dt>
        <dd class="font-medium tabular-nums">v{v.current}</dd>
        <dt class="text-muted-foreground">{words.commit}</dt>
        <dd class="tabular-nums">
          {#if v.commit}
            <a class="font-mono text-link" href="https://github.com/{v.repo}/commit/{v.commit.replace('+', '')}" target="_blank" rel="noopener">{v.commit.replace('+', '')}</a>
            {#if v.commit.endsWith('+')}<span class="text-muted-foreground"> · {words.changed}</span>{/if}
          {:else}
            <span class="text-muted-foreground">{words.unknown}</span>
          {/if}
        </dd>
        <dt class="text-muted-foreground">{words.started}</dt>
        <dd title={fdate(v.started_at)}>{rel(v.started_at)}</dd>
        <dt class="text-muted-foreground">{words.latest}</dt>
        <dd class="tabular-nums">
          {#if v.latest}
            <a class="text-link" href={v.latest.url} target="_blank" rel="noopener">v{v.latest.version}</a>
            {#if v.latest.published_at}<span class="text-muted-foreground"> · {fdate(Date.parse(v.latest.published_at) / 1000)}</span>{/if}
          {:else}
            <span class="text-muted-foreground">{words.unknown}</span>
          {/if}
        </dd>
        <dt class="text-muted-foreground">{words.checked}</dt>
        <dd>{v.checked_at ? rel(v.checked_at) : words.never}{#if v.error}<span class="text-critical"> · {v.error}</span>{/if}</dd>
      </dl>
      {#if v.newer && v.latest}
        <div class="mt-4 rounded-lg border border-link bg-[color-mix(in_srgb,var(--link)_6%,var(--card))] p-4">
          <p class="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {words.available(v.latest.version)}
            <a class="inline-flex items-center gap-1 text-[13px] font-normal text-link" href={v.latest.url} target="_blank" rel="noopener">
              {words.notes}<ExternalLink class="size-3.5" />
            </a>
          </p>
          {#if v.latest.notes}<p class="mt-2 max-h-64 overflow-auto text-[13px] whitespace-pre-wrap text-foreground/80">{v.latest.notes}</p>{/if}
        </div>
      {:else if v.latest}
        <p class="mt-3 text-[13px] text-good">{words.upToDate}</p>
      {/if}
    </Section>
    <Section title={words.how} sub={words.howSub(v.runtime === 'docker')}>
      <pre class="rounded-md bg-muted px-3 py-2 font-mono text-[13px]">scripts/update.sh {v.runtime}</pre>
      {#if v.runtime === 'bun'}<p class="mt-2 text-[13px] text-muted-foreground">{words.howNative}</p>{/if}
    </Section>
  </div>
{:else if version.isError}
  <p class="text-critical">{messageOf(version.error)}</p>
{/if}
