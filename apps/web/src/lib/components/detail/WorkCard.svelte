<script lang="ts">
import Bot from '@lucide/svelte/icons/bot';
import CircleCheck from '@lucide/svelte/icons/circle-check';
import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
import ListChecks from '@lucide/svelte/icons/list-checks';
import ListPlus from '@lucide/svelte/icons/list-plus';
import Play from '@lucide/svelte/icons/play';
import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
import ThumbsUp from '@lucide/svelte/icons/thumbs-up';
import UserRound from '@lucide/svelte/icons/user-round';
import { slide } from 'svelte/transition';
import CodeTag from '#lib/components/board/CodeTag.svelte';
import PortTag from '#lib/components/board/PortTag.svelte';
import TaskTag from '#lib/components/board/TaskTag.svelte';
import WhoTag from '#lib/components/board/WhoTag.svelte';
import StatusBadge from '#lib/components/squad/StatusBadge.svelte';
import { Button } from '#lib/components/ui/button/index.ts';
import { openDetail } from '#lib/detail.ts';
import { age, fdate, personName, rel, shortDate } from '#lib/format.ts';
import { m, tr } from '#lib/i18n.svelte.ts';
import { myWorkHref, workHref } from '#lib/links.ts';
import { words } from '#lib/me/words.ts';
import { type Board, featureTopics, hasRplus, prUrl, rplusUndone, stageLabel, taskUrl, uniq, versionNumber } from '#lib/squad/model.ts';
import { ownTask, progress, reviewState, stageOf, taskReviewers, type Unit } from '#lib/squad/unit.ts';
import { todos } from '#lib/todos.svelte.ts';
import Block from './Block.svelte';
import Branch from './Branch.svelte';
import CardHead from './CardHead.svelte';
import CardLink from './CardLink.svelte';
import Fact from './Fact.svelte';
import Facts from './Facts.svelte';
import Measures from './Measures.svelte';
import Steps from './Steps.svelte';
import VersionBlock from './VersionBlock.svelte';

