import {
  type Board,
  type Code,
  codeDone,
  type Feat,
  hasRplus,
  ownTask,
  rplusUndone,
  stageLabel,
  tagged,
  taskClosed,
  uniq,
  validated,
} from './model.ts';
import type { Received, Request, Task } from './types.ts';

/** What the reviewers said of a feature since its last code: changes asked, an approval, a comment, the r+ of each PR. */
export function reviewState(board: Board, f: Feat) {
  const code = Math.max(0, ...f._events.filter((e) => e.type === 'code' || e.type === 'new' || e.type === 'open').map((e) => e.t));
  const received = (f.gh?.received ?? []).filter((rv) => !f._people.includes(board.reviewerLogin(rv)));
  const since = received.filter((rv) => rv.at > code);
  const last = (state: string) => since.findLast((rv) => rv.state === state);
  const open = f.prs.filter((p) => p.state === 'open');
  return {
    code,
    received,
    open,
    changes: last('CHANGES_REQUESTED'),
    approved: last('APPROVED'),
    comment: last('COMMENTED'),
    rplus: !!f.merged_at || (!!open.length && open.every(hasRplus)),
  };
}

/** Where a task's stage stands in the pipe: Spec, Dev, Testing, Review, then Deployed. */
export function stageOf(stage?: string) {
  const name = stageLabel(stage).toLowerCase();
  if (name.includes('cancel')) return 'cancelled';
  if (name.includes('deploy') || name === 'done') return 'deployed';
  if (name.includes('review')) return 'review';
  if (name.includes('test')) return 'testing';
  if (name.startsWith('dev')) return 'dev';
  return 'spec';
}

/** Who reviews a task: its review-<trigram> tags, never the task's reviewer field. */
export const taskReviewers = (t: Task) => uniq(tagged(t, 'review'));

/**
 * One piece of work whatever it is opened from, a feature, a PR or a task: its task, the features doing it (their ports by
 * hand to other versions too) with their PRs and forward-ports, and the PRs no known feature holds. A feature the task only
 * links to does another task, a follow-up's original for one: it is related work, not this one.
 */
export type Unit = {
  title: string;
  features: Feat[];
  /** PRs reviewed or asked of me that no feature of the data holds: their branch names nobody it reads. */
  loose: string[];
  task: Task | undefined;
  related: Feat[];
  children: Task[];
  request: Request | undefined;
  authors: string[];
  codes: Code[];
};

export function unitOf(board: Board, kind: 'feature' | 'pr' | 'task', key: string): Unit | null {
  const holding = (pr: string) => board.prFeature(pr) ?? board.features.find((f) => f.prs.some((p) => `${p.repo}#${p.number}` === pr));
  // A forward-port is its source's, a port by hand the one of the feature it ports.
  const root = (f: Feat) => {
    const source = (f.fw_of && board.feature(f.fw_of)) || f;
    return (source.port_of && board.feature(source.port_of)) || source;
  };
  const seeds: Feat[] = [];
  const loose: string[] = [];
  let task: Task | undefined;
  if (kind === 'task') {
    task = board.taskOf(key);
    if (!task) return null;
  } else {
    const f = kind === 'feature' ? board.feature(key) : holding(key);
    if (f) {
      seeds.push(root(f));
      task = ownTask(root(f));
    } else if (kind === 'pr') {
      loose.push(key, ...board.siblingsOf(key).filter((pr) => !holding(pr)));
      task = board.mainTaskOfPr(key)[0];
    } else return null;
  }
  const linked = task ? board.featuresOfTask(task).map(root) : [];
  const owned = linked.filter((f) => ownTask(f) === task);
  const features = new Set<Feat>();
  const add = (f: Feat) => {
    if (features.has(f)) return;
    features.add(f);
    for (const port of board.manualPorts(f)) add(port.f);
  };
  for (const f of [...seeds, ...(owned.length || seeds.length ? owned : linked)]) add(f);
  const list = [...features];
  if (task && kind === 'task') loose.push(...board.prsOfTask(task).filter((pr) => !holding(pr)));
  const request = [...board.requests, ...board.followed].find(
    (p) => loose.includes(p.pr) || list.some((f) => f.prs.some((x) => `${x.repo}#${x.number}` === p.pr)),
  );
  const reviewed = loose.flatMap((pr) => board.reviews.filter((r) => r.pr === pr));
  return {
    title: list[0]?.title || list[0]?.name || request?.title || reviewed[0]?.subject || task?.name || key,
    features: list,
    loose: uniq(loose),
    task,
    related: uniq(linked.filter((f) => !features.has(f))),
    children: task ? board.allTasks().filter((t) => t.parent?.id === task.id) : [],
    request,
    authors: uniq([
      ...list.flatMap((f) => f._people),
      ...(request ? [request.who || request.author || ''] : []),
      ...reviewed.map((r) => r.author),
    ]).filter(Boolean) as string[],
    codes: [
      ...list.map(board.codeOfFeature),
      ...loose.flatMap((pr) => {
        const c = board.codeOf(pr);
        return c ? [c] : [];
      }),
    ],
  };
}

