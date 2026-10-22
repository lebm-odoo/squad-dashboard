<script lang="ts">
import PortTag from '#lib/components/board/PortTag.svelte';
import WhoTag from '#lib/components/board/WhoTag.svelte';
import StatusBadge from '#lib/components/squad/StatusBadge.svelte';
import { shortDate } from '#lib/format.ts';
import { m, tr } from '#lib/i18n.svelte.ts';
import { words } from '#lib/me/words.ts';
import { type Board, type Feat, hasRplus, portsStopped } from '#lib/squad/model.ts';
import { tooltip } from '#lib/tip.svelte.ts';
import Branch from './Branch.svelte';

/** One branch of a piece of work: its version, its PRs, closed ones included, and how far the mergebot forward-ported it. */
let { board, f, port }: { board: Board; f: Feat; port?: 'back' | 'forward' | 'task' } = $props();
const w = $derived(tr(words).card);
const chain = $derived(board.forwardChain(f));
const open = $derived(f.prs.filter((p) => p.state === 'open'));
const ready = $derived(open.filter(hasRplus).length);
</script>

<div class="rounded-lg border bg-card p-3" class:opacity-60={f.status === 'closed'}>
  <div class="flex min-w-0 flex-wrap items-center gap-2">
    <span class="rounded-md bg-muted px-1.5 text-[12px] font-semibold tabular-nums">{board.versionLabel(f.version, f.merged_at)}</span>
    {#if port}<span class="text-xs text-muted-foreground">{w.byHand[port]}</span>{/if}
    <StatusBadge {board} {f} />
    {#if open.length}
      <span class="rtag {ready === open.length ? 'validation' : 'comment'}">{ready === open.length ? w.ready : w.notes.rplusOf(ready, open.length)}</span>
    {/if}
    <WhoTag {board} person={f.owner} class="text-[12.5px]" />
    <Branch name={f.name} />
    {#if f.runbot}<a class="text-xs text-link" href={f.runbot.url} target="_blank" rel="noopener">runbot</a>{/if}
  </div>
  {#if f.prs.length}
    <ul class="mt-2 flex flex-col gap-1.5 text-[13px]">
      {#each f.prs as p (`${p.repo}#${p.number}`)}
        {@const checks = Object.entries(p.ci ?? {}).map(([name, state]) => [name.replace(/^ci\//, ''), state] as const)}
        {@const failed = checks.filter(([, state]) => state === 'fail').map(([name]) => name)}
        {@const running = checks.some(([, state]) => state === 'pending')}
        {#snippet ciDetail()}
          <ul class="space-y-0.5">
            {#each checks as [name, state] (name)}<li class="flex justify-between gap-4"><span>{name}</span><span class="text-muted-foreground">{state}</span></li>{/each}
          </ul>
        {/snippet}
        <li class="flex flex-wrap items-center gap-x-2 gap-y-1" class:opacity-60={p.state === 'closed' && f.status !== 'closed'}>
          <a class="text-link" class:line-through={p.state === 'closed'} href={p.url} target="_blank" rel="noopener">{p.repo.split('/')[1]}#{p.number}</a>
          {#if p.merged_at}
            <span class="rtag fw-merged">{m().mergedIn(board.mergedIn((p.linked ?? []).find((l) => l.repo === p.repo && l.number === p.number)?.branch || f.version, p.merged_at))}</span>
            <span class="text-xs text-muted-foreground">{shortDate(p.merged_at)}</span>
          {:else if p.state === 'closed'}
            <span class="rtag fw-closed">{m().status.closed}</span>
          {:else}
            <span class="rtag {p.draft ? 'comment' : 'rplus'}">{m().status[p.draft ? 'draft' : 'open']}</span>
            {#if checks.length}
              <span class="rtag cursor-help {failed.length ? 'fw-blocked' : running ? 'fw-open' : 'fw-merged'}" {@attach tooltip(ciDetail)}>
                {failed.length ? w.ci.failed(failed.join(', ')) : running ? w.ci.running : w.ci.ok}
              </span>
            {/if}
            <span class="rtag {hasRplus(p) ? 'validation' : 'comment'}">{hasRplus(p) ? w.rGiven : w.rMissing}</span>
            {#if p.phase}<span class="text-xs text-muted-foreground">{p.phase}</span>{/if}
          {/if}
          {#if p.mergebot_url}<a class="ml-auto text-xs text-link" href={p.mergebot_url} target="_blank" rel="noopener">mergebot</a>{/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-2 text-[13px] text-muted-foreground">{m().status.wip}</p>
  {/if}
  {#if chain.length}
    <div class="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span class="mr-1">{w.ports}</span>{#each chain as step (step.branch)}<PortTag {step} />{/each}
    </div>
  {:else if f.merged_at && f.version !== 'master' && !portsStopped(f.merged_at)}
    <p class="mt-2 text-xs text-muted-foreground">{w.portsNone}</p>
  {/if}
</div>
