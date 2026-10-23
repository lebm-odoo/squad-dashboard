<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import CircleDot from '@lucide/svelte/icons/circle-dot';
import Pause from '@lucide/svelte/icons/pause';
import PencilLine from '@lucide/svelte/icons/pencil-line';
import ThumbsUp from '@lucide/svelte/icons/thumbs-up';
import X from '@lucide/svelte/icons/x';
import type { Component } from 'svelte';
import { m } from '#lib/i18n.svelte.ts';
import { stageLabel, type TaskHow, taskUrl, validated } from '#lib/squad/model.ts';
import type { Task } from '#lib/squad/types.ts';
import { tooltip } from '#lib/tip.svelte.ts';
import TaskTip from './TaskTip.svelte';

let { t, short = false, how }: { t: Task; short?: boolean; how?: TaskHow } = $props();
const looks: Record<string, [Component, string]> = {
  '01_in_progress': [CircleDot, ''],
  '02_changes_requested': [PencilLine, 'changes'],
  '03_approved': [Check, 'validation'],
  '04_waiting_normal': [Pause, 'comment'],
  tober: [ThumbsUp, 'tober'],
  '1_done': [Check, 'fw-merged'],
  '1_canceled': [X, 'fw-closed'],
};
const state = $derived(t.state === '01_in_progress' && validated(t) ? 'tober' : t.state);
const [Icon, tone] = $derived(looks[state] ?? [CircleDot, '']);
const guess = $derived(how === 'guess');
</script>

{#snippet tip()}<TaskTip {t} note={guess ? m().tip.guess(t.id) : null} />{/snippet}

<a
  class="rtag {tone}"
  class:guess
  href={taskUrl(t.id)}
  target="_blank"
  rel="noopener"
  onclick={(event) => event.stopPropagation()}
  {@attach tooltip(tip)}
>
  <Icon class="size-3" />{stageLabel(t.stage)}{short ? '' : ` · ${m().taskStates[state] ?? state}`}{guess ? ' ⚠' : ''}
</a>
