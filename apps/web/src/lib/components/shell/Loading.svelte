<script lang="ts">
import Mark from './Mark.svelte';

type Shape = 'desk' | 'work' | 'journey' | 'squad' | 'settings' | 'card';

/**
 * A page being read, in its own shape: its cards, tables and charts as bones under one sheen of the brand's colours, the
 * mark tracing its S where the title goes.
 */
let { label, shape }: { label: string; shape: Shape } = $props();
const heights = [34, 52, 44, 70, 58, 82, 64, 46, 76, 92, 68, 54, 72, 86, 60, 78, 50, 66];
const card = 'rounded-xl border bg-card p-4 shadow-xs';
</script>

{#snippet bone(cls: string, tint = '')}
  <div class={['bone', tint, cls]}></div>
{/snippet}

{#snippet heading(sub = true)}
  <div class="flex flex-col gap-2.5">
    <div class="flex items-center gap-3">
      <Mark loop class="size-8 flex-none" />
      <span class="label text-sm font-medium">{label}</span>
    </div>
    {#if sub}{@render bone('h-3 w-96 max-w-full')}{/if}
  </div>
{/snippet}

{#snippet stats(n: number)}
  <div class="grid gap-3" style:grid-template-columns="repeat(auto-fit, minmax(8rem, 1fr))">
    {#each { length: n }, i}
      <div class="{card} flex flex-col gap-2.5">
        {@render bone('h-3 w-20')}
        {@render bone('h-7 w-14', i % 2 ? 'brand-2' : 'brand')}
        {@render bone('h-2.5 w-28 max-w-full')}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet title()}
  {@render bone('h-3.5 w-44')}
  {@render bone('mt-2 h-2.5 w-72 max-w-full')}
{/snippet}

{#snippet chart(bars = 16, cls = '')}
  <div class="{card} {cls}">
    {@render title()}
    <div class="mt-5 flex h-36 items-end gap-1.5">
      {#each heights.slice(0, bars) as h, i}
        <div class={['bone flex-1 rounded-b-none', i % 3 === 2 ? 'brand-2' : 'brand']} style:height="{h}%"></div>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet list(rows: number, tabs = false)}
  <div class={card}>
    <div class="flex flex-wrap items-center gap-3">
      {@render bone('h-4 w-28')}
      {#if tabs}{@render bone('h-8 w-56 rounded-lg')}{/if}
    </div>
    <div class="mt-4 grid gap-3.5">
      {#each { length: rows }, i}
        <div class="flex items-center gap-3">
          {@render bone('size-7 flex-none rounded-full', ['brand', 'brand-2', ''][i % 3])}
          <div class="grid flex-1 gap-1.5">
            {@render bone(['h-3 w-3/5', 'h-3 w-1/2', 'h-3 w-2/3'][i % 3])}
            {@render bone('h-2.5 w-2/5')}
          </div>
          {@render bone('h-5 w-16 flex-none rounded-md')}
        </div>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet table(rows: number, cols: number, tools = true)}
  <div class={card}>
    {#if tools}
      <div class="mb-4 flex flex-wrap items-center gap-2">
        {@render bone('h-8 w-40 rounded-md')}
        {@render bone('h-8 w-28 rounded-md')}
        <div class="ml-auto flex gap-2">{@render bone('h-8 w-16 rounded-md')}{@render bone('h-8 w-24 rounded-md')}</div>
      </div>
    {/if}
    <div class="overflow-hidden rounded-lg border">
      <div class="flex gap-4 border-b bg-muted/40 px-3 py-3">
        {@render bone('h-3 w-2/5')}
        {#each { length: cols - 1 }}{@render bone('h-3 flex-1')}{/each}
      </div>
      {#each { length: rows }, i}
        <div class="flex items-center gap-4 border-b px-3 py-3 last:border-0">
          <div class="grid w-2/5 gap-1.5">
            {@render bone(['h-3 w-4/5', 'h-3 w-3/5', 'h-3 w-2/3'][i % 3])}
            {@render bone('h-2.5 w-2/5')}
          </div>
          {#each { length: cols - 1 }, j}
            {@render bone('h-4 flex-1 rounded-md', j === 0 ? ['brand', 'brand-2'][i % 2] : '')}
          {/each}
        </div>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet text(lines: number, cls = '')}
  <div class="{card} {cls}">
    {@render bone('h-3.5 w-44')}
    <div class="mt-4 grid gap-2.5">
      {#each { length: lines }, i}{@render bone(['h-2.5 w-full', 'h-2.5 w-11/12', 'h-2.5 w-4/5', 'h-2.5 w-3/5'][i % 4])}{/each}
    </div>
  </div>
{/snippet}

{#snippet form()}
  <div class={card}>
    {@render title()}
    {@render bone('mt-5 h-3 w-24')}
    {@render bone('mt-2 h-9 w-full max-w-md rounded-md')}
    {@render bone('mt-2 h-2.5 w-56')}
  </div>
{/snippet}

<div class="flex flex-col gap-4" role="status">
  {#if shape === 'desk'}
    {@render heading()}
    {@render stats(5)}
    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {@render list(8, true)}
      <div class="grid gap-4">{@render list(3)}{@render text(3)}</div>
    </div>
  {:else if shape === 'work'}
    {@render heading()}
    {@render table(8, 5)}
  {:else if shape === 'journey'}
    {@render heading()}
    {@render stats(5)}
    {@render text(6)}
    {@render chart(18)}
    <div class="grid gap-4 md:grid-cols-3">{@render chart(8)}{@render chart(8)}{@render chart(8)}</div>
  {:else if shape === 'squad'}
    {@render heading(false)}
    {@render stats(4)}
    {@render table(6, 4, false)}
    <div class="grid items-start gap-4 lg:grid-cols-2">{@render list(6, true)}{@render list(6)}</div>
  {:else if shape === 'settings'}
    {@render heading()}
    {@render bone('h-9 w-[30rem] max-w-full rounded-lg')}
    {@render form()}
    {@render form()}
  {:else}
    {@render heading(false)}
    {@render text(3)}
    {@render table(3, 4, false)}
    {@render text(4)}
  {/if}
</div>

<style>
  .label {
    background: linear-gradient(
        90deg,
        var(--muted-foreground) 35%,
        var(--brand) 47%,
        var(--brand-2) 53%,
        var(--muted-foreground) 65%
      )
      0 0 / 300% 100%;
    background-clip: text;
    color: transparent;
    animation: sweep 2s linear infinite;
  }
  /* One sheen across the whole page: fixed to the viewport, it passes through every bone at once. */
  .bone {
    --tint: var(--muted);
    border-radius: 0.375rem;
    background:
      linear-gradient(
          100deg,
          transparent 30%,
          color-mix(in srgb, var(--brand) 20%, transparent) 45%,
          color-mix(in srgb, var(--brand-2) 20%, transparent) 55%,
          transparent 70%
        )
        fixed 0 0 / 250vw 100vh,
      var(--tint);
    animation: sheen 2.2s ease-in-out infinite;
  }
  .bone.brand {
    --tint: color-mix(in srgb, var(--brand) 22%, var(--muted));
  }
  .bone.brand-2 {
    --tint: color-mix(in srgb, var(--brand-2) 22%, var(--muted));
  }
  @keyframes sweep {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: 0 0;
    }
  }
  @keyframes sheen {
    from {
      background-position: 100vw 0;
    }
    to {
      background-position: -150vw 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .label {
      background: none;
      color: var(--muted-foreground);
    }
    .label,
    .bone {
      animation: none;
    }
  }
</style>
