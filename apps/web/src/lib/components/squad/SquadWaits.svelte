<script lang="ts">
import FeatureLine from '#lib/components/board/FeatureLine.svelte';
import PortTag from '#lib/components/board/PortTag.svelte';
import WhoTag from '#lib/components/board/WhoTag.svelte';
import InfoTip from '#lib/components/InfoTip.svelte';
import * as Card from '#lib/components/ui/card/index.ts';
import * as Tabs from '#lib/components/ui/tabs/index.ts';
import { age } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import type { Board } from '#lib/squad/model.ts';

/** What the squad waits for: its PRs ready for a review, its forward-ports that need a hand. */
let { board }: { board: Board } = $props();
const words = $derived(m().board);
const queue = $derived(board.reviewQueue());
const blocked = $derived(board.blockedPorts());
</script>

<Card.Root class="gap-2 py-4">
  <Card.Header class="px-[18px]">
    <Card.Title class="text-[15px]">{words.waits}</Card.Title>
    <Card.Description class="text-xs">{words.waitsSub}</Card.Description>
  </Card.Header>
  <Card.Content class="px-[18px]">
    <Tabs.Root value="queue">
      <Tabs.List class="mb-2">
        <Tabs.Trigger value="queue">{words.queueTab} <span class="text-muted-foreground tabular-nums">{queue.length}</span></Tabs.Trigger>
        <Tabs.Trigger value="blocked">{words.blockedTab} <span class="text-muted-foreground tabular-nums">{blocked.length}</span></Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="queue">
        <p class="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><InfoTip text={words.queueSub} />{words.queue(queue.length)}</p>
        {#if queue.length}
          <div class="flex min-w-0 flex-col gap-px">
            {#each queue as x (x.f.name)}
              <div class="flex min-w-0 items-baseline gap-2">
                <WhoTag {board} person={x.p} class="w-[74px] flex-none text-[12.5px]" />
                <div class="min-w-0 flex-1">
                  <FeatureLine
                    {board}
                    f={x.f}
                    who={x.p}
                    meta={`${board.versionLabel(x.f.version)} · ${x.fresh ? words.waitingFor(age(x.since)) : words.updatedAgo(age(x.since))}`}
                    icon={x.fresh ? 'open' : 'changes'}
                  />
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="p-7 text-center text-muted-foreground">{words.queueEmpty}</p>
        {/if}
      </Tabs.Content>
      <Tabs.Content value="blocked">
        <p class="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><InfoTip text={words.blockedSub} />{words.blocked(blocked.length)}</p>
        {#if blocked.length}
          <div class="flex min-w-0 flex-col gap-px">
            {#each blocked as f (f.name)}
              <div class="flex min-w-0 items-baseline gap-2">
                <WhoTag {board} person={f._people.find((p) => board.everyone.includes(p)) || f.owner} class="w-[74px] flex-none text-[12.5px]" />
                <div class="min-w-0 flex-1"><FeatureLine {board} {f} who={f.owner} icon="port" /></div>
                <span class="inline-flex flex-wrap justify-end gap-1">
                  {#each board.portSteps(f).filter((y) => y.state === 'blocked') as step (step.branch)}<PortTag {step} />{/each}
                </span>
              </div>
            {/each}
          </div>
        {:else}
          <p class="p-7 text-center text-muted-foreground">{words.blockedEmpty}</p>
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  </Card.Content>
</Card.Root>
