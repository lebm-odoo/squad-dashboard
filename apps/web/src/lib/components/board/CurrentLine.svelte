<script lang="ts">
import { age, shortDate } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import type { Board, CurrentItem } from '#lib/squad/model.ts';
import FeatureLine from './FeatureLine.svelte';
import TaskLine from './TaskLine.svelte';

let { board, x, person }: { board: Board; x: CurrentItem; person: string } = $props();
</script>

{#if x.task}
  <TaskLine t={x.task} meta={m().me.noPrLinked(age(x.t))} note={m().tip.noPrLinked(x.task.id)} />
{:else if x.f && x.port}
  <FeatureLine
    {board}
    f={x.f}
    who={person}
    icon="port"
    meta={m().me.portsOf(
      board
        .portSteps(x.f)
        .filter((y) => y.state === 'open' || y.state === 'blocked')
        .map((y) => y.branch)
        .join(', '),
    )}
  />
{:else if x.f}
  <FeatureLine {board} f={x.f} who={x.who || person} meta={x.f.merged_at ? m().me.mergedShort(shortDate(x.f.merged_at)) : `${board.versionLabel(x.f.version)} · ${age(x.t)}`} />
{/if}
