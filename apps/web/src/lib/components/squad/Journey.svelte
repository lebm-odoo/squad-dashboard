<script lang="ts">
import FeatureLine from '#lib/components/board/FeatureLine.svelte';
import ReviewerChip from '#lib/components/board/ReviewerChip.svelte';
import Swatch from '#lib/components/board/Swatch.svelte';
import StatCard from '#lib/components/StatCard.svelte';
import { Button } from '#lib/components/ui/button/index.ts';
import * as Card from '#lib/components/ui/card/index.ts';
import { cap, dayMonth, fdate, fmt, fmt1, label, lower, monthLong, pct, shortDate } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import {
  arrivalTs,
  type Board,
  DAY,
  featureTopics,
  inP,
  inProgress,
  lastActivity,
  monthStart,
  nextMonth,
  now,
  periodHolding,
  sum,
  tally,
  weekStart,
} from '#lib/squad/model.ts';
import { reading, type Signal } from '#lib/squad/reading.ts';
import { tooltip } from '#lib/tip.svelte.ts';
import { hasTodo, todos } from '#lib/todos.svelte.ts';
import ActivityChart, { type ActivityRow } from './charts/ActivityChart.svelte';
import CumulativeChart from './charts/CumulativeChart.svelte';
import EvolutionCard, { type MonthRow } from './charts/EvolutionCard.svelte';
import PeopleChips from './PeopleChips.svelte';
import Sources from './Sources.svelte';

