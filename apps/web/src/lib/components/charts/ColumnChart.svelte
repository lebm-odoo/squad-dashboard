<script lang="ts" module>
export type Series = { key: string; label: string; color: string };
</script>

<script lang="ts" generics="R extends Record<string, unknown>">
import { BarChart } from 'layerchart';
import * as Chart from '#lib/components/ui/chart/index.ts';
import { fmt } from '#lib/format.ts';

/**
 * Columns by time slot or by category, one series or several stacked; a tooltip lists every series of the column hovered,
 * a legend names them from two on.
 */
let {
  data,
  x,
  series,
  height = 220,
  stacked = true,
  format,
  ticks,
  header,
  value = fmt,
  onclick,
}: {
  data: R[];
  x: keyof R & string;
  series: Series[];
  height?: number;
  stacked?: boolean;
  /** The text under a column. */
  format?: (x: R[keyof R]) => string;
  ticks?: unknown[];
  /** The title of a column's tooltip, from the value of its x. */
  header?: (x: R[keyof R]) => string;
  value?: (v: number) => string;
  onclick?: (row: R) => void;
} = $props();
const config = $derived(Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])));
// Small counts get whole ticks: halves would round to the same label twice.
const top = $derived(Math.max(0, ...data.map((row) => series.reduce((total, s) => total + (Number(row[s.key]) || 0), 0))));
const yTicks = $derived(top && top <= 6 ? Array.from({ length: Math.ceil(top) + 1 }, (_, i) => i) : undefined);
</script>

<Chart.Container config={config} class="aspect-auto w-full" style="height: {height}px">
  <BarChart
    {data}
    {x}
    {series}
    seriesLayout={stacked && series.length > 1 ? 'stack' : 'group'}
    bandPadding={0.25}
    legend={series.length > 1}
    onBarClick={onclick ? (_event, detail) => onclick(detail.data as R) : undefined}
    props={{
      bars: { radius: 3, rounded: 'edge', strokeWidth: 0, stroke: 'none' },
      xAxis: { format: format as (v: unknown) => string, ticks: ticks as never, tickOcclusion: true },
      yAxis: { format: (v: number) => value(v), ticks: yTicks as never },
      tooltip: { header: { format: (header ?? format) as never }, item: { format: ((v: number) => value(v)) as never } },
    }}
  />
</Chart.Container>
