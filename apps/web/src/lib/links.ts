import { api } from '#lib/api.ts';
import { goto } from '$app/navigation';

type WorkParams = { who?: string; period?: string; role?: string; status?: string; reviewer?: string; feature?: string };

const href = (path: string, params: Record<string, string | undefined>) => {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => !!entry[1]));
  return `${path}${query.size ? `?${query}` : ''}`;
};

/** Where a Work list opens, filtered: Squad's sends mine on to Moi's, so a link to anyone's work holds. */
export const workHref = (params: WorkParams) => href('/squad/work', params);
export const myWorkHref = (params: Omit<WorkParams, 'who'>) => href('/me/work', params);
export const journeyHref = (who?: string, window?: string) => href('/squad/journey', { who, window });
export const myJourneyHref = (window?: string) => href('/me/journey', { window });

const openTab = (url: string) => window.open(url, '_blank', 'noopener');

/** In its own window (scripts/app.sh), the page hands the links leaving it to the default browser, through the server. */
export function openOutside() {
  if (!matchMedia('(display-mode: standalone)').matches) return () => {};
  const follow = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (event.button > 1 || !(link instanceof HTMLAnchorElement) || link.origin === location.origin || !/^https?:$/.test(link.protocol))
      return;
    event.preventDefault();
    void api.open
      .$post({ json: { url: link.href } })
      .then((res) => res.ok || Promise.reject())
      .catch(() => openTab(link.href));
  };
  document.addEventListener('click', follow, true);
  document.addEventListener('auxclick', follow, true);
  return () => {
    document.removeEventListener('click', follow, true);
    document.removeEventListener('auxclick', follow, true);
  };
}

/** Changes the address's parameters: a view's state lives there, a link reopens it and the back button undoes a step. */
export function setParams(url: { href: string }, changes: Record<string, string | null>, push = false) {
  const next = new URL(url.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null) next.searchParams.delete(key);
    else next.searchParams.set(key, value);
  }
  return goto(next, push ? {} : { replace: true, reset: false });
}
