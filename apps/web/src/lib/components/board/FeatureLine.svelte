<script lang="ts">
import { openDetail } from '#lib/detail.ts';
import { age, fdate, rel } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { type Board, type Feat, featureTopics, inProgress, lastActivity, stageLabel, statusKey, taskClosed } from '#lib/squad/model.ts';
import { hasTodo } from '#lib/todos.svelte.ts';
import Line from './Line.svelte';
import TaskTag from './TaskTag.svelte';
import TodoButton from './TodoButton.svelte';

let {
  board,
  f,
  who,
  meta = null,
  icon,
  withTask = true,
}: { board: Board; f: Feat; who: string; meta?: string | null; icon?: string; withTask?: boolean } = $props();
const icons: Record<string, string> = { merged: '✓', open: '●', draft: '◌', closed: '×', wip: '○', port: '→' };
const key = $derived(icon || statusKey(f));
const pinned = $derived(hasTodo('feature', f.name) || f.prs.some((p) => hasTodo('pr', `${p.repo}#${p.number}`)));
const task = $derived(board.mainTask(f));
const owner = $derived(board.everyone.includes(who) ? who : f._people.find((p) => board.everyone.includes(p)) || f.owner);
const topics = $derived(featureTopics(f));
</script>

{#snippet tip()}
  <div class="font-semibold">{f.title || f.name}</div>
  <div class="font-mono text-muted-foreground">{f.name}</div>
  <div>{[m().kinds[f.kind], board.versionLabel(f.version, f.merged_at), topics.join(', ')].filter(Boolean).join(' · ')}</div>
  {#if task}
    <div>
      {m().tip.featureTask(stageLabel(task.stage), m().taskStates[task.state] ?? task.state, task.stage_since ? age(task.stage_since) : null, board.isGuess(f, task))}
    </div>
  {/if}
  <div class="text-muted-foreground">
    {f.merged_at ? m().tip.mergedOn(fdate(f.merged_at)) : m().tip.lastActivity(m().status[statusKey(f)] ?? f.status, rel(lastActivity(f)))}
  </div>
  <div class="text-muted-foreground">{m().tip.openCard}</div>
{/snippet}

<Line {tip} {pinned} onopen={() => openDetail('feature', f.name)}>
  <span class="ico {key}">{icons[key] || '●'}</span>
  <span class="txt">{f.title || f.name}</span>
  {#if withTask && task && (inProgress(f) || !taskClosed(task))}<TaskTag t={task} short how={f._taskHow.get(task)} />{/if}
  {#if pinned}<span class="pin" title={m().todoPinTitle}>{m().todoPin}</span>{/if}
  {#if meta != null}<span class="meta">{meta}</span>{/if}
  <TodoButton todoRef={{ type: 'feature', key: f.name, label: f.title || f.name, who: owner }} />
</Line>
