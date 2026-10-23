import { describe, expect, test } from 'bun:test';
import { Odoo, OdooError, odooPerson, odooTs, readTasks, taskLinks } from './odoo';

/** An Odoo answering each `model/method` call with what `answer` gives. */
function odooServer(answer: (model: string, method: string, params: Record<string, unknown>) => unknown) {
  const calls: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const [model, method] = (url.split('/json/2/')[1] as string).split('/') as [string, string];
    calls.push(`${model}.${method}`);
    return Response.json(answer(model, method, JSON.parse(init.body as string)));
  }) as unknown as typeof fetch;
  return { calls, odoo: new Odoo('key', 'https://odoo.test', fetcher) };
}

describe('Odoo', () => {
  test('is only read: a write never leaves', async () => {
    const { odoo, calls } = odooServer(() => []);
    await expect(odoo.call('project.task', 'write' as 'read', {})).rejects.toThrow(OdooError);
    await expect(odoo.call('project.task; drop', 'read', {})).rejects.toThrow('modèle invalide');
    expect(calls).toEqual([]);
  });

  test('dates, people and links as the squad read them', () => {
    expect(odooTs('2026-10-01 10:00:00')).toBe(Date.parse('2026-10-01T10:00:00Z') / 1000);
    expect(odooTs(false)).toBeNull();
    expect(odooPerson('Anne Example (anne)')).toBe('anne');
    expect(taskLinks('see https://github.com/odoo/enterprise/pull/12 and odoo-dev:master-x-anne, odoo/odoo#7')).toEqual({
      prs: ['odoo/enterprise#12', 'odoo/odoo#7'],
      branches: ['master-x-anne'],
      bundles: [],
    });
  });

  test("the squad's tasks, with every change of stage kept", async () => {
    const task = { id: 7, name: 'A task', project_id: [1, 'RD HR'], stage_id: [3, 'In Review'], state: '01_in_progress', user_ids: [11] };
    const { odoo } = odooServer((model, method) => {
      if (method === 'fields_get') return { name: {}, project_id: {}, stage_id: {}, state: {}, user_ids: {}, date_last_stage_update: {} };
      if (model === 'res.users') return [{ id: 11, name: 'Anne (anne)', login: 'anne@odoo.com' }];
      if (model === 'project.task') return [{ ...task, date_last_stage_update: '2026-10-10 08:00:00' }];
      if (model === 'project.task.type') return [{ id: 3, name: 'In Review', sequence: 5, fold: false }];
      return [];
    });
    const now = Date.parse('2026-10-17T10:00:00Z') / 1000;
    const read = await readTasks(odoo, {
      squad: ['anne'],
      lead: 'anne',
      named: [9],
      history: { 7: [[100, 'New', '01_in_progress']] },
      now,
    });
    expect(read.tasks[7]).toMatchObject({ stage: 'In Review', people: ['anne'], squad: ['anne'] });
    expect(read.changes[7]).toEqual([
      [100, 'New', '01_in_progress'],
      [Date.parse('2026-10-10T08:00:00Z') / 1000, 'In Review', '01_in_progress'],
    ]);
    expect(read.stages).toEqual({ 3: { name: 'In Review', sequence: 5, fold: false } });
    expect(read.notFound).toEqual(['9']);
  });

  test('tober+ is dated by the reading that saw it come, unknown when there at the first one', async () => {
    const { odoo } = odooServer((model, method) => {
      if (method === 'fields_get') return { name: {}, state: {}, user_ids: {}, tag_ids: {} };
      if (model === 'res.users') return [{ id: 11, name: 'Anne (anne)', login: 'anne@odoo.com' }];
      if (model === 'project.task')
        return [7, 8, 9].map((id) => ({ id, name: 'A task', state: '01_in_progress', user_ids: [11], tag_ids: [5] }));
      if (model === 'project.tags') return [{ id: 5, name: 'tober+ ' }];
      return [];
    });
    const read = await readTasks(odoo, {
      squad: ['anne'],
      lead: null,
      named: [],
      history: {},
      previous: { 7: { tags: [], validated_at: null }, 8: { tags: ['tober+'], validated_at: 50 } },
      now: 1000,
    });
    expect([7, 8, 9].map((id) => read.tasks[id]?.validated_at)).toEqual([1000, 50, null]);
  });

  test('a task kept open that the squad no longer has is read again by its id: given to someone else, it is no longer ours', async () => {
    const byId: unknown[] = [];
    const { odoo } = odooServer((model, method, params) => {
      if (method === 'fields_get') return { name: {}, stage_id: {}, state: {}, user_ids: {} };
      if (model === 'res.users')
        return params.domain && JSON.stringify(params.domain).includes('login')
          ? [{ id: 11, name: 'Anne (anne)', login: 'anne@odoo.com' }]
          : [{ id: 12, name: 'Bob (bob)', login: 'bob@odoo.com' }];
      if (model !== 'project.task') return [];
      const domain = params.domain as unknown[];
      if (!JSON.stringify(domain).includes('"id","in"')) return [];
      byId.push(domain);
      return [{ id: 8, name: 'Given away', stage_id: [3, 'RD Spec'], state: '01_in_progress', user_ids: [12] }];
    });
    const read = await readTasks(odoo, { squad: ['anne'], lead: null, named: [], kept: [8], history: {}, now: 1000 });
    expect(byId).toEqual([[['id', 'in', [8]]]]);
    expect(read.tasks[8]).toMatchObject({ people: ['bob'], squad: [] });
    expect(read.notFound).toEqual([]);
  });

  test('the tasks the lead reviews, those closed in the last 60 days too: a move to Deployed by someone else shows', async () => {
    const domains: unknown[][] = [];
    const { odoo } = odooServer((model, method, params) => {
      if (method === 'fields_get') return { name: {}, stage_id: {}, state: {}, user_ids: {}, reviewer_id: {}, date_last_stage_update: {} };
      if (model === 'res.users') return [{ id: 11, name: 'Anne (anne)', login: 'anne@odoo.com' }];
      if (model !== 'project.task') return [];
      domains.push(params.domain as unknown[]);
      return domains.length === 2
        ? [{ id: 8, name: 'Reviewed', stage_id: [4, 'RD Deployed'], state: '1_done', reviewer_id: [11, 'Anne (anne)'] }]
        : [];
    });
    const read = await readTasks(odoo, {
      squad: ['anne'],
      lead: 'anne',
      named: [],
      history: {},
      now: Date.parse('2026-10-17T10:00:00Z') / 1000,
    });
    expect(domains[1]).toContainEqual(['date_last_stage_update', '>=', '2026-08-18 10:00:00']);
    expect(read.tasks[8]).toMatchObject({ stage: 'RD Deployed', state: '1_done', reviewer: 'anne' });
  });
});
