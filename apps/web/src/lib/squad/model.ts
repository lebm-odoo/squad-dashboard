import type { Commit, Feature, Pr, Received, Request, Review, ReviewedPr, SquadData, Task } from './types.ts';

export const DAY = 86400;
export const now = () => Date.now() / 1000;
export type Period = { from: number; to: number };
export const periodOf = (daysBack: number): Period => ({ from: now() - daysBack * DAY, to: now() + DAY });
export const inP = (t: number, P: Period) => t >= P.from && t <= P.to;
export const uniq = <T>(items: T[]) => [...new Set(items)];
/** The entry of a key, made on its first read. */
function entry<K, V>(map: Map<K, V>, key: K, make: () => V) {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
}
export const prUrl = (key: string) => (key.includes('#') ? `https://github.com/${key.split('#')[0]}/pull/${key.split('#')[1]}` : null);
export const taskUrl = (id: number | string) => `https://www.odoo.com/odoo/project.task/${id}`;
export const versionNumber = (version: string) =>
  version === 'master' ? Number.POSITIVE_INFINITY : Number.parseFloat(String(version).replace(/^saas-/, '')) || 0;

export type TaskHow = 'code' | 'task' | 'guess';
export type FeatureEvent = { t: number; type: string; repo?: string };
export type Feat = Feature & {
  _events: FeatureEvent[];
  _people: string[];
  _activity: number[];
  _draft: boolean;
  _ciFail: boolean;
  _before: boolean;
  _tasks: Task[];
  _taskHow: Map<Task, TaskHow>;
  _search: string;
  _own: Commit[];
  /** The person's own work: the merge is the mergebot's, done on its own after the r+. */
  _work: number[];
  _rounds: number;
  _firstReview: number | null;
  _lead: number | null;
};
export type Rev = Review & { _feature: string; _search: string };
export type PortState = 'merged' | 'open' | 'blocked' | 'closed';
export type Step = { branch: string; state: PortState; prs?: string[]; urls?: string[]; at?: number };
export type ManualPort<F extends Feature = Feat> = Step & { f: F; back: boolean; chain: Step[] };
export type Code = {
  f?: Feat;
  pr?: ReviewedPr;
  merged: boolean;
  closed: boolean;
  at: number | null | undefined;
  version: string | null;
  steps: Step[];
};
export type ReviewerKind = 'rplus' | 'validation' | 'changes' | 'comment';
export type FeatureReviewer = { who: string; rplus: boolean; states: string[]; last: number };
export type ColumnItem = { t: Task; code: Code[]; live: Code[]; since: number; guess: boolean };
export type Validation = { by: string[]; state: 'pending' | 'done' | 'outdated'; at: number; pushed: number };
export type CurrentItem = { f?: Feat; task?: Task; who?: string; port?: boolean; t: number };

export type WorkFilter = {
  who: string | null;
  period: string;
  role: string;
  status: string;
  reviewer: string | null;
  q: string;
  feature: string | null;
};
export type OwnItem = { own: true; f: Feat; t: number; who: string[]; outside?: boolean };
export type GivenItem = { own: false; rv: Rev; t: number; who: string[]; code: Code | null; tasks: Task[] };
export type WorkItem = OwnItem | GivenItem;
export type TimelineEvent = {
  t: number;
  type: string;
  who: string[];
  f?: Feat;
  c?: Commit;
  r?: Rev;
  task?: Task;
  stage?: string;
  taskState?: string;
};
export type JourneyBase = { people: string[]; mine: Feat[]; given: Rev[] };
export type Facts = ReturnType<Board['facts']>;

export const lastActivity = (f: Feat) => (f._activity.length ? Math.max(...f._activity) : 0);
export const inProgress = (f: Feature) => f.status === 'open' || (f.status === 'wip' && !f.deleted);
export const statusKey = (f: Feat) => (f.status === 'open' && f._draft ? 'draft' : f.status);
export const taskClosed = (t: Task) => t.state === '1_done' || t.state === '1_canceled';
/** The task a feature does: the one its code names before one that links to it, an open one before a closed one. */
export function ownTask(f: Feat) {
  const ranks = ['code', 'task', 'guess'];
  return [...f._tasks].sort(
    (a, b) =>
      ranks.indexOf(f._taskHow.get(a) ?? 'guess') - ranks.indexOf(f._taskHow.get(b) ?? 'guess') ||
      Number(taskClosed(a)) - Number(taskClosed(b)),
  )[0];
}
/** The trigrams of a task's <kind>-<trigram> tags. */
export const tagged = (t: Task, kind: string) =>
  t.tags.flatMap(
    (tag) =>
      tag
        .trim()
        .toLowerCase()
        .match(new RegExp(`^${kind}-([a-z]+)$`))?.[1] ?? [],
  );
/** Validated by its PO, who tags it tober+ rather than give an r+ they may not give alone. */
export const validated = (t: Task) => t.tags.some((tag) => tag.trim().toLowerCase() === 'tober+');
export const stageLabel = (stage?: string) => (stage || 'No stage').replace(/^RD\s+/, '');
export const reviewerKind = (y: FeatureReviewer): ReviewerKind =>
  y.rplus ? 'rplus' : y.states.includes('APPROVED') ? 'validation' : y.states.includes('CHANGES_REQUESTED') ? 'changes' : 'comment';
export const reviewKind = (r: Review): ReviewerKind =>
  r.src === 'r+' ? 'rplus' : r.state === 'APPROVED' ? 'validation' : r.state === 'CHANGES_REQUESTED' ? 'changes' : 'comment';
/** A PR has its own r+: on a batch, the mergebot can miss the r+ of another PR. */
export const hasRplus = (p: Pr) => p.state === 'merged' || (p.review ? p.review === 'ok' : !p.missing_r);
/** What undid my r+ on a PR not merged yet, which will not merge as it is: an r- or a push since, a conflict GitHub sees. */
export function rplusUndone(p: Request | undefined): ['rminus' | 'pushed' | 'conflict', number, string?] | null {
  const since = p?.rplus_at;
  if (!since) return null;
  const rminus = p.rminus?.findLast(([, at]) => at > since);
  if (rminus) return ['rminus', rminus[1], rminus[0]];
  if (p.pushed_at && p.pushed_at > since) return ['pushed', p.pushed_at];
  return p.mergeable === 'CONFLICTING' ? ['conflict', since] : null;
}
export const reviewUrl = (r: Review) => prUrl(r.pr) || `https://github.com/odoo/${r.pr.split('@')[0]}/commit/${r.pr.split('@')[1]}`;
/** Mergebot opens the next forward-port up to hours after a merge: a day without one, the chain stopped there. */
export const portsStopped = (lastMerge: number | null | undefined) => !!lastMerge && now() - lastMerge > DAY;
/** Merged with each of its forward-ports, none left open: up to master, or wherever the chain stopped. */
export const codeDone = (c: Code) =>
  c.merged &&
  c.steps.every((y) => y.state === 'merged' || y.state === 'closed') &&
  (c.version === 'master' ||
    c.steps.some((y) => y.branch === 'master') ||
    c.steps.at(-1)?.state === 'closed' ||
    portsStopped(Math.max(c.at ?? 0, ...c.steps.map((y) => y.at ?? 0))));
