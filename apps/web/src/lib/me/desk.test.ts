import { describe, expect, test } from 'vitest';
import { Board, DAY, now, periodOf } from '../squad/model.ts';
import type { Feature, Request, ReviewedPr, SquadData, Task } from '../squad/types.ts';
import { desk } from './desk.ts';

const ago = (days: number) => now() - days * DAY;
const feature = (name: string, x: Partial<Feature>): Feature => ({
  name,
  owner: 'ann',
  kind: 'feature',
  version: 'master',
  status: 'open',
  prs: [{ repo: 'odoo/odoo', number: 1, state: 'open', missing_r: true }],
  pushes: [{ at: ago(5), kind: 'push', repo: 'odoo' }],
  commits: [],
  tasks: [],
  reviewers: [],
  branches: {},
  modules: {},
  opws: [],
  countries: [],
  ...x,
});
const request = (pr: string, x: Partial<Request> = {}): Request => ({
  pr,
  url: `https://github.com/${pr.replace('#', '/pull/')}`,
  title: pr,
  author: 'carl',
  created_at: ago(4),
  direct: true,
  teams: [],
  other_teams: 0,
  ids: {},
  validations: [],
  rplus: [],
  ...x,
});

function deskOf({
  features = [] as Feature[],
  requests = [] as Request[],
  followed = [] as Request[],
  reviewed = {} as Record<string, ReviewedPr>,
  tasks = [] as Task[],
} = {}) {
  const data: SquadData = {
    generated_at: null,
    me: 'ann',
    squad: null,
    org: { squads: {}, arrivals: {} },
    review_requests: { login: 'ann-odoo', at: now(), total: requests.length, prs: requests, followed, teams: ['rd-hr'] },
    version_forks: {},
    features,
    reviews: [],
    reviewed_prs: reviewed,
    odoo: { tasks: Object.fromEntries(tasks.map((t) => [String(t.id), t])), stages: {}, at: now(), error: null, not_found: [] },
    logins: {},
  };
  return desk(new Board(data), periodOf(14));
}
const whys = (items: { why: string }[]) => items.map((x) => x.why);

describe('my code', () => {
  test('changes asked after my last push wait for me, from their reviewer', () => {
    const D = deskOf({ features: [feature('a', { gh: { received: [{ who: 'bob', state: 'CHANGES_REQUESTED', at: ago(2) }] } })] });
    expect(D.now).toMatchObject([{ why: 'changes', who: 'bob', side: 'write' }]);
  });

  test('a push after the changes sends it back to the reviewers', () => {
    const D = deskOf({
      features: [feature('a', { gh: { received: [{ who: 'bob', state: 'CHANGES_REQUESTED', at: ago(6) }] } })],
    });
    expect(whys(D.waiting)).toEqual(['review']);
  });

  test('changes asked on my task wait for me until the task moves on, even after a push', () => {
    const asked = ago(8);
    const task: Task = {
      id: 8,
      name: 'POC',
      stage: 'RD Testing BE',
      state: '02_changes_requested',
      people: ['dan', 'ann'],
      squad: ['ann'],
      tags: [],
      links: { prs: ['odoo/odoo#1'] },
      changes: [[asked, 'RD Testing BE', '02_changes_requested']],
      stage_since: ago(9),
    };
    const D = deskOf({ features: [feature('a', { pushes: [{ at: ago(1), kind: 'push', repo: 'odoo' }] })], tasks: [task] });
    expect(D.now).toMatchObject([{ why: 'changes', key: 'feature:a', t: asked }]);
    expect(D.waiting).toEqual([]);
  });

  test('a draft and a branch without a PR are in progress, an r+ waits for the merge', () => {
    const D = deskOf({
      features: [
        feature('draft', { prs: [{ repo: 'odoo/odoo', number: 2, state: 'open', draft: true }] }),
        feature('branch', { status: 'wip', prs: [] }),
        feature('approved', { prs: [{ repo: 'odoo/odoo', number: 3, state: 'open', missing_r: false }] }),
      ],
    });
    expect(whys(D.doing).sort()).toEqual(['draft', 'wip']);
    expect(whys(D.waiting)).toEqual(['merge']);
  });

  test('merged over the period counts as done, not before', () => {
    const D = deskOf({
      features: [
        feature('new', { status: 'merged', merged_at: ago(3), prs: [] }),
        feature('old', { status: 'merged', merged_at: ago(40), prs: [] }),
      ],
    });
    expect(D.merged.map((f) => f.name)).toEqual(['new']);
  });
});

