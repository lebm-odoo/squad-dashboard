<script lang="ts">
import Copy from '@lucide/svelte/icons/copy';
import ExternalLink from '@lucide/svelte/icons/external-link';
import { toast } from 'svelte-sonner';
import { m } from '#lib/i18n.svelte.ts';

/** How to get a GitHub token or an Odoo key: the command to run, or the page where to make one. */
let { kind }: { kind: 'github' | 'odoo' } = $props();
const words = $derived(m().settings.connections.help);

async function copy(command: string) {
  await navigator.clipboard.writeText(command).then(
    () => toast.success(words.copied),
    () => toast.error(command),
  );
}
</script>

{#snippet command(text: string)}
  <span class="inline-flex max-w-full items-center gap-1 rounded-md bg-muted py-0.5 pr-1 pl-2 font-mono text-[12.5px]">
    <span class="truncate">{text}</span>
    <button class="cursor-pointer rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" title={words.copy} aria-label={words.copy} onclick={() => copy(text)}>
      <Copy class="size-3.5" />
    </button>
  </span>
{/snippet}

{#snippet link(href: string, text: string)}
  <a class="inline-flex items-center gap-1 text-link" {href} target="_blank" rel="noopener">{text}<ExternalLink class="size-3.5" /></a>
{/snippet}

<div class="grid gap-1.5 text-[13px] text-foreground/80">
  {#if kind === 'github'}
    <p>{words.github.gh}</p>
    <div>{@render command('gh auth login --scopes read:org')}</div>
    <p>{words.github.refresh}</p>
    <div>{@render command('gh auth refresh --scopes read:org')}</div>
    <p>
      {words.github.web}
      {@render link('https://github.com/settings/tokens/new?description=Dashboard&scopes=repo,read:org', words.github.webLink)}
    </p>
    <p class="text-xs text-muted-foreground">{words.github.sso}</p>
  {:else}
    <p>{words.odoo.steps} {@render link('https://www.odoo.com/odoo', words.odoo.link)}</p>
  {/if}
</div>
