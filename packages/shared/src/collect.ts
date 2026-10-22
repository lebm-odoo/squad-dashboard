/**
 * `all` reads everything, Moi first, then the squad; `me` only what waits for me: the reviews asked, the tasks, the PRs of my
 * desk that moved; `watch` the same, run by the page on its own; `git` reads the clones as they are, offline; the others read
 * one source.
 */
export const collectScopes = ['all', 'me', 'git', 'ci', 'github', 'odoo', 'watch'] as const;
/** What a collection makes ready, in this order: the page reloads each space as soon as it is. */
export const collectSpaces = ['me', 'squad'] as const;
export type CollectScope = (typeof collectScopes)[number];

export type CollectState = {
  running: boolean;
  scope: CollectScope | null;
  /** What runs now, one step per source going on: git, the network sources and Odoo run side by side. */
  current: string[];
  /** The spaces this collection already brought up to date. */
  ready: (typeof collectSpaces)[number][];
  started: number | null;
  finished: number | null;
  /** Each source's failure, the others having gone on. */
  errors: Record<string, string>;
  /** The steps done, with their seconds. */
  steps: [string, number][];
};
