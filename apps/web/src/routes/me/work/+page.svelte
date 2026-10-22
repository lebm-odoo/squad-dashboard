<script lang="ts">
import TodoDialog from '#lib/components/board/TodoDialog.svelte';
import Loading from '#lib/components/shell/Loading.svelte';
import Work from '#lib/components/squad/Work.svelte';
import { m } from '#lib/i18n.svelte.ts';
import { setParams } from '#lib/links.ts';
import { squadQuery } from '#lib/squad/query.svelte.ts';
import { page } from '$app/state';

const query = squadQuery();
const params = $derived(page.url.searchParams);
</script>

{#if query.isPending}
  <Loading label={m().me.loading} shape="work" />
{:else if query.isError}
  <p class="text-critical">{query.error.message}</p>
{:else if query.data}
  {@const board = query.data}
  <Work
    {board}
    mine
    params={{
      who: board.me,
      period: params.get('period'),
      role: params.get('role') ?? 'all',
      status: params.get('status') ?? 'all',
      mode: params.get('mode') ?? 'list',
      reviewer: params.get('reviewer'),
      feature: params.get('feature'),
    }}
    set={({ who, ...changes }, push) => setParams(page.url, changes, push)}
  />
  <TodoDialog {board} />
{/if}