/** A piece of work as one: its task, its features on every version, their PRs and forward-ports, its reviews, its history. */
let { board, u }: { board: Board; u: Unit } = $props();
const w = $derived(tr(words).card);
let history = $state(8);
let stages = $state(false);
const P = $derived(progress(board, u));
const validation = $derived(u.task ? board.validationOf(u.task) : null);
// The PRs of one branch, in several repositories, share a block as a feature's do.
const branches = $derived([...Map.groupBy(u.loose, (pr) => board.requestOf(pr)?.head || pr).values()]);
const main = $derived(u.features[0]);
const mainPr = $derived(main && (main.prs.find((p) => p.state === 'open') ?? main.prs.find((p) => p.state === 'merged') ?? main.prs[0]));
const asked = $derived(!!u.request && !u.request.rplus_at && !board.asideReason(u.request));
const role = $derived(
  u.authors.includes(board.me)
    ? 'mine'
    : asked
      ? 'asked'
      : u.request?.rplus_at ||
          board.reviews.some(
            (r) =>
              r.reviewer === board.me &&
              (u.loose.includes(r.pr) || u.features.some((f) => f.prs.some((p) => `${p.repo}#${p.number}` === r.pr))),
          )
        ? 'reviewed'
        : u.task && taskReviewers(u.task).includes(board.me)
          ? 'reviewer'
          : null,
);
const notes = $derived.by(() => {
  const n = w.notes;
  const t = u.task;
  const first = Math.min(...u.features.flatMap((f) => f._activity));
  const received = u.features.reduce((sum, f) => sum + reviewState(board, f).received.length, 0);
  const rounds = u.features.reduce((sum, f) => sum + f._rounds, 0);
  const live = u.codes.filter((c) => !c.closed);
  const merged = live.filter((c) => c.merged && c.at).sort((a, b) => (b.at as number) - (a.at as number))[0];
  const open = u.features.flatMap((f) => f.prs.filter((p) => p.state === 'open'));
  const entered = new Map<string, number>();
  for (const [at, stage] of t?.changes ?? []) if (!entered.has(stageOf(stage))) entered.set(stageOf(stage), at);
  const stage = (key: string) =>
    t && stageOf(t.stage) === key
      ? `${m().taskStates[t.state] ?? t.state}${t.stage_since ? ` · ${age(t.stage_since)}` : ''}`
      : entered.has(key)
        ? shortDate(entered.get(key) as number)
        : undefined;
  return {
    code: Number.isFinite(first) ? shortDate(first) : undefined,
    spec: stage('spec'),
    dev: stage('dev'),
    testing: stage('testing'),
    review: t ? stage('review') : received ? n.reviews(received, rounds) : undefined,
    deployed: stage('deployed'),
    merge:
      merged && live.every((c) => c.merged)
        ? `${merged.version ? `${board.mergedIn(merged.version, merged.at as number)} · ` : ''}${shortDate(merged.at as number)}`
        : merged
          ? n.partly(live.filter((c) => c.merged).length, live.length)
          : open.some(hasRplus)
            ? n.rplusOf(open.filter(hasRplus).length, open.length)
            : undefined,
    master: P.stopped ? n.stopped(P.stopped) : P.portsLeft.join(', ') || undefined,
  } as Record<string, string | undefined>;
});
const steps = $derived(P.steps.map((step) => ({ ...step, note: notes[step.key] })));
const whoNext = $derived(P.next.who === board.me ? w.yourMove : P.next.who ? personName(P.next.who) : (w.nobody[P.next.key] ?? ''));
const reviews = $derived.by(() => {
  const rows: { who: string; state: string; at: number }[] = [];
  for (const f of u.features) {
    for (const rv of f.gh?.received ?? [])
      if (!f._people.includes(board.reviewerLogin(rv))) rows.push({ who: board.reviewerLogin(rv), state: rv.state, at: rv.at });
    for (const who of f.reviewers) if (!f._people.includes(who)) rows.push({ who, state: 'RPLUS', at: f.rplus?.[who] || f.merged_at || 0 });
  }
  for (const pr of u.loose) {
    for (const r of board.reviews.filter((x) => x.pr === pr))
      rows.push({ who: r.reviewer, state: r.src === 'r+' ? 'RPLUS' : (r.state ?? ''), at: r.t });
    if (u.request?.pr === pr) {
      for (const [who, state, at] of u.request.validations) rows.push({ who, state, at });
      for (const [who, at] of u.request.rplus) rows.push({ who, state: 'RPLUS', at });
    }
  }
  return [...new Map(rows.map((r) => [`${r.who}:${r.state}:${Math.round(r.at / 60)}`, r])).values()].sort((a, b) => b.at - a.at);
});
const events = $derived.by(() => {
  const icons: Record<string, string> = { code: '▲', new: '✚', open: '⊕', merge: '✓' };
  const many = u.features.length > 1;
  return [
    ...u.features.flatMap((f) =>
      f._events
        .filter((e) => m().work.events[e.type])
        .map((e) => ({
          t: e.t,
          icon: icons[e.type] ?? '•',
          text: `${m().work.events[e.type]}${many ? ` · ${board.versionLabel(f.version, f.merged_at)}` : ''}`,
        })),
    ),
    ...reviews.map((r) => ({
      t: r.at,
      icon: '◆',
      text: `${personName(r.who)} ${r.state === 'RPLUS' ? m().gaveRplus : m().reviewStates[r.state] || r.state}`,
    })),
    ...(u.task?.changes ?? []).map(([t, stage, state]) => ({
      t,
      icon: '▢',
      text: `${w.taskMoved(stageLabel(stage))} · ${m().taskStates[state] ?? state}`,
    })),
  ].sort((a, b) => b.t - a.t);
});
const mergebot = $derived(
  main?.prs.find((p) => p.mergebot_url)?.mergebot_url ?? u.loose.map((pr) => board.data.reviewed_prs[pr]?.url).find(Boolean),
);
const github = $derived(mainPr?.url ?? (u.request?.url || (u.loose[0] ? prUrl(u.loose[0]) : null)));
const versions = $derived(
  uniq(
    [...u.features]
      .sort((a, b) => versionNumber(a.version) - versionNumber(b.version))
      .map((f) => board.versionLabel(f.version, f.merged_at)),
  ),
);
</script>

