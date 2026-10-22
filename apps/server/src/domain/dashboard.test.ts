import { expect, test } from 'bun:test';
import { type DashboardInput, deriveDashboard } from './dashboard';
import type { MergebotPr, MergedCommit } from './features';

const merged = (number: number, target: string): MergedCommit => ({
  id: `enterprise:${number}`,
  repo: 'enterprise',
  sha: String(number).repeat(40).slice(0, 40),
  owner: 'carl',
  author: 'carl',
  coauthor: false,
  at: 1000,
  ct: 2000 + number,
  target,
  subject: '[FIX] l10n_be_hr_payroll: fix Dimona key password read',
  fw: target !== 'saas-19.3',
  files: [],
  tasks: [],
  opws: [],
  closes: [['odoo/enterprise', String(number)]],
  reviewers: [],
});
const pr = (number: number, branch: string, fields: Partial<MergebotPr>): MergebotPr => ({
  repo: 'odoo/enterprise',
  number,
  label: `odoo-dev:${branch}`,
  title: '[FIX] l10n_be_hr_payroll: fix Dimona key password read',
  ...fields,
  state: fields.state ?? 'merged',
});

const inputOf = (fields: Partial<DashboardInput>): DashboardInput => ({
  now: 10_000,
  sinceDays: 30,
  me: 'anne',
  names: new Set(['carl']),
  forcedLogins: {},
  deducedLogins: {},
  viewer: null,
  branches: {},
  merged: [],
  trailerReviews: [],
  archivedReviews: {},
  written: [],
  signed: [],
  ghReviews: {},
  rplus: {},
  mergebot: {},
  runbot: {},
  github: {},
  archivedFeatures: {},
  requests: null,
  related: [],
  squad: new Set(['anne']),
  lastFetch: 10_000,
  ruleFiles: {},
  mechanics: () => ({}),
  ...fields,
});

test('a merge git saw beats a mergebot page read before it, the forward-port tables too', () => {
  const ports = [
    { repo: 'odoo/enterprise', number: 1, branch: 'saas-19.3', state: 'merged' },
    { repo: 'odoo/enterprise', number: 2, branch: '20.0', state: 'open' },
    { repo: 'odoo/enterprise', number: 3, branch: 'master', state: 'open' },
  ];
  const input = inputOf({
    merged: [merged(1, 'saas-19.3'), merged(2, '20.0')],
    mergebot: {
      'odoo/enterprise#1': pr(1, 'saas-19.3-dimona-carl', { merged_at: 2001, linked: ports }),
      'odoo/enterprise#2': pr(2, '20.0-saas-19.3-dimona-carl-123456-fw', { state: 'open', phase: 'Staged', blocked: true, linked: ports }),
    },
  });
  const prs = deriveDashboard(input).features.flatMap((f) => f.prs);
  const port = prs.find((row) => row.number === 2);
  expect([port?.state, port?.phase, port?.blocked, port?.merged_at]).toEqual(['merged', 'Merged', false, 2002]);
  const linked = prs.find((row) => row.number === 1)?.linked as typeof ports | undefined;
  expect(linked?.map((link) => link.state)).toEqual(['merged', 'merged', 'open']);
});

test('a PR retargeted to another stable version is of that version; one named after master stays master', () => {
  const own = (number: number, branch: string) => [{ repo: 'odoo/enterprise', number, branch, state: 'open' }];
  const bundle = (number: number) => ({
    id: number,
    url: '',
    branches: [],
    prs: [{ repo: 'odoo/enterprise', number, closed: false }],
    batches: [],
  });
  const { features } = deriveDashboard(
    inputOf({
      mergebot: {
        'odoo/enterprise#1': pr(1, 'saas-19.2-opw-1234567-gantt-carl', { state: 'open', linked: own(1, '19.0') }),
        'odoo/enterprise#2': pr(2, 'master-dimona-carl', { state: 'open', linked: own(2, '20.0') }),
      },
      runbot: { 'saas-19.2-opw-1234567-gantt-carl': bundle(1), 'master-dimona-carl': bundle(2) },
    }),
  );
  expect(features.map((f) => [f.name, f.version])).toEqual([
    ['master-dimona-carl', 'master'],
    ['saas-19.2-opw-1234567-gantt-carl', '19.0'],
  ]);
});

