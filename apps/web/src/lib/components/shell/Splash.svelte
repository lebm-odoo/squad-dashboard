<script lang="ts">
import { onMount } from 'svelte';
import { prefersReducedMotion } from 'svelte/motion';
import { fade } from 'svelte/transition';
import { m } from '#lib/i18n.svelte.ts';
import { setupQuery } from '#lib/setup.svelte.ts';
import { splash, splashSeen } from '#lib/splash.svelte.ts';
import Mark from './Mark.svelte';

/** The dashboard opening: its mark draws itself, then the screen fades out on the page once the page knows what to show. */
const setup = setupQuery();
let played = $state(false);
onMount(() => {
  if (!splash.open) return;
  splashSeen();
  const timer = setTimeout(() => (played = true), prefersReducedMotion.current ? 300 : 1800);
  return () => clearTimeout(timer);
});
$effect(() => {
  if (played && !setup.isPending) splash.open = false;
});
</script>

{#if splash.open}
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-background"
    role="status"
    aria-label={m().brand}
    out:fade={{ duration: prefersReducedMotion.current ? 0 : 450 }}
  >
    <div class="glow" aria-hidden="true"></div>
    <div class="relative flex flex-col items-center gap-6">
      <Mark class="size-24 drop-shadow-xl" />
      <div class="text-center">
        <p class="name bg-linear-to-r from-brand to-brand-2 bg-clip-text text-4xl font-bold tracking-tight text-transparent">{m().brand}</p>
        <p class="tagline mt-2 text-sm text-muted-foreground">{m().tagline}</p>
      </div>
    </div>
  </div>
{/if}

<style>
  .glow {
    position: absolute;
    width: 28rem;
    height: 28rem;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--brand) 22%, transparent), transparent 65%);
    filter: blur(24px);
    animation: glow 1.4s ease-out both;
  }
  .name {
    animation: rise 0.6s 0.55s ease-out both;
  }
  .tagline {
    animation: rise 0.6s 0.85s ease-out both;
  }
  @keyframes glow {
    from {
      opacity: 0;
      transform: scale(0.4);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .glow,
    .name,
    .tagline {
      animation: none;
    }
  }
</style>
