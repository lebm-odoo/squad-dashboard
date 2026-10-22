<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import CircleAlert from '@lucide/svelte/icons/circle-alert';
import Hourglass from '@lucide/svelte/icons/hourglass';
import X from '@lucide/svelte/icons/x';
import { m } from '#lib/i18n.svelte.ts';
import type { Step } from '#lib/squad/model.ts';

let { step, title }: { step: Step; title?: string } = $props();
const looks = {
  merged: ['fw-merged', Check],
  open: ['fw-open', Hourglass],
  blocked: ['fw-blocked', CircleAlert],
  closed: ['fw-closed', X],
} as const;
const [tone, Icon] = $derived(looks[step.state]);
const hint = $derived(`${title || step.branch}: ${m().ports[step.state]}${step.prs ? ` (${step.prs.join(', ')})` : ''}`);
</script>

{#if step.urls?.[0]}
  <a class="rtag {tone}" title={hint} href={step.urls[0]} target="_blank" rel="noopener" onclick={(event) => event.stopPropagation()}><Icon class="size-3" />{step.branch}</a>
{:else}
  <span class="rtag {tone}" title={hint}><Icon class="size-3" />{step.branch}</span>
{/if}
