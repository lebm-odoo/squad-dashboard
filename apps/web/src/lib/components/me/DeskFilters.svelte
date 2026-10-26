<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import ListFilter from '@lucide/svelte/icons/list-filter';
import { Badge } from '#lib/components/ui/badge/index.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import * as Command from '#lib/components/ui/command/index.ts';
import * as Popover from '#lib/components/ui/popover/index.ts';
import { Separator } from '#lib/components/ui/separator/index.ts';
import { tr } from '#lib/i18n.svelte.ts';
import { type DeskFilter, type DeskItem, type Lane, reasons } from '#lib/me/desk.ts';
import { words } from '#lib/me/words.ts';
import { ignore, prefs, setDesk } from '#lib/prefs.svelte.ts';
import { type Board, stageLabel } from '#lib/squad/model.ts';

/** The reasons and Odoo stages my lists ignore, each with its number of items; ticked is shown. */
let { board, items }: { board: Board; items: DeskItem[] } = $props();
const w = $derived(tr(words));
const filter = $derived(prefs.desk);
const sequence = $derived(new Map(Object.values(board.data.odoo?.stages ?? {}).map((s) => [stageLabel(s.name), s.sequence ?? 0])));
const stages = $derived(
  [...new Set([...items.map((x) => x.stage), ...filter.stages])].sort(
    (a, b) => Number(!a) - Number(!b) || (sequence.get(a) ?? 99) - (sequence.get(b) ?? 99) || a.localeCompare(b),
  ),
);
const lanes = $derived(
  (['now', 'doing', 'waiting'] as Lane[])
    .map((lane) => ({
      lane,
      whys: reasons()
        .filter(([why, of]) => of === lane && (filter.whys.includes(why) || items.some((x) => x.why === why)))
        .map(([why]) => why),
    }))
    .filter((group) => group.whys.length),
);
const ignored = $derived(filter.whys.length + filter.stages.length);
</script>

{#snippet option(key: keyof DeskFilter, value: string, label: string, count: number)}
  {@const shown = !filter[key].includes(value)}
  <Command.Item value={`${label} ${value}`} onSelect={() => ignore(key, value)}>
    <span
      class="flex size-4 shrink-0 items-center justify-center rounded-[4px] border {shown
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-input [&_svg]:invisible'}"
    >
      <Check class="size-3.5 text-current" />
    </span>
    <span class="min-w-0 flex-1 truncate {shown ? '' : 'text-muted-foreground line-through'}">{label}</span>
    <span class="font-mono text-xs text-muted-foreground tabular-nums">{count}</span>
  </Command.Item>
{/snippet}

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button variant="outline" size="sm" class="h-8 {ignored ? 'border-ring' : ''}" title={w.filter.title} {...props}>
        <ListFilter />{w.filter.button}
        {#if ignored}
          <Separator orientation="vertical" class="mx-0.5 data-[orientation=vertical]:h-4" />
          <Badge variant="secondary" class="rounded-sm px-1 font-normal tabular-nums">{ignored}</Badge>
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-88 p-0" align="end">
    <Command.Root>
      <Command.Input placeholder={w.filter.search} />
      <Command.List class="max-h-96">
        <Command.Empty>{w.noMatch}</Command.Empty>
        <Command.Group heading={w.filter.stages}>
          {#each stages as stage (stage)}
            {@render option('stages', stage, stage || w.filter.noTask, items.filter((x) => x.stage === stage).length)}
          {/each}
        </Command.Group>
        {#each lanes as { lane, whys } (lane)}
          <Command.Group heading={w.lanes[lane]?.[0]}>
            {#each whys as why (why)}
              {@render option('whys', why, w.filter.reasons[why] ?? why, items.filter((x) => x.why === why).length)}
            {/each}
          </Command.Group>
        {/each}
        {#if ignored}
          <Command.Separator />
          <Command.Group>
            <Command.Item class="justify-center text-center" onSelect={() => setDesk({ whys: [], stages: [] })}>{w.filter.showAll}</Command.Item>
          </Command.Group>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