export type StepState = 'done' | 'now' | 'blocked' | 'todo';
/** The next move of a piece of work and whose it is; null when nobody is named: a dev to come, the PO, the mergebot. */
export type Next = { key: string; who: string | null; detail: string };

/**
 * Whose move a task is, from its stage and state. Spec: its author's, a dev's to take once approved. Dev: the dev's, the PO's
 * when the dev asks for details (changes requested) or hands it to testing (approved). Testing: the PO's, the dev's on changes
 * requested, the reviewer's once approved; validated by the PO (tober+), it waits for its test. Review: the reviewer's, the
 * dev's on changes requested; approved, the r+ is given and the code takes over: null.
 */
export function taskTurn(t: Task, dev: string | null, me: string): Next | null {
  const one = (people: string[]) => (people.includes(me) ? me : (people[0] ?? null));
  const next = (key: string, who: string | null): Next => ({ key, who, detail: '' });
  const devs = dev ? [dev] : t.people;
  const po = tagged(t, 'validation');
  const stage = stageOf(t.stage);
  if (taskClosed(t) || stage === 'deployed' || stage === 'cancelled') return null;
  if (t.state === '04_waiting_normal') return next('waiting', one(t.people));
  const changes = t.state === '02_changes_requested';
  const approved = t.state === '03_approved';
  if (stage === 'spec') return approved ? next('pick', null) : next('spec', one(t.people));
  if (stage === 'dev') return changes ? next('devAsks', one(po)) : approved ? next('toTesting', one(po)) : next('dev', one(devs));
  if (stage === 'testing')
    return changes
      ? next('testChanges', one(devs))
      : approved
        ? next('toReview', one(taskReviewers(t)))
        : validated(t)
          ? next('validated', null)
          : next('testing', one(po));
  return changes ? next('changes', one(devs)) : approved ? null : next('review', one(taskReviewers(t)));
}

/**
 * Where a piece of work stands: along its task's stages (the ones it went through, and those ahead), then merged, forward-
 * ported up to master and Deployed, which waits for master; without a task, along its code. And what comes next.
 */
