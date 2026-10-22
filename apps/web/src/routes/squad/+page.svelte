<script lang="ts">
import TodoDialog from '#lib/components/board/TodoDialog.svelte';
import Loading from '#lib/components/shell/Loading.svelte';
import SquadBoard from '#lib/components/squad/SquadBoard.svelte';
import { m } from '#lib/i18n.svelte.ts';
import { squadQuery } from '#lib/squad/query.svelte.ts';

const query = squadQuery();
</script>

{#if query.isPending}
  <Loading label={m().me.loading} shape="squad" />
{:else if query.isError}
  <p class="text-critical">{query.error.message}</p>
{:else if query.data}
  <SquadBoard board={query.data} />
  <TodoDialog board={query.data} />
{/if}
