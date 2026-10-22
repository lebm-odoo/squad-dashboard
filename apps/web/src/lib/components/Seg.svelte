<script lang="ts">
let {
  options,
  value = $bindable(),
  label,
  onchange,
}: { options: [string, string][]; value: string; label: string; onchange?: (value: string) => void } = $props();
</script>

<div class="inline-flex overflow-hidden rounded-lg border bg-card" role="group" aria-label={label}>
  {#each options as [option, text], index (option)}
    <button
      class="cursor-pointer px-2.5 py-[5px] text-[13px] text-foreground/70 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
      class:border-l={index > 0}
      aria-pressed={value === option}
      onclick={() => {
        value = option;
        onchange?.(option);
      }}>{text}</button
    >
  {/each}
</div>