<CardHead
  kind={role ? w.roles[role] ?? '' : main ? (m().kinds[main.kind] ?? main.kind) : w.kinds.pr ?? ''}
  overline={[versions.join(', '), main && featureTopics(main).join(', ')].filter(Boolean).join(' · ')}
  title={u.title}
>
  {#snippet status()}
    {#if main}<StatusBadge {board} f={main} />{:else}<CodeTag code={u.codes[0] ?? null} />{/if}
    {#if u.task}<TaskTag t={u.task} how={main?._taskHow.get(u.task)} />{/if}
    {#if !u.authors.includes(board.me) && u.authors.length}<span>{m().work.prBy(u.authors.map(personName).join(', '))}</span>{/if}
    {#if main?.status === 'open' && main._activity.length}<span>{w.openFor(age(main.gh?.opened_at || Math.min(...main._activity)))}</span>{/if}
  {/snippet}
  {#snippet actions()}
    {#if github}
      <Button variant={asked && P.next.key === 'review' ? 'default' : 'outline'} size="sm" href={github} target="_blank" rel="noopener">
        <GitPullRequest />{w.github}
      </Button>
    {/if}
    {#if u.task}<Button variant="outline" size="sm" href={taskUrl(u.task.id)} target="_blank" rel="noopener"><SquareArrowOutUpRight />{w.odoo}</Button>{/if}
    {#if mergebot}<Button variant="outline" size="sm" href={mergebot} target="_blank" rel="noopener"><Bot />{w.mergebot}</Button>{/if}
    {#if main?.runbot}<Button variant="outline" size="sm" href={main.runbot.url} target="_blank" rel="noopener"><Play />{w.runbot}</Button>{/if}
    <Button
      variant="ghost"
      size="sm"
      disabled={todos.offline}
      onclick={() =>
        (todos.dialog = main
          ? { type: 'feature', key: main.name, label: u.title, who: main.owner }
          : u.task
            ? { type: 'task', key: String(u.task.id), label: u.title, url: taskUrl(u.task.id) }
            : { type: 'pr', key: u.loose[0] ?? '', label: u.title, url: github ?? undefined })}
    >
      <ListPlus />{w.todo}
    </Button>
    {#if main && board.everyone.includes(main.owner)}
      <Button
        variant="ghost"
        size="sm"
        href={main.owner === board.me ? myWorkHref({ feature: main.name }) : workHref({ who: main.owner, feature: main.name })}
      >
        <ListChecks />{w.inWork}
      </Button>
    {/if}
  {/snippet}
</CardHead>

<div class="px-5 py-4">
  <div
    class="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-[13.5px]"
    class:border-link={P.next.who === board.me}
    style:background={P.next.who === board.me ? 'color-mix(in srgb, var(--link) 8%, var(--card))' : null}
  >
    {#if P.next.key === 'done'}
      <CircleCheck class="mt-0.5 size-4 flex-none text-good" />
    {:else}
      <UserRound class="mt-0.5 size-4 flex-none {P.next.who === board.me ? 'text-link' : 'text-muted-foreground'}" />
    {/if}
    <span class="min-w-0">
      {#if whoNext}<span class="font-semibold">{whoNext}</span><span class="mx-1.5 text-muted-foreground">·</span>{/if}{w.next[P.next.key]?.(
        P.next.detail ? personName(P.next.detail) : '',
      )}
    </span>
  </div>
  {#if validation}
    <p class="mt-2 flex items-center gap-2 text-[12.5px]" style:color={validation.state === 'outdated' ? 'var(--critical)' : 'var(--p4)'}>
      <ThumbsUp class="size-3.5 flex-none" />{w.validation[validation.state]?.(validation.by.map(personName).join(', '))}
      {#if validation.state !== 'pending' && (validation.pushed || validation.at)}
        <span class="text-muted-foreground">· {rel(validation.pushed || validation.at)}</span>
      {/if}
    </p>
  {/if}
</div>

<Block title={w.where}><Steps {steps} labels={w.steps} /></Block>

<Block title={w.versions} count={u.features.length + branches.length}>
  <div class="flex flex-col gap-2">
    {#each u.features as f (f.name)}
      <VersionBlock
        {board}
        {f}
        port={!main || f === main
          ? undefined
          : f.port_of !== main.name && main.port_of !== f.name
            ? 'task'
            : versionNumber(f.version) < versionNumber(main.version)
              ? 'back'
              : 'forward'}
      />
    {/each}
    {#each branches as prs (prs[0])}
      {@const lead = board.requestOf(prs[0] as string)}
      {@const code = board.codeOf(prs[0] as string)}
      {@const branch = code?.version ?? (lead?.base || lead?.head)?.match(/^(master|saas-\d+\.\d+|\d+\.\d+)(?:-|$)/)?.[1]}
      {@const version = branch && board.versionLabel(branch, code?.at)}
      {@const ids = uniq(prs.flatMap((pr) => Object.entries(board.requestOf(pr)?.ids ?? {}).flatMap(([kind, list]) => list.map((id) => [kind, id].join('-')))))}
      {@const steps = prs.map((pr) => board.codeOf(pr)?.steps ?? []).find((list) => list.length)}
      <div class="rounded-lg border bg-card p-3 text-[13px]">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          {#if version}<span class="rounded-md bg-muted px-1.5 text-[12px] font-semibold tabular-nums">{version}</span>{/if}
          {#if lead?.head}<Branch name={lead.head} />{/if}
        </div>
        <ul class="mt-2 flex flex-col gap-1.5">
          {#each prs as pr (pr)}
            {@const code = board.codeOf(pr)}
            {@const request = board.requestOf(pr)}
            {@const undone = !code?.merged && rplusUndone(request)}
            <li class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <a class="text-link" href={request?.url ?? prUrl(pr) ?? undefined} target="_blank" rel="noopener">{pr.replace(/^odoo\//, '')}</a>
              {#if code}
                <CodeTag {code} moving={false} />
              {:else if request}
                <span class="rtag {request.draft ? 'comment' : 'rplus'}">{m().status[request.draft ? 'draft' : 'open']}</span>
              {/if}
              {#if code?.pr && !code.merged && !code.closed}
                <span class="rtag {code.pr.missing_r ? 'comment' : 'validation'}">{code.pr.missing_r ? w.rMissing : w.rGiven}</span>
              {/if}
              {#if request}
                <span class="text-xs text-muted-foreground">
                  {request.rplus_at
                    ? w.rplusGiven(rel(request.rplus_at))
                    : w.askedHow(request.direct ?? false, request.teams.join(', '), rel(request.asked_at || request.created_at))}
                </span>
              {/if}
              {#if undone}<span class="rtag fw-blocked">{tr(words).undone[undone[0]]?.(personName(undone[2] ?? '?'))}</span>{/if}
            </li>
          {/each}
        </ul>
        {#if ids.length}
          <p class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            {#each ids as tag (tag)}
              {@const [kind, id] = tag.split('-') as [string, string]}
              {#if kind === 'opw' || kind === 'task'}
                <a class="rtag k-{kind}" href={taskUrl(id)} target="_blank" rel="noopener">{tag}</a>
              {:else}
                <span class="rtag k-{kind}">{tag}</span>
              {/if}
            {/each}
          </p>
        {/if}
        {#if steps}
          <div class="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span class="mr-1">{w.ports}</span>{#each steps as step (step.branch)}<PortTag {step} />{/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</Block>

{#if u.task}
  {@const t = u.task}
  {@const reviewers = taskReviewers(t)}
  <Block title={w.task}>
    <Facts>
      <Fact label={w.stage}>
        <TaskTag {t} />
        {#if t.stage_since}<span class="text-muted-foreground">{w.inStage(age(t.stage_since))}</span>{/if}
      </Fact>
      {#if t.people.length}<Fact label={w.assigned}>{#each t.people as person (person)}<WhoTag {board} {person} class="text-[13px]" />{/each}</Fact>{/if}
      {#if reviewers.length}
        <Fact label={w.reviewer}>{#each reviewers as person (person)}<WhoTag {board} {person} class="text-[13px]" />{/each}</Fact>
      {/if}
      {#if t.tags.length}<Fact label={w.tags}>{#each t.tags as tag (tag)}<span class="rtag">{tag.trim()}</span>{/each}</Fact>{/if}
      {#if t.project}<Fact label={w.project}>{t.project}</Fact>{/if}
    </Facts>
    {#if t.changes?.length}
      <button class="linkish mt-2" onclick={() => (stages = !stages)}>{stages ? w.hideStages : w.showStages(t.changes.length)}</button>
      {#if stages}
        <ol class="relative mt-2 ml-1.5 border-l pl-4 text-[13px]" transition:slide={{ duration: 180 }}>
          {#each t.changes.toReversed() as [at, stage, state], index (index)}
            <li class="relative pb-2 last:pb-0">
              <span class="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card" class:bg-link={!index} class:bg-border={index}></span>
              <span class="font-medium">{stageLabel(stage)}</span>
              <span class="text-muted-foreground">· {m().taskStates[state] ?? state} · {fdate(at)}</span>
            </li>
          {/each}
        </ol>
      {/if}
    {/if}
  </Block>
{/if}

{#if u.related.length || u.children.length || u.task?.parent}
  {@const parent = u.task?.parent}
  <Block title={w.related}>
    <p class="mb-1 text-xs text-muted-foreground">{w.relatedSub}</p>
    <div class="flex flex-col">
      {#if parent}
        {@const known = board.taskOf(String(parent.id))}
        {#if known}
          <CardLink onclick={() => openDetail('task', String(parent.id))}>
            <span class="flex-none text-xs text-muted-foreground">{w.parentTask}</span><TaskTag t={known} /><span class="truncate">{known.name}</span>
          </CardLink>
        {:else}
          <a class="py-1.5 text-[13px] text-link" href={taskUrl(parent.id)} target="_blank" rel="noopener">{w.parentTask} · {parent.name}</a>
        {/if}
      {/if}
      {#each u.related as f (f.name)}
        {@const own = ownTask(f)}
        <CardLink onclick={() => openDetail('feature', f.name)}>
          <span class="flex-none rounded-md bg-muted px-1.5 text-[12px] font-semibold tabular-nums">{board.versionLabel(f.version, f.merged_at)}</span>
          <StatusBadge {board} {f} />
          <span class="min-w-0 truncate">{f.title || f.name}</span>
          {#if own}<span class="flex-none"><TaskTag t={own} short /></span>{/if}
        </CardLink>
      {/each}
      {#each u.children as child (child.id)}
        <CardLink onclick={() => openDetail('task', String(child.id))}>
          <span class="flex-none text-xs text-muted-foreground">{w.childTask}</span><TaskTag t={child} /><span class="truncate">{child.name}</span>
        </CardLink>
      {/each}
    </div>
  </Block>
{/if}

{#if reviews.length}
  <Block title={m().work.reviews} count={reviews.length}>
    <ul class="plain-list">
      {#each reviews as r, index (index)}
        <li class:font-semibold={r.who === board.me}>
          <span class="d">{shortDate(r.at)}</span><span class="i">{r.state === 'RPLUS' ? 'r+' : '◆'}</span>
          <span class="t">{personName(r.who)} {r.state === 'RPLUS' ? m().gaveRplus : m().reviewStates[r.state] || r.state}</span>
        </li>
      {/each}
    </ul>
  </Block>
{/if}

{#if main}
  <Block title={w.facts}><Measures {board} f={main} authors={u.authors} /></Block>
{/if}

{#if events.length}
  <Block title={w.history} count={events.length}>
    <ul class="plain-list">
      {#each events.slice(0, history) as x, index (index)}
        <li transition:slide={{ duration: 160 }}><span class="d">{shortDate(x.t)}</span><span class="i">{x.icon}</span><span class="t" title={x.text}>{x.text}</span></li>
      {/each}
    </ul>
    {#if events.length > 8}
      <button class="linkish mt-1" onclick={() => (history = history > 8 ? 8 : events.length)}>{history > 8 ? tr(words).showFewer : tr(words).showAll(events.length)}</button>
    {/if}
  </Block>
{/if}
