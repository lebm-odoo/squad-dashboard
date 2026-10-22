<script lang="ts">
import { createQuery } from '@tanstack/svelte-query';
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import { live, queryClient } from '#lib/live.svelte.ts';
import Section from './Section.svelte';

const words = $derived(m().settings.data);
const data = createQuery(() => ({ queryKey: ['settings', 'data'], queryFn: () => parseResponse(api.settings.data.$get()) }));
let result = $state<{ features: number; reviews: number; seconds: number } | null>(null);
let busy = $state(false);
const size = (bytes: number) =>
  new Intl.NumberFormat(m().intl, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 }).format(bytes / 1e6);

async function derive() {
  busy = true;
  try {
    result = await parseResponse(api.settings.derive.$post());
    await queryClient.invalidateQueries();
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

<div class="grid gap-4">
  <Section title={words.title} sub={data.data ? words.size(size(data.data.size)) : m().settings.loading}>
    {#if data.data}
      <table class="w-full max-w-xl border-collapse text-[13px]">
        <thead>
          <tr class="border-b text-left text-[11.5px] tracking-wide text-muted-foreground uppercase">
            <th class="px-2 py-1 font-semibold">{words.table}</th>
            <th class="px-2 py-1 text-right font-semibold">{words.rows}</th>
          </tr>
        </thead>
        <tbody>
          {#each Object.entries(data.data.tables).sort((a, b) => b[1] - a[1]) as [table, rows] (table)}
            <tr class="border-b"><td class="px-2 py-1 font-mono text-xs">{table}</td><td class="px-2 py-1 text-right tabular-nums">{rows.toLocaleString(m().intl)}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </Section>
  <Section title={words.derive} sub={words.deriveSub}>
    <div class="flex flex-wrap items-center gap-3">
      <Button disabled={busy || !!live.state?.running} onclick={derive}>{words.derive}</Button>
      {#if result}<span class="text-[13px] text-muted-foreground">{words.derived(result.features, result.reviews, Math.round(result.seconds))}</span>{/if}
    </div>
  </Section>
  <Section title={words.commands}>
    <dl class="grid gap-3 text-[13px]">
      {#each [[words.backup, 'pg_dump -Fc squad_dashboard > squad_dashboard.dump'], [words.importV1, 'bun run import-v1']] as [label, command] (command)}
        <div>
          <dt class="text-muted-foreground">{label}</dt>
          <dd><code class="mt-1 inline-block rounded bg-muted px-2 py-1 font-mono text-xs">{command}</code></dd>
        </div>
      {/each}
    </dl>
  </Section>
</div>