export function progress(board: Board, u: Unit) {
  const pending = u.features.filter((f) => f.status !== 'closed' && !f.merged_at).map((f) => ({ f, ...reviewState(board, f) }));
  const codes = u.codes.filter((c) => !c.closed);
  const merged = codes.length > 0 && codes.every((c) => c.merged);
  const ports = codes.flatMap((c) => c.steps);
  const portsBlocked = uniq(ports.filter((y) => y.state === 'blocked').map((y) => y.branch));
  const portsOpen = uniq(ports.filter((y) => y.state === 'open').map((y) => y.branch));
  // A backport's chain stops where the work was first merged: one line up to master is enough.
  const master = merged && !portsBlocked.length && !portsOpen.length && codes.some(codeDone);
  const changes = pending.find((x) => x.changes);
  const rplus = merged || (pending.length ? pending.every((x) => x.rplus) : codes.some((c) => c.pr && !c.pr.missing_r));
  const blocked = pending.some((x) => x.rplus && x.open.some((p) => p.blocked));
  const writing = pending.find((x) => x.f._draft || !x.open.length);
  const t = u.task;
  const stage = t ? stageOf(t.stage) : null;
  const deployed = stage === 'deployed';
  const code: { key: string; state: StepState }[] = [
    { key: 'merge', state: merged ? 'done' : blocked ? 'blocked' : rplus ? 'now' : 'todo' },
    { key: 'master', state: master ? 'done' : !merged ? 'todo' : portsBlocked.length ? 'blocked' : 'now' },
  ];
  let steps: { key: string; state: StepState }[];
  if (t && stage !== 'cancelled') {
    const pipe = ['spec', 'dev', 'testing', 'review'];
    const visited = new Set([...(t.changes ?? []).map(([, s]) => stageOf(s)), stage]);
    const current = deployed ? pipe.length : pipe.indexOf(stage as string);
    const approved = t.state === '03_approved';
    steps = pipe.flatMap((key, i): { key: string; state: StepState }[] => {
      if (i < current && !visited.has(key)) return [];
      if (i < current || (i === current && approved)) return [{ key, state: 'done' }];
      if (i === current) return [{ key, state: t.state === '02_changes_requested' ? 'blocked' : 'now' }];
      return [{ key, state: i === current + 1 && approved ? 'now' : 'todo' }];
    });
    steps.push(...code, { key: 'deployed', state: deployed ? 'done' : master ? 'now' : 'todo' });
  } else {
    steps = [
      { key: 'code', state: u.features.some((f) => f._activity.length) || u.loose.length ? 'done' : 'now' },
      { key: 'review', state: rplus ? 'done' : changes ? 'blocked' : writing && pending.length === 1 ? 'todo' : 'now' },
      ...code,
    ];
  }

  const owner = u.features[0]?.owner ?? u.authors[0] ?? null;
  const reviewers = t ? taskReviewers(t) : [];
  const reviewer = reviewers.includes(board.me) ? board.me : (reviewers[0] ?? null);
  const asked = !!u.request && !board.asideReason(u.request);
  const next = (key: string, who: string | null, detail = ''): Next => ({ key, who, detail });
  const tail = () => {
    if (blocked) return next('mergebot', owner);
    if (!merged) return next('merging', null);
    if (portsBlocked.length) return next('portBlocked', owner, portsBlocked.join(', '));
    if (!master) return next('ports', null, portsOpen.join(', '));
    return t && !deployed ? next('deploy', reviewer) : next('done', null);
  };
  const following = () => {
    if (deployed) return next('done', null);
    const turn = t ? taskTurn(t, owner, board.me) : null;
    if (turn) return turn.key === 'changes' && changes ? { ...turn, detail: board.reviewerLogin(changes.changes as Received) } : turn;
    const undone = merged ? null : [u.request, ...u.loose.map(board.requestOf)].map(rplusUndone).find((x) => x);
    if (undone) return next(undone[0], board.me, undone[2]);
    if (t && stage === 'review') return tail();
    if (changes) return next('changes', changes.f.owner, board.reviewerLogin(changes.changes as Received));
    if (pending.some((x) => x.f._ciFail)) return next('ci', owner);
    if (writing && !rplus) return next('writing', writing.f.owner);
    const comment = pending.find((x) => !x.rplus && x.comment);
    if (comment) return next('comments', comment.f.owner, board.reviewerLogin(comment.comment as Received));
    const approved = pending.find((x) => !x.rplus && x.approved);
    if (approved) return next('rplus', board.reviewerLogin(approved.approved as Received));
    if (!rplus) return next('review', asked ? board.me : reviewer);
    return tail();
  };
  const reached = codes.some((c) => c.version === 'master' || c.steps.some((y) => y.branch === 'master'));
  const stopped =
    master && !reached ? (ports.findLast((y) => y.state === 'closed') ?? ports.at(-1))?.branch || codes[0]?.version : undefined;
  return { steps, next: following(), portsLeft: [...portsBlocked, ...portsOpen], stopped };
}
