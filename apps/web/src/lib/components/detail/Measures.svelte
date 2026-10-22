<script lang="ts">
import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
import { slide } from 'svelte/transition';
import WhoTag from '#lib/components/board/WhoTag.svelte';
import { fdate, fdays, fmt, fmt1, fmt2, personName } from '#lib/format.ts';
import { tr } from '#lib/i18n.svelte.ts';
import { words as cardWords } from '#lib/me/words.ts';
import { type Board, DAY, type Feat, now, uniq } from '#lib/squad/model.ts';
import Fact from './Fact.svelte';
import Facts from './Facts.svelte';
import { complexityReasons, profiles, words } from './measures.ts';
import ProfileBar from './ProfileBar.svelte';

/** Who wrote a feature, what it weighs and how its review went; the detail on demand. */
let { board, f, authors }: { board: Board; f: Feat; authors: string[] } = $props();
const c = $derived(tr(cardWords).card);
const w = $derived(tr(words));
let detail = $state(false);
const slugs: Record<string, string> = { odoo: 'odoo-dev/odoo', enterprise: 'odoo-dev/enterprise', upgrade: 'odoo/upgrade' };
const reasons = $derived(complexityReasons(f, w.factors));
const received = $derived(f.gh?.received ?? []);
const profile = $derived(f.profile ? profiles.map((k) => f.profile?.[k] ?? 0) : null);
const modules = $derived(Object.entries(f.modules ?? {}));
const parts = $derived(Object.entries(f.weight_parts ?? {}).sort((a, b) => b[1].weighted - a[1].weighted));
</script>

