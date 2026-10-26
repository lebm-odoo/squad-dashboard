import type { DeskFilter } from './me/desk.ts';

const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // a private window keeps it for the visit
  }
}

const period = stored('sd-period');
let desk: Partial<DeskFilter> = {};
try {
  desk = JSON.parse(stored('sd-desk') ?? '{}') ?? {};
} catch {
  // an unreadable filter ignores nothing
}

/** What this browser keeps for its viewer: the default period of Moi, what its lists ignore, and Squad hidden from the screen. */
export const prefs = $state({
  period: period && ['14', '30', '91'].includes(period) ? period : '14',
  desk: { whys: desk.whys ?? [], stages: desk.stages ?? [] },
  hidden: stored('sd-hidden') === '1',
});

export function setPeriod(period: string) {
  prefs.period = period;
  store('sd-period', period);
}

export function setHidden(hidden: boolean) {
  prefs.hidden = hidden;
  store('sd-hidden', hidden ? '1' : '0');
}

export function setDesk(desk: DeskFilter) {
  prefs.desk = desk;
  store('sd-desk', JSON.stringify(desk));
}

/** Ignores a reason or an Odoo stage on Moi, or shows it again. */
export function ignore(key: keyof DeskFilter, value: string) {
  const values = prefs.desk[key];
  setDesk({ ...prefs.desk, [key]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] });
}