export const codeMoving = (c: Code) => c.steps.find((y) => y.state === 'blocked') || c.steps.find((y) => y.state === 'open');

export const sum = (items: (number | null | undefined)[]) => items.reduce<number>((x, y) => x + (y || 0), 0);
export const median = (items: (number | null | undefined)[]) => {
  const sorted = items.filter((v): v is number => v != null && !Number.isNaN(v)).sort((x, y) => x - y);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};
const mean = (items: (number | null | undefined)[]) => {
  const known = items.filter((v): v is number => v != null && !Number.isNaN(v));
  return known.length ? sum(known) / known.length : null;
};
export function tally(list: string[]) {
  const counts = new Map<string, number>();
  for (const key of list) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}
export function weekStart(ts: number) {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime() / 1000;
}
export const monthStart = (ts: number) => {
  const d = new Date(ts * 1000);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000;
};
export const nextMonth = (ts: number) => {
  const d = new Date(ts * 1000);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() / 1000;
};
export const lineValue = (f: Feature) => f.weighted ?? f.size ?? 0;
export const periods = ['14', '30', '91', '182', '365'];
/** The shortest period that still holds a moment. */
export const periodHolding = (t: number) => periods.find((days) => now() - t <= +days * DAY) ?? '365';
/** The main topics of a feature: those of a quarter of its lines or more, else its domain. */
/** The versions master left, by date: their merge-base with master, else the first merge seen on each. */
function masterForks(versionForks: Record<string, number> | undefined, features: Feature[]) {
  let forks = Object.entries(versionForks || {});
  if (!forks.length) {
    const first = new Map<string, number>();
    for (const f of features)
      if (f.version !== 'master' && f.merged_at)
        first.set(f.version, Math.min(first.get(f.version) ?? Number.POSITIVE_INFINITY, f.merged_at));
    forks = [...first];
  }
  return forks.sort((a, b) => a[1] - b[1]);
}

/** What master was at a time: the first version that left master after it, else the one after the last. */
function versionAt(forks: [string, number][], t: number) {
  const next = forks.find(([, at]) => at > t);
  if (next) return next[0];
  const m = forks.at(-1)?.[0].match(/^(saas-)?(\d+)\.(\d+)$/);
  if (!m) return 'master';
  return +(m[3] as string) >= 4 ? `${+(m[2] as string) + 1}.0` : `saas-${m[2]}.${+(m[3] as string) + 1}`;
}

export function featureTopics(f: Feature) {
  const entries = Object.entries(f.topics || {});
  const total = sum(entries.map(([, n]) => n));
  const main = entries
    .filter(([, n]) => total && n / total >= 0.25)
    .slice(0, 2)
    .map(([topic]) => topic);
  return main.length ? main : f.domain && f.domain !== 'Unknown' ? [f.domain] : [];
}

export function arrivalTs(arrival: string) {
  const [y, m] = arrival.split('-').map(Number);
  return new Date(y as number, (m || 1) - 1, 1).getTime() / 1000;
}

/** The words that tell a name apart: no tag, version, trigram or small word; l10n_be gives be. */
function nameWords(text: string, people: Set<string>) {
  const noise = new Set(
    'a an the and or of to in on for with from by at is are not no when if as into via its it this that imp fix ref add rem perf mov rev i18n master saas odoo'.split(
      ' ',
    ),
  );
  const out = new Set<string>();
  for (let w of text
    .toLowerCase()
    .replace(/l10n/g, ' ')
    .match(/[a-z]+|\d+/g) || []) {
    if (/^\d/.test(w)) w = w.replace(/^0+(?=\d)/, '');
    if (w.length > 4 && w.endsWith('s')) w = w.slice(0, -1);
    if (w.length > 1 && !noise.has(w) && !people.has(w)) out.add(w);
  }
  return out;
}

/** The forward-port chains and the ports by hand of features, from the mergebot tables of their PRs. */
class Ports<F extends Feature> {
  private readonly features: F[];
  private readonly chains = new Map<F, Step[]>();
  private prIndex?: Map<string, Pr>;
  private fwIndex?: Map<string, F[]>;
  private portIndex?: Map<string, F[]>;

  constructor(features: F[]) {
    this.features = features;
  }

  /** The forward-port chain of a feature, one step per later version, from the mergebot tables of its PRs. */
  forwardChain(f: F): Step[] {
    const cached = this.chains.get(f);
    if (cached) return cached;
    this.prIndex ??= new Map(this.features.flatMap((x) => x.prs.map((p) => [`${p.repo}#${p.number}`, p] as [string, Pr])));
    const steps = new Map<string, { branch: string; states: string[]; prs: string[]; urls: string[]; at: number }>();
    const step = (branch: string) =>
      entry(steps, branch, () => ({ branch, states: [] as string[], prs: [] as string[], urls: [] as string[], at: 0 }));
    for (const p of f.prs) {
      for (const l of p.linked || []) {
        if (versionNumber(l.branch) <= versionNumber(f.version)) continue;
        const known = this.prIndex.get(`${l.repo}#${l.number}`);
        const cur = known && known.state !== 'open' ? known.state : l.state;
        const x = step(l.branch);
        x.states.push(cur === 'open' && known?.blocked ? 'blocked' : cur);
        x.prs.push(`${l.repo.split('/')[1]}#${l.number}`);
        x.urls.push(known?.mergebot_url || `https://mergebot.odoo.com/${l.repo}/pull/${l.number}`);
        x.at = Math.max(x.at, known?.merged_at ?? 0);
      }
    }
    this.fwIndex ??= Map.groupBy(
      this.features.filter((x) => x.fw_of),
      (x) => x.fw_of as string,
    );
    const listed = new Set(steps.keys());
    for (const x of this.fwIndex.get(f.name) || []) {
      if (listed.has(x.version)) continue;
      for (const p of x.prs) {
        const id = `${p.repo.split('/')[1]}#${p.number}`;
        const y = step(x.version);
        if (y.prs.includes(id)) continue;
        y.states.push(p.state === 'open' && p.blocked ? 'blocked' : p.state);
        y.prs.push(id);
        y.urls.push((p.mergebot_url || p.url) as string);
        y.at = Math.max(y.at, p.merged_at ?? x.merged_at ?? 0);
      }
    }
    const order: PortState[] = ['blocked', 'open', 'merged', 'closed'];
    const chain = [...steps.values()]
      .sort((a, b) => versionNumber(a.branch) - versionNumber(b.branch))
      .map(({ branch, states, prs, urls, at }) => ({ branch, prs, urls, at, state: order.find((o) => states.includes(o)) || 'merged' }));
    this.chains.set(f, chain);
    return chain;
  }

