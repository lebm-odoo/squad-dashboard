<script lang="ts">
import { onMount } from 'svelte';
import { prefersReducedMotion } from 'svelte/motion';
import { fade, fly } from 'svelte/transition';
import VaultForm from '#lib/components/settings/VaultForm.svelte';
import { m } from '#lib/i18n.svelte.ts';
import { setupQuery } from '#lib/setup.svelte.ts';
import { splash, splashSeen } from '#lib/splash.svelte.ts';
import Mark from './Mark.svelte';

/**
 * The dashboard opening: its mark draws itself, then the screen fades out on the page once the page knows what to show.
 * Docker's vault locks at each restart: the screen then stays, or comes back, and asks its passphrase.
 */
const setup = setupQuery();
const vault = $derived(setup.data?.vault);
const locked = $derived(!!vault?.exists && vault.locked);
let played = $state(!splash.open);
onMount(() => {
  if (!splash.open) return;
  splashSeen();
  const timer = setTimeout(() => (played = true), prefersReducedMotion.current ? 300 : 1800);
  return () => clearTimeout(timer);
});
$effect(() => {
  if (played && !setup.isPending && !locked) splash.open = false;
});
</script>

{#if splash.open || locked}
  <div
    class="fixed inset-0 z-50 grid place-items-center bg-background px-4"
    role={locked ? 'dialog' : 'status'}
    aria-modal={locked ? 'true' : undefined}
    aria-label={m().brand}
    in:fade={{ duration: splash.open || prefersReducedMotion.current ? 0 : 250 }}
    out:fade={{ duration: prefersReducedMotion.current ? 0 : 450 }}
  >
    <div class="glow" aria-hidden="true"></div>
    <div class="relative flex flex-col items-center gap-6">
      <Mark class="size-24 drop-shadow-xl" />
      <div class="text-center">
        <p class="name bg-linear-to-r from-brand to-brand-2 bg-clip-text text-4xl font-bold tracking-tight text-transparent">{m().brand}</p>
        <p class="tagline mt-2 text-sm text-muted-foreground">{m().tagline}</p>
      </div>
      {#if vault && locked && played}
        <div class="grid max-w-md gap-3 text-center" in:fly={{ y: 8, duration: prefersReducedMotion.current ? 0 : 350 }}>
          <p class="text-sm text-muted-foreground">{m().locked}</p>
          <VaultForm status={vault} autofocus class="justify-center" />
        </div>
      {/if}
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