/** Where a person or the squad went over the months: mine in Moi, the squad's or one member's in Squad. */
let {
  board,
  who,
  window,
  set,
  mine = false,
}: { board: Board; who: string | null; window: string; set: (changes: Record<string, string | null>) => void; mine?: boolean } = $props();
const words = $derived(m().journey);
const single = $derived(who && board.everyone.includes(who) ? who : null);
const span = $derived(!single && window === 'arrival' ? '365' : window);
const people = $derived(single ? [single] : board.members);
const base = $derived(board.journeyBase(people));
const org = $derived(single ? board.orgOf(single) : null);
// The squad starts with its first visible work: before it, the months would only show who had not arrived yet.
const start = $derived(single && org?.arrival ? arrivalTs(org.arrival) : Math.min(now(), ...base.mine.flatMap((f) => f._activity)));
const from = $derived(span === 'arrival' ? start : Math.max(start, now() - +span * DAY));
const W = $derived(board.facts(base, { from, to: now() + DAY }));
const evo = $derived(board.selfEvolution(base, start));
const open = $derived(single ? board.featuresOf(single).filter(inProgress) : []);
const read = $derived(
  reading({
    W,
    R: evo.R,
    B: evo.B,
    evo,
    single,
    people,
    canReview: !!single && (!!org?.lead || board.reviews.some((r) => r.reviewer === single && r.src === 'r+')),
    stale: open.filter((f) => f.status === 'open' && lastActivity(f) < now() - 14 * DAY),
  }),
);
const color = $derived(single ? `var(--p${board.everyone.indexOf(single)})` : 'var(--link)');
const reviewedBy = $derived(single ? board.reviewersOf(single, { from, to: now() + DAY }) : []);
// Activity and path: weeks up to a year, months beyond.
const weekly = $derived(now() - from <= 400 * DAY);
const series = $derived.by((): ActivityRow[] => {
  const slots: number[] = [];
  if (weekly) for (let t = weekStart(from); t <= now(); t += 7 * DAY) slots.push(t);
  else for (let t = monthStart(from); t <= now(); t = nextMonth(t)) slots.push(t);
  const slotOf = (t: number) => (weekly ? weekStart(t) : monthStart(t));
  const reviewSlots = new Map<number, number>();
  for (const r of W.reviews) reviewSlots.set(slotOf(r.t), (reviewSlots.get(slotOf(r.t)) || 0) + 1);
  return slots.map((t, i) => {
    const end = (slots[i + 1] || now() + DAY) - 1;
    const P = { from: Math.max(t, from), to: end };
    return {
      m: t,
      partial: end > now(),
      reviews: reviewSlots.get(t) || 0,
      code: sum(base.mine.map((f) => f._events.filter((e) => (e.type === 'code' || e.type === 'new') && inP(e.t, P)).length)),
      merged: W.merged.filter((f) => inP(f.merged_at as number, P)).length,
      long: weekly ? words.weekOf(dayMonth(t)) : monthLong(t),
    };
  });
});
// Month by month over the last year (or since arrival), to see the trend of the person's own work.
const months = $derived.by((): MonthRow[] => {
  const evoFrom = Math.max(start, span === 'arrival' ? start : now() - 365 * DAY);
  const rows: MonthRow[] = [];
  for (let t = monthStart(evoFrom); t <= now(); t = nextMonth(t)) {
    const f = board.facts(base, { from: Math.max(t, evoFrom), to: nextMonth(t) - 1 });
    rows.push({
      m: t,
      partial: nextMonth(t) > now(),
      merged: f.merged.length,
      lines: f.lines,
      clean: f.clean.length,
      reviewed: f.reviewed.length,
      complexity: f.featureComplexity,
      reviews: f.reviews.length,
    });
  }
  return rows;
});
const evolution = $derived(
  (
    [
      [words.evo.merged, '', (r: MonthRow) => r.merged as number, fmt1],
      [words.evo.lines, '', (r: MonthRow) => r.lines as number, fmt],
      [
        words.evo.clean,
        '%',
        (r: MonthRow) => (r.reviewed ? ((r.clean as number) / (r.reviewed as number)) * 100 : null),
        fmt,
        ['clean', 'reviewed'],
      ],
      [words.evo.complexity, '/100', (r: MonthRow) => r.complexity as number | null, fmt],
      ...(sum(months.map((r) => r.reviews as number)) ? [[words.evo.reviews, '', (r: MonthRow) => r.reviews as number, fmt1]] : []),
    ] as [string, string, (r: MonthRow) => number | null, (v: number | null) => string, [string, string]?][]
  ).filter(([, , value, , ratio]) => {
    const known = months.filter((r) => value(r) != null && !r.partial);
    if (known.length < 4) return false;
    return !ratio || ![known.slice(0, 3), known.slice(-3)].some((list) => sum(list.map((r) => r[ratio[1]] as number)) < 3);
  }),
);
// Ground covered for the first time in the window: modules never touched before it.
const newModules = $derived.by(() => {
  const before = base.mine.filter((f) => f.kind !== 'forward-port' && f._activity.length && Math.min(...f._activity) < from);
  const seen = new Set(before.flatMap((f) => Object.keys(f.modules ?? {})));
  return before.length ? W.modules.filter((module) => !seen.has(module)) : [];
});
const seniority = $derived(Math.max(0, Math.round((now() - start) / (30.44 * DAY))));
const tenure = $derived(
  seniority < 1
    ? words.lessThanMonth
    : seniority < 12
      ? words.months(seniority)
      : `${words.years(Math.floor(seniority / 12))}${seniority % 12 ? ` ${words.months(seniority % 12)}` : ''}`,
);
const role = $derived(
  single ? (single === board.lead ? words.roleLead : org?.leader ? words.roleIn(label(org.leader)) : words.roleMember) : '',
);
const profileKeys = ['back', 'front', 'views', 'data', 'test'];
const profileColors: Record<string, string> = {
  back: 'var(--p0)',
  front: 'var(--p1)',
  views: 'var(--p2)',
  data: 'var(--p3)',
  test: 'var(--p4)',
};
const profileTotal = $derived(sum(W.profile));
const context = $derived.by(() => {
  const kinds = tally(W.merged.map((f) => f.kind))
    .map(([k, n]) => `${n} ${n === 1 ? words.kinds[k]?.[0] : words.kinds[k]?.[1]}`)
    .join(', ');
  const profileTop = profileTotal
    ? profileKeys
        .map((k, i) => [k, (W.profile[i] ?? 0) / profileTotal] as const)
        .sort((x, y) => y[1] - x[1])
        .filter(([, v], i) => !i || v >= 0.15)
        .slice(0, 2)
        .map(([k, v]) => `${(words.profiles[k] ?? k).toLowerCase()} ${pct(v)}`)
        .join(', ')
    : '';
  return [
    single
      ? words.contextOne(label(single), role, tenure, org?.arrival ? monthLong(arrivalTs(org.arrival)) : null, fdate(from))
      : words.contextSquad(board.members.map(label).join(', '), fdate(from)),
    words.observed(
      words.change(W.merged.length),
      kinds,
      profileTop,
      fmt1(W.perMonth),
      W.fw.length ? words.forwardPorts(W.fw.length) : '',
      W.reviews.length ? words.features(W.reviews.length) : '',
      single ? words.features(open.filter((f) => f.status === 'open').length) : '',
    ),
  ];
});
const hero = $derived(
  [
    [words.hero.merged, W.merged.length, words.hero.perMonth(fmt1(W.perMonth), W.fw.length)],
    W.reviews.length ? [words.hero.reviewed, W.reviews.length, words.hero.forPeople(W.reviewedAuthors.length, W.rplus)] : null,
    [words.hero.topics, W.topics.length, W.topics[0] ? words.hero.mostly(W.topics[0][0]) : '—'],
    W.countries.length ? [words.hero.countries, W.countries.length, W.countries.slice(0, 6).join(' · ')] : null,
    single ? [words.hero.weeks, W.activeWeeks, words.hero.outOf(W.weeks)] : [words.hero.workedOn, W.active.length, words.hero.inTotal],
  ].filter((x): x is [string, number, string] => !!x),
);
const levels = (complexity: number | undefined) =>
  complexity == null ? '' : (words.levels[[60, 40, 20, 0].find((min) => complexity >= min) ?? 0] ?? '');
