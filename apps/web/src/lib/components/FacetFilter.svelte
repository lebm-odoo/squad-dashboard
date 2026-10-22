<script lang="ts" module>
export type FacetOption = { value: string; label: string; count?: number; swatch?: string | null; hint?: string };
</script>

<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import CirclePlus from '@lucide/svelte/icons/circle-plus';
import { Badge } from '#lib/components/ui/badge/index.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import * as Command from '#lib/components/ui/command/index.ts';
import * as Popover from '#lib/components/ui/popover/index.ts';
import { Separator } from '#lib/components/ui/separator/index.ts';
import { m } from '#lib/i18n.svelte.ts';

/** A filter on the values of one dimension: several can be chosen, none means all; a search field once the list is long. */
let {
  title,
  options,
  selected,
  onchange,
  single = false,
}: { title: string; options: FacetOption[]; selected: string[]; onchange: (values: string[]) => void; single?: boolean } = $props();
const chosen = $derived(new Set(selected));
const words = $derived(m().table);

function toggle(value: string) {
  if (single) return onchange(chosen.has(value) ? [] : [value]);
  const next = new Set(chosen);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  onchange(options.map((o) => o.value).filter((v) => next.has(v)));
}
</script>

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button variant="outline" size="sm" class="h-8 border-dashed {chosen.size ? 'border-solid border-ring' : ''}" {...props}>
        <CirclePlus />{title}
        {#if chosen.size}
          <Separator orientation="vertical" class="mx-0.5 data-[orientation=vertical]:h-4" />
          {#if chosen.size > 2}
            <Badge variant="secondary" class="rounded-sm px-1 font-normal">{words.selected(chosen.size)}</Badge>
          {:else}
            {#each options.filter((o) => chosen.has(o.value)) as o (o.value)}
              <Badge variant="secondary" class="max-w-32 truncate rounded-sm px-1 font-normal">{o.label}</Badge>
            {/each}
          {/if}
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-72 p-0" align="start">
    <Command.Root>
      {#if options.length > 7}<Command.Input placeholder={title} />{/if}
      <Command.List class="max-h-80">
        <Command.Empty>{words.noMatch}</Command.Empty>
        <Command.Group>
          {#each options as o (o.value)}
            <Command.Item value={`${o.label} ${o.value}`} title={o.hint} onSelect={() => toggle(o.value)}>
              <span
                class="flex size-4 shrink-0 items-center justify-center rounded-[4px] border {chosen.has(o.value)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input [&_svg]:invisible'}"
              >
                <Check class="size-3.5 text-current" />
              </span>
              {#if o.swatch}<span class="inline-block size-2.5 shrink-0 rounded-full" style:background={o.swatch}></span>{/if}
              <span class="min-w-0 flex-1 truncate">{o.label}</span>
              {#if o.count != null}<span class="font-mono text-xs text-muted-foreground tabular-nums">{o.count}</span>{/if}
            </Command.Item>
          {/each}
        </Command.Group>
        {#if chosen.size}
          <Command.Separator />
          <Command.Group>
            <Command.Item class="justify-center text-center" onSelect={() => onchange([])}>{words.clear}</Command.Item>
          </Command.Group>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
