<script lang="ts">
import { openDetail } from '#lib/detail.ts';
import { cap, fdate, personName } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { type Board, type Rev, reviewKind, reviewUrl, stageLabel } from '#lib/squad/model.ts';
import { codeText } from '#lib/squad/text.ts';
import { hasTodo } from '#lib/todos.svelte.ts';
import CodeTag from './CodeTag.svelte';
import Line from './Line.svelte';
import TaskTag from './TaskTag.svelte';
import TodoButton from './TodoButton.svelte';

let { board, r, meta = null }: { board: Board; r: Rev; meta?: string | null } = $props();
const pinned = $derived(hasTodo('pr', r.pr));
const code = $derived(board.codeOf(r.pr));
const [task, how] = $derived(board.mainTaskOfPr(r.pr));
const verb = $derived(r.src === 'r+' ? m().gaveRplus : m().reviewStates[r.state ?? ''] || m().reviewed);
</script>

{#snippet tip()}
  <div class="font-semibold">{r.subject || r.pr}</div>
  <div>{m().tip.reviewOn(cap(verb), fdate(r.t))}</div>
  <div class="text-muted-foreground">{m().tip.prBy(r.pr, personName(r.author))}</div>
  {#if code}<div>{codeText(code)}</div>{/if}
  {#if task}
    <div>{m().tip.featureTask(stageLabel(task.stage), m().taskStates[task.state] ?? task.state, null, how === 'guess')}</div>
  {/if}
  <div class="text-muted-foreground">{m().tip.openCard}</div>
{/snippet}

<Line onopen={() => openDetail('pr', r.pr)} {tip} {pinned}>
  <span class="ico {reviewKind(r)}">◆</span>
  <span class="txt">{r.subject || r.pr}</span>
  {#if task}<TaskTag t={task} short {how} />{/if}
  <CodeTag {code} />
  {#if pinned}<span class="pin" title={m().todoPinTitle}>{m().todoPin}</span>{/if}
  {#if meta != null}<span class="meta">{meta}</span>{/if}
  <TodoButton todoRef={{ type: 'pr', key: r.pr, label: r.subject || r.pr, url: reviewUrl(r) }} />
</Line>
