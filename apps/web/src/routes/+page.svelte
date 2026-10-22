<script lang="ts">
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import GitMerge from '@lucide/svelte/icons/git-merge';
import Hammer from '@lucide/svelte/icons/hammer';
import Hourglass from '@lucide/svelte/icons/hourglass';
import Inbox from '@lucide/svelte/icons/inbox';
import MessageSquareCode from '@lucide/svelte/icons/message-square-code';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import Search from '@lucide/svelte/icons/search';
import Users from '@lucide/svelte/icons/users';
import { flip } from 'svelte/animate';
import { prefersReducedMotion } from 'svelte/motion';
import { SvelteSet } from 'svelte/reactivity';
import { fade, slide } from 'svelte/transition';
import FeatureLine from '#lib/components/board/FeatureLine.svelte';
import Lines from '#lib/components/board/Lines.svelte';
import ReviewLine from '#lib/components/board/ReviewLine.svelte';
import TodoDialog from '#lib/components/board/TodoDialog.svelte';
import Todos from '#lib/components/board/Todos.svelte';
import InfoTip from '#lib/components/InfoTip.svelte';
import DeskRow from '#lib/components/me/DeskRow.svelte';
import Seg from '#lib/components/Seg.svelte';
import StatCard from '#lib/components/StatCard.svelte';
import Loading from '#lib/components/shell/Loading.svelte';
import { Button } from '#lib/components/ui/button/index.ts';
import * as Card from '#lib/components/ui/card/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import * as Tabs from '#lib/components/ui/tabs/index.ts';
import { dayLong, label, personName, rel, shortDate } from '#lib/format.ts';
import { m, tr } from '#lib/i18n.svelte.ts';
import { myWorkHref } from '#lib/links.ts';
import { collect, live } from '#lib/live.svelte.ts';
import { type DeskItem, desk, type Lane } from '#lib/me/desk.ts';
import { words } from '#lib/me/words.ts';
import { prefs } from '#lib/prefs.svelte.ts';
import { now, periodOf } from '#lib/squad/model.ts';
import { squadQuery } from '#lib/squad/query.svelte.ts';
import { goto } from '$app/navigation';

const query = squadQuery();
const board = $derived(query.data ?? null);
const w = $derived(tr(words));
let period = $state(prefs.period);
let side = $state('all');
let q = $state('');
let search = $state<HTMLInputElement | null>(null);
// The lanes shown whole, and the requests of my teams once opened.
const unfolded = new SvelteSet<string>();
const D = $derived(board ? desk(board, periodOf(+period)) : null);
const terms = $derived(q.trim().toLowerCase());
const keep = (x: DeskItem) => (side === 'all' || x.side === side) && (!terms || x.search.includes(terms));
const report = $derived(board?.data.review_requests);
const when = $derived(m().periods[period] ?? period);
const reloading = $derived(!!live.state?.running && (live.state.scope === 'me' || live.state.scope === 'watch'));
const ms = (duration: number) => (prefersReducedMotion.current ? 0 : duration);
const toWork = (changes: { role?: string; status?: string }) => () => goto(myWorkHref({ period, ...changes }));
const toggle = (key: string) => (unfolded.has(key) ? unfolded.delete(key) : unfolded.add(key));

function focusSearch(event: KeyboardEvent) {
  const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]');
  if (event.key !== '/' || typing || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  search?.focus();
}
</script>

<svelte:window onkeydown={focusSearch} />

