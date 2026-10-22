<script lang="ts">
import { AreaChart } from 'layerchart';
import { monthYear } from '#lib/format.ts';
import type { ActivityRow } from './ActivityChart.svelte';

let { rows, defs }: { rows: ActivityRow[]; defs: ['merged' | 'reviews', string, string][] } = $props();
// Running totals, one column per series, as the area chart reads them.
const data = $derived.by(() => {
  const totals = Object.fromEntries(defs.map(([key]) => [key, 0]));
  return rows.map((r) => {
    for (const [key] of defs) totals[key] = (totals[key] ?? 0) + r[key];
    return { date: new Date(r.m * 1000), ...totals };
  });
});
</script>

<div class="h-64">
  <AreaChart
    {data}
    x="date"
    series={defs.map(([key, label, color]) => ({ key, label, color }))}
    legend
    props={{
      xAxis: {
        format: (d: Date) => monthYear(d.getTime() / 1000),
        ticks: data.filter((r, i) => !i || data[i - 1]?.date.getMonth() !== r.date.getMonth()).map((r) => r.date),
        tickOcclusion: true,
      },
      area: { fillOpacity: 0.15 },
    }}
  />
</div>
