<script lang="ts">
import ReviewerChip from '#lib/components/board/ReviewerChip.svelte';
import WhoTag from '#lib/components/board/WhoTag.svelte';
import InfoTip from '#lib/components/InfoTip.svelte';
import Seg from '#lib/components/Seg.svelte';
import * as Card from '#lib/components/ui/card/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import { type Board, periodOf } from '#lib/squad/model.ts';

/** Who reviews each member of the squad over a window, me apart. */
let { board }: { board: Board } = $props();
let period = $state('91');
const words = $derived(m().board);
</script>

<Card.Root class="gap-2 py-4">
  <Card.Header class="px-[18px]">
    <Card.Title class="flex items-center gap-1.5 text-[15px]">
      {words.reviewers}<InfoTip text={words.reviewersSub(m().periods[period] ?? period)} />
    </Card.Title>
    <Card.Description class="text-xs">{words.reviewersShort}</Card.Description>
    <Card.Action>
      <Seg options={['30', '91', '182'].map((days) => [days, m().periods[days] ?? days])} bind:value={period} label={words.reviewers} />
    </Card.Action>
  </Card.Header>
  <Card.Content class="px-[18px]">
    <div class="mb-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground">
      {#each Object.entries({ rplus: 'var(--link)', validation: 'var(--good)', changes: 'var(--p3)', comment: 'var(--muted-foreground)' }) as [kind, color] (kind)}
        <span class="inline-flex items-center gap-1"><i class="inline-block size-[7px] rounded-full" style:background={color}></i>{m().reviewerWords[kind]}</span>
      {/each}
    </div>
    <div class="grid grid-cols-[110px_minmax(0,1fr)]">
      {#each board.members as person (person)}
        {@const list = board.reviewersOf(person, periodOf(+period), [board.me])}
        <div class="flex items-center gap-1.5 border-t py-2.5 text-[13px] font-semibold first:border-t-0"><WhoTag {board} {person} /></div>
        <div class="flex flex-wrap items-center gap-1.5 border-t py-2.5 [&:nth-child(2)]:border-t-0">
          {#each list.slice(0, 12) as x (x.who)}<ReviewerChip {person} {x} {period} />{:else}<span class="text-xs text-muted-foreground">{words.noReviewers}</span>{/each}
          {#if list.length > 12}<span class="text-xs text-muted-foreground">+ {list.length - 12}</span>{/if}
        </div>
      {/each}
    </div>
  </Card.Content>
</Card.Root>
