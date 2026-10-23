<script lang="ts">
import BadgeAlert from '@lucide/svelte/icons/badge-alert';
import BadgeCheck from '@lucide/svelte/icons/badge-check';
import Ban from '@lucide/svelte/icons/ban';
import CircleAlert from '@lucide/svelte/icons/circle-alert';
import CircleX from '@lucide/svelte/icons/circle-x';
import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import Clock from '@lucide/svelte/icons/clock';
import Eye from '@lucide/svelte/icons/eye';
import EyeOff from '@lucide/svelte/icons/eye-off';
import FilePenLine from '@lucide/svelte/icons/file-pen-line';
import FlaskConical from '@lucide/svelte/icons/flask-conical';
import GitBranch from '@lucide/svelte/icons/git-branch';
import GitCompareArrows from '@lucide/svelte/icons/git-compare-arrows';
import GitMerge from '@lucide/svelte/icons/git-merge';
import GitPullRequestDraft from '@lucide/svelte/icons/git-pull-request-draft';
import Hourglass from '@lucide/svelte/icons/hourglass';
import MessageCircle from '@lucide/svelte/icons/message-circle';
import MessageCircleQuestionMark from '@lucide/svelte/icons/message-circle-question-mark';
import PencilLine from '@lucide/svelte/icons/pencil-line';
import Rocket from '@lucide/svelte/icons/rocket';
import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
import ThumbsUp from '@lucide/svelte/icons/thumbs-up';
import Wrench from '@lucide/svelte/icons/wrench';
import { parseResponse } from 'hono/client';
import type { Component } from 'svelte';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import TaskTag from '#lib/components/board/TaskTag.svelte';
import TodoButton from '#lib/components/board/TodoButton.svelte';
import { openDetail } from '#lib/detail.ts';
import { age, personName } from '#lib/format.ts';
import { m, tr } from '#lib/i18n.svelte.ts';
import { queryClient } from '#lib/live.svelte.ts';
import { columnWait, type DeskItem } from '#lib/me/desk.ts';
import { words } from '#lib/me/words.ts';
import { type Board, rplusUndone, stageLabel, taskUrl } from '#lib/squad/model.ts';
import { taskReviewers } from '#lib/squad/unit.ts';
import { hasTodo, type TodoRef } from '#lib/todos.svelte.ts';

