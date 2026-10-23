<script lang="ts">
import { age, personName } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import type { Task } from '#lib/squad/types.ts';
import { taskReviewers } from '#lib/squad/unit.ts';

let { t, note = null, action }: { t: Task; note?: string | null; action?: string } = $props();
const reviewers = $derived(taskReviewers(t));
</script>

<div class="font-semibold">{t.name}</div>
<div class="text-muted-foreground">{m().tip.task(t.id, t.project)}</div>
<div>{m().tip.taskStage(t.stage || 'No stage', m().taskStates[t.state] ?? t.state, t.stage_since ? age(t.stage_since) : null)}</div>
{#if t.people.length}<div class="text-muted-foreground">{m().tip.assigned(t.people.map(personName).join(', '))}</div>{/if}
{#if reviewers.length}<div class="text-muted-foreground">{m().tip.reviewer(reviewers.map(personName).join(', '))}</div>{/if}
{#if t.tags.length}<div class="text-muted-foreground">{t.tags.join(' · ')}</div>{/if}
{#if note}<div>{note}</div>{/if}
<div class="text-muted-foreground">{action ?? m().tip.openOdoo}</div>
