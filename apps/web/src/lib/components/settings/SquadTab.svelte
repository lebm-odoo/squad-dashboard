<script lang="ts">
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import { collect, live, queryClient } from '#lib/live.svelte.ts';
import Section from './Section.svelte';
import type { Settings } from './types.ts';

let { settings }: { settings: Settings } = $props();
const words = $derived(m().settings.squad);
let logins = $state<Record<string, string>>({});
let arrivals = $state<Record<string, string>>({});
let busy = $state(false);
const lead = $derived(settings.config.squad?.lead);
const dirty = $derived(Object.keys(logins).length + Object.keys(arrivals).length > 0);
const unknown = $derived(settings.logins.filter((row) => row.source === 'none' && !logins[row.member]).length);

function edit(changes: Record<string, string>, member: string, value: string, saved: string) {
  if (value.trim() === saved) delete changes[member];
  else changes[member] = value.trim();
}

async function save(read: boolean) {
  busy = true;
  try {
    await parseResponse(api.settings.config.$put({ json: { github_logins: logins, arrivals } }));
    logins = {};
    arrivals = {};
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
    await queryClient.invalidateQueries({ queryKey: ['squad'] });
    if (read) await collect('github');
    toast.success(m().settings.saved);
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

<Section title={words.title(settings.logins.length)} sub={words.sub}>
  <div class="overflow-x-auto">
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr class="border-b text-left text-[11.5px] tracking-wide text-muted-foreground uppercase">
          <th class="px-2 py-1.5 font-semibold">{words.person}</th>
          <th class="px-2 py-1.5 font-semibold">{words.login}</th>
          <th class="px-2 py-1.5 font-semibold">{words.from}</th>
          <th class="px-2 py-1.5 font-semibold">{words.force}</th>
          <th class="px-2 py-1.5 font-semibold" title={words.arrivalTitle}>{words.arrival}</th>
        </tr>
      </thead>
      <tbody>
        {#each settings.logins as row (row.member)}
          {@const login = row.member in logins ? logins[row.member] : row.forced}
          {@const arrival = row.member in arrivals ? arrivals[row.member] : (settings.config.arrivals[row.member] ?? '')}
          <tr class="border-b" class:unknown={row.source === 'none'}>
            <td class="px-2 py-1.5 font-semibold whitespace-nowrap">
              {row.member.toUpperCase()}{#if row.member === lead}<span class="ml-1.5 rounded bg-muted px-1.5 text-[10.5px] text-foreground/70">lead</span>{/if}
            </td>
            <td class="px-2 py-1.5">
              {#if row.login}<a class="text-link" href="https://github.com/{row.login}" target="_blank" rel="noopener">{row.login}</a>{:else}<span class="text-muted-foreground">—</span>{/if}
              {#if row.rejected}<div class="text-xs text-muted-foreground">{words.rejected(row.rejected)}</div>{/if}
            </td>
            <td class="px-2 py-1.5 whitespace-nowrap">
              <span class="rtag {row.source === 'config' ? 'rplus' : row.source === 'none' ? 'changes' : 'validation'}" title={words.sources[row.source]?.[1]}>{words.sources[row.source]?.[0]}</span>
              {#if row.member in logins}<span class="ml-1.5 text-xs text-muted-foreground">{words.modified}</span>{/if}
            </td>
            <td class="px-2 py-1.5">
              <span class="inline-flex items-center gap-1">
                <Input
                  class="h-7 w-40 text-[13px]"
                  value={login}
                  placeholder={row.login || 'login'}
                  spellcheck="false"
                  autocomplete="off"
                  aria-label="{words.force} {row.member}"
                  onchange={(event) => edit(logins, row.member, event.currentTarget.value, row.forced)}
                />
                {#if login}<button class="cursor-pointer px-1 text-muted-foreground hover:text-foreground" title={words.unforce} onclick={() => edit(logins, row.member, '', row.forced)}>×</button>{/if}
              </span>
            </td>
            <td class="px-2 py-1.5">
              <Input
                class="h-7 w-28 text-[13px]"
                value={arrival}
                placeholder="2024-09"
                spellcheck="false"
                autocomplete="off"
                aria-label="{words.arrival} {row.member}"
                onchange={(event) => edit(arrivals, row.member, event.currentTarget.value, settings.config.arrivals[row.member] ?? '')}
              />
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="mt-4 flex flex-wrap items-center gap-2">
    <Button variant="outline" disabled={!dirty || busy} onclick={() => save(false)}>{m().settings.save}</Button>
    <Button disabled={!Object.keys(logins).length || busy || !!live.state?.running} onclick={() => save(true)}>{words.saveRead}</Button>
    {#if unknown}<span class="text-[13px] text-critical">{words.unknown(unknown)}</span>{/if}
  </div>
</Section>

<style>
  .unknown td {
    background: color-mix(in srgb, var(--serious) 8%, var(--card));
  }
</style>