  /** Ports by hand of a feature (the same title merged on another version), with what the mergebot forward-ported of them below it. */
  manualPorts(f: F): ManualPort<F>[] {
    this.portIndex ??= Map.groupBy(
      this.features.filter((x) => x.port_of),
      (x) => x.port_of as string,
    );
    return (this.portIndex.get(f.name) || [])
      .map((x) => ({
        f: x,
        back: versionNumber(x.version) < versionNumber(f.version),
        branch: x.version,
        urls: [x.prs[0]?.mergebot_url || x.prs[0]?.url].filter(Boolean) as string[],
        at: x.merged_at ?? 0,
        state: (x.status === 'merged'
          ? 'merged'
          : x.status === 'closed'
            ? 'closed'
            : x.prs.some((p) => p.blocked)
              ? 'blocked'
              : 'open') as PortState,
        chain: this.forwardChain(x).filter((c) => versionNumber(c.branch) < versionNumber(f.version)),
      }))
      .sort((a, b) => versionNumber(a.f.version) - versionNumber(b.f.version));
  }
}

/**
 * The squad dashboard's page computations, on the data of one load: events, people, tasks joined to the features, ports,
 * reviews. The squad's lead has the Me board; without a squad, `me` alone.
 */
export class Board {
  readonly data: SquadData;
  readonly me: string;
  readonly lead: string;
  readonly members: string[];
  readonly everyone: string[];
  readonly features: Feat[];
  readonly reviews: Rev[];
  readonly requests: Request[];
  /** The reviews asked of me I gave the r+ to. */
  readonly followed: Request[];
  private readonly people = new Map<string, Feat[]>();
  private readonly ports: Ports<Feat>;
  private readonly loginNames: Map<string, string>;
  private byPr?: Map<string, Feat>;
  private byName?: Map<string, Feat>;
  private forks?: [string, number][];

  constructor(data: SquadData) {
    this.data = data;
    this.me = data.me;
    this.lead = data.squad?.lead ?? data.me;
    this.members = data.squad?.members ?? [];
    this.everyone = data.squad ? [data.squad.lead, ...data.squad.members] : [data.me];
    this.loginNames = new Map(
      Object.entries(data.logins ?? {}).flatMap(([member, login]) => (login ? [[login.toLowerCase(), member] as [string, string]] : [])),
    );
    const arrivals = Object.fromEntries(Object.entries(data.org?.arrivals ?? {}).map(([m, a]) => [m, arrivalTs(a)]));
    const arrived = (member: string, t: number) => !arrivals[member] || t >= arrivals[member];
    const tasks = data.odoo?.tasks ?? {};
    this.reviews = data.reviews
      .filter((r) => arrived(r.reviewer, r.t))
      .map((r) => ({ ...r, _feature: r.feature || r.pr, _search: [r.pr, r.subject, r.author, r.reviewer].join(' ').toLowerCase() }));
    for (const raw of data.features) {
      const f = raw as Feat;
      if (f.gh) {
        const last = new Map<string, number>();
        f.gh.received = [...f.gh.received]
          .sort((x, y) => x.at - y.at)
          .filter((rv) => {
            const key = `${rv.who}:${rv.state}`;
            const keep = !last.has(key) || rv.at - (last.get(key) as number) >= 1800;
            last.set(key, rv.at);
            return keep;
          });
      }
      f.pushes = f.pushes.filter((p) => arrived(f.owner, p.at));
      const pushType = (kind: string) =>
        kind === 'rebase' ? 'rebase' : kind === 'new' ? 'new' : ['push', 'amend', 'rebase+code'].includes(kind) ? 'code' : 'other';
      f._events = f.pushes.map((p) => ({ t: p.at, type: pushType(p.kind), repo: p.repo }));
      if (f.merged_at) f._events.push({ t: f.merged_at, type: 'merge' });
      if (f.gh?.opened_at && arrived(f.owner, f.gh.opened_at)) f._events.push({ t: f.gh.opened_at, type: 'open' });
      f._people = [f.owner, ...(f.contributors || []).filter((c) => !f.merged_at || arrived(c, f.merged_at))];
      f._own = f.commits.filter((c) => (c.email || '').split('@')[0] === f.owner && arrived(f.owner, c.at));
      const commitTimes = [...f._own.map((c) => c.at), ...f._own.map((c) => c.ct)];
      f._activity = [...f._events.map((e) => e.t), ...commitTimes].filter(Boolean) as number[];
      f._work = [...f._events.filter((e) => e.type !== 'merge').map((e) => e.t), ...commitTimes].filter(Boolean) as number[];
      const openPrs = f.prs.filter((p) => p.state === 'open');
      f._draft = f.status === 'open' && openPrs.length > 0 && openPrs.every((p) => p.draft);
      f._ciFail = openPrs.some((p) => Object.values(p.ci || {}).includes('fail'));
      // Changes requested on the PRs of a feature less than 30 min apart are one round: odoo and enterprise are reviewed together.
      const lastAsked = new Map<string, number>();
      f._rounds = 0;
      for (const rv of f.gh?.received.filter((x) => x.state === 'CHANGES_REQUESTED') ?? []) {
        if (!lastAsked.has(rv.who) || rv.at - (lastAsked.get(rv.who) as number) >= 1800) f._rounds += 1;
        lastAsked.set(rv.who, rv.at);
      }
      f._firstReview = f.gh?.first_review_delay != null ? f.gh.first_review_delay / DAY : null;
      f._lead = f.merged_at && f._activity.length ? Math.max(0, f.merged_at - Math.min(...f._activity)) : null;
      f._before = !!arrivals[f.owner] && (f.merged_at ? !arrived(f.owner, f.merged_at) : !f._activity.length);
      f._tasks = f.tasks.map((id) => tasks[id]).filter(Boolean) as Task[];
      f._taskHow = new Map(f._tasks.map((t) => [t, 'code']));
      f._search = [f.name, f.title, f.owner, ...(f.contributors || []), f.domain, ...f.tasks, ...f._tasks.map((t) => t.name)]
        .concat(f.prs.map((p) => `#${p.number}`))
        .join(' ')
        .toLowerCase();
    }
    this.features = (data.features as Feat[]).filter((f) => !f._before);
    this.ports = new Ports(this.features);
    // Missing details of a request read as empty: nothing set aside, no team named.
    const request = (r: Request): Request => ({
      ...r,
      teams: r.teams ?? [],
      ids: r.ids ?? {},
      validations: r.validations ?? [],
      rplus: r.rplus ?? [],
      other_teams: r.other_teams ?? 0,
    });
    this.requests = (data.review_requests?.prs ?? []).map(request);
    this.followed = (data.review_requests?.followed ?? []).map(request);
    this.linkTasks();
  }

