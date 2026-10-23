import { describe, expect, test } from 'vitest';
import { Board, DAY, hasRplus, now } from './model.ts';
import type { Feature, Linked, Request, SquadData, Task } from './types.ts';
import { progress, taskTurn, unitOf } from './unit.ts';

const ago = (days: number) => now() - days * DAY;
const linked = (number: number, branch: string, state: string): Linked => ({ repo: 'odoo/odoo', number, branch, state });
const feature = (name: string, x: Partial<Feature>): Feature => ({
  name,
  owner: 'bob',
  kind: 'fix',
  version: '18.0',
  status: 'merged',
  merged_at: ago(10),
  prs: [],
  pushes: [{ at: ago(12), kind: 'push', repo: 'odoo' }],
  commits: [],
  tasks: ['7'],
  reviewers: ['ann'],
  branches: {},
  modules: {},
  opws: [],
  countries: [],
  ...x,
});
const task: Task = {
  id: 7,
  name: 'Fix it',
  stage: 'RD Review',
  state: '03_approved',
  people: ['bob'],
  squad: [],
  reviewer: 'ann',
  tags: [],
};

function boardOf(master: string, { requests = [] as Request[], features = [] as Feature[], tasks = [] as Task[] } = {}) {
  const fix = feature('18.0-fix-bob', {
    prs: [
      {
        repo: 'odoo/odoo',
        number: 10,
        state: 'merged',
        merged_at: ago(10),
        linked: [linked(10, '18.0', 'merged'), linked(11, '19.0', 'merged'), linked(12, 'master', master)],
      },
    ],
  });
  const backport = feature('17.0-fix-bob', { version: '17.0', port_of: fix.name, tasks: [], merged_at: ago(8) });
  const data: SquadData = {
    generated_at: null,
    me: 'ann',
    squad: null,
    org: { squads: {}, arrivals: {} },
    review_requests: { login: 'ann-odoo', at: now(), total: requests.length, prs: requests },
    version_forks: {},
    features: [fix, backport, ...features],
    reviews: [{ id: 'r1', reviewer: 'ann', pr: 'odoo/odoo#10', t: ago(11), author: 'bob', src: 'github', state: 'APPROVED' }],
    reviewed_prs: {},
    odoo: { tasks: Object.fromEntries([task, ...tasks].map((t) => [t.id, t])), stages: {}, at: now(), error: null, not_found: [] },
    logins: {},
  };
  return new Board(data);
}

describe('a piece of work', () => {
  test('a PR I reviewed, a task or a feature open the same work: the feature, its port by hand, its task', () => {
    const board = boardOf('open');
    for (const [kind, key] of [
      ['pr', 'odoo/odoo#10'],
      ['task', '7'],
      ['feature', '17.0-fix-bob'],
    ] as const) {
      const u = unitOf(board, kind, key);
      expect(u?.features.map((f) => f.name)).toEqual(['18.0-fix-bob', '17.0-fix-bob']);
      expect(u?.task?.id).toBe(7);
    }
  });

  test('merged but not yet in master: the forward-ports come first, then Deployed', () => {
    const board = boardOf('open');
    const P = progress(board, unitOf(board, 'pr', 'odoo/odoo#10') as NonNullable<ReturnType<typeof unitOf>>);
    expect(P.steps.map((s) => [s.key, s.state])).toEqual([
      ['review', 'done'],
      ['merge', 'done'],
      ['master', 'now'],
      ['deployed', 'todo'],
    ]);
    expect(P.next).toMatchObject({ key: 'ports', detail: 'master' });
  });

  test('in master, the task waits for its reviewer to move it to Deployed', () => {
    const board = boardOf('merged');
    const P = progress(board, unitOf(board, 'task', '7') as NonNullable<ReturnType<typeof unitOf>>);
    expect(P.steps.find((s) => s.key === 'master')?.state).toBe('done');
    expect(P.next).toEqual({ key: 'deploy', who: 'ann', detail: '' });
  });

  test('a chain stopped before master is done a day after its last merge, mergebot opening the next port up to hours later', () => {
    const stoppedAt20 = (days: number) => {
      const fix = feature('19.0-fix-carl', {
        version: '19.0',
        tasks: [],
        merged_at: ago(days),
        prs: [
          {
            repo: 'odoo/odoo',
            number: 30,
            state: 'merged',
            merged_at: ago(days),
            linked: [linked(30, '19.0', 'merged'), linked(31, '20.0', 'merged')],
          },
        ],
      });
      const board = boardOf('merged', { features: [fix] });
      const P = progress(board, unitOf(board, 'pr', 'odoo/odoo#30') as NonNullable<ReturnType<typeof unitOf>>);
      return [P.steps.find((s) => s.key === 'master')?.state, P.next.key, P.stopped];
    };
    expect(stoppedAt20(0.1)).toEqual(['now', 'ports', undefined]);
    expect(stoppedAt20(2)).toEqual(['done', 'done', '20.0']);
  });

  test('a PR of someone the dashboard does not read, asked of me, waits for my review', () => {
    const request: Request = {
      pr: 'odoo/odoo#99',
      url: 'https://github.com/odoo/odoo/pull/99',
      title: 'Outside',
      author: 'carl',
      created_at: ago(2),
      direct: true,
      teams: [],
      other_teams: 0,
      ids: {},
      validations: [],
      rplus: [],
    };
    const board = boardOf('open', { requests: [request] });
    const u = unitOf(board, 'pr', 'odoo/odoo#99') as NonNullable<ReturnType<typeof unitOf>>;
    expect(u).toMatchObject({ features: [], loose: ['odoo/odoo#99'], title: 'Outside', authors: ['carl'] });
    expect(progress(board, u).next).toMatchObject({ key: 'review', who: 'ann' });
  });
});

