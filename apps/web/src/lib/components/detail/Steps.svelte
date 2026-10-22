<script lang="ts" module>
export type Step = { key: string; state: 'done' | 'now' | 'blocked' | 'todo'; note?: string };
</script>

<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import { prefersReducedMotion } from 'svelte/motion';
import { scale } from 'svelte/transition';

/** Where a piece of work stands, as a row of steps: done, under way, stuck, or still ahead. */
let { steps, labels }: { steps: Step[]; labels: Record<string, string> } = $props();
const colors = { done: 'var(--good)', now: 'var(--link)', blocked: 'var(--critical)', todo: 'var(--border)' };
</script>

<ol class="grid gap-1" style:grid-template-columns="repeat({steps.length}, minmax(0, 1fr))">
  {#each steps as step, i (step.key)}
    <li class="relative flex min-w-0 flex-col items-center px-0.5 text-center">
      {#if i}
        <!-- From the previous circle's edge to this one's, a gap on each side: the circles are 1.5rem, the columns 0.25rem apart. -->
        <span
          class="absolute top-3 right-[calc(50%+1rem)] h-0.5 w-[calc(100%-1.75rem)] -translate-y-1/2 rounded-full transition-colors duration-500"
          style:background={steps[i - 1]?.state === 'done' ? colors.done : 'var(--border)'}
        ></span>
      {/if}
      <span
        class="relative grid size-6 place-items-center rounded-full border-2 bg-card"
        style:border-color={colors[step.state]}
        style:background={step.state === 'done' ? colors.done : step.state === 'blocked' ? `color-mix(in srgb, ${colors.blocked} 14%, var(--card))` : null}
        in:scale={{ start: 0.6, duration: prefersReducedMotion.current ? 0 : 260, delay: prefersReducedMotion.current ? 0 : i * 45 }}
      >
        {#if step.state === 'done'}
          <Check class="size-3.5 text-white" strokeWidth={3} />
        {:else if step.state === 'now'}
          <span class="absolute size-full animate-ping rounded-full bg-link/30 motion-reduce:animate-none"></span>
          <span class="size-2 rounded-full bg-link"></span>
        {:else if step.state === 'blocked'}
          <span class="text-[12px] leading-none font-bold text-critical">!</span>
        {/if}
      </span>
      <span class="mt-1.5 text-xs font-medium" class:text-muted-foreground={step.state === 'todo'}>{labels[step.key] ?? step.key}</span>
      {#if step.note}<span class="line-clamp-2 text-[11px] leading-tight text-muted-foreground">{step.note}</span>{/if}
    </li>
  {/each}
</ol>