  /**
   * Features joined to tasks beyond the task ids of their code: by the PRs, branches or bundles a task links to, else guessed
   * from the names. Tuned on the tasks linked by code: no wrong guess at this score, with a word in less than 5% of the names.
   */
  private linkTasks() {
    const tasks = this.allTasks();
    if (!tasks.length) return;
    const features = this.features.filter((f) => f.kind !== 'forward-port' && !f.noisy);
    const join = (f: Feat, t: Task, how: TaskHow) => {
      if (!f._taskHow.has(t)) {
        f._tasks.push(t);
        f._search += ` ${t.id} ${t.name.toLowerCase()}`;
      }
      f._taskHow.set(t, how);
    };
    for (const t of tasks) {
      const { prs = [], branches = [], bundles = [] } = t.links || {};
      if (prs.length || branches.length || bundles.length)
        for (const f of features) {
          if (
            !f._taskHow.has(t) &&
            (f.prs.some((p) => prs.includes(`${p.repo}#${p.number}`)) ||
              branches.includes(f.name) ||
              (f.runbot && bundles.includes(f.runbot.id)))
          )
            join(f, t, 'task');
        }
    }
    const linked = new Set(features.flatMap((f) => f._tasks));
    const open = tasks.filter((t) => t.squad.length && !linked.has(t) && !['1_done', '1_canceled'].includes(t.state) && !this.folded(t));
    const free = features.filter((f) => !f._tasks.length && !f.deleted);
    if (!open.length || !free.length) return;
    const people = new Set(this.everyone);
    const words = new Map<Feat | Task, Set<string>>([
      ...features.map(
        (f) => [f, nameWords(`${f.title || ''} ${f.name.replace(/^(master|saas-[\d.]+|\d+\.\d+)-/, '')}`, people)] as [Feat, Set<string>],
      ),
      ...tasks.map((t) => [t, nameWords(t.name, people)] as [Task, Set<string>]),
    ]);
    const df = new Map<string, number>();
    for (const ws of words.values()) for (const w of ws) df.set(w, (df.get(w) || 0) + 1);
    const weight = (ws: Iterable<string>) => sum([...ws].map((w) => Math.log(words.size / (df.get(w) || 1))));
    const best = new Map<Feat, { t: Task; score: number }>();
    for (const t of open) {
      const tw = words.get(t) as Set<string>;
      const scored = free
        .filter((f) => f._people.some((p) => t.squad.includes(p)) && (f.merged_at || lastActivity(f)) >= (t.created || 0) - 14 * DAY)
        .map((f) => {
          const fw = words.get(f) as Set<string>;
          const shared = [...tw].filter((w) => fw.has(w));
          return { f, shared, score: shared.length ? weight(shared) / Math.sqrt(weight(tw) * weight(fw)) : 0 };
        })
        .filter((x) => x.score >= 0.3 && x.shared.some((w) => (df.get(w) as number) / words.size < 0.05))
        .sort((a, b) => b.score - a.score);
      // The same change in several versions scores the same: each of them gets the task.
      for (const x of scored.filter((x) => x.score >= (scored[0]?.score ?? 0) - 0.05))
        if (!best.has(x.f) || (best.get(x.f)?.score ?? 0) < x.score) best.set(x.f, { t, score: x.score });
    }
    for (const [f, { t }] of best) join(f, t, 'guess');
  }

  allTasks = () => Object.values(this.data.odoo?.tasks ?? {});
  taskOf = (id: string) => this.data.odoo?.tasks?.[id];
  private folded = (t: Task) => !!this.data.odoo?.stages?.[String(t.stage_id)]?.fold;
  /** A task still worked on: open, and not in a stage Odoo folds (backlog, deployed, cancelled). */
  taskActive = (t: Task) => !taskClosed(t) && !this.folded(t);

  /** Every feature of a person, forward-ports included. */
  allFeaturesOf(person: string) {
    return entry(this.people, person, () => this.features.filter((f) => f._people.includes(person)));
  }
  featuresOf = (person: string) => this.allFeaturesOf(person).filter((f) => f.kind !== 'forward-port');
  featuresOfTask = (t: Task) => this.features.filter((f) => f.kind !== 'forward-port' && f._tasks.includes(t));
  /** The features doing a task, as its card shows them: one that does another task only relates to it, unless none does it. */
  taskFeatures = (t: Task) => {
    const linked = this.featuresOfTask(t);
    const own = linked.filter((f) => ownTask(f) === t);
    return own.length ? own : linked;
  };
  isGuess = (f: Feat, t: Task) => f._taskHow.get(t) === 'guess';
  /** The task that tells where a feature stands: an open one before a closed one, a real link before a guess, the last moved first. */
  mainTask = (f: Feat) =>
    [...f._tasks].sort(
      (a, b) =>
        Number(taskClosed(a)) - Number(taskClosed(b)) ||
        Number(this.isGuess(f, a)) - Number(this.isGuess(f, b)) ||
        (b.stage_since || 0) - (a.stage_since || 0),
    )[0];

  /** The version master became when a feature was merged on it. */
  masterVersion(t: number) {
    if (!this.forks) this.forks = masterForks(this.data.version_forks, this.features);
    return versionAt(this.forks, t);
  }
  mergedIn = (branch: string, t: number) => (branch === 'master' ? this.masterVersion(t) : branch);
  /** A version as it ships: master merged is the version it went out in, master not merged yet the version it will be. */
  versionLabel = (version: string, merged?: number | null) =>
    version !== 'master' ? version : merged ? this.masterVersion(merged) : `${this.masterVersion(now())} (master)`;

  forwardChain = (f: Feat) => this.ports.forwardChain(f);
  manualPorts = (f: Feat) => this.ports.manualPorts(f);
  portSteps = (f: Feat): Step[] => [...this.forwardChain(f), ...this.manualPorts(f).flatMap((y) => [y, ...y.chain])];
  portsInFlight = (f: Feat) => this.portSteps(f).some((y) => y.state === 'open' || y.state === 'blocked');

  /** A reviewer's login as a member's name, else the login without its -odoo. */
  reviewerLogin = (rv: Received) => this.loginNames.get((rv.who || '').toLowerCase()) || (rv.who || '').replace(/-odoo$/i, '');

  /** Who reviewed a feature, its authors apart: r+ from the mergebot sign-offs, and GitHub reviews, with the last one's date. */
  featureReviewers(f: Feat) {
    const by = new Map<string, FeatureReviewer>();
    const row = (who: string) => entry(by, who, () => ({ who, rplus: false, states: [] as string[], last: 0 }));
    // An r+ is dated by its `robodoo r+` comment; until the collector has read it, by the merge.
    for (const n of f.reviewers) {
      if (f._people.includes(n)) continue;
      row(n).rplus = true;
      row(n).last = Math.max(row(n).last, f.rplus?.[n] || f.merged_at || 0);
    }
    for (const rv of f.gh ? f.gh.received : []) {
      const who = this.reviewerLogin(rv);
      if (!who || f._people.includes(who)) continue;
      row(who).states.push(rv.state);
      row(who).last = Math.max(row(who).last, rv.at || 0);
    }
    return [...by.values()].sort((a, b) => Number(b.rplus) - Number(a.rplus));
  }

