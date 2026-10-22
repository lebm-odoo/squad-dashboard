import { decodeHTML } from 'entities';
import { re } from '../domain/py';

export class OdooError extends Error {}

type Method = 'search_read' | 'read' | 'search_count' | 'fields_get';
// biome-ignore lint/suspicious/noExplicitAny: records are read field by field, as each query asks.
type OdooRecord = Record<string, any>;

/**
 * Odoo through its JSON-2 API with the user's key, read only: a method other than the four reads is refused here, before any
 * request leaves.
 */
export class Odoo {
  calls = 0;

  constructor(
    private readonly key: string,
    readonly url = 'https://www.odoo.com',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async call<T = OdooRecord[]>(model: string, method: Method, params: object): Promise<T> {
    if (!['search_read', 'read', 'search_count', 'fields_get'].includes(method))
      throw new OdooError(`${model}.${method} : Odoo est lu, jamais modifié`);
    if (!/^[a-z][a-z0-9_.]*$/.test(model)) throw new OdooError(`modèle invalide : ${model}`);
    this.calls++;
    let response: Response;
    try {
      response = await this.fetcher(`${this.url}/json/2/${model}/${method}`, {
        method: 'POST',
        body: JSON.stringify(params),
        headers: { authorization: `bearer ${this.key}`, 'content-type': 'application/json', 'user-agent': 'squad-dashboard/2.0' },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new OdooError(`${model}.${method} : ${(error as Error).message}`);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new OdooError(`${model}.${method} : ${body.message ?? response.statusText} (${response.status})`);
    return body as T;
  }

  searchRead(model: string, domain: unknown[], fields: string[], extra: object = {}) {
    return this.call(model, 'search_read', { domain, fields, ...extra });
  }
}

/** An Odoo date or datetime, in UTC seconds. */
export function odooTs(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(value)) return null;
  return Date.parse(`${value.length === 10 ? value : value.replace(' ', 'T')}Z`) / 1000;
}

/** The trigram of an Odoo user named “Name (abc)”, else the name. */
export const odooPerson = (name: string | null | undefined) => /\(([a-z]{2,8})\)\s*$/.exec(name ?? '')?.[1] ?? name ?? null;

/** The PRs, branches and runbot bundles a task links to, in its description or review notes. */
export function taskLinks(text: string | null | undefined) {
  const decoded = decodeHTML(text ?? '');
  const w = re.word;
  const prs = [
    ...decoded.matchAll(new RegExp(`(?:github\\.com/odoo/((?:${w}|-)+)/pull/|${re.boundary}odoo/((?:${w}|-)+)#)(${re.digit}+)`, 'gu')),
  ].map(([, urlRepo, repo, number]) => `odoo/${urlRepo || repo}#${number}`);
  const branches = [
    ...decoded.matchAll(new RegExp(`(?:github\\.com/odoo-dev/(?:${w}|-)+/tree/|${re.boundary}odoo-dev:)((?:${w}|[.-])+)`, 'gu')),
  ].map(([, branch]) => branch as string);
  const bundles = [...decoded.matchAll(/runbot\.odoo\.com\/runbot\/bundle\/(\d+)/g)].map(([, id]) => Number(id));
  return {
    prs: [...new Set(prs)].sort(),
    branches: [...new Set(branches)].sort(),
    bundles: [...new Set(bundles)].sort((a, b) => a - b),
  };
}

export type TaskChange = [number | null, string | null, string];
export type Task = {
  id: number;
  name: string;
  project: string | null;
  stage: string | null;
  stage_id: number | null;
  state: string;
  people: string[];
  squad: string[];
  reviewer: string | null;
  owner: string | null;
  tags: string[];
  priority: number;
  deadline: number | null;
  stage_since: number | null;
  created: number | null;
  updated: number | null;
  parent: { id: number; name: string } | null;
  links: ReturnType<typeof taskLinks>;
  changes: TaskChange[];
};

/**
 * The tasks of the squad, as the squad dashboard read them: the open ones assigned to it in the R&D projects, the ones closed
 * there in the last 60 days, those the lead reviews likewise, and every task its PRs name; the `kept` ones too, open when last
 * read, for one given to someone else to stop showing as the squad's. Each change of stage or state seen is added to
 * `history`: a new stage is dated by Odoo, a new state in the same stage by this reading.
 */
export async function readTasks(
  odoo: Odoo,
  {
    squad,
    lead,
    named,
    kept = [],
    history,
    now,
  }: { squad: string[]; lead: string | null; named: number[]; kept?: number[]; history: Record<string, TaskChange[]>; now: number },
) {
  const closed = ['1_done', '1_canceled'];
  const available = Object.keys(await odoo.call<OdooRecord>('project.task', 'fields_get', { attributes: ['type'] }));
  const fields = [
    'name',
    'project_id',
    'stage_id',
    'state',
    'user_ids',
    'tag_ids',
    'priority',
    'date_deadline',
    'create_date',
    'write_date',
    'date_last_stage_update',
    'reviewer_id',
    'x_owner_id',
    'parent_id',
  ].filter((field) => available.includes(field));
  const users = await odoo.searchRead('res.users', [['login', 'in', squad.map((member) => `${member}@odoo.com`)]], ['name', 'login']);
  const squadOf = new Map(users.map((user) => [user.id as number, (user.login as string).split('@')[0] as string]));
  const recent = new Date((now - 60 * 86400) * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const current = ['|', ['state', 'not in', closed], ['date_last_stage_update', '>=', recent]];
  const rows = squadOf.size
    ? await odoo.searchRead(
        'project.task',
        [['user_ids', 'in', [...squadOf.keys()]], ['project_id.name', '=ilike', 'RD %'], ...current],
        fields,
      )
    : [];
  const leadId = [...squadOf].find(([, member]) => member === lead)?.[0];
  if (leadId) {
    // The tasks the lead reviews: as reviewer, or by their review-<trigram> and validation-<trigram> tags.
    const known = new Set(rows.map((task) => task.id));
    const reviewed = ['|', ['reviewer_id', '=', leadId], ['tag_ids.name', 'in', [`review-${lead}`, `validation-${lead}`]]];
    for (const task of await odoo.searchRead('project.task', [...reviewed, ...current], fields)) if (!known.has(task.id)) rows.push(task);
  }
  const missing = [...new Set([...named, ...kept])].filter((id) => !rows.some((task) => task.id === id)).sort((a, b) => a - b);
  if (missing.length) rows.push(...(await odoo.searchRead('project.task', [['id', 'in', missing]], fields)));
  const names = async (model: string, ids: Iterable<number>, wanted = ['name']) => {
    const unique = [...new Set(ids)];
    const records = unique.length ? await odoo.searchRead(model, [['id', 'in', unique]], wanted, { context: { active_test: false } }) : [];
    return new Map(records.map((record) => [record.id as number, record]));
  };
  const [tags, stages, people] = await Promise.all([
    names(
      'project.tags',
      rows.flatMap((task) => task.tag_ids ?? []),
    ),
    names(
      'project.task.type',
      rows.flatMap((task) => (task.stage_id ? [task.stage_id[0]] : [])),
      ['name', 'sequence', 'fold'],
    ),
    names(
      'res.users',
      rows.flatMap((task) => (task.user_ids ?? []).filter((id: number) => !squadOf.has(id))),
      ['name', 'login'],
    ),
  ]);
  const person = (id: number) => squadOf.get(id) ?? odooPerson(people.get(id)?.name) ?? String(id);
  // The links of a task to its PRs, read for the open tasks alone: a description can be long.
  const textFields = ['description', 'x_review'].filter((field) => available.includes(field));
  const open = rows.filter((task) => !closed.includes(task.state)).map((task) => task.id);
  const texts = new Map(
    textFields.length && open.length
      ? (await odoo.searchRead('project.task', [['id', 'in', open]], textFields)).map((task) => [
          task.id,
          textFields.map((field) => task[field] || '').join(' '),
        ])
      : [],
  );
  const changes: Record<string, TaskChange[]> = {};
  const tasks: Record<string, Task> = {};
  for (const task of rows) {
    const stage: string | null = task.stage_id ? task.stage_id[1] : null;
    const stageSince = odooTs(task.date_last_stage_update);
    const seen = [...(history[task.id] ?? [])];
    const last = seen.at(-1);
    if (!last || last[1] !== stage || last[2] !== task.state) seen.push([!last || last[1] !== stage ? stageSince : now, stage, task.state]);
    changes[task.id] = seen;
    tasks[task.id] = {
      id: task.id,
      name: task.name,
      project: task.project_id ? task.project_id[1] : null,
      stage,
      stage_id: task.stage_id ? task.stage_id[0] : null,
      state: task.state,
      people: (task.user_ids ?? []).map(person),
      squad: (task.user_ids ?? []).flatMap((id: number) => squadOf.get(id) ?? []),
      reviewer: task.reviewer_id ? odooPerson(task.reviewer_id[1]) : null,
      owner: task.x_owner_id ? odooPerson(task.x_owner_id[1]) : null,
      tags: (task.tag_ids ?? []).flatMap((id: number) => tags.get(id)?.name ?? []),
      priority: Number(task.priority || 0),
      deadline: odooTs(task.date_deadline),
      stage_since: stageSince,
      created: odooTs(task.create_date),
      updated: odooTs(task.write_date),
      parent: task.parent_id ? { id: task.parent_id[0], name: task.parent_id[1] } : null,
      links: taskLinks(texts.get(task.id)),
      changes: seen.slice(-12),
    };
  }
  return {
    tasks,
    changes,
    stages: Object.fromEntries([...stages].map(([id, stage]) => [id, { name: stage.name, sequence: stage.sequence, fold: stage.fold }])),
    notFound: [...new Set(named)]
      .filter((id) => !tasks[id])
      .map(String)
      .sort(),
  };
}

/** The key given to the server (ODOO_API_KEY), else the one the V1 kept in the session's keyring: the same user, the same rights. */
export async function squadOdooKey() {
  const given = process.env.ODOO_API_KEY;
  if (given) return given;
  try {
    const proc = Bun.spawn(['secret-tool', 'lookup', 'service', 'squad-dashboard', 'account', 'odoo-api-key'], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const key = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 && key ? key : null;
  } catch {
    return null;
  }
}
