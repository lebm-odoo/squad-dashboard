<script lang="ts">
import Search from '@lucide/svelte/icons/search';
import * as Command from '#lib/components/ui/command/index.ts';
import { Kbd } from '#lib/components/ui/kbd/index.ts';
import { openDetail } from '#lib/detail.ts';
import { label } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { journeyHref, workHref } from '#lib/links.ts';
import { setupQuery, spaces } from '#lib/setup.svelte.ts';
import { squadQuery } from '#lib/squad/query.svelte.ts';
import { goto } from '$app/navigation';
import { mePages, squadPages } from './nav.ts';

let open = $state(false);
let search = $state('');
// Only while open: shut, the palette would read the squad's data again after each collection, on any page.
const squad = squadQuery(() => open);
const words = $derived(m().nav);
const setup = setupQuery();
const shown = $derived(spaces(setup.data));
const pages = $derived([
  ...mePages.map(([href, key]) => [href, `${words.me} › ${words.mePages[key]}`]),
  ...(shown.squad ? squadPages : []).map(([href, key]) => [href, `${words.squad} › ${words.squadPages[key]}`]),
  ['/settings', m().settings.title],
]);
// The palette filters on its own, on texts made once per reading: the command's own scoring and sorting of every item
// redrew the whole list at each key.
const people = $derived(
  (shown.squad ? (squad.data?.everyone ?? []) : []).map((person) => ({
    key: `squad:${person}`,
    href: journeyHref(person),
    text: words.journeyOf(label(person)),
  })),
);
const peopleIndex = $derived(people.map((p) => [p, `${p.key} ${p.text}`.toLowerCase()] as const));
const featureIndex = $derived(
  (squad.data?.features ?? []).map(
    (f) => [f, `${f.name} ${f.title ?? ''} ${f.prs.map((p) => `#${p.number}`).join(' ')}`.toLowerCase()] as const,
  ),
);
const terms = $derived(search.trim().toLowerCase().split(/\s+/).filter(Boolean));
const matching = <T,>(index: readonly (readonly [T, string])[], limit: number) =>
  index.flatMap(([x, text]) => (terms.every((term) => text.includes(term)) ? [x] : [])).slice(0, limit);
const foundPages = $derived(pages.filter(([, text]) => terms.every((term) => text.toLowerCase().includes(term))));
const foundPeople = $derived(matching(peopleIndex, 12));
const foundFeatures = $derived(search.trim().length >= 2 ? matching(featureIndex, 30) : []);

function go(href: string) {
  open = false;
  void goto(href);
}

function show(feature: string) {
  open = false;
  void openDetail('feature', feature);
}
</script>

<svelte:window
  onkeydown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open = !open;
    }
  }}
/>

<button
  class="inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md border bg-card px-2 text-sm text-muted-foreground hover:bg-accent @4xl:min-w-56 @4xl:px-2.5"
  title={words.search}
  aria-label={words.search}
  onclick={() => (open = true)}
>
  <Search class="size-4" /><span class="hidden @4xl:inline">{words.search}</span><Kbd class="ml-auto hidden @4xl:inline-flex">Ctrl K</Kbd>
</button>

<Command.Dialog bind:open shouldFilter={false} title={words.search} description={words.searchPlaceholder}>
  <Command.Input placeholder={words.searchPlaceholder} bind:value={search} />
  <Command.List class="max-h-[60vh]">
    <Command.Empty>{words.searchEmpty}</Command.Empty>
    {#if foundPages.length}
      <Command.Group heading={words.groups.pages}>
        {#each foundPages as [href, text] (href)}<Command.Item value={`page ${href}`} onSelect={() => go(href)}>{text}</Command.Item>{/each}
      </Command.Group>
    {/if}
    {#if foundPeople.length}
      <Command.Group heading={words.groups.people}>
        {#each foundPeople as p (p.key)}
          <Command.Item value={p.key} onSelect={() => go(p.href)}>{p.text}</Command.Item>
        {/each}
      </Command.Group>
    {/if}
    {#if foundFeatures.length}
      <Command.Group heading={words.groups.features}>
        {#each foundFeatures as f (f.name)}
          <Command.Item value={`feature ${f.name}`} onSelect={() => (shown.squad ? go(workHref({ feature: f.name })) : show(f.name))}>
            <span class="min-w-0 flex-1 truncate">{f.title || f.name}</span><span class="truncate font-mono text-xs text-muted-foreground">{f.name}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}
  </Command.List>
</Command.Dialog>
