/** Downloads a CSV in the browser, its cells quoted, the date of the day in its name. */
export function downloadCsv(name: string, head: string[], rows: unknown[][]) {
  const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const content = [head.join(','), ...rows.map((row) => row.map(esc).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
}
