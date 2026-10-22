<script lang="ts">
import { type CollectScope, collectScopes } from '@sd/shared';
import { createQuery } from '@tanstack/svelte-query';
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import { Label } from '#lib/components/ui/label/index.ts';
import { fdt } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { collect, live, queryClient } from '#lib/live.svelte.ts';
import Section from './Section.svelte';
import type { Settings } from './types.ts';

let { settings }: { settings: Settings } = $props();
// svelte-ignore state_referenced_locally
let form = $state({ ...settings.collect });
let busy = $state(false);
const words = $derived(m().settings.collect);
const sources = createQuery(() => ({ queryKey: ['sources'], queryFn: () => parseResponse(api.sources.$get()) }));
type Last = { scope: CollectScope; started: number; finished: number; errors: Record<string, string>; steps: [string, number][] };
const last = $derived((live.state?.finished ? live.state : sources.data?.collect) as Last | null | undefined);
const fields = $derived([
  ['historyDays', words.historyDays, words.historyHint, 30, 3650],
  ['githubReserve', words.reserve, words.reserveHint, 0, 5000],
  ['githubConcurrency', words.concurrency, words.concurrencyHint, 1, 4],
] as const);

async function save() {
  busy = true;
  try {
    form = await parseResponse(api.settings.collect.$put({ json: form }));
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
    toast.success(m().settings.saved);
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

<div class="grid gap-4">
  <Section title={words.title}>
    <div class="grid max-w-2xl gap-4">
      {#each fields as [key, label, hint, min, max] (key)}
        <div class="grid gap-1.5">
          <Label for={key}>{label}</Label>
          <Input id={key} type="number" {min} {max} class="h-8 w-32" bind:value={form[key]} />
          <p class="text-xs text-muted-foreground">{hint}</p>
        </div>
      {/each}
    </div>
    <Button class="mt-4" disabled={busy} onclick={save}>{busy ? m().settings.saving : m().settings.save}</Button>
  </Section>
  <Section title={words.run} sub={words.runSub}>
    <div class="flex flex-wrap gap-2">
      {#each collectScopes.filter((scope) => scope !== 'watch') as scope (scope)}
        <Button variant={scope === 'all' ? 'default' : 'outline'} size="sm" disabled={!!live.state?.running} title={words.scopes[scope]?.[1]} onclick={() => collect(scope)}>
          {words.scopes[scope]?.[0]}
        </Button>
      {/each}
    </div>
  </Section>
  <Section title={words.last}>
    {#if live.state?.running}
      <p class="mb-2 text-[13px]">{words.running} {live.state.current.join(', ')}</p>
    {/if}
    {#if last}
      <p class="text-[13px]">{words.lastLine(words.scopes[last.scope]?.[0] ?? last.scope, fdt(last.finished), Math.round(last.finished - last.started))}</p>
      {#if Object.keys(last.errors).length}
        <h3 class="col-title mt-3">{words.errors}</h3>
        <ul class="text-[13px] text-critical">
          {#each Object.entries(last.errors) as [source, error] (source)}<li><b>{source}</b> : {error}</li>{/each}
        </ul>
      {/if}
      <table class="mt-3 w-full max-w-2xl border-collapse text-[13px]">
        <thead>
          <tr class="border-b text-left text-[11.5px] tracking-wide text-muted-foreground uppercase">
            <th class="px-2 py-1 font-semibold">{words.step}</th>
            <th class="px-2 py-1 text-right font-semibold">{words.seconds}</th>
          </tr>
        </thead>
        <tbody>
          {#each last.steps as [step, seconds], index (index)}
            <tr class="border-b"><td class="px-2 py-1">{step}</td><td class="px-2 py-1 text-right tabular-nums">{seconds.toFixed(1)}</td></tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="text-[13px] text-muted-foreground">{words.never}</p>
    {/if}
  </Section>
</div>
