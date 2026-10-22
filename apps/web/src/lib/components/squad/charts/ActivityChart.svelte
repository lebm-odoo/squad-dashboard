<script lang="ts" module>
export type ActivityRow = { m: number; partial: boolean; code: number; reviews: number; merged: number; long: string };
</script>

<script lang="ts">
import ColumnChart from '#lib/components/charts/ColumnChart.svelte';
import { monthYear } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';

let { rows, color }: { rows: ActivityRow[]; color: string } = $props();
const data = $derived(rows.map((r) => ({ ...r, date: new Date(r.m * 1000) })));
const light = $derived(`color-mix(in srgb, ${color} 38%, var(--card))`);
// One label per month, under its first slot.
const ticks = $derived(data.filter((r, i) => !i || data[i - 1]?.date.getMonth() !== r.date.getMonth()).map((r) => r.date));
const format = (d: unknown) => monthYear((d as Date).getTime() / 1000);
const header = (d: unknown) => rows.find((r) => r.m * 1000 === (d as Date).getTime())?.long ?? format(d);
</script>

<ColumnChart
  {data}
  x="date"
  series={[
    { key: 'code', label: m().journey.legendCode, color },
    { key: 'reviews', label: m().journey.legendReviews, color: light },
  ]}
  height={240}
  {format}
  {ticks}
  {header}
/>
<div class="mt-2">
  <ColumnChart {data} x="date" series={[{ key: 'merged', label: m().journey.legendMerged, color: 'var(--good)' }]} height={90} {format} {ticks} {header} />
</div>
