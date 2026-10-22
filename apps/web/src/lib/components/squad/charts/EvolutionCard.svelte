<script lang="ts" module>
export type MonthRow = { m: number; partial: boolean } & Record<string, number | boolean | null>;
</script>

<script lang="ts">
import { LineChart } from 'layerchart';
import { monthYear } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { sum } from '#lib/squad/model.ts';

/** One measure month by month: the months as a faint line, their 3-month average as the strong one; a dip is grey, never red. */
let {
  rows,
  title,
  unit,
  value,
  show,
  ratio,
}: {
  rows: MonthRow[];
  title: string;
  unit: string;
  value: (r: MonthRow) => number | null;
  show: (v: number | null) => string;
  ratio?: [string, string];
} = $props();
const data = $derived(rows.map((r): MonthRow & { v: number | null } => ({ ...r, v: value(r) })));
const known = $derived(data.filter((r) => r.v != null && !r.partial));
const avg = (list: typeof data) => {
  if (!ratio) return list.length ? sum(list.map((r) => r.v)) / list.length : null;
  const den = sum(list.map((r) => r[ratio[1]] as number));
  return den ? (sum(list.map((r) => r[ratio[0]] as number)) / den) * 100 : null;
};
const points = $derived(
  data.map((r, i) => ({
    date: new Date(r.m * 1000),
    month: r.v,
    average: avg(data.slice(Math.max(0, i - 2), i + 1).filter((x) => x.v != null && !x.partial)),
  })),
);
const first = $derived(avg(known.slice(0, 3)));
const last = $derived(avg(known.slice(-3)));
const change = $derived(first ? ((last ?? 0) - first) / first : (last ?? 0) > 0 ? 1 : 0);
const trend = $derived(Math.abs(change) < 0.1 ? (['flat', '●'] as const) : change > 0 ? (['up', '▲'] as const) : (['down', '▼'] as const));
</script>

<div>
  <div class="mb-1 flex justify-between gap-2 text-[13px] font-semibold">
    <span>{title}</span>
    <span class={trend[0] === 'up' ? 'text-good-text' : 'text-muted-foreground'}>{trend[1]} {m().journey.trend[trend[0]]}</span>
  </div>
  <div class="h-32">
    <LineChart
      data={points}
      x="date"
      series={[
        { key: 'month', label: title, color: 'color-mix(in srgb, var(--p0) 35%, transparent)' },
        { key: 'average', label: m().journey.averageLabel, color: 'var(--p0)' },
      ]}
      points
      props={{
        xAxis: { format: (d: Date) => monthYear(d.getTime() / 1000), tickOcclusion: true },
        yAxis: { format: (v: number) => show(v) },
      }}
    />
  </div>
  <div class="mt-1 text-xs text-muted-foreground">{m().journey.firstLast(`${show(first)}${unit}`, `${show(last)}${unit}`)}</div>
</div>
