<script lang="ts">
import { m } from '#lib/i18n.svelte.ts';
import Mark from './Mark.svelte';
</script>

<!-- In a span: the sidebar's buttons shrink the icons they hold directly. -->
<span class="grid size-8 flex-none place-items-center"><Mark class="size-8" /></span>
<span class="name truncate bg-linear-to-r from-brand to-brand-2 bg-clip-text font-bold text-transparent">{m().brand}</span>

<style>
  .name {
    animation: rise 0.5s 0.35s ease-out both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateX(-6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .name {
      animation: none;
    }
  }
</style>
