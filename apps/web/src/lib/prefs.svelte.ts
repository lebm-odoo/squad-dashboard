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

/** What this browser keeps for its viewer: the default period of Moi, and Squad hidden from the screen. */
export const prefs = $state({ period: period && ['14', '30', '91'].includes(period) ? period : '14', hidden: stored('sd-hidden') === '1' });

export function setPeriod(period: string) {
  prefs.period = period;
  store('sd-period', period);
}

export function setHidden(hidden: boolean) {
  prefs.hidden = hidden;
  store('sd-hidden', hidden ? '1' : '0');
}
