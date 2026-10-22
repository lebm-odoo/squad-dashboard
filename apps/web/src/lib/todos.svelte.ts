import type { Todo } from '@sd/shared';
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from './api.ts';
import { m } from './i18n.svelte.ts';
import { type Board, now } from './squad/model.ts';

export type TodoRef = NonNullable<Todo['ref']>;

/** The to-dos of Moi, kept by the server; what has one is marked everywhere. */
export const todos = $state<{ items: Todo[]; offline: boolean; dialog: TodoRef | null }>({ items: [], offline: true, dialog: null });

/** A to-do may also name a feature alone. */
export const refOf = (todo: Todo): TodoRef | null =>
  todo.ref ?? (todo.feature ? { type: 'feature', key: todo.feature, label: todo.feature } : null);

const keys = $derived(
  new Set(todos.items.flatMap((todo) => (!todo.done && refOf(todo) ? [`${refOf(todo)?.type}:${refOf(todo)?.key}`] : []))),
);
export const hasTodo = (type: TodoRef['type'], key: string) => keys.has(`${type}:${key}`);

export async function loadTodos() {
  try {
    todos.items = await parseResponse(api.todos.$get());
    todos.offline = false;
  } catch {
    todos.offline = true;
  }
}

export async function saveTodos(items: Todo[]) {
  const before = todos.items;
  todos.items = items;
  try {
    todos.items = await parseResponse(api.todos.$put({ json: items }));
  } catch (error) {
    todos.items = before;
    toast.error(m().todos.notSaved(messageOf(error)));
  }
}

export function addTodo(text: string, ref?: TodoRef) {
  const value = text.trim();
  if ((!value && !ref) || todos.offline) return false;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  void saveTodos([...todos.items, { id, text: value, done: false, at: now(), ...(ref ? { ref } : {}) }]);
  return true;
}

export const updateTodo = (id: string, changes: Partial<Todo>) =>
  saveTodos(todos.items.map((todo) => (todo.id === id ? { ...todo, ...changes } : todo)));

/** Whether what a to-do refers to waits for my review on GitHub. */
export const refAsked = (board: Board | null, ref: TodoRef | null) =>
  !!board &&
  !!ref &&
  (ref.type === 'pr'
    ? board.askedOfMe(ref.key)
    : ref.type === 'feature' && !!board.feature(ref.key)?.prs.some((p) => board.askedOfMe(`${p.repo}#${p.number}`)));