{#snippet rows(items: DeskItem[], key: string, limit: number)}
  {#each unfolded.has(key) ? items : items.slice(0, limit) as x (x.key)}
    <div animate:flip={{ duration: ms(220) }} in:fade={{ duration: ms(160) }}>
      {#if board}<DeskRow {board} {x} />{/if}
    </div>
  {/each}
  {#if items.length > limit}
    <button class="linkish mt-1" onclick={() => toggle(key)}>{unfolded.has(key) ? w.showFewer : w.showAll(items.length)}</button>
  {/if}
{/snippet}

{#snippet lane(name: Lane, all: DeskItem[], color: string)}
  {@const items = all.filter(keep)}
  {@const [title, hint] = w.lanes[name] ?? ['', '']}
  <section id={name} class="scroll-mt-20">
    <h3 class="mb-1 flex items-center gap-2 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
      <span class="size-2 rounded-full" style:background={color}></span>{title}
      <span class="text-foreground/70 tabular-nums">{items.length}</span>
      <InfoTip text={hint} />
    </h3>
    {#if items.length}
      <div class="flex min-w-0 flex-col">{@render rows(items, name, 8)}</div>
    {:else}
      <p class="py-2 text-[13px] text-muted-foreground">{all.length ? w.noMatch : w.empty[name]}</p>
    {/if}
  </section>
{/snippet}

{#if query.isPending}
  <Loading label={m().me.loading} shape="desk" />
{:else if query.isError}
  <p class="text-critical">{query.error.message}</p>
{:else if board && D}
  {@const reviews = D.now.filter((x) => x.side === 'review').length}
  {@const teams = side === 'write' ? [] : D.teams.filter(keep)}
  <div class="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3">
    <div class="min-w-0 flex-1">
      <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{dayLong(now())}</p>
      <h1 class="mt-0.5 text-2xl font-semibold tracking-tight">{w.hello(label(board.me))}</h1>
      <p class="mt-1 text-sm text-muted-foreground">{w.summary(D.now.length, D.doing.length, D.waiting.length)}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={!!live.state?.running} title={w.reloadTitle} onclick={() => collect('me')}>
        <RefreshCw class={reloading ? 'animate-spin' : ''} />{reloading ? w.reloading : w.reload}
      </Button>
    </div>
  </div>

  <div class="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
    <StatCard icon={Inbox} label={w.kpi.now} value={D.now.length} hint={w.kpi.nowHint(reviews, D.now.length - reviews)} href="#now" />
    <StatCard icon={Hammer} label={w.kpi.doing} value={D.doing.length} hint={w.kpi.doingHint} href="#doing" />
    <StatCard icon={Hourglass} label={w.kpi.waiting} value={D.waiting.length} hint={w.kpi.waitingHint} href="#waiting" />
    <StatCard icon={GitMerge} label={w.kpi.merged} value={D.merged.length} hint={w.kpi.over(when)} href="#done" />
    <StatCard icon={MessageSquareCode} label={w.kpi.reviewed} value={D.reviewed.length} hint={w.kpi.over(when)} href="#done" />
  </div>

  <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
    <Card.Root class="gap-3 py-4">
      <Card.Header class="flex flex-wrap items-center gap-x-3 gap-y-2 px-[18px]">
        <Card.Title class="text-[15px]">{w.work}</Card.Title>
        <Tabs.Root value={side} onValueChange={(value) => (side = value)}>
          <Tabs.List>
            {#each ['all', 'write', 'review'] as key (key)}
              {@const n = [...D.now, ...D.doing, ...D.waiting].filter((x) => key === 'all' || x.side === key).length}
              <Tabs.Trigger value={key}>{w.sides[key]} <span class="text-muted-foreground tabular-nums">{n}</span></Tabs.Trigger>
            {/each}
          </Tabs.List>
        </Tabs.Root>
        <label class="relative ml-auto w-full sm:w-56">
          <Search class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input bind:ref={search} type="search" class="h-8 pr-7 pl-8" bind:value={q} placeholder={w.search} aria-label={w.search} />
          <kbd class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1 text-[10.5px] text-muted-foreground">/</kbd>
        </label>
      </Card.Header>
      <Card.Content class="flex flex-col gap-5 px-[18px]">
        {#if board.data.odoo?.error}
          <p class="rounded-md bg-critical/10 px-3 py-2 text-[12.5px] text-critical">{w.odooError(rel(board.data.odoo.at), board.data.odoo.error)}</p>
        {/if}
        {@render lane('now', D.now, 'var(--critical)')}
        {@render lane('doing', D.doing, 'var(--link)')}
        {@render lane('waiting', D.waiting, 'var(--muted-foreground)')}
        {#if side !== 'write'}
          <section class="border-t pt-3">
            {#if !report}
              <p class="text-xs text-muted-foreground">{w.notRead}</p>
            {:else}
              <button
                class="flex w-full cursor-pointer items-center gap-2 text-left text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
                aria-expanded={unfolded.has('teams')}
                onclick={() => toggle('teams')}
              >
                <ChevronRight class="size-3.5 transition-transform {unfolded.has('teams') ? 'rotate-90' : ''}" />
                <Users class="size-3.5" />{w.teams((report.teams ?? []).join(', '), teams.length)}
                <span class="ml-auto hidden font-normal tracking-normal normal-case sm:inline">{w.teamsHint}</span>
              </button>
              {#if unfolded.has('teams')}
                <div class="mt-1.5 flex min-w-0 flex-col" transition:slide={{ duration: ms(220) }}>
                  {@render rows(teams, 'teams-all', 15)}
                  {#if D.aside}<p class="mt-2 text-xs text-muted-foreground">{w.aside(D.aside)}</p>{/if}
                  {#if report.total > report.prs.length}
                    <p class="mt-1 text-xs text-muted-foreground">
                      {w.unread(report.total - report.prs.length, report.complete === false)}<a
                        class="text-link"
                        href={`https://github.com/pulls?q=${encodeURIComponent(`is:open is:pr archived:false review-requested:${report.login}`)}`}
                        target="_blank"
                        rel="noopener">{w.seeGithub}</a
                      >
                    </p>
                  {/if}
                </div>
              {/if}
            {/if}
          </section>
        {/if}
      </Card.Content>
    </Card.Root>

    <div class="flex min-w-0 flex-col gap-4">
      <div id="todos" class="scroll-mt-20"><Todos {board} /></div>
      <Card.Root id="done" class="scroll-mt-20 gap-2 py-4">
        <Card.Header class="px-[18px]">
          <Card.Title class="text-[15px]">{w.done}</Card.Title>
          <Card.Description class="text-xs">{w.kpi.over(when)}</Card.Description>
          <Card.Action><Seg options={['14', '30', '91'].map((days) => [days, m().periods[days] ?? days])} bind:value={period} label={w.done} /></Card.Action>
        </Card.Header>
        <Card.Content class="px-[18px]">
          <Tabs.Root value="merged">
            <Tabs.List class="mb-2">
              <Tabs.Trigger value="merged">{w.doneTabs.merged} <span class="text-muted-foreground tabular-nums">{D.merged.length}</span></Tabs.Trigger>
              <Tabs.Trigger value="reviewed">{w.doneTabs.reviewed} <span class="text-muted-foreground tabular-nums">{D.reviewed.length}</span></Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="merged">
              <Lines items={D.merged} limit={10} more={toWork({ role: 'own', status: 'merged' })}>
                {#snippet item(f)}<FeatureLine {board} {f} who={board.me} meta={shortDate(f.merged_at as number)} />{/snippet}
              </Lines>
            </Tabs.Content>
            <Tabs.Content value="reviewed">
              <Lines items={D.reviewed} limit={10} more={toWork({ role: 'given' })}>
                {#snippet item(r)}<ReviewLine {board} {r} meta={personName(r.author)} />{/snippet}
              </Lines>
            </Tabs.Content>
          </Tabs.Root>
        </Card.Content>
      </Card.Root>
    </div>
  </div>
  <TodoDialog {board} />
{/if}