describe('my reviews', () => {
  const task: Task = {
    id: 7,
    name: 'Fix it',
    stage: 'RD Review',
    state: '01_in_progress',
    people: ['carl'],
    squad: [],
    reviewer: 'ann',
    tags: [],
    links: { prs: ['odoo/odoo#9'] },
    stage_since: ago(3),
  };

  test('a request on the PR of a task of my review column is that task, once', () => {
    const D = deskOf({ tasks: [task], requests: [request('odoo/odoo#9')] });
    expect(D.now).toMatchObject([{ why: 'again', key: 'task:7', who: 'carl', request: { pr: 'odoo/odoo#9' } }]);
  });

  test('a review with changes requested is with the dev, not with me', () => {
    const D = deskOf({ tasks: [{ ...task, state: '02_changes_requested' }] });
    expect(D.now).toEqual([]);
    expect(D.waiting).toMatchObject([{ why: 'fixing', key: 'task:7' }]);
  });

  test('requests to my teams stay apart, those already r+ are set aside', () => {
    const D = deskOf({
      requests: [
        request('odoo/odoo#10'),
        request('odoo/odoo#11', { direct: false, teams: ['rd-hr'] }),
        request('odoo/odoo#12', { rplus: [['dan', ago(1)]] }),
      ],
    });
    expect(D.now.map((x) => x.key)).toEqual(['pr:odoo/odoo#10']);
    expect(D.teams.map((x) => x.key)).toEqual(['pr:odoo/odoo#11']);
    expect(D.aside).toBe(1);
  });

  test('a review I gave the r+ to waits on the mergebot until merged and ported; a colleague’s PR, on its task if any', () => {
    const page = (x: Partial<ReviewedPr>): ReviewedPr => ({
      state: 'open',
      merged_at: null,
      blocked: false,
      missing_r: false,
      branch: '19.0',
      linked: [],
      tasks: [],
      ...x,
    });
    const ported = [
      { repo: 'odoo/odoo', number: 21, branch: '19.0', state: 'merged' },
      { repo: 'odoo/odoo', number: 23, branch: 'master', state: 'merged' },
    ];
    const D = deskOf({
      followed: [
        request('odoo/odoo#20', { rplus_at: ago(1) }),
        request('odoo/odoo#21', { rplus_at: ago(2) }),
        request('odoo/odoo#22', { rplus_at: ago(3), colleague: true }),
        request('odoo/odoo#24', { rplus_at: ago(5) }),
        request('odoo/odoo#25', { rplus_at: ago(4), colleague: true }),
      ],
      tasks: [{ ...task, id: 8, stage: 'RD Dev', reviewer: null, links: { prs: ['odoo/odoo#22'] } }],
      reviewed: {
        'odoo/odoo#20': page({ blocked: true }),
        'odoo/odoo#21': page({ state: 'merged', merged_at: ago(1), linked: ported }),
      },
    });
    expect(D.now).toEqual([]);
    expect(D.waiting).toMatchObject([
      { why: 'approved', key: 'pr:odoo/odoo#24', code: undefined },
      { why: 'approved', key: 'pr:odoo/odoo#25' },
      { why: 'approved', key: 'pr:odoo/odoo#20', code: { pr: { blocked: true } } },
    ]);
  });

  test("one branch's PRs in several repositories are one line, the most pressing of them", () => {
    const branch = { head: 'saas-19.2-fix-carl', rplus_at: ago(3) };
    const D = deskOf({
      followed: [
        request('odoo/odoo#40', branch),
        request('odoo/enterprise#41', { ...branch, rminus: [['dan', ago(1)]] }),
        request('odoo/enterprise#42', { ...branch, author: 'dan' }),
      ],
    });
    expect(D.now).toMatchObject([{ why: 'undone', key: 'pr:odoo/enterprise#41', siblings: ['odoo/odoo#40'] }]);
    expect(D.waiting.map((x) => x.key)).toEqual(['pr:odoo/enterprise#42']);
  });

  test('a PR of a colleague asked of me directly is set aside: its task and the pipe follow it', () => {
    const D = deskOf({ requests: [request('odoo/odoo#13', { colleague: true })] });
    expect([D.now, D.teams, D.aside]).toEqual([[], [], 1]);
  });

  test('a task in testing with me as its PO waits for my validation, once approved for its reviewer', () => {
    const testing = { ...task, stage: 'RD Testing BE', state: '01_in_progress', reviewer: null, tags: ['validation-ann'], links: {} };
    expect(deskOf({ tasks: [testing] }).now).toMatchObject([{ why: 'toValidate', key: 'task:7', side: 'validate' }]);
    expect(deskOf({ tasks: [{ ...testing, state: '02_changes_requested' }] }).waiting).toMatchObject([{ why: 'fixing', side: 'validate' }]);
    expect(deskOf({ tasks: [{ ...testing, state: '03_approved', tags: ['review-ann'] }] }).now).toMatchObject([{ why: 'toReview' }]);
  });

  describe('validation, a column apart from the stages', () => {
    const code = (pushed: number, approved?: number) =>
      feature('x', {
        owner: 'carl',
        tasks: ['7'],
        prs: [{ repo: 'odoo/odoo', number: 9, state: 'open', missing_r: true }],
        pushes: [{ at: pushed, kind: 'push', repo: 'odoo' }],
        gh: { received: approved ? [{ who: 'bob', state: 'APPROVED', at: approved }] : [] },
      });

    test('validated (tober+), a task waits on others whatever its stage, its request with it', () => {
      const testing = { ...task, stage: 'RD Testing BE', reviewer: null, tags: ['validation-ann', 'review-ann', 'tober+'] };
      const D = deskOf({ tasks: [testing], requests: [request('odoo/odoo#9')] });
      expect(D.now).toEqual([]);
      expect(D.waiting).toMatchObject([{ why: 'validated', key: 'task:7', side: 'validate', request: { pr: 'odoo/odoo#9' } }]);
      const review = { ...testing, stage: 'RD Review', tags: ['validation-ann', 'review-bob', 'tober+'] };
      expect(deskOf({ tasks: [review] }).waiting).toMatchObject([{ why: 'validated' }]);
    });

    test('in review, a task waits for its validator, then is mine to review', () => {
      expect(deskOf({ tasks: [{ ...task, tags: ['validation-bob'] }] }).waiting).toMatchObject([{ why: 'validating', side: 'review' }]);
      expect(deskOf({ tasks: [{ ...task, tags: ['validation-bob', 'tober+'] }] }).now).toMatchObject([{ why: 'reviewValidated' }]);
      expect(deskOf({ tasks: [{ ...task, tags: ['validation-ann'] }] }).now).toMatchObject([{ why: 'toValidate', side: 'validate' }]);
    });

    test('code pushed since the tober+ or the validator’s approval outdates it, for its validator as for its reviewer', () => {
      const tags = ['validation-bob', 'tober+'];
      const outdated = (x: Partial<Task>, pushed: number, approved?: number) =>
        deskOf({ tasks: [{ ...task, tags, ...x }], features: [code(pushed, approved)] }).now.map((y) => y.why);
      expect(outdated({ validated_at: ago(3) }, ago(1))).toEqual(['validationOutdated']);
      expect(outdated({ validated_at: ago(3) }, ago(4))).toEqual(['reviewValidated']);
      expect(outdated({}, ago(1), ago(2))).toEqual(['validationOutdated']);
      expect(outdated({ validated_at: ago(0.5) }, ago(1), ago(2))).toEqual(['reviewValidated']);
      expect(outdated({}, ago(1))).toEqual(['reviewValidated']);
      const mine = { stage: 'RD Testing BE', reviewer: null, tags: ['validation-ann', 'tober+'], validated_at: ago(3) };
      expect(outdated(mine, ago(1))).toEqual(['revalidate']);
    });
  });

  test('an approved task waits for its merge', () => {
    const D = deskOf({ tasks: [{ ...task, state: '03_approved' }] });
    expect(D.waiting).toMatchObject([{ why: 'approved', side: 'review' }]);
  });

  test('a push, an r- or a conflict after my r+ brings the review back to me, its task too; before it, nothing', () => {
    const [one, two, three, four, five] = [1, 2, 3, 4, 5].map(ago);
    const D = deskOf({
      tasks: [{ ...task, state: '03_approved' }],
      followed: [
        request('odoo/odoo#30', { rplus_at: three, pushed_at: one }),
        request('odoo/odoo#31', { rplus_at: three, rminus: [['dan', two]] }),
        request('odoo/odoo#32', { rplus_at: three, mergeable: 'CONFLICTING' }),
        request('odoo/odoo#33', { rplus_at: three, pushed_at: four, rminus: [['dan', five]], mergeable: 'MERGEABLE' }),
        request('odoo/odoo#9', { rplus_at: three, pushed_at: two, colleague: true }),
      ],
    });
    expect(D.now).toMatchObject([
      { why: 'undone', key: 'pr:odoo/odoo#32', t: three },
      { why: 'undone', key: 'task:7', t: two, request: { pr: 'odoo/odoo#9' } },
      { why: 'undone', key: 'pr:odoo/odoo#31', t: two },
      { why: 'undone', key: 'pr:odoo/odoo#30', t: one },
    ]);
    expect(D.waiting).toMatchObject([{ why: 'approved', key: 'pr:odoo/odoo#33' }]);
  });
});
