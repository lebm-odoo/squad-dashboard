<script lang="ts">
import WhoTag from '#lib/components/board/WhoTag.svelte';
import { dayLong, personName, timeOf } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { type Board, reviewUrl, stageLabel, type TimelineEvent, taskUrl } from '#lib/squad/model.ts';

let { board, events }: { board: Board; events: TimelineEvent[] } = $props();
const icons: Record<string, string> = { code: '▲', new: '✚', open: '⊕', merge: '✓', review: '◆', commit: '•' };
const days = $derived([...Map.groupBy(events, (e) => new Date(e.t * 1000).toDateString()).values()]);
</script>

<div class="timeline">
  {#each days as list (list[0]?.t)}
    <div class="day">{dayLong(list[0]?.t ?? 0)}</div>
    {#each list as e, index (index)}
      <div class="ev">
        <span class="text-xs text-muted-foreground tabular-nums">{timeOf(e.t)}</span>
        <span class="inline-flex flex-wrap items-center gap-1.5">{#each e.who as person (person)}<WhoTag {board} {person} />{/each}</span>
        <span class="text-foreground/70">
          {e.task ? m().work.taskIn(stageLabel(e.stage), m().taskStates[e.taskState ?? ''] ?? e.taskState ?? '') : `${icons[e.type]} ${m().work.events[e.type]}`}
        </span>
        {#if e.task}
          <span class="min-w-0">
            <a class="text-link" href={taskUrl(e.task.id)} target="_blank" rel="noopener">{e.task.name}</a>
            {#if e.task.project}<div class="text-xs text-muted-foreground">{e.task.project}</div>{/if}
          </span>
        {:else if e.f}
          <span class="min-w-0">
            {e.c ? e.c.subject : e.f.title || e.f.name}
            {#if e.c && e.f.title && e.c.subject !== e.f.title}<div class="text-xs text-muted-foreground">{e.f.title}</div>{/if}
          </span>
        {:else if e.r}
          <span class="min-w-0">
            {e.r.subject || e.r.pr}
            <div class="text-xs text-muted-foreground">
              {e.r.src === 'r+' ? m().gaveRplus : m().reviewStates[e.r.state ?? ''] || m().reviewed} · {m().work.prBy(personName(e.r.author))} ·
              <a class="text-link" href={reviewUrl(e.r)} target="_blank" rel="noopener">{e.r.pr.replace(/^odoo\//, '')}</a>
            </div>
          </span>
        {/if}
      </div>
    {/each}
  {/each}
</div>