  /** Who reviewed a person's features over a window, once per feature, the most frequent first. */
  reviewersOf(person: string, P: Period, skip: string[] = []) {
    const by = new Map<
      string,
      { who: string; items: { f: Feat; kind: ReviewerKind; t: number }[]; kinds: Record<ReviewerKind, number>; last: number }
    >();
    for (const f of this.featuresOf(person)) {
      for (const y of this.featureReviewers(f)) {
        if (skip.includes(y.who) || !y.last || !inP(y.last, P)) continue;
        const x = entry(by, y.who, () => ({ who: y.who, items: [], kinds: { rplus: 0, validation: 0, changes: 0, comment: 0 }, last: 0 }));
        const kind = reviewerKind(y);
        x.items.push({ f, kind, t: y.last });
        x.kinds[kind] += 1;
        x.last = Math.max(x.last, y.last);
      }
    }
    return [...by.values()].sort((a, b) => b.items.length - a.items.length || b.last - a.last);
  }

  /** One row per feature reviewed by a person: the r+ wins over a GitHub review of the same feature; ports are not reviews. */
  reviewsGiven(person: string, P: Period) {
    const by = new Map<string, Rev>();
    for (const r of this.reviews) {
      if (r.reviewer !== person || r.fw || r.onboarding || !inP(r.t, P)) continue;
      const cur = by.get(r._feature);
      if (!cur || (r.src === 'r+' && cur.src !== 'r+') || (r.src === cur.src && r.t > cur.t)) by.set(r._feature, r);
    }
    return [...by.values()].sort((a, b) => b.t - a.t);
  }

  prFeature(key: string) {
    this.byPr ??= new Map(
      this.features
        .filter((f) => f.kind !== 'forward-port')
        .flatMap((f) => f.prs.map((p) => [`${p.repo}#${p.number}`, f] as [string, Feat])),
    );
    return this.byPr.get(key);
  }
  codeOfFeature = (f: Feat): Code => ({
    f,
    merged: !!f.merged_at,
    closed: f.status === 'closed',
    at: f.merged_at,
    version: f.version,
    steps: this.portSteps(f),
  });
  codeOfPr(pr: ReviewedPr): Code {
    const by = new Map<string, { states: string[]; prs: string[]; urls: string[] }>();
    for (const l of pr.linked) {
      if (versionNumber(l.branch) <= versionNumber(pr.branch ?? '')) continue;
      const x = entry(by, l.branch, () => ({ states: [] as string[], prs: [] as string[], urls: [] as string[] }));
      x.states.push(l.state);
      x.prs.push(`${l.repo.split('/')[1]}#${l.number}`);
      x.urls.push(`https://mergebot.odoo.com/${l.repo}/pull/${l.number}`);
    }
    const steps = [...by]
      .sort(([a], [b]) => versionNumber(a) - versionNumber(b))
      .map(([branch, x]) => ({
        branch,
        state: (['open', 'merged', 'closed'] as PortState[]).find((st) => x.states.includes(st)) as PortState,
        prs: x.prs,
        urls: x.urls,
      }));
    return { pr, merged: pr.state === 'merged', closed: pr.state === 'closed', at: pr.merged_at, version: pr.branch, steps };
  }
  codeOf(key: string) {
    const f = this.prFeature(key);
    if (f) return this.codeOfFeature(f);
    const pr = this.data.reviewed_prs[key];
    return pr ? this.codeOfPr(pr) : null;
  }
  /** Nothing left to do: merged with every forward-port, or closed for good, and its tasks deployed or closed. */
  settled = (c: Code | null, tasks: Task[]) => !!c && (c.closed || codeDone(c)) && tasks.every((t) => !this.taskActive(t));

  /** The tasks of a PR: its feature's, else the ones it names or that link to it. */
  tasksOfPr(key: string): [Task, TaskHow][] {
    const f = this.prFeature(key);
    if (f) return f._tasks.map((t) => [t, f._taskHow.get(t) as TaskHow]);
    const named = new Set(this.data.reviewed_prs[key]?.tasks || []);
    return this.allTasks()
      .filter((t) => named.has(String(t.id)) || (t.links?.prs || []).includes(key))
      .map((t) => [t, named.has(String(t.id)) ? 'code' : 'task']);
  }
  mainTaskOfPr = (key: string): [Task, TaskHow] | [] =>
    this.tasksOfPr(key).sort(([a], [b]) => Number(taskClosed(a)) - Number(taskClosed(b)))[0] || [];
  /** The PRs of a task: those of its features, the reviewed ones that name it, the ones it links to. */
  prsOfTask = (t: Task) =>
    uniq([
      ...this.taskFeatures(t).flatMap((f) => f.prs.map((p) => `${p.repo}#${p.number}`)),
      ...Object.entries(this.data.reviewed_prs).flatMap(([key, pr]) => (pr.tasks.includes(String(t.id)) ? [key] : [])),
      ...(t.links?.prs ?? []),
    ]);
  codeOfTask(t: Task) {
    const feats = this.taskFeatures(t);
    const own = new Set(feats.flatMap((f) => f.prs.map((p) => `${p.repo}#${p.number}`)));
    const prs = Object.entries(this.data.reviewed_prs).filter(
      ([key, pr]) => !own.has(key) && !this.prFeature(key) && (pr.tasks.includes(String(t.id)) || (t.links?.prs || []).includes(key)),
    );
    return [...feats.map(this.codeOfFeature), ...prs.map(([, pr]) => this.codeOfPr(pr))];
  }

  /**
   * The validation of a task, apart from its stages: its validators, by their validation-<trigram> tags, and whether they
   * gave it the tober+. Code pushed since outdates it: since the reading that saw tober+ come or a validator's last approval
   * on GitHub, whichever is last; neither known, nothing tells it.
   */
  validationOf(t: Task): Validation | null {
    const by = tagged(t, 'validation');
    if (!by.length) return null;
    if (!validated(t)) return { by, state: 'pending', at: 0, pushed: 0 };
    const features = this.taskFeatures(t).filter((f) => !this.isGuess(f, t));
    const prs = this.prsOfTask(t);
    const at = Math.max(
      t.validated_at ?? 0,
      ...features.flatMap((f) =>
        (f.gh?.received ?? []).filter((rv) => rv.state === 'APPROVED' && by.includes(this.reviewerLogin(rv))).map((rv) => rv.at),
      ),
      ...this.reviews.filter((r) => r.state === 'APPROVED' && by.includes(r.reviewer) && prs.includes(r.pr)).map((r) => r.t),
    );
    const pushes = [
      ...features
        .filter((f) => !f.merged_at)
        .flatMap((f) => f._events.filter((e) => e.type === 'code' || e.type === 'new').map((e) => e.t)),
      ...prs.map((pr) => this.requestOf(pr)?.pushed_at ?? 0),
    ];
    const pushed = at ? Math.max(0, ...pushes.filter((p) => p > at)) : 0;
    return { by, state: pushed ? 'outdated' : 'done', at, pushed };
  }