test("a PR of someone not read is one work with its branch's PRs in the other repositories, whichever undid my r+", () => {
  const side = (pr: string, x: Partial<Request> = {}): Request => ({
    pr,
    url: '',
    title: 'Outside',
    author: 'carl',
    head: 'saas-19.2-fix-carl',
    created_at: ago(3),
    direct: true,
    teams: [],
    other_teams: 0,
    ids: {},
    validations: [],
    rplus: [],
    rplus_at: ago(2),
    ...x,
  });
  const board = boardOf('open', {
    requests: [side('odoo/odoo#99'), side('odoo/enterprise#98', { pushed_at: ago(1) }), side('odoo/enterprise#97', { head: 'other' })],
  });
  const u = unitOf(board, 'pr', 'odoo/odoo#99') as NonNullable<ReturnType<typeof unitOf>>;
  expect(u.loose).toEqual(['odoo/odoo#99', 'odoo/enterprise#98']);
  expect(progress(board, u).next).toMatchObject({ key: 'pushed', who: 'ann' });
});

test('a follow-up is its own work: the original it links to, done in another task, is related work', () => {
  const followUp = feature('20.0-fix-follow-up-bob', {
    version: '20.0',
    status: 'open',
    merged_at: null,
    tasks: ['8'],
    prs: [{ repo: 'odoo/odoo', number: 20, state: 'open', missing_r: true }],
  });
  const board = boardOf('merged', {
    features: [followUp],
    tasks: [{ ...task, id: 8, name: 'Follow-up', state: '01_in_progress', links: { prs: ['odoo/odoo#10', 'odoo/odoo#20'] } }],
  });
  const u = unitOf(board, 'task', '8') as NonNullable<ReturnType<typeof unitOf>>;
  expect(u.features.map((f) => f.name)).toEqual(['20.0-fix-follow-up-bob']);
  expect(u.related.map((f) => f.name)).toEqual(['18.0-fix-bob']);
  expect(unitOf(board, 'pr', 'odoo/odoo#20')?.task?.id).toBe(8);
});

test('a PR has its own r+: the mergebot reviews each PR of a batch apart', () => {
  expect(hasRplus({ repo: 'odoo/odoo', number: 1, state: 'open', missing_r: true, review: 'ok' })).toBe(true);
  expect(hasRplus({ repo: 'odoo/enterprise', number: 2, state: 'open', missing_r: true, review: 'fail' })).toBe(false);
  expect(hasRplus({ repo: 'odoo/odoo', number: 3, state: 'open', missing_r: false })).toBe(true);
});

test('the pipe says whose move a task is', () => {
  const at = (stage: string, state: string, tags: string[] = []): Task => ({ ...task, stage, state, tags, people: ['dan'] });
  const turn = (t: Task) => taskTurn(t, 'bob', 'ann');
  expect(turn(at('RD Spec', '01_in_progress'))).toMatchObject({ key: 'spec', who: 'dan' });
  expect(turn(at('RD Spec', '03_approved'))).toMatchObject({ key: 'pick', who: null });
  expect(turn(at('RD Dev', '01_in_progress'))).toMatchObject({ key: 'dev', who: 'bob' });
  expect(turn(at('RD Dev', '02_changes_requested', ['validation-ann']))).toMatchObject({ key: 'devAsks', who: 'ann' });
  expect(turn(at('RD Testing BE', '01_in_progress', ['validation-ann']))).toMatchObject({ key: 'testing', who: 'ann' });
  expect(turn(at('RD Testing BE', '02_changes_requested'))).toMatchObject({ key: 'testChanges', who: 'bob' });
  expect(turn(at('RD Testing BE', '03_approved', ['review-ann']))).toMatchObject({ key: 'toReview', who: 'ann' });
  expect(turn(at('RD Testing BE', '01_in_progress', ['validation-ann', 'tober+']))).toMatchObject({ key: 'validated', who: null });
  expect(turn(at('RD Review', '01_in_progress', ['review-ann']))).toMatchObject({ key: 'review', who: 'ann' });
  expect(turn(at('RD Review', '03_approved'))).toBeNull();
});

test('master shows the version it went out in, or the one it will be', () => {
  const board = boardOf('open');
  board.data.version_forks = { '19.0': ago(400), '20.0': ago(30) };
  expect(board.versionLabel('master', ago(60))).toBe('20.0');
  expect(board.versionLabel('master')).toBe('saas-20.1 (master)');
  expect(board.versionLabel('18.0')).toBe('18.0');
});
