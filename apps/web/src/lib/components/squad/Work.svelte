<script lang="ts">
import CodeTag from '#lib/components/board/CodeTag.svelte';
import PortTag from '#lib/components/board/PortTag.svelte';
import TaskTag from '#lib/components/board/TaskTag.svelte';
import TodoButton from '#lib/components/board/TodoButton.svelte';
import WhoTag from '#lib/components/board/WhoTag.svelte';
import type { Columns } from '#lib/components/data-table/columns.ts';
import DataTable from '#lib/components/data-table/DataTable.svelte';
import { Button } from '#lib/components/ui/button/index.ts';
import * as Card from '#lib/components/ui/card/index.ts';
import { renderSnippet } from '#lib/components/ui/data-table/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import * as Select from '#lib/components/ui/select/index.ts';
import * as Tabs from '#lib/components/ui/tabs/index.ts';
import { openDetail } from '#lib/detail.ts';
import { fdt, label, personName, rel, shortDate } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import {
  type Board,
  featureTopics,
  lastActivity,
  periodHolding,
  periods,
  portsStopped,
  reviewKind,
  reviewUrl,
  statusKey,
  taskUrl,
  type WorkFilter,
  type WorkItem,
} from '#lib/squad/model.ts';
import { hasTodo } from '#lib/todos.svelte.ts';
import PeopleChips from './PeopleChips.svelte';
import PortsCell from './PortsCell.svelte';
import ReviewerTag from './ReviewerTag.svelte';
import StatusBadge from './StatusBadge.svelte';
import Timeline from './Timeline.svelte';

type Params = {
  who: string | null;
  period: string | null;
  role: string;
  status: string;
  mode: string;
  reviewer: string | null;
  feature: string | null;
};
/** Features and reviews as a list or day by day: mine in Moi, the squad's or one member's in Squad. */
let {
  board,
  params,
  set,
  mine = false,
}: { board: Board; params: Params; set: (changes: Record<string, string | null>, push?: boolean) => void; mine?: boolean } = $props();
let q = $state('');
let feedLimit = $state(150);
const words = $derived(m().work);
const focus = $derived(params.feature ? board.feature(params.feature) : undefined);
const W = $derived<WorkFilter>({
  who: params.who,
  period: params.period ?? (focus ? periodHolding(focus.merged_at || lastActivity(focus)) : '30'),
  role: params.role,
  status: params.status,
  reviewer: params.reviewer,
  q,
  feature: params.feature,
});
const work = $derived(board.workItems(W));
const events = $derived(params.mode === 'feed' ? board.timelineEvents(W.who, work.P, q, (type) => !!words.events[type]) : []);
const statusOptions = $derived(
  params.role === 'given'
    ? work.reviewStatuses.map(([key, keep]) => [
        key,
        (key === 'deployed' && !board.data.odoo?.at ? words.statuses.portsMerged : words.statuses[key]) ?? key,
        key === 'all' ? null : work.given.filter(keep).length,
      ])
    : work.statuses.map(([key, keep]) => [key, words.statuses[key] ?? key, key === 'all' ? null : work.own.filter(keep).length]),
);
// The period a focused feature chose stays when the focus goes.
const change = (changes: Record<string, string | null>) => set({ period: W.period, ...changes, feature: null });
// A status the other role also has, like Changes requested, stays chosen.
const roleChange = (role: string) => {
  const keys = (role === 'given' ? work.reviewStatuses : work.statuses).map(([key]) => key);
  change({ role, status: keys.includes(params.status) ? params.status : 'all' });
};
const open = (x: WorkItem) => (x.own ? openDetail('feature', x.f.name) : openDetail('pr', x.rv.pr));

const columns: Columns<WorkItem> = $derived([
  ...(mine
    ? []
    : [
        {
          id: 'who',
          accessorFn: (x: WorkItem) => x.who.join(' '),
          meta: { label: words.head[0] },
          cell: ({ row }: { row: { original: WorkItem } }) => renderSnippet(whoCell, row.original),
        },
      ]),
  {
    id: 'feature',
    accessorFn: (x) => (x.own ? x.f.title || x.f.name : x.rv.subject || x.rv.pr),
    meta: { label: words.head[1], class: 'w-[38%] whitespace-normal', csv: (x: WorkItem) => (x.own ? x.f.name : x.rv.pr) },
    cell: ({ row }) => renderSnippet(featureCell, row.original),
  },
  {
    id: 'status',
    accessorFn: (x) => (x.own ? statusKey(x.f) : 'reviewed'),
    meta: { label: words.head[2] },
    cell: ({ row }) => renderSnippet(statusCell, row.original),
  },
  { id: 'reviews', enableSorting: false, meta: { label: words.head[3] }, cell: ({ row }) => renderSnippet(reviewsCell, row.original) },
  { id: 'ports', enableSorting: false, meta: { label: words.head[4] }, cell: ({ row }) => renderSnippet(portsCell, row.original) },
  {
    id: 'date',
    accessorFn: (x) => x.t,
    sortDescFirst: true,
    meta: { label: words.head[5], align: 'right', csv: (x: WorkItem) => new Date(x.t * 1000).toISOString() },
    cell: ({ row }) => renderSnippet(dateCell, row.original),
  },
]);
const pinned = (x: WorkItem) =>
  x.own ? hasTodo('feature', x.f.name) || x.f.prs.some((p) => hasTodo('pr', `${p.repo}#${p.number}`)) : hasTodo('pr', x.rv.pr);