  columnItem = (t: Task): ColumnItem => {
    const code = this.codeOfTask(t);
    return {
      t,
      code,
      live: code.filter((c) => !c.closed),
      since: t.changes?.at(-1)?.[0] || t.stage_since || 0,
      guess: this.featuresOfTask(t).some((f) => this.isGuess(f, t)),
    };
  };

  /**
   * The Review column of my own pipe: the tasks I review, by a review-<trigram> tag, and the ones assigned to me but for my
   * own code. In progress: mine to review (again); changes requested or on hold: the dev's to fix; approved:
   * to deploy once all is merged, forward-ports included.
   */
  reviewColumn() {
    const me = this.me;
    const out: Record<'again' | 'fixing' | 'waiting' | 'ready', ColumnItem[]> = { again: [], fixing: [], waiting: [], ready: [] };
    const mine = (t: Task) =>
      tagged(t, 'review').includes(me) || (t.people.includes(me) && !this.featuresOfTask(t).some((f) => f.owner === me));
    for (const t of this.allTasks()) {
      if (taskClosed(t) || !/^review$/i.test(stageLabel(t.stage)) || !mine(t)) continue;
      const x = this.columnItem(t);
      if (t.state === '02_changes_requested' || t.state === '04_waiting_normal') out.fixing.push(x);
      else if (t.state !== '03_approved') out.again.push(x);
      else (x.live.length && x.live.every(codeDone) ? out.ready : out.waiting).push(x);
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.since - b.since);
    return out;
  }

  /**
   * What a person is on right now: open features and branches touched in the last 30 days, the ports of recent merges, and
   * each of their tasks still worked on, through the feature that names it (idle or merged, the task is not over) or alone.
   */
  currentWork(person: string): CurrentItem[] {
    const recent = periodOf(30);
    const mine = this.featuresOf(person);
    const items = new Map<Feat, CurrentItem>();
    const alone: CurrentItem[] = [];
    for (const f of mine) {
      if (inProgress(f) && f._activity.some((t) => inP(t, recent))) items.set(f, { f, t: lastActivity(f) });
      else if (f.merged_at && inP(f.merged_at, periodOf(91)) && this.portsInFlight(f)) items.set(f, { f, port: true, t: f.merged_at });
    }
    for (const task of this.allTasks().filter((t) => this.taskActive(t) && t.squad.includes(person))) {
      const feats = this.featuresOfTask(task);
      const own = feats.filter((f) => mine.includes(f));
      const f = (own.length ? own : feats).sort((a, b) => lastActivity(b) - lastActivity(a))[0];
      const since = task.stage_since || task.updated || 0;
      if (!f) alone.push({ task, t: since });
      else if (!items.has(f)) items.set(f, { f, who: own.length ? person : f.owner, t: Math.max(lastActivity(f), since) });
    }
    return [...items.values(), ...alone].sort((a, b) => b.t - a.t);
  }

  /** Open PRs of the squad, not in draft, touched in the last 45 days, without an r+: never reviewed, or new code since. */
  reviewQueue() {
    const recent = periodOf(45);
    return this.members
      .flatMap((p) => this.featuresOf(p).map((f) => ({ f, p })))
      .filter(({ f }) => f.status === 'open' && !f._draft && f._activity.some((t) => inP(t, recent)))
      .flatMap(({ f, p }) => {
        if (!f.prs.some((x) => x.state === 'open' && !x.draft && x.missing_r)) return [];
        const revs = (f.gh ? f.gh.received : []).filter((rv) => this.reviewerLogin(rv) && !f._people.includes(this.reviewerLogin(rv)));
        const lastReview = Math.max(0, ...revs.map((rv) => rv.at));
        const lastCode = Math.max(0, ...f._events.filter((e) => e.type === 'code' || e.type === 'new').map((e) => e.t));
        if (revs.length && lastCode <= lastReview) return [];
        return [{ f, p, fresh: !revs.length, since: revs.length ? lastCode : f.gh?.opened_at || Math.min(...f._activity) }];
      })
      .sort((a, b) => a.since - b.since);
  }

  /** Waiting on me: a review GitHub asks of me, not set aside. */
  askedOfMe = (key: string) => this.requests.some((p) => p.pr === key && !this.asideReason(p));
  requestOf = (key: string) => this.requests.find((p) => p.pr === key) ?? this.followed.find((p) => p.pr === key);
  /** The PRs of the same branch in the other repositories, as GitHub asks them or mergebot batches them: one piece of work. */
  siblingsOf(key: string) {
    const request = this.requestOf(key);
    const page = this.data.reviewed_prs[key];
    return uniq([
      ...[...this.requests, ...this.followed]
        .filter((p) => request?.head && p.head === request.head && p.author === request.author)
        .map((p) => p.pr),
      ...(page?.linked ?? []).filter((l) => page?.branch && l.branch === page.branch).map((l) => `${l.repo}#${l.number}`),
    ]).filter((pr) => pr !== key);
  }

  feature(name: string) {
    this.byName ??= new Map(this.features.map((f) => [f.name, f]));
    return this.byName.get(name);
  }

  blockedPorts = () =>
    uniq(this.everyone.flatMap(this.featuresOf))
      .filter((f) => f.merged_at && this.portSteps(f).some((y) => y.state === 'blocked'))
      .sort((a, b) => (b.merged_at as number) - (a.merged_at as number));

  /** The squad as Work and Journey show it: one person, or the members. */
  workPeople = (who: string | null) => (who ? [who] : this.members);

  /** Where a member stands in the organisation: the lead of their squad, their role, their arrival. */
  orgOf(member: string) {
    const squads = this.data.org?.squads ?? {};
    const leader = Object.keys(squads).find((lead) => (squads[lead] ?? []).includes(member));
    return { leader, lead: !!squads[member] || member === this.lead, arrival: this.data.org?.arrivals?.[member] ?? null };
  }

