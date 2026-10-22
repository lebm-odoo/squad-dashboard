<script lang="ts">
import TodoDialog from '#lib/components/board/TodoDialog.svelte';
import Loading from '#lib/components/shell/Loading.svelte';
import Journey from '#lib/components/squad/Journey.svelte';
import { m } from '#lib/i18n.svelte.ts';
import { myJourneyHref, setParams } from '#lib/links.ts';
import { squadQuery } from '#lib/squad/query.svelte.ts';
import { goto } from '$app/navigation';
import { page } from '$app/state';

const query = squadQuery();
// My journey is Moi's: a link to it from anywhere lands there.
$effect(() => {
  if (query.data && page.url.searchParams.get('who') === query.data.me)
    void goto(myJourneyHref(page.url.searchParams.get('window') ?? undefined), { replaceState: true });
});
</script>

{#if query.isPending}
  <Loading label={m().me.loading} shape="journey" />
{:else if query.isError}
  <p class="text-critical">{query.error.message}</p>
{:else if query.data}
  <Journey
    board={query.data}
    who={page.url.searchParams.get('who')}
    window={page.url.searchParams.get('window') ?? '182'}
    set={(changes) => setParams(page.url, changes, 'who' in changes)}
  />
  <TodoDialog board={query.data} />
{/if}
