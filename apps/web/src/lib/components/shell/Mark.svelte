<script lang="ts">
/** The favicon's mark: its tile pops in and its S draws itself once, or traces it again and again while a page loads. */
let { loop = false, class: className = '' }: { loop?: boolean; class?: string } = $props();
const id = $props.id();
</script>

<svg class={['mark', loop && 'loop', className]} viewBox="0 0 32 32" aria-hidden="true">
  <defs>
    <linearGradient id="{id}-tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a78d6" />
      <stop offset="1" stop-color="#7a4fe0" />
    </linearGradient>
    <linearGradient id="{id}-shine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0" />
      <stop offset="0.5" stop-color="#fff" stop-opacity="0.5" />
      <stop offset="1" stop-color="#fff" stop-opacity="0" />
    </linearGradient>
    <clipPath id="{id}-clip"><rect width="32" height="32" rx="7" /></clipPath>
  </defs>
  <g class="tile">
    <rect width="32" height="32" rx="7" fill="url(#{id}-tile)" />
    <path
      class="s"
      d="M21.5 7.5H13.25a4.25 4.25 0 0 0 0 8.5h5.5a4.25 4.25 0 0 1 0 8.5H10.5"
      pathLength="1"
      fill="none"
      stroke="#fff"
      stroke-width="4.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <g clip-path="url(#{id}-clip)">
      <g transform="rotate(20 16 16)"><rect class="shine" x="-24" y="-8" width="12" height="48" fill="url(#{id}-shine)" /></g>
    </g>
  </g>
</svg>

<style>
  .tile {
    transform-box: fill-box;
    transform-origin: center;
    animation: pop 0.6s cubic-bezier(0.3, 0.7, 0.4, 1) both;
  }
  .s {
    stroke-dasharray: 1;
    animation: draw 0.7s 0.25s ease-in-out both;
  }
  .shine {
    animation: shine 0.9s 0.9s ease-in-out both;
  }
  :global(a:hover) .mark .shine {
    animation: shine-again 0.9s ease-in-out both;
  }
  .loop .tile {
    animation: breathe 1.6s ease-in-out infinite;
  }
  .loop .s {
    animation: trace 1.6s ease-in-out infinite;
  }
  .loop .shine {
    animation: shine 1.6s 0.5s ease-in-out infinite;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.4) rotate(-20deg);
    }
    60% {
      opacity: 1;
      transform: scale(1.08) rotate(4deg);
    }
    to {
      transform: none;
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes trace {
    from {
      stroke-dashoffset: 1;
    }
    45%,
    70% {
      stroke-dashoffset: 0;
    }
    to {
      stroke-dashoffset: -1;
    }
  }
  @keyframes breathe {
    50% {
      transform: scale(0.92) rotate(-4deg);
    }
  }
  @keyframes shine {
    to {
      transform: translateX(72px);
    }
  }
  @keyframes shine-again {
    to {
      transform: translateX(72px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tile,
    .s,
    .shine {
      animation: none !important;
    }
  }
</style>
