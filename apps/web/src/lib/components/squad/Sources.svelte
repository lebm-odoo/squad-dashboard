<script lang="ts">
import { fdate, personName, rel } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { type Feat, lastActivity, type Rev, reviewUrl } from '#lib/squad/model.ts';

let { items }: { items: (Feat | Rev)[] } = $props();
</script>

<details class="mt-0.5 text-xs">
  <summary class="w-fit cursor-pointer text-muted-foreground hover:text-foreground">{m().journey.sources(items.length)}</summary>
  <ul class="mt-1 mb-0.5">
    {#each items.slice(0, 15) as x, index (index)}
      <li class="border-b py-1 [overflow-wrap:anywhere]">
        {#if 'reviewer' in x}
          <a class="text-link" href={reviewUrl(x)} target="_blank" rel="noopener">{x.pr.replace(/^odoo\//, '')}</a>
          {x.subject}<span class="text-muted-foreground">{m().journey.sourceReview(fdate(x.t), personName(x.author))}</span>
        {:else}
          {#if x.prs[0]}<a class="text-link" href={x.prs[0].url} target="_blank" rel="noopener">{x.title || x.name}</a>{:else}{x.title || x.name}{/if}
          <span class="text-muted-foreground">
            {x.merged_at ? m().journey.sourceMerged(fdate(x.merged_at)) : m().journey.sourceActive(m().status[x.status] ?? x.status, rel(lastActivity(x)))}
          </span>
        {/if}
      </li>
    {/each}
    {#if items.length > 15}<li class="text-muted-foreground">{m().journey.more(items.length - 15)}</li>{/if}
  </ul>
</details>