<Facts>
  <Fact label={c.who}>{#each authors as person (person)}<WhoTag {board} {person} class="text-[13px]" />{/each}</Fact>
  <Fact label={w.facts.size}>{f.size ? w.facts.sizeValue(f.size, f.weighted) : w.facts.unknown}</Fact>
  {#if f.size}<Fact label={w.facts.complexity}>{w.facts.complexityValue(f.complexity ?? 0, w.level(f.complexity))}</Fact>{/if}
  {#if f.merged_at && f._lead != null}
    <Fact label={w.facts.lead}>{fdays(f._lead / DAY)}</Fact>
  {:else if f.status === 'open' && f._activity.length}
    <Fact label={w.facts.openSince}>{fdays((now() - Math.min(...f._activity)) / DAY)}</Fact>
  {/if}
  {#if f.gh}<Fact label={w.facts.received}>{w.facts.receivedValue(received.length, f._rounds)}</Fact>{/if}
  {#if profile?.some(Boolean)}<Fact label={w.facts.profile}><span class="w-full max-w-72 pt-1"><ProfileBar counts={profile} height={6} /></span></Fact>{/if}
</Facts>

<button class="linkish mt-2" onclick={() => (detail = !detail)}>{detail ? c.hideMeasures : c.showMeasures}</button>
{#if detail}
  <div class="detail-grid mt-3" transition:slide={{ duration: 180 }}>
    {#if f.size}
      <section>
        <h4 class="col-title">{w.sections.complexity} · {f.complexity}/100</h4>
        {#if reasons.length}
          <div class="flex flex-col gap-1 text-[12.5px]">
            {#each reasons as r (r.key)}
              <div class="grid grid-cols-[minmax(0,1fr)_72px_32px] items-center gap-2" title={w.points(fmt1(r.points), r.max)}>
                <span class="truncate">{r.text}</span>
                <span class="h-1.5 overflow-hidden rounded bg-muted"><span class="block h-full rounded bg-link" style:width="{Math.max(3, (r.points / r.max) * 100)}%"></span></span>
                <span class="text-right text-muted-foreground tabular-nums">+{fmt(r.points)}</span>
              </div>
            {/each}
          </div>
        {/if}
        <p class="mt-2 mb-1.5 text-xs text-muted-foreground">{w.content.raw(f.size, f.weighted, f.mechanical)}</p>
        {#if profile}<ProfileBar counts={profile} legend />{/if}
      </section>
      <section>
        <h4 class="col-title">{w.sections.content}</h4>
        <dl class="kv mt-0">
          <dt>{w.content.lines}</dt>
          <dd>{w.content.linesValue(f.ins ?? 0, f.dels ?? 0, f.mechanical)}</dd>
          <dt>{w.content.files}</dt>
          <dd>{w.content.filesValue(f.files ?? 0, modules.length)}</dd>
          {#if modules.length}
            <dt>{w.content.modules}</dt>
            <dd>{modules.slice(0, 4).map(([name, n]) => `${name} (${fmt(n)})`).join(', ')}</dd>
          {/if}
          <dt>{w.content.tests}</dt>
          <dd>{f.test_lines ? w.content.testsValue(f.test_lines, f.new_tests) : w.content.none}</dd>
          {#if f.new_models || f.new_fields}
            <dt>{w.content.schema}</dt>
            <dd>{w.factors.schema(f.new_models ?? 0, f.new_fields ?? 0)}</dd>
          {/if}
          {#if f.migration_lines}
            <dt>{w.content.migration}</dt>
            <dd>{w.content.migrationValue(f.migration_lines)}</dd>
          {/if}
        </dl>
      </section>
    {/if}
    {#if f.gh}
      <section>
        <h4 class="col-title">{w.sections.review}</h4>
        <dl class="kv mt-0">
          {#if f.gh.opened_at}
            <dt>{w.review.openedOn}</dt>
            <dd>{fdate(f.gh.opened_at)}</dd>
          {/if}
          <dt>{w.review.first}</dt>
          <dd>{f._firstReview != null ? w.review.firstValue(fdays(f._firstReview)) : w.review.none}</dd>
          {#if received.length}
            <dt>{w.review.from}</dt>
            <dd>{uniq(received.map((rv) => personName(board.reviewerLogin(rv)))).join(', ')}</dd>
          {/if}
          <dt>{w.review.changes}</dt>
          <dd>{w.review.changesValue(f._rounds)}</dd>
          {#if f.gh.opened_at && f.merged_at}
            <dt>{w.review.toMerge}</dt>
            <dd>{fdays(Math.max(0, f.merged_at - f.gh.opened_at) / DAY)}</dd>
          {/if}
        </dl>
      </section>
    {/if}
    {#if parts.length}
      <section class="col-span-full">
        <h4 class="col-title">{w.breakdown}</h4>
        <table class="w-full text-[12.5px] tabular-nums [&_td]:px-1.5 [&_th]:px-1.5">
          <thead class="text-muted-foreground">
            <tr>
              <th class="py-1 text-left font-medium">{w.kindHead.kind}</th>
              <th class="py-1 text-right font-medium">{w.kindHead.weight}</th>
              <th class="py-1 text-right font-medium">+</th>
              <th class="py-1 text-right font-medium">−</th>
              <th class="py-1 font-medium" title={w.kindHead.mechanical}><ArrowLeftRight class="ml-auto size-3" aria-label={w.kindHead.mechanical} /></th>
              <th class="py-1 text-right font-medium">{w.kindHead.weighted}</th>
            </tr>
          </thead>
          <tbody>
            {#each parts as [kind, part] (kind)}
              <tr class="border-t">
                <td class="py-1">{w.kinds[kind] ?? kind}</td>
                <td class="py-1 text-right">× {fmt2(part.weight)}</td>
                <td class="py-1 text-right">{fmt(part.ins)}</td>
                <td class="py-1 text-right">{fmt(part.dels)}</td>
                <td class="py-1 text-right">{fmt(part.mechanical)}</td>
                <td class="py-1 text-right font-medium">{fmt1(part.weighted)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="mt-1.5 text-xs text-muted-foreground">{w.rule}</p>
      </section>
    {/if}
    {#if f.commits.length}
      <section>
        <h4 class="col-title">{c.commits}</h4>
        <ul class="plain-list">
          {#each [...f.commits].reverse().slice(0, 5) as commit (commit.sha)}
            <li>
              <a class="d font-mono text-link" href="https://github.com/{commit.merged ? `odoo/${commit.repo}` : slugs[commit.repo ?? '']}/commit/{commit.sha}" target="_blank" rel="noopener">{commit.sha?.slice(0, 8)}</a>
              <span class="t" title={commit.subject}>{commit.subject}</span>
            </li>
          {/each}
          {#if (f.commit_count ?? f.commits.length) > 5}<li class="text-muted-foreground">{w.commitsTotal(f.commit_count ?? f.commits.length)}</li>{/if}
        </ul>
      </section>
    {/if}
  </div>
{/if}
