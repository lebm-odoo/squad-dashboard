import { inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { loadCursor, saveCursor } from '../db/git';
import { insertRows, toDate } from '../db/rows';
import { gitBranch, mergebotPr, odooTask } from '../db/schema';
import { ownerOf } from '../domain/branches';
import { type Odoo, readTasks, type Task, type TaskChange } from '../sources/odoo';
import { leadReviewedPrs } from './web';

/** The squad's Odoo tasks, and the changes of stage seen since the last reading. */
export async function syncTasks(
  db: Database,
  odoo: Odoo,
  { squad, lead, now, step = () => {} }: { squad: string[]; lead: string | null; now: number; step?: (label: string) => void },
) {
  step('odoo : tâches du squad');
  const people = new Set(squad);
  const [branches, prs, stored, reviewed] = await Promise.all([
    db.select({ name: gitBranch.name, trailers: gitBranch.trailers }).from(gitBranch),
    db.select({ repo: mergebotPr.repo, number: mergebotPr.number, label: mergebotPr.label, tasks: mergebotPr.tasks }).from(mergebotPr),
    db.select({ id: odooTask.id, data: odooTask.data, changes: odooTask.changes }).from(odooTask),
    leadReviewedPrs(db, lead, now).then((keys) => new Set(keys)),
  ]);
  // The tasks the squad's branches and PRs name, and the PRs the lead reviewed, read even when nobody of the squad is
  // assigned to them.
  const named = [
    ...branches.flatMap(({ name, trailers }) => (ownerOf(name, people) ? ((trailers as { tasks?: string[] } | null)?.tasks ?? []) : [])),
    ...prs.flatMap(({ repo, number, label, tasks }) =>
      ownerOf((label ?? '').split(':').at(-1) ?? '', people) || reviewed.has(`${repo}#${number}`) ? (tasks ?? []) : [],
    ),
  ].map(Number);
  const history = Object.fromEntries(stored.map(({ id, changes }) => [id, changes as TaskChange[]]));
  const previous = Object.fromEntries(stored.map(({ id, data }) => [id, data as Task | null]));
  const kept = stored.flatMap(({ id, data }) =>
    ['1_done', '1_canceled'].includes((data as { state?: string } | null)?.state ?? '1_done') ? [] : [id],
  );
  const read = await readTasks(odoo, { squad, lead, named, kept, history, previous, now });
  // A task kept open that Odoo no longer gives was deleted or archived there.
  const gone = kept.filter((id) => !read.tasks[id]);
  if (gone.length) await db.delete(odooTask).where(inArray(odooTask.id, gone));
  await insertRows(
    db,
    odooTask,
    Object.values(read.tasks).map((task) => ({ id: task.id, data: task, changes: read.changes[task.id] ?? [], fetchedAt: toDate(now) })),
    ['data', 'changes', 'fetchedAt'],
  );
  const status = { at: now, calls: odoo.calls, tasks: Object.keys(read.tasks).length, stages: read.stages, not_found: read.notFound };
  await saveCursor(db, 'odoo', 'status', { ...(await loadCursor<object>(db, 'odoo', 'status')), ...status });
  return status;
}
