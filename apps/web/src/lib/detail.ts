import { goto } from '$app/navigation';
import { page } from '$app/state';

const kinds = ['feature', 'pr', 'task'] as const;
export type Detail = { kind: (typeof kinds)[number]; key: string };

/** The card the address opens: a link reopens it, the back button steps back through the cards opened one from another. */
export function openedDetail(params: Pick<URLSearchParams, 'get'>): Detail | null {
  for (const kind of kinds) {
    const key = params.get(kind);
    if (key) return { kind, key };
  }
  return null;
}

function addressOf(detail: Detail | null) {
  const next = new URL(page.url.href);
  for (const kind of kinds) next.searchParams.delete(kind);
  if (detail) next.searchParams.set(detail.kind, detail.key);
  return next;
}

export const openDetail = (kind: Detail['kind'], key: string) =>
  goto(addressOf({ kind, key }), { reset: false, state: { cards: (page.state.cards ?? 0) + 1 }, persistState: true });

/** Closes every card opened from this page at once; a card a link opened goes away from the address. */
export function closeDetail() {
  if (page.state.cards) history.go(-page.state.cards);
  else void goto(addressOf(null), { reset: false, replace: true });
}