</script>

{#snippet signals(items: Signal[], tone: 'good' | 'talk', icon: string)}
  <ul class="signals">
    {#each items as it, index (index)}
      <li class={tone}>
        <span class="ico" aria-hidden="true">{it.open ? '?' : icon}</span>
        <div>
          {it.text}
          {#if it.question}<div class="mt-0.5 text-[13px] text-foreground/70">{it.question}</div>{/if}
          {#if it.suggestion}<div class="mt-0.5 text-[13px] text-foreground/70">{words.suggestion(lower(it.suggestion))}</div>{/if}
          {#if it.sources?.length}<Sources items={it.sources} />{/if}
        </div>
      </li>
    {/each}
  </ul>
{/snippet}

<div class="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
  {#if !mine}<PeopleChips {board} who={single} pick={(person) => set({ who: person })} />{/if}
  <div class="ml-auto inline-flex overflow-hidden rounded-lg border bg-card" role="group" aria-label="Window">
    {#each ['91', '182', '365', ...(single ? ['arrival'] : [])] as value (value)}
      <button
        class="cursor-pointer px-2.5 py-[5px] text-[13px] text-foreground/70 aria-pressed:bg-primary aria-pressed:text-primary-foreground [&+&]:border-l"
        aria-pressed={span === value}
        onclick={() => set({ window: value === '182' ? null : value })}>{words.window[value]}</button
      >
    {/each}
  </div>
</div>

<div class="mt-1 mb-4 flex flex-wrap items-baseline gap-3">
  <h2 class="inline-flex items-center gap-2.5 text-[22px] font-semibold tracking-tight">
    {#if mine}{words.mine}{:else if single}<Swatch {board} person={single} size={14} />{label(single)}{:else}{words.theSquad}{/if}
  </h2>
  {#if !todos.offline}
    <Button
      variant="outline"
      size="sm"
      title={words.todoTitle}
      onclick={() =>
        (todos.dialog = {
          type: 'journey',
          key: single || 'squad',
          label: single ? words.journeyOf(label(single)) : words.journeyOfSquad,
          ...(single ? { who: single } : {}),
          window: span,
        })}>{hasTodo('journey', single || 'squad') ? words.todoHas : words.todo}</Button
    >
  {/if}
  <span class="text-muted-foreground">{single ? words.head(cap(role), tenure, fdate(from)) : words.headSquad(board.members.length, fdate(from))}</span>
</div>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
  {#each hero as [title, value, hint] (title)}<StatCard label={title} value={fmt(value)} {hint} />{/each}
</div>

<Card.Root class="mb-4 gap-0 px-[18px] py-4 text-sm leading-relaxed">
  <h2 class="text-[15px] font-semibold">{words.reading}</h2>
  <p class="sub mb-3">{words.readingSub}</p>
  {#each context as line, index (index)}<p class="mb-1.5 max-w-[980px]">{line}</p>{/each}
  <div class="mt-3.5 grid gap-x-8 gap-y-1 md:grid-cols-2">
    <div>
      <h3 class="col-title mt-2.5">{words.wentWell}</h3>
      {#if read.good.length}{@render signals(read.good, 'good', '✓')}{:else}<p class="text-muted-foreground">{words.steady}</p>{/if}
    </div>
    <div>
      <h3 class="col-title mt-2.5">{words.achievements}</h3>
      {#if read.achievements.length}
        <ul>
          {#each read.achievements as f (f.name)}
            {@const details = [
              f.new_models && words.achievement.models(f.new_models),
              f.new_fields && words.achievement.fields(f.new_fields),
              f.migration_lines && words.achievement.migration,
              f.test_lines && words.achievement.tests,
              Object.keys(f.modules ?? {}).length > 1 && words.achievement.modules(Object.keys(f.modules).length),
            ]
              .filter(Boolean)
              .join(', ')}
            <li class="border-t py-[9px] first:border-t-0 first:pt-0.5">
              <div class="flex items-baseline justify-between gap-2.5">
                {#if f.prs[0]}<a class="font-semibold text-foreground" href={f.prs[0].url} target="_blank" rel="noopener">{f.title || f.name}</a>{:else}<b>{f.title || f.name}</b>{/if}
                <span class="rounded-full border bg-muted px-2 text-[11.5px] whitespace-nowrap text-foreground/70">{levels(f.complexity)}</span>
              </div>
              <div class="text-[12.5px] text-muted-foreground">
                {[
                  people.length > 1 ? f._people.filter((p) => people.includes(p)).map(label).join(', ') : null,
                  featureTopics(f).join(', '),
                  words.achievement.mergedIn(monthLong(f.merged_at as number)),
                  details,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-muted-foreground">{words.noAchievement}</p>
      {/if}
    </div>
  </div>
  {#if single && read.talk.length}
    <details class="mt-4 rounded-lg border border-dashed bg-muted px-3.5 py-2.5">
      <summary class="cursor-pointer text-[13.5px] font-semibold">
        {words.talk}<span class="text-[12.5px] font-normal text-muted-foreground">{words.talkHint(read.talk.filter((t) => !t.open).length)}</span>
      </summary>
      <div class="mt-2">{@render signals(read.talk, 'talk', '→')}</div>
    </details>
  {/if}
  <p class="mt-3.5 max-w-[980px] text-xs text-muted-foreground">{words.limits}</p>
</Card.Root>

<Card.Root class="mb-4 gap-0 px-[18px] py-4">
  <h2 class="text-[15px] font-semibold">{weekly ? words.weekByWeek : words.monthByMonth}</h2>
  <p class="sub mb-3">{words.activitySub(weekly)}</p>
  <ActivityChart rows={series} {color} />
</Card.Root>

{#if evolution.length}
  <Card.Root class="mb-4 gap-0 px-[18px] py-4">
    <h2 class="text-[15px] font-semibold">{words.evolved}</h2>
    <p class="sub mb-3">{words.evolvedSub(span === 'arrival', !!single)}</p>
    <div class="grid gap-x-6 gap-y-4" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr))">
      {#each evolution as [title, unit, value, show, ratio] (title)}<EvolutionCard rows={months} {title} {unit} {value} {show} {ratio} />{/each}
    </div>
  </Card.Root>
{/if}

<Card.Root class="mb-4 gap-0 px-[18px] py-4">
  <h2 class="text-[15px] font-semibold">{words.path}</h2>
  <p class="sub mb-3">{words.pathSub}</p>
  <CumulativeChart rows={series} defs={[['merged', words.pathMerged, color], ...(W.reviews.length ? [['reviews', words.pathReviewed, 'var(--p6)'] as ['reviews', string, string]] : [])]} />
</Card.Root>

<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
  <Card.Root class="gap-0 px-[18px] py-4">
    <h2 class="text-[15px] font-semibold">{words.about}</h2>
    <p class="sub mb-3">{words.aboutSub}</p>
    {#if profileTotal}
      {@const parts = profileKeys.map((k, i) => [k, W.profile[i] ?? 0] as const).filter(([, n]) => n)}
      <div class="flex h-3 w-full gap-0.5 overflow-hidden rounded">
        {#each parts as [k, n] (k)}
          {#snippet tip()}
            <div class="font-semibold">{words.profiles[k]}</div>
            <div>{words.ofLines(pct(n / profileTotal))}</div>
            <div class="text-muted-foreground">{words.profileHints[k]}</div>
          {/snippet}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <span class="block min-w-[3px]" style:flex={n} style:background={profileColors[k]} tabindex="0" {@attach tooltip(tip)}></span>
        {/each}
      </div>
      <div class="legend">
        {#each [...parts].sort((a, b) => b[1] - a[1]) as [k, n] (k)}<span><i style:background={profileColors[k]}></i>{words.profiles[k]} {pct(n / profileTotal)}</span>{/each}
      </div>
    {:else}
      <p class="text-muted-foreground">—</p>
    {/if}
    <div class="mt-3.5">
      {#if W.topics.length}
        {@const top = Math.max(1, ...W.topics.slice(0, 8).map(([, n]) => n))}
        {#each W.topics.slice(0, 8) as [topic, n] (topic)}
          {@const [app, feature] = topic.split(' › ')}
          <div class="my-[5px] grid grid-cols-[minmax(120px,1.4fr)_1fr_32px] items-center gap-2.5 text-[13px]">
            <span class="truncate" title={topic}>{#if feature}<em class="text-muted-foreground not-italic">{`${app} › `}</em>{feature}{:else}{app}{/if}</span>
            <span class="h-2 overflow-hidden rounded bg-muted"><span class="block h-full rounded" style:width="{Math.max(3, (n / top) * 100)}%" style:background={color}></span></span>
            <b class="text-right font-semibold tabular-nums">{n}</b>
          </div>
        {/each}
      {:else}
        <p class="text-muted-foreground">—</p>
      {/if}
    </div>
    {#if W.countries.length}
      <h3 class="col-title mt-3.5">{words.countriesTitle}</h3>
      <div class="flex flex-wrap gap-1.5">{#each W.countries as country (country)}<span class="rounded-full border bg-muted px-2 text-xs text-foreground/70">{country}</span>{/each}</div>
    {/if}
    {#if newModules.length}
      <h3 class="col-title mt-3.5">{words.newModules}</h3>
      <div class="flex flex-wrap gap-1.5">{#each newModules.slice(0, 18) as module (module)}<span class="rounded-full border bg-muted px-2 text-xs text-foreground/70">{module}</span>{/each}</div>
    {/if}
    {#if single && reviewedBy.length}
      <h3 class="col-title mt-3.5">{words.reviewedBy}</h3>
      <div class="flex flex-wrap gap-1.5">{#each reviewedBy.slice(0, 10) as x (x.who)}<ReviewerChip person={single} {x} period={periodHolding(from)} />{/each}</div>
    {/if}
  </Card.Root>
  <Card.Root class="gap-0 px-[18px] py-4">
    <h2 class="text-[15px] font-semibold">{words.delivered}</h2>
    <p class="sub mb-3">{words.deliveredSub}</p>
    {#if W.merged.length}
      <div class="flex min-w-0 flex-col gap-px">
        {#each W.merged.slice(0, 30) as f (f.name)}
          <FeatureLine
            {board}
            {f}
            who={single || f._people.find((p) => people.includes(p)) || f.owner}
            meta={[
              single ? null : f._people.filter((p) => people.includes(p)).map(label).join(', '),
              board.mergedIn(f.version, f.merged_at as number),
              shortDate(f.merged_at as number),
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        {/each}
        {#if W.merged.length > 30}<span class="pt-1 text-xs text-muted-foreground">{words.moreInWork(W.merged.length - 30)}</span>{/if}
      </div>
    {:else}
      <p class="text-muted-foreground">{words.nothingMerged}</p>
    {/if}
  </Card.Root>
</div>