</script>

{#snippet whoCell(x: WorkItem)}
  <div class="flex flex-col gap-0.5">{#each x.who as person (person)}<WhoTag {board} {person} class="text-[13px]" />{/each}</div>
{/snippet}

{#snippet featureCell(x: WorkItem)}
  {#if x.own}
    {@const f = x.f}
    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-[13.5px] leading-5 font-medium whitespace-normal">{f.title || f.name}</span>
      <span class="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
        <span>{[m().kinds[f.kind], board.versionLabel(f.version, f.merged_at), featureTopics(f)[0]].filter(Boolean).join(' · ')}</span>
        {#each f.prs.filter((p) => p.state !== 'closed' || f.status === 'closed').slice(0, 3) as p (`${p.repo}#${p.number}`)}
          <a class="text-link" href={p.url} target="_blank" rel="noopener" onclick={(event) => event.stopPropagation()}>{p.repo.split('/')[1]}#{p.number}</a>
        {/each}
        {#each f.tasks.filter((id) => !board.taskOf(id)).slice(0, 2) as id (id)}
          <a class="text-link" href={taskUrl(id)} target="_blank" rel="noopener" onclick={(event) => event.stopPropagation()}>T{id}</a>
        {/each}
        {#if x.outside}<span>{words.outside}</span>{/if}
      </span>
    </div>
  {:else}
    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-[13.5px] leading-5 font-medium whitespace-normal">{x.rv.subject || x.rv.pr}</span>
      <span class="flex flex-wrap gap-x-2.5 text-xs text-muted-foreground">
        <span>{words.prBy(personName(x.rv.author))}</span><span>{x.rv.pr.replace(/^odoo\//, '')}</span>{#if x.rv.target}<span>{x.rv.target}</span>{/if}
      </span>
    </div>
  {/if}
{/snippet}

{#snippet statusCell(x: WorkItem)}
  {#if x.own}
    <span class="inline-flex min-w-0 flex-col items-start gap-1">
      <StatusBadge {board} f={x.f} />
      {#each x.f._tasks.slice(0, 2) as t (t.id)}<span class="[&>.rtag]:whitespace-normal"><TaskTag {t} how={x.f._taskHow.get(t)} /></span>{/each}
    </span>
  {:else}
    {@const [task, how] = board.mainTaskOfPr(x.rv.pr)}
    <span class="inline-flex min-w-0 flex-col items-start gap-1">
      <span class="badge st-review"><span class="ico">◆</span>{words.reviewedBadge}</span>
      <CodeTag code={x.code} moving={false} />
      {#if task}<span class="[&>.rtag]:whitespace-normal"><TaskTag t={task} {how} /></span>{/if}
    </span>
  {/if}
{/snippet}

{#snippet reviewsCell(x: WorkItem)}
  <span class="flex flex-wrap gap-1">
    {#if x.own}
      {#each board.featureReviewers(x.f) as y (y.who)}<ReviewerTag {y} />{:else}<span class="text-xs text-muted-foreground">{x.f.status === 'wip' ? '—' : words.noReview}</span>{/each}
    {:else}
      <span class="rtag {reviewKind(x.rv)}">{x.rv.src === 'r+' ? m().gaveRplus : m().reviewStates[x.rv.state ?? ''] || m().reviewed}</span>
    {/if}
  </span>
{/snippet}

{#snippet portsCell(x: WorkItem)}
  <span class="flex flex-wrap gap-1">
    {#if x.own}
      <PortsCell {board} f={x.f} />
    {:else if x.code?.f}
      <PortsCell {board} f={x.code.f} />
    {:else if x.code?.steps.length}
      {#each x.code.steps as step (step.branch)}<PortTag {step} />{/each}
    {:else}
      <span class="text-xs text-muted-foreground">
        {!x.code || x.code.version === 'master' || x.code.closed || portsStopped(x.code.at) ? '—' : x.code.merged ? words.notCreated : words.afterMerge}
      </span>
    {/if}
  </span>
{/snippet}

{#snippet dateCell(x: WorkItem)}
  <span class="group/line flex items-start justify-end gap-1">
    {#if x.own}
      <TodoButton todoRef={{ type: 'feature', key: x.f.name, label: x.f.title || x.f.name, who: x.who[0] }} />
    {:else}
      <TodoButton todoRef={{ type: 'pr', key: x.rv.pr, label: x.rv.subject || x.rv.pr, url: reviewUrl(x.rv) }} />
    {/if}
    <span class="flex flex-col items-end text-[12.5px] leading-5">
      <span title={fdt(x.t)}>{shortDate(x.t)}</span><span class="text-[11.5px] leading-4 text-muted-foreground">{rel(x.t)}</span>
    </span>
  </span>
{/snippet}

<div class="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
  <div class="min-w-0 flex-1">
    <h1 class="text-2xl font-semibold tracking-tight">{mine ? words.title.mine : params.who ? words.workOf(label(params.who)) : words.title.squad}</h1>
    <p class="mt-1 text-sm text-muted-foreground">{words.sub[mine ? 'mine' : 'squad']}</p>
  </div>
  <Tabs.Root value={params.mode === 'feed' ? 'feed' : 'list'} onValueChange={(mode) => change({ mode: mode === 'list' ? null : mode })}>
    <Tabs.List>{#each ['list', 'feed'] as mode (mode)}<Tabs.Trigger value={mode}>{words.views[mode]}</Tabs.Trigger>{/each}</Tabs.List>
  </Tabs.Root>
</div>
{#if !mine}<div class="mb-4 text-[13px]"><PeopleChips {board} who={params.who} pick={(who) => change({ who, reviewer: null })} /></div>{/if}

<Card.Root class="gap-3 py-4">
  <Card.Header class="flex flex-wrap items-center gap-2 px-4">
    {#if params.mode !== 'feed' && !params.reviewer}
      <Tabs.Root value={params.role} onValueChange={roleChange}>
        <Tabs.List>
          {#each [['all', null], ['own', work.own.length], ['given', work.given.length]] as const as [role, n] (role)}
            <Tabs.Trigger value={role}>{words.roles[role]}{#if n != null}<span class="ml-1 text-muted-foreground tabular-nums">{n}</span>{/if}</Tabs.Trigger>
          {/each}
        </Tabs.List>
      </Tabs.Root>
    {/if}
    {#if params.mode !== 'feed'}
      <Select.Root type="single" value={params.status} onValueChange={(status) => change({ status })}>
        <Select.Trigger size="sm" class="min-w-44">
          {m().table.status} : {statusOptions.find(([key]) => key === params.status)?.[1] ?? words.statuses.all}
        </Select.Trigger>
        <Select.Content>
          {#each statusOptions as [key, text, n] (key)}
            <Select.Item value={key as string}>{text}{#if n != null}<span class="ml-auto pl-3 text-muted-foreground tabular-nums">{n}</span>{/if}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    {/if}
    <Select.Root type="single" value={W.period} onValueChange={(period) => change({ period })}>
      <Select.Trigger size="sm" class="min-w-36">{m().table.period} : {m().periods[W.period] ?? W.period}</Select.Trigger>
      <Select.Content>{#each periods as days (days)}<Select.Item value={days}>{m().periods[days]}</Select.Item>{/each}</Select.Content>
    </Select.Root>
    {#if params.reviewer}
      <Button variant="secondary" size="sm" title={words.removeFilter} onclick={() => change({ reviewer: null })}>
        {words.reviewedBy(personName(params.reviewer))} ×
      </Button>
    {/if}
    <Input
      type="search"
      class="ml-auto h-8 w-64"
      value={q}
      placeholder={words.search}
      aria-label={words.search}
      oninput={(event) => {
        q = event.currentTarget.value;
      }}
    />
  </Card.Header>
  <Card.Content class="px-4">
    {#if params.mode !== 'feed'}
      <div class="mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground">
        <span>{words.legendReviews}</span><span class="rtag rplus">r+</span><span class="rtag validation">{words.approved}</span>
        <span class="rtag changes">{words.suggested}</span><span class="rtag comment">{words.commented}</span>
        <span class="ml-2.5">{words.legendPorts}</span>
        {#each ['merged', 'open', 'blocked'] as const as state (state)}
          <PortTag step={{ branch: { merged: words.portMerged, open: words.portOpen, blocked: words.portBlocked }[state], state }} title="" />
        {/each}
        <span class="ml-auto">
          {params.reviewer ? words.countReviewer(work.items.length, personName(params.reviewer), m().periods[W.period] ?? W.period) : words.count(work.items.length)}
        </span>
      </div>
      <DataTable
        data={work.items}
        {columns}
        sort={[{ id: 'date', desc: true }]}
        pageSize={50}
        storageKey="squad-work"
        csv="travail"
        empty={words.empty}
        rowClass={(x) => `${x.own ? '' : 'bg-[color-mix(in_srgb,var(--p6)_3.5%,transparent)]'} ${pinned(x) ? 'shadow-[inset_3px_0_0_var(--link)]' : ''}`}
        onrowclick={open}
      />
    {:else}
      {#if events.length}
        <Timeline {board} events={events.slice(0, feedLimit)} />
      {:else}
        <p class="p-7 text-center text-muted-foreground">{words.empty}</p>
      {/if}
      {#if events.length > feedLimit}
        <Button variant="outline" class="mx-auto mt-3.5 flex" onclick={() => (feedLimit += 150)}>{words.showMore(events.length - feedLimit)}</Button>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>

