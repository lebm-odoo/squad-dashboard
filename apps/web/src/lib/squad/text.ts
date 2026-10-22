import { fdate } from '../format.ts';
import { m } from '../i18n.svelte.ts';
import type { Code } from './model.ts';

/** Where the code stands, in words: merged or not, and each forward-port. */
export const codeText = (c: Code) =>
  c.closed
    ? m().tip.closedNoMerge
    : !c.merged
      ? m().tip.notMerged
      : m().tip.mergedPorts(fdate(c.at), c.steps.map((y) => `${y.branch} ${m().ports[y.state]}`).join(', '));
