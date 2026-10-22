<script lang="ts">
import CurrentLine from '#lib/components/board/CurrentLine.svelte';
import FeatureLine from '#lib/components/board/FeatureLine.svelte';
import Lines from '#lib/components/board/Lines.svelte';
import ReviewLine from '#lib/components/board/ReviewLine.svelte';
import Swatch from '#lib/components/board/Swatch.svelte';
import Seg from '#lib/components/Seg.svelte';
import StatCard from '#lib/components/StatCard.svelte';
import Reviewers from '#lib/components/squad/Reviewers.svelte';
import SquadWaits from '#lib/components/squad/SquadWaits.svelte';
import { label, personName, shortDate } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { journeyHref, workHref } from '#lib/links.ts';
import { prefs } from '#lib/prefs.svelte.ts';
import { type Board, type CurrentItem, DAY, inP, lastActivity, now, periodOf } from '#lib/squad/model.ts';
import { goto } from '$app/navigation';

let { board }: { board: Board } = $props();
let period = $state(prefs.period);
let expanded = $state<string[]>([]);
const when = $derived(m().periods[period] ?? period);
const P = $derived(periodOf(+period));
const toWork =
  (who: string, changes: { role?: string; status?: string } = {}) =>
  () =>
    goto(workHref({ who, period, ...changes }));
const kpi = $derived.by(() => {
  const mine = board.members.flatMap(board.featuresOf);
  const open = mine.filter((f) => f.status === 'open');
  return {
    open: open.length,
    stale: open.filter((f) => lastActivity(f) < now() - 14 * DAY).length,
    merged: mine.filter((f) => f.merged_at && inP(f.merged_at, P)).length,
    reviewed: board.members.reduce((n, person) => n + board.reviewsGiven(person, P).length, 0),
    ports: mine.filter(board.portsInFlight).length,
    blocked: board.blockedPorts().filter((f) => f._people.some((p) => board.members.includes(p))).length,
  };
});
const legend = $derived([
  ['open', '●'],
  ['draft', '◌'],
  ['wip', '○'],
  ['port', '→'],
  ['merged', '✓'],
  ['rplus', '◆'],
  ...(board.data.odoo?.at
    ? [
        ['task', '▢'],
        ['guess', '⚠'],
      ]
    : []),
]);
</script>

{#snippet current(person: string)}
  {#snippet line(x: CurrentItem)}<CurrentLine {board} {x} {person} />{/snippet}
  <Lines
    items={board.currentWork(person)}
    limit={expanded.includes(person) ? Number.POSITIVE_INFINITY : 4}
    item={line}
    more={() => (expanded = [...expanded, person])}
  />
{/snippet}

<div class="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
  <StatCard label={m().board.kpi.open} value={kpi.open} hint={m().board.kpi.openHint(kpi.stale)} />
  <StatCard label={m().board.kpi.merged} value={kpi.merged} hint={m().board.kpi.mergedHint(when)} />
  <StatCard label={m().board.kpi.reviewed} value={kpi.reviewed} hint={m().board.kpi.mergedHint(when)} />
  <StatCard label={m().board.kpi.ports} value={kpi.ports} hint={m().board.kpi.portsHint(kpi.blocked)} />
</div>

<div class="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-foreground/70">
  <span>{m().board.over}</span>
  <Seg options={['14', '30', '91'].map((days) => [days, m().periods[days] ?? days])} bind:value={period} label={m().board.over} />
  <span class="ml-auto inline-flex flex-wrap gap-3 text-xs text-muted-foreground" title={m().board.legendTitle}>
    {#each legend as [kind, icon] (kind)}<span><span class="ico {kind} mr-0.5">{icon}</span>{m().board.legend[kind]}</span>{/each}
  </span>
</div>

<div class="board overflow-hidden rounded-xl border bg-card">
  <div class="bhead">
    <div>{m().board.who}</div>
    <div>{m().board.onIt}</div>
    <div>{m().board.merged(when)}</div>
    <div>{m().board.reviewed(when)}</div>
  </div>
  {#each board.members as person (person)}
    {@const merged = board
      .featuresOf(person)
      .filter((f) => f.merged_at && inP(f.merged_at, P))
      .sort((a, b) => (b.merged_at as number) - (a.merged_at as number))}
    <div class="brow">
      <div class="flex flex-col gap-1">
        <span class="inline-flex items-center gap-2 text-sm font-semibold"><Swatch {board} {person} />{label(person)}</span>
        <span class="flex gap-2.5 pl-[18px]">
          <button class="linkish" onclick={toWork(person)}>{m().board.work}</button>
          <a class="linkish" href={journeyHref(person)}>{m().board.journey}</a>
        </span>
      </div>
      <div data-label={m().board.onIt}>{@render current(person)}</div>
      <div data-label={m().board.merged(when)}>
        <Lines items={merged} limit={4} more={toWork(person, { status: 'merged', role: 'own' })}>
          {#snippet item(f)}<FeatureLine {board} {f} who={person} meta={shortDate(f.merged_at as number)} />{/snippet}
        </Lines>
      </div>
      <div data-label={m().board.reviewed(when)}>
        <Lines items={board.reviewsGiven(person, P)} limit={4} more={toWork(person, { role: 'given' })}>
          {#snippet item(r)}<ReviewLine {board} {r} meta={personName(r.author)} />{/snippet}
        </Lines>
      </div>
    </div>
  {:else}
    <p class="p-7 text-center text-muted-foreground">{m().board.noSquad}</p>
  {/each}
</div>

{#if board.members.length}
  <div class="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
    <SquadWaits {board} />
    <Reviewers {board} />
  </div>
{/if}

<style>
  .board {
    display: grid;
    grid-template-columns: 150px minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr);
  }
  .board > div {
    display: contents;
  }
  .board > div > :global(*) {
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    min-width: 0;
  }
  .board > .bhead > :global(*) {
    border-top: 0;
    padding-top: 10px;
    padding-bottom: 8px;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted-foreground);
    font-weight: 600;
    background: var(--muted);
  }
  .board > div > :global(* + *) {
    border-left: 1px solid var(--border);
  }
  @media (max-width: 900px) {
    .board {
      grid-template-columns: 1fr;
    }
    .board > .bhead {
      display: none;
    }
    .board > div > :global(* + *) {
      border-left: 0;
      border-top: 0;
      padding-top: 0;
    }
    .board > div > :global([data-label])::before {
      content: attr(data-label);
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted-foreground);
      font-weight: 600;
      margin: 4px 0 2px;
    }
  }
</style>