test('a draft runbot has no bundle for yet joins the branch git read', () => {
  const { features } = deriveDashboard(
    inputOf({
      branches: {
        'master-dimona-carl': {
          enterprise: {
            head: 'a',
            url: '',
            pushes: [],
            base: 'master',
            commit_count: 0,
            commits: [],
            files: [],
            trailers: { tasks: [], opws: [] },
          },
        },
      },
      mergebot: { 'odoo/enterprise#1': pr(1, 'master-dimona-carl', { state: 'open', draft: true }) },
    }),
  );
  expect(features.map((f) => [f.name, f.prs.map((row) => row.number)])).toEqual([['master-dimona-carl', [1]]]);
});

test('a PR of someone else I review is a feature of its author, without their runbot or merged work', () => {
  const open = inputOf({
    names: new Set(['anne', 'carl']),
    mergebot: { 'odoo/enterprise#5': pr(5, 'master-dimona-carl', { state: 'open', phase: 'Ready' }) },
  });
  expect(deriveDashboard(open).features).toEqual([]);
  const features = deriveDashboard({ ...open, related: ['odoo/enterprise#5'] }).features;
  expect(features.map((f) => [f.name, f.owner, f.prs.map((row) => row.number)])).toEqual([['master-dimona-carl', 'carl', [5]]]);
});

test('a review asked by a colleague is told apart: my squad, the members of my GitHub teams, a branch of the squad', () => {
  const asked = (pr: string, author: string, head: string) => ({ pr, author, head, asked_at: 1, reviews: [], rplus: [] });
  const { review_requests } = deriveDashboard(
    inputOf({
      requests: {
        v: 2,
        login: 'anne-odoo',
        colleagues: ['Eric-odoo'],
        prs: [
          asked('odoo/odoo#1', 'gina-odoo', 'master-a-gina'),
          asked('odoo/odoo#2', 'eric-odoo', 'master-b-eric'),
          asked('odoo/odoo#3', 'fred-odoo', 'master-c-fred'),
        ],
      },
      squad: new Set(['anne', 'gina']),
    }),
  );
  expect(review_requests?.prs.map((p) => [p.pr, p.who, p.colleague])).toEqual([
    ['odoo/odoo#1', 'gina', true],
    ['odoo/odoo#2', 'eric', true],
    ['odoo/odoo#3', 'fred', false],
  ]);
  expect(review_requests).not.toHaveProperty('colleagues');
});

test('a reviewer nobody listed is known by their r+: the one login that gave it, the one trigram the mergebot signed off', () => {
  const signed = (number: number, reviewers: string[]) => ({ ...merged(number, 'saas-19.3'), reviewers });
  const { logins, review_requests } = deriveDashboard(
    inputOf({
      merged: [signed(1, ['Dora Rine (dor)']), signed(2, ['Dora Rine (dor)']), signed(3, ['Ann (ann)', 'Bob (bob)'])],
      rplus: {
        'odoo/enterprise#1': { r: [['dorine', 2000]] },
        'odoo/enterprise#2': { r: [['dorine', 2001]] },
        'odoo/enterprise#3': { r: [['ann-gh', 2002]] },
      },
      requests: {
        v: 2,
        login: 'anne-odoo',
        colleagues: ['dorine'],
        prs: [{ pr: 'odoo/odoo#9', author: 'carl-odoo', asked_at: 1, reviews: [['dorine', 'APPROVED', 5]], rplus: [] }],
      },
    }),
  );
  expect(logins).toMatchObject({ dor: 'dorine' });
  expect(logins).not.toHaveProperty('ann');
  expect(review_requests?.prs[0]?.validations).toEqual([['dor', 'APPROVED', 5]]);
});
