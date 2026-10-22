import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import ListChecks from '@lucide/svelte/icons/list-checks';
import Route from '@lucide/svelte/icons/route';
import Sun from '@lucide/svelte/icons/sun';

/** The pages of each space, in the sidebar's order: the address, the key of its name, its icon. */
export const mePages = [
  ['/', 'desk', Sun],
  ['/me/work', 'work', ListChecks],
  ['/me/journey', 'journey', Route],
] as const;

export const squadPages = [
  ['/squad', 'overview', LayoutDashboard],
  ['/squad/work', 'work', ListChecks],
  ['/squad/journey', 'journey', Route],
] as const;
