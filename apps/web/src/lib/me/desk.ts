import {
  type Board,
  type Code,
  type ColumnItem,
  codeDone,
  codeMoving,
  type Feat,
  hasRplus,
  inP,
  type Period,
  rplusUndone,
  taskClosed,
  uniq,
} from '../squad/model.ts';
import type { Request, Task } from '../squad/types.ts';
import { reviewState, stageOf, taskTurn } from '../squad/unit.ts';

/** Where an item stands for me: it waits for me, I am on it, or it waits for someone else. */
export type Lane = 'now' | 'doing' | 'waiting';
export type Side = 'write' | 'review' | 'validate';
export type Why =
  | 'changes'
  | 'ci'
  | 'mergeBlocked'
  | 'portBlocked'
  | 'undone'
  | 'revalidate'
  | 'validationOutdated'
  | 'comments'
  | 'again'
  | 'reviewValidated'
  | 'toValidate'
  | 'deploy'
  | 'toReview'
  | 'devAsks'
  | 'toTesting'
  | 'spec'
  | 'asked'
  | 'wip'
  | 'draft'
  | 'noPr'
  | 'review'
  | 'rplus'
  | 'merge'
  | 'ports'
  | 'task'
  | 'validating'
  | 'validated'
  | 'approved'
  | 'fixing';

export type DeskItem = {
  key: string;
  side: Side;
  lane: Lane;
  why: Why;
  /** Since when it stands there. */
  t: number;
  /** The reviewer it comes from on my code, the author of the code I review. */
  who?: string;
  f?: Feat;
  task?: Task;
  request?: Request;
  column?: ColumnItem;
  /** The code of a review I gave the r+ to, once mergebot read. */
  code?: Code;
  /** The PRs of the same branch in the other repositories, which the item stands for too. */
  siblings?: string[];
  search: string;
};

/** Why a feature of mine is where it is, since when, and who it comes from. */
function writing(board: Board, f: Feat, t: number): [Why, number, string?] {
  const steps = board.portSteps(f);
  if (f.merged_at) {
    if (steps.some((y) => y.state === 'blocked')) return ['portBlocked', f.merged_at];
    return [steps.some((y) => y.state === 'open') ? 'ports' : 'task', f.merged_at];
  }
  const { code, open, changes, approved, comment } = reviewState(board, f);
  if (!open.length) return [f.status === 'wip' ? 'wip' : 'noPr', t];
  if (f._draft) return ['draft', t];
  const task = board.mainTask(f);
  // Unlike a GitHub review, a push does not answer changes asked on the task: they stand until the task moves on.
  if (changes || task?.state === '02_changes_requested')
    return [
      'changes',
      changes?.at ?? task?.changes?.at(-1)?.[0] ?? task?.stage_since ?? t,
      changes ? board.reviewerLogin(changes) : (task?.reviewer ?? undefined),
    ];
  if (f._ciFail) return ['ci', t];
  if (open.every(hasRplus)) return [open.some((p) => p.blocked) ? 'mergeBlocked' : 'merge', t];
  if (approved) return ['rplus', approved.at, board.reviewerLogin(approved)];
  if (comment) return ['comments', comment.at, board.reviewerLogin(comment)];
  return ['review', code || t];
}

/** What the code of an approved review waits for, with the branches when it is the ports. */
export function columnWait(live: Code[]): [string, string] {
  if (!live.length) return ['noPr', ''];
  const open = live.filter((c) => !c.merged);
  if (open.length) {
    const prs = open.flatMap((c): { missing_r?: boolean; blocked?: boolean }[] =>
      c.f ? c.f.prs.filter((p) => p.state === 'open') : c.pr ? [c.pr] : [],
    );
    return [prs.some((p) => p.missing_r) ? 'rMissing' : prs.some((p) => p.blocked) ? 'mergebot' : 'notMerged', ''];
  }
  const moving = live.map(codeMoving).filter((y) => !!y);
  if (!moving.length) return ['portsNotYet', ''];
  return [moving.some((y) => y.state === 'blocked') ? 'portsBlocked' : 'portsMoving', uniq(moving.map((y) => y.branch)).join(', ')];
}

/**
 * My desk: my code, the reviews and validations I owe, by what they wait for, the most pressing first; the reviews asked of
 * my GitHub teams apart; what I merged and reviewed over a period.
 */
