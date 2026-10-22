import type { Snippet } from 'svelte';
import type { Attachment } from 'svelte/attachments';

/** One tooltip for the page, as the squad dashboard had: hundreds of lines each get theirs without a component apiece. */
export const tip = $state<{ content: Snippet | null; x: number; y: number }>({ content: null, x: 0, y: 0 });

export const hideTip = () => {
  tip.content = null;
};

/** Shows `content` next to the pointer while it is over the element, or below the element while it has the focus. */
export const tooltip =
  (content: Snippet): Attachment<HTMLElement> =>
  (element) => {
    const place = (event: PointerEvent | FocusEvent) => {
      const box = element.getBoundingClientRect();
      const pointer = 'clientX' in event;
      tip.x = pointer ? event.clientX : box.left + box.width / 2;
      tip.y = pointer ? event.clientY : box.bottom;
    };
    const show = (event: PointerEvent | FocusEvent) => {
      tip.content = content;
      place(event);
    };
    const listeners = [
      ['pointerenter', show],
      ['pointermove', place],
      ['pointerleave', hideTip],
      ['focus', show],
      ['blur', hideTip],
    ] as const;
    for (const [name, listener] of listeners) element.addEventListener(name, listener as EventListener);
    return () => {
      for (const [name, listener] of listeners) element.removeEventListener(name, listener as EventListener);
      if (tip.content === content) hideTip();
    };
  };
