<script lang="ts">
import TodoDialog from '#lib/components/board/TodoDialog.svelte';
import Loading from '#lib/components/shell/Loading.svelte';
import Journey from '#lib/components/squad/Journey.svelte';
import { m } from '#lib/i18n.svelte.ts';
import { setParams } from '#lib/links.ts';
import { squadQuery } from '#lib/squad/query.svelte.ts';
import { page } from '$app/state';

const query = squadQuery();
</script>

{#if query.isPending}
  <Loading label={m().me.loading} shape="journey" />
{:else if query.isError}
  <p class="text-critical">{query.error.message}</p>
{:else if query.data}
  <Journey
    board={query.data}
    mine
    who={query.data.me}
    window={page.url.searchParams.get('window') ?? '182'}
    set={({ who, ...changes }) => setParams(page.url, changes)}
  />
  <TodoDialog board={query.data} />
{/if}
