<script lang="ts">
import { openDetail } from '#lib/detail.ts';
import { m } from '#lib/i18n.svelte.ts';
import type { Task } from '#lib/squad/types.ts';
import Line from './Line.svelte';
import TaskTag from './TaskTag.svelte';
import TaskTip from './TaskTip.svelte';

let { t, meta, note }: { t: Task; meta: string; note: string } = $props();
</script>

{#snippet tip()}<TaskTip {t} {note} action={m().tip.openCard} />{/snippet}

<Line onopen={() => openDetail('task', String(t.id))} {tip}>
  <span class="ico task">▢</span>
  <span class="txt">{t.name}</span>
  <TaskTag {t} short />
  <span class="meta">{meta}</span>
</Line>