  /**
   * Work: the features written over a period (open ones touched in the last 3 months always) and the features reviewed, by
   * status. Filtered on a reviewer: the features they reviewed in the period, whatever else happened on them.
   */
  workItems(W: WorkFilter) {
    const P = periodOf(+W.period);
    const people = this.workPeople(W.who);
    const q = W.q.trim().toLowerCase();
    const recent = periodOf(91);
    const reviewedBy = (f: Feat) => this.featureReviewers(f).some((y) => y.who === W.reviewer && inP(y.last, P));
    const own: OwnItem[] = uniq(people.flatMap(this.featuresOf))
      .filter((f) =>
        W.reviewer
          ? reviewedBy(f)
          : f._activity.some((t) => inP(t, P)) ||
            (f.merged_at && inP(f.merged_at, P)) ||
            (inProgress(f) && f._activity.some((t) => inP(t, recent))),
      )
      .map((f) => ({
        own: true,
        f,
        t: f.merged_at && inP(f.merged_at, P) ? f.merged_at : lastActivity(f),
        who: f._people.filter((x) => people.includes(x)),
      }));
    const given: GivenItem[] = W.reviewer
      ? []
      : people.flatMap((p) =>
          this.reviewsGiven(p, P).map((rv) => ({
            own: false as const,
            rv,
            t: rv.t,
            who: [p],
            code: this.codeOf(rv.pr),
            tasks: this.tasksOfPr(rv.pr).map(([t]) => t),
          })),
        );
    const odoo = !!this.data.odoo?.at;
    const statuses: [string, (x: OwnItem) => boolean][] = [
      ['all', () => true],
      ['open', (x) => x.f.status === 'open'],
      ['merged', (x) => !!x.f.merged_at && inP(x.f.merged_at, P)],
      ['wip', (x) => x.f.status === 'wip' && !x.f.deleted],
      ['ports', (x) => this.portsInFlight(x.f)],
      ...(odoo
        ? [['changes', (x: OwnItem) => x.f._tasks.some((t) => t.state === '02_changes_requested')] as [string, (x: OwnItem) => boolean]]
        : []),
    ];
    // The reviews by where their PR and its task stand; an r+ read from git is merged.
    const merged = (x: GivenItem) => (x.code ? x.code.merged : x.rv.src === 'r+');
    const moving = (x: GivenItem) => merged(x) && !!x.code && !!codeMoving(x.code);
    const open = (x: GivenItem) => !merged(x) && !x.code?.closed;
    const reviewStatuses: [string, (x: GivenItem) => boolean][] = [
      ['all', () => true],
      ['open', open],
      ['changes', (x) => open(x) && (reviewKind(x.rv) === 'changes' || x.tasks.some((t) => t.state === '02_changes_requested'))],
      ['ports', moving],
      ...(odoo
        ? [
            ['undeployed', (x: GivenItem) => merged(x) && !moving(x) && x.tasks.some(this.taskActive)] as [
              string,
              (x: GivenItem) => boolean,
            ],
          ]
        : []),
      ['deployed', (x) => this.settled(x.code, x.tasks)],
    ];
    const status = (statuses.find(([key]) => key === W.status) ?? statuses[0]) as [string, (x: OwnItem) => boolean];
    const reviewStatus = (reviewStatuses.find(([key]) => key === W.status) ?? reviewStatuses[0]) as [string, (x: GivenItem) => boolean];
    const items: WorkItem[] = [
      ...(W.role === 'given' ? [] : own.filter(status[1])),
      ...(W.role === 'own' ? [] : W.role === 'given' ? given.filter(reviewStatus[1]) : W.status !== 'all' ? [] : given),
    ]
      .filter((x) => !q || (x.own ? x.f._search : x.rv._search).includes(q))
      .sort((a, b) => b.t - a.t);
    // A feature opened from another page stays visible whatever the filters.
    const focus = W.feature ? this.feature(W.feature) : undefined;
    if (focus && !items.some((x) => x.own && x.f === focus))
      items.unshift({
        own: true,
        f: focus,
        t: lastActivity(focus),
        who: focus._people.filter((x) => this.everyone.includes(x)),
        outside: true,
      });
    return { P, own, given, items, statuses, reviewStatuses };
  }

  /** The timeline of Work: pushes, merges, PRs opened, commits, reviews and task moves of the people, newest first. */
  timelineEvents(who: string | null, P: Period, q: string, labelled: (type: string) => boolean) {
    const people = this.workPeople(who);
    const events: TimelineEvent[] = [];
    for (const f of uniq(people.flatMap(this.featuresOf))) {
      const authors = f._people.filter((p) => people.includes(p));
      for (const e of f._events) {
        if (!labelled(e.type) || !inP(e.t, P)) continue;
        const by = e.type === 'merge' ? authors : [f.owner].filter((p) => people.includes(p));
        if (by.length) events.push({ t: e.t, type: e.type, who: by, f });
      }
      if (people.includes(f.owner))
        for (const c of f._own) if (inP(c.at, P)) events.push({ t: c.at, type: 'commit', who: [f.owner], f, c });
    }
    for (const p of people)
      for (const r of this.reviews)
        if (r.reviewer === p && !r.fw && !r.onboarding && inP(r.t, P)) events.push({ t: r.t, type: 'review', who: [p], r });
    for (const task of this.allTasks()) {
      const by = task.squad.filter((p) => people.includes(p));
      if (by.length)
        for (const [t, stage, taskState] of task.changes || [])
          if (inP(t, P)) events.push({ t, type: 'task', who: by, task, stage, taskState });
    }
    const query = q.trim().toLowerCase();
    return events
      .filter((e) => !query || (e.f ? e.f._search : e.task ? e.task.name.toLowerCase() : (e.r?._search ?? '')).includes(query))
      .sort((a, b) => b.t - a.t);
  }

  /** What a person or a group did, from the features they wrote and the reviews they gave. */
  journeyBase(people: string[]): JourneyBase {
    return {
      people,
      mine: uniq(people.flatMap((p) => this.allFeaturesOf(p))).filter((f) => f.kind !== 'onboarding'),
      given: this.reviews.filter((r) => people.includes(r.reviewer) && !r.onboarding),
    };
  }