export function desk(board: Board, P: Period) {
  const order: [Why, Lane][] = [
    ['changes', 'now'],
    ['ci', 'now'],
    ['mergeBlocked', 'now'],
    ['portBlocked', 'now'],
    ['undone', 'now'],
    ['revalidate', 'now'],
    ['validationOutdated', 'now'],
    ['comments', 'now'],
    ['again', 'now'],
    ['reviewValidated', 'now'],
    ['toValidate', 'now'],
    ['deploy', 'now'],
    ['toReview', 'now'],
    ['devAsks', 'now'],
    ['toTesting', 'now'],
    ['spec', 'now'],
    ['asked', 'now'],
    ['wip', 'doing'],
    ['draft', 'doing'],
    ['noPr', 'doing'],
    ['review', 'waiting'],
    ['rplus', 'waiting'],
    ['merge', 'waiting'],
    ['ports', 'waiting'],
    ['task', 'waiting'],
    ['validating', 'waiting'],
    ['validated', 'waiting'],
    ['approved', 'waiting'],
    ['fixing', 'waiting'],
  ];
  const lanes = new Map(order);
  const rank = order.map(([why]) => why);
  const item = (side: Side, why: Why, t: number, x: Omit<DeskItem, 'side' | 'why' | 'lane' | 't'>): DeskItem => ({
    side,
    why,
    lane: lanes.get(why) as Lane,
    t,
    ...x,
  });
  // Given my r+, a review waits on the mergebot, as an approved task does, unless a push, an r- or a conflict undid it.
  const requestItem = (p: Request, code?: Code) => {
    const undone = !code?.merged && rplusUndone(p);
    return item(
      'review',
      undone ? 'undone' : p.rplus_at ? 'approved' : 'asked',
      undone ? undone[1] : p.rplus_at || p.asked_at || p.created_at,
      {
        key: `pr:${p.pr}`,
        request: p,
        code,
        siblings: board.siblingsOf(p.pr),
        who: p.who || p.author,
        search: [p.pr, p.title, p.author, p.who].join(' ').toLowerCase(),
      },
    );
  };
  const column = board.data.odoo?.at ? board.reviewColumn() : { again: [], fixing: [], waiting: [], ready: [] };
  const asked = new Map(board.requests.filter((p) => !board.asideReason(p)).map((p) => [p.pr, p]));
  // A colleague's PR I gave the r+ to is followed through its task, if it has one.
  const followed = new Map(board.followed.filter((p) => !p.colleague || !board.tasksOfPr(p.pr).length).map((p) => [p.pr, p]));
  const reviewed = new Set<number>();
  const items: DeskItem[] = [];
  const columnTask = (x: ColumnItem, why: Why, side: Side = 'review', since = x.since) => {
    const prs = board.prsOfTask(x.t);
    const request = prs.map((key) => asked.get(key)).find((p) => !!p);
    // An approved task whose PR moved since my r+ is mine again.
    const undone =
      why === 'approved' ? board.followed.find((p) => prs.includes(p.pr) && !board.codeOf(p.pr)?.merged && rplusUndone(p)) : undefined;
    for (const key of prs) {
      asked.delete(key);
      followed.delete(key);
    }
    reviewed.add(x.t.id);
    items.push(
      item(side, undone ? 'undone' : why, undone ? (rplusUndone(undone)?.[1] ?? since) : since, {
        key: `task:${x.t.id}`,
        task: x.t,
        column: x,
        request: undone ?? request,
        who: x.t.people.find((p) => p !== board.me),
        search: `${x.t.id} ${x.t.name} ${x.t.people.join(' ')}`.toLowerCase(),
      }),
    );
  };
  // In review, a task waits for its validators first: validated (tober+), it is mine to review.
  for (const x of column.again) {
    const v = board.validationOf(x.t);
    if (!v) columnTask(x, 'again');
    else if (v.by.includes(board.me) && v.state !== 'done') columnTask(x, v.state === 'pending' ? 'toValidate' : 'revalidate', 'validate');
    else columnTask(x, v.state === 'pending' ? 'validating' : v.state === 'outdated' ? 'validationOutdated' : 'reviewValidated');
  }
  for (const [list, why] of [
    [column.ready, 'deploy'],
    [column.waiting, 'approved'],
    [column.fixing, 'fixing'],
  ] as const)
    for (const x of list) columnTask(x, why);
  // My Validation column, apart from the stages: the tasks of my validation-<trigram> tag from Testing on, from Dev once
  // validated. Validated (tober+), nothing is left for me to do but validate again what was pushed since.
  for (const t of board.allTasks()) {
    const v = taskClosed(t) || reviewed.has(t.id) ? null : board.validationOf(t);
    const stage = stageOf(t.stage);
    if (!v?.by.includes(board.me) || !['dev', 'testing', 'review'].includes(stage) || (stage === 'dev' && v.state === 'pending')) continue;
    const x = board.columnItem(t);
    if (v.state === 'outdated') columnTask(x, 'revalidate', 'validate', v.pushed);
    else if (v.state === 'done') columnTask(x, 'validated', 'validate', v.at || x.since);
    else columnTask(x, t.state === '02_changes_requested' || t.state === '04_waiting_normal' ? 'fixing' : 'toValidate', 'validate');
  }
  items.push(...[...asked.values()].filter((p) => p.direct).map((p) => requestItem(p)));
  for (const p of followed.values()) {
    const code = board.codeOf(p.pr) ?? undefined;
    if (!code || !(code.closed || codeDone(code))) items.push(requestItem(p, code));
  }
  // Elsewhere than in my Review and Validation columns, the pipe hands a task to me as its PO or its reviewer once tested.
  const handed = (t: Task) => {
    const turn = taskTurn(t, board.featuresOfTask(t)[0]?.owner ?? null, board.me);
    return turn?.who === board.me && ['spec', 'devAsks', 'toTesting', 'toReview'].includes(turn.key) ? (turn.key as Why) : null;
  };
  const taskItem = (t: Task, why: Why) =>
    item(why === 'noPr' ? 'write' : 'review', why, t.stage_since || t.updated || 0, {
      key: `task:${t.id}`,
      task: t,
      who: t.people.find((p) => p !== board.me),
      search: `${t.id} ${t.name} ${t.people.join(' ')}`.toLowerCase(),
    });
  for (const x of board.currentWork(board.me)) {
    if (x.task) {
      if (!reviewed.has(x.task.id)) items.push(taskItem(x.task, handed(x.task) ?? 'noPr'));
    } else if (x.f && (x.f._people.includes(board.me) || !x.f._tasks.some((t) => reviewed.has(t.id)))) {
      const [why, t, who] = writing(board, x.f, x.t);
      items.push(item('write', why, t, { key: `feature:${x.f.name}`, f: x.f, who, search: x.f._search }));
    }
  }
  const listed = new Set(items.flatMap((x) => [x.task?.id, ...(x.f?._tasks.map((t) => t.id) ?? [])]));
  for (const t of board.allTasks()) {
    const why = !listed.has(t.id) && handed(t);
    if (why) items.push(taskItem(t, why));
  }
  // The PRs of one branch in several repositories are one piece of work: the most pressing of them stands for the others.
  const groups: { prs: Set<string>; x: DeskItem }[] = [];
  for (const x of items.filter((x) => x.request && x.key.startsWith('pr:'))) {
    const prs = [x.request?.pr as string, ...(x.siblings ?? [])];
    const group = groups.find((g) => prs.some((pr) => g.prs.has(pr)));
    if (!group) groups.push({ prs: new Set(prs), x });
    else {
      for (const pr of prs) group.prs.add(pr);
      if (rank.indexOf(x.why) < rank.indexOf(group.x.why)) group.x = x;
    }
  }
  const shown = new Set(groups.map((g) => g.x));
  const lane = (name: Lane) => items.filter((x) => x.lane === name && (!x.key.startsWith('pr:') || shown.has(x)));
  return {
    now: lane('now').sort((a, b) => rank.indexOf(a.why) - rank.indexOf(b.why) || a.t - b.t),
    doing: lane('doing').sort((a, b) => b.t - a.t),
    waiting: lane('waiting').sort((a, b) => a.t - b.t),
    teams: [...asked.values()]
      .filter((p) => !p.direct)
      .map((p) => requestItem(p))
      .sort((a, b) => a.t - b.t),
    aside: board.requests.filter((p) => board.asideReason(p)).length,
    merged: board
      .featuresOf(board.me)
      .filter((f) => f.merged_at && inP(f.merged_at, P))
      .sort((a, b) => (b.merged_at as number) - (a.merged_at as number)),
    reviewed: board.reviewsGiven(board.me, P),
  };
}
export type Desk = ReturnType<typeof desk>;
