import { m } from './i18n.svelte.ts';
import { DAY, now } from './squad/model.ts';

const formatter = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(m().intl, options);
export const fdate = (ts: number | null | undefined) =>
  ts ? formatter({ day: 'numeric', month: 'short', year: 'numeric' }).format(ts * 1000) : '—';
export const fdt = (ts: number | null | undefined) =>
  ts ? formatter({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts * 1000) : '—';
export const shortDate = (ts: number) =>
  new Date(ts * 1000).getFullYear() === new Date().getFullYear()
    ? formatter({ day: 'numeric', month: 'short' }).format(ts * 1000)
    : fdate(ts);
export function rel(ts: number | null | undefined) {
  if (!ts) return '—';
  const d = now() - ts;
  const time = m().time;
  if (d < 3600) return time.justNow;
  if (d < DAY) return time.hoursAgo(Math.floor(d / 3600));
  if (d < 60 * DAY) return time.daysAgo(Math.floor(d / DAY));
  return time.monthsAgo(Math.floor(d / (30 * DAY)));
}
export function age(ts: number) {
  const d = now() - ts;
  const time = m().time;
  return d < DAY
    ? time.hours(Math.max(1, Math.floor(d / 3600)))
    : d < 60 * DAY
      ? time.days(Math.floor(d / DAY))
      : time.months(Math.floor(d / (30 * DAY)));
}
export const label = (person: string) => person.toUpperCase();
export const personName = (name: string) => (/^[a-z]{2,8}$/.test(name) ? label(name) : name);
export const cap = (text: string) => (text ? (text[0] as string).toUpperCase() + text.slice(1) : text);

const number = (digits: number) => (n: number | null | undefined) =>
  n == null || Number.isNaN(n) ? '—' : new Intl.NumberFormat(m().intl, { maximumFractionDigits: digits }).format(n);
export const fmt = number(0);
export const fmt1 = number(1);
export const fmt2 = number(2);
export const pct = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '—' : `${Math.round(n * 100)}%`);
export const fdays = (d: number | null | undefined) => (d == null ? '—' : d < 1 ? m().time.hours(fmt1(d * 24)) : m().time.days(fmt1(d)));
/** “Apr ’26”: “Apr 26” reads as a day. */
export const monthYear = (ts: number) =>
  `${formatter({ month: 'short' }).format(ts * 1000)} ’${String(new Date(ts * 1000).getFullYear()).slice(2)}`;
export const monthLong = (ts: number) => formatter({ month: 'long', year: 'numeric' }).format(ts * 1000);
export const dayLong = (ts: number) => formatter({ weekday: 'long', day: 'numeric', month: 'long' }).format(ts * 1000);
export const dayMonth = (ts: number) => formatter({ day: 'numeric', month: 'short' }).format(ts * 1000);
export const timeOf = (ts: number) => formatter({ hour: '2-digit', minute: '2-digit' }).format(ts * 1000);
export const lower = (text: string) => (text ? (text[0] as string).toLowerCase() + text.slice(1) : text);