  /** The facts of a window: what was merged, reviewed, how fast, how often, on what. */
  facts(base: JourneyBase, P: Period) {
    const { people, mine } = base;
    const own = mine.filter((f) => f.kind !== 'forward-port');
    const merged = own.filter((f) => f.merged_at && inP(f.merged_at, P)).sort((a, b) => (b.merged_at as number) - (a.merged_at as number));
    const sized = merged.filter((f) => f.size);
    const reviewed = merged.filter((f) => f.gh);
    const opened = own.filter((f) => f.gh?.opened_at && inP(f.gh.opened_at, P));
    const active = own.filter((f) => f._activity.some((t) => inP(t, P)) || (f.merged_at && inP(f.merged_at, P)));
    const given = base.given.filter((r) => inP(r.t, P));
    const byFeature = new Map<string, Rev>();
    for (const r of given) {
      if (r.fw) continue;
      const key = `${r.reviewer}:${r._feature}`;
      const cur = byFeature.get(key);
      if (!cur || (r.src === 'r+' && cur.src !== 'r+')) byFeature.set(key, r);
    }
    const reviews = [...byFeature.values()].sort((a, b) => b.t - a.t);
    const events = mine.flatMap((f) => f._events.filter((e) => inP(e.t, P)));
    const code = events.filter((e) => e.type === 'code' || e.type === 'new').length;
    const rebase = events.filter((e) => e.type === 'rebase').length;
    const end = Math.min(P.to, now());
    const fixes = sized.filter((f) => f.kind === 'fix');
    const others = sized.filter((f) => f.kind !== 'fix');
    const pushesOf = (f: Feat) => f._events.filter((e) => e.type === 'code' || e.type === 'new').length;
    // A short fix that still took several rounds of code or days of work: the bug was hard to find, not the patch to write.
    const hardFixes = fixes.filter(
      (f) => lineValue(f) <= 40 && (pushesOf(f) >= 3 || (f._lead != null && f._lead / DAY >= 7 && (f.commit_count ?? 0) >= 2)),
    );
    const activeDays = uniq(
      [...mine.flatMap((f) => f._work), ...given.map((r) => r.t)]
        .filter((t) => inP(t, P))
        .map((t) => new Date(t * 1000).setHours(0, 0, 0, 0) / 1000),
    ).sort((a, b) => a - b);
    const bounds = [P.from, ...activeDays, end];
    const months = Math.max(0.5, (end - P.from) / (30.44 * DAY));
    const profile = ['back', 'front', 'views', 'data', 'test'].map((k) => sum(sized.map((f) => f.profile?.[k] || 0)));
    const together = (f: Feat) =>
      people.length === 1
        ? f.owner !== people[0] || !!f.coauthored
        : f._people.filter((p) => people.includes(p)).length > 1 || !!f.coauthored;
    return {
      P,
      months,
      merged,
      sized,
      reviewed,
      opened,
      active,
      reviews,
      profile,
      perMonth: merged.length / months,
      lines: sum(sized.map(lineValue)),
      rawLines: sum(sized.map((f) => f.size)),
      mechanical: sum(sized.map((f) => f.mechanical || 0)),
      fixes,
      hardFixes,
      fixesTested: fixes.filter((f) => f.test_lines),
      featuresSized: others,
      featuresTested: others.filter((f) => f.test_lines),
      featureComplexity: mean(others.map((f) => f.complexity)),
      lead: median(merged.map((f) => (f._lead == null ? null : f._lead / DAY))),
      firstReview: median(opened.map((f) => f._firstReview)),
      clean: reviewed.filter((f) => !f._rounds),
      heavy: reviewed.filter((f) => f._rounds > 1),
      cleanShare: reviewed.length ? reviewed.filter((f) => !f._rounds).length / reviewed.length : null,
      descWords: median(opened.filter((f) => people.includes(f.owner)).flatMap((f) => f.prs.map((p) => p.desc_words))),
      fw: mine.filter((f) => f.kind === 'forward-port' && f.merged_at && inP(f.merged_at, P)),
      closed: own.filter((f) => f.status === 'closed' && f._activity.some((t) => inP(t, P))),
      together: active.filter(together),
      rplus: reviews.filter((r) => r.src === 'r+').length,
      validations: reviews.filter((r) => r.src === 'github'),
      reviewedAuthors: uniq(reviews.map((r) => r.author)),
      code,
      rebase,
      rebaseRatio: code + rebase ? rebase / (code + rebase) : null,
      lastWork: Math.max(
        0,
        ...events.filter((e) => e.type !== 'rebase' && e.type !== 'other' && e.type !== 'merge').map((e) => e.t),
        ...given.map((r) => r.t),
        ...mine.flatMap((f) => f._own.map((c) => c.at)).filter((t) => inP(t, P)),
      ),
      rebasesSince: (t: number) => events.filter((e) => e.type === 'rebase' && e.t > t).length,
      activeDays: activeDays.length,
      activeWeeks: uniq(activeDays.map(weekStart)).length,
      weeks: Math.max(1, Math.round((end - P.from) / (7 * DAY))),
      gap: bounds
        .slice(1)
        .map((t, i) => ({ from: bounds[i] as number, to: t, days: Math.max(0, Math.round((t - (bounds[i] as number)) / DAY) - 1) }))
        .sort((a, b) => b.days - a.days)[0],
      domains: tally(active.map((f) => f.domain).filter((d): d is string => !!d && d !== 'Unknown')),
      topics: tally(active.flatMap(featureTopics)),
      countries: uniq(active.flatMap((f) => f.countries ?? [])).sort(),
      modules: uniq(active.flatMap((f) => Object.keys(f.modules ?? {}))),
    };
  }

  /** The person against their own previous 3 months, nobody else involved. */
  selfEvolution(base: JourneyBase, start: number) {
    const recent = Math.max(start, now() - 91 * DAY);
    const previous = Math.max(start, now() - 182 * DAY);
    const R = this.facts(base, { from: recent, to: now() + DAY });
    const B = this.facts(base, { from: previous, to: recent - 1 });
    const comparable = recent - previous >= 45 * DAY;
    const ratio = (r: number, b: number) => (b ? r / b >= 1.5 || r / b <= 2 / 3 : r > 0);
    const apart = (threshold: number) => (r: number, b: number) => Math.abs(r - b) >= threshold;
    type Row = {
      key: string;
      v: (f: Facts) => number | null;
      dir: number;
      n: (f: Facts) => number;
      min: number;
      pooled?: boolean;
      test: (r: number, b: number) => boolean;
    };
    const rows: Row[] = !comparable
      ? []
      : [
          { key: 'perMonth', v: (f) => f.perMonth, dir: 1, n: (f) => f.merged.length, min: 4, pooled: true, test: ratio },
          { key: 'complexity', v: (f) => f.featureComplexity, dir: 1, n: (f) => f.featuresSized.length, min: 6, test: apart(8) },
          { key: 'lead', v: (f) => f.lead, dir: -1, n: (f) => f.merged.length, min: 6, test: ratio },
          { key: 'cleanShare', v: (f) => f.cleanShare, dir: 1, n: (f) => f.reviewed.length, min: 8, test: apart(0.15) },
          {
            key: 'activeDays',
            v: (f) => f.activeDays / f.months,
            dir: 1,
            n: (f) => f.activeDays,
            min: 10,
            pooled: true,
            test: (r, b) => ratio(r, b) && Math.abs(r - b) >= 3,
          },
          { key: 'reviews', v: (f) => f.reviews.length / f.months, dir: 1, n: (f) => f.reviews.length, min: 3, pooled: true, test: ratio },
        ];
    return {
      R,
      B,
      comparable,
      rows: rows.map((row) => {
        const b = row.v(B);
        const r = row.v(R);
        const enough = b != null && r != null && (row.pooled ? row.n(B) + row.n(R) >= row.min : Math.min(row.n(B), row.n(R)) >= row.min);
        return {
          ...row,
          b,
          r,
          enough,
          change: enough && row.test(r as number, b as number) ? Math.sign((r as number) - (b as number)) : 0,
        };
      }),
    };
  }

  /** Why a request needs nothing from me: already r+, validated by a colleague, or a colleague's PR asked through a GitHub team. */
  asideReason(p: Request, name = (who: string) => who) {
    if (p.rplus.length) return { kind: 'rplus' as const, who: uniq(p.rplus.map(([who]) => name(who))) };
    if (p.validations.length) return { kind: 'validated' as const, who: uniq(p.validations.map(([who]) => name(who))) };
    // A colleague's PR is followed through its task and the pipe, whoever GitHub asks.
    if (p.colleague) return { kind: 'colleague' as const, who: [] };
    return null;
  }
}