/** One thing on my desk on one line: what it is, why it is there and since when; a click opens its card. */
let { board, x }: { board: Board; x: DeskItem } = $props();
const w = $derived(tr(words));
const looks: Record<string, [Component, string]> = {
  changes: [PencilLine, 'var(--p3)'],
  ci: [CircleX, 'var(--critical)'],
  mergeBlocked: [Ban, 'var(--critical)'],
  portBlocked: [CircleAlert, 'var(--critical)'],
  undone: [BadgeAlert, 'var(--critical)'],
  comments: [MessageCircle, 'var(--p3)'],
  again: [RotateCcw, 'var(--p3)'],
  deploy: [Rocket, 'var(--good)'],
  toReview: [Eye, 'var(--link)'],
  testing: [FlaskConical, 'var(--link)'],
  devAsks: [MessageCircleQuestionMark, 'var(--p3)'],
  toTesting: [FlaskConical, 'var(--p6)'],
  spec: [FilePenLine, 'var(--p6)'],
  asked: [Eye, 'var(--link)'],
  wip: [GitBranch, 'var(--muted-foreground)'],
  draft: [GitPullRequestDraft, 'var(--muted-foreground)'],
  noPr: [ClipboardList, 'var(--p6)'],
  review: [Hourglass, 'var(--link)'],
  rplus: [BadgeCheck, 'var(--good)'],
  merge: [GitMerge, 'var(--good)'],
  ports: [GitCompareArrows, 'var(--p2)'],
  task: [ClipboardCheck, 'var(--p6)'],
  validated: [ThumbsUp, 'var(--p4)'],
  approved: [Clock, 'var(--good)'],
  fixing: [Wrench, 'var(--muted-foreground)'],
};
const [Icon, tone] = $derived(looks[x.why] as [Component, string]);
const title = $derived(x.f ? x.f.title || x.f.name : x.task ? x.task.name : (x.request?.title ?? ''));
const task = $derived(x.task ?? (x.f ? board.mainTask(x.f) : undefined));
const where = $derived.by(() => {
  const p = x.f && (x.f.prs.find((y) => y.state === 'open') ?? x.f.prs[0]);
  const pr = x.request?.pr ?? (p ? `${p.repo}#${p.number}` : null);
  return [
    x.f && board.versionLabel(x.f.version, x.f.merged_at),
    pr && [pr, ...(x.siblings ?? [])].map((key) => key.replace(/^odoo\//, '')).join(' + '),
    x.task && !x.f && `#${x.task.id}`,
  ]
    .filter(Boolean)
    .join(' · ');
});
const origin = $derived(['opw', 'sentry', 'upg'].find((k) => x.request?.ids[k]?.length));
const todoRef = $derived<TodoRef>(
  x.f
    ? { type: 'feature', key: x.f.name, label: title, who: board.me }
    : x.task
      ? { type: 'task', key: String(x.task.id), label: title, url: taskUrl(x.task.id) }
      : { type: 'pr', key: x.request?.pr ?? '', label: title, url: x.request?.url },
);
const pinned = $derived(hasTodo(todoRef.type, todoRef.key));
const reason = $derived.by(() => {
  const branches = (state: string) =>
    x.f
      ? board
          .portSteps(x.f)
          .filter((y) => y.state === state)
          .map((y) => y.branch)
          .join(', ')
      : '';
  const detail: Record<string, () => string> = {
    changes: () => (x.who ? personName(x.who) : ''),
    comments: () => personName(x.who ?? '?'),
    rplus: () => personName(x.who ?? '?'),
    asked: () => personName(x.who ?? '?'),
    portBlocked: () => branches('blocked'),
    ports: () => branches('open'),
    task: () => stageLabel(task?.stage),
    validated: () => (task ? taskReviewers(task).map(personName).join(', ') : ''),
    fixing: () =>
      x.column?.live.some((c) => c.f?._events.some((e) => (e.type === 'code' || e.type === 'new') && e.t > (x.column?.since ?? 0)))
        ? 'new'
        : '',
    again: () =>
      x.column?.live.some((c) => c.f?._events.some((e) => (e.type === 'code' || e.type === 'new') && e.t > (x.column?.since ?? 0)))
        ? 'new'
        : '',
    approved: () => {
      const [key, on] = x.column ? columnWait(x.column.live) : x.code ? columnWait([x.code]) : ['notMerged', ''];
      return w.wait[key]?.(on) ?? '';
    },
    undone: () => {
      const [kind, , who] = rplusUndone(x.request) ?? [];
      return kind ? (w.undone[kind]?.(personName(who ?? '?')) ?? '') : '';
    },
  };
  return w.why[x.why]?.(detail[x.why]?.() ?? '') ?? '';
});
// A review GitHub asks of me alone, or one I gave the r+ to, not a task's: it can be set aside.
const request = $derived(x.key.startsWith('pr:') ? x.request : undefined);
const teams = $derived(request && request.teams.length + request.other_teams > 1 ? request : null);

async function discard(event: MouseEvent) {
  event.stopPropagation();
  if (!request) return;
  try {
    const { removed, error } = await parseResponse(api.requests.discard.$post({ json: { pr: request.pr } }));
    toast(w.discarded(removed, error));
  } catch (reason) {
    toast.error(messageOf(reason));
  }
  await queryClient.invalidateQueries({ queryKey: ['squad'] });
}

const open = () =>
  x.f ? openDetail('feature', x.f.name) : x.task ? openDetail('task', String(x.task.id)) : openDetail('pr', x.request?.pr ?? '');
</script>

<div
  class="group/line -mx-2 flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-link"
  class:shadow-[inset_2px_0_0_var(--link)]={pinned}
  role="button"
  tabindex="0"
  onclick={open}
  onkeydown={(event) => event.key === 'Enter' && open()}
>
  <span class="grid size-7 flex-none place-items-center rounded-full" style:color={tone} style:background="color-mix(in srgb, {tone} 14%, transparent)">
    <Icon class="size-3.5" />
  </span>
  <span class="flex min-w-0 flex-1 flex-col">
    <span class="flex min-w-0 items-center gap-2">
      <span class="truncate text-[13.5px] leading-5 font-medium">{title}</span>
      {#if pinned}<span class="pin" title={m().todoPinTitle}>{m().todoPin}</span>{/if}
    </span>
    <span class="flex min-w-0 items-baseline gap-1.5 text-xs leading-4 whitespace-nowrap text-muted-foreground">
      <span class="max-w-[75%] flex-none truncate font-medium" style:color={tone}>{reason}</span>
      {#if where}<span aria-hidden="true">·</span><span class="min-w-0 truncate">{where}</span>{/if}
      <span aria-hidden="true">·</span><span class="tabular-nums">{age(x.t)}</span>
    </span>
  </span>
  <span class="hidden flex-none items-center gap-1 sm:inline-flex">
    {#if origin}<span class="rtag k-{origin}">{origin}</span>{/if}
    {#if teams}<span class="rtag" title={w.teamsAskedTitle(teams.teams, teams.other_teams)}>{w.teamsAsked(teams.teams, teams.other_teams)}</span>{/if}
    {#if task}<TaskTag t={task} short how={x.f?._taskHow.get(task)} />{/if}
  </span>
  {#if request}
    <button
      class="flex-none cursor-pointer rounded p-1 text-muted-foreground opacity-0 group-hover/line:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
      title={request.rplus_at ? w.hideTitle : w.discardTitle(!!request.direct)}
      aria-label={w.discard}
      onclick={discard}
    >
      <EyeOff class="size-3.5" />
    </button>
  {/if}
  <TodoButton {todoRef} />
</div>
