<script lang="ts">
import TodoDialog from '#lib/components/board/TodoDialog.svelte';
import Loading from '#lib/components/shell/Loading.svelte';
import Work from '#lib/components/squad/Work.svelte';
import { m } from '#lib/i18n.svelte.ts';
import { setParams } from '#lib/links.ts';
import { squadQuery } from '#lib/squad/query.svelte.ts';
import { goto } from '$app/navigation';
import { page } from '$app/state';

const query = squadQuery();
const params = $derived(page.url.searchParams);
// My work is Moi's: a link to it from anywhere lands there.
$effect(() => {
  if (!query.data || params.get('who') !== query.data.me) return;
  const mine = new URL(page.url.href);
  mine.pathname = '/me/work';
  mine.searchParams.delete('who');
  void goto(mine, { replaceState: true });
});
</script>

{#if query.isPending}
  <Loading label={m().me.loading} shape="work" />
{:else if query.isError}
  <p class="text-critical">{query.error.message}</p>
{:else if query.data}
  {@const board = query.data}
  <Work
    {board}
    params={{
      who: board.everyone.includes(params.get('who') ?? '') ? params.get('who') : null,
      period: params.get('period'),
      role: params.get('role') ?? 'all',
      status: params.get('status') ?? 'all',
      mode: params.get('mode') ?? 'list',
      reviewer: params.get('reviewer'),
      feature: params.get('feature'),
    }}
    set={(changes, push) => setParams(page.url, changes, push)}
  />
  <TodoDialog {board} />
{/if}
