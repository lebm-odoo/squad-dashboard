import { expect, test } from 'bun:test';
import { featureGroups, type MemberCommit, writersOf } from './groups';

const DAY = 86400;
const commit = (pr: string, ct: number, fields: Partial<MemberCommit> = {}): MemberCommit => ({
  id: pr,
  member: 'anne',
  coauthor: false,
  pr,
  subject: '[FIX] hr_payroll: round the net',
  at: ct - DAY,
  ct,
  ...fields,
});

test('the PRs of one feature share it: a Related trailer, a port by hand, a branch; a forward-port branch stays apart', () => {
  const featureOf = featureGroups({
    reviewRows: [],
    commits: [commit('odoo/odoo#1', 10 * DAY, { related: ['odoo/enterprise#2'] }), commit('odoo/odoo#3', 60 * DAY)],
    archivedReviews: [],
    ghReviews: [],
    labels: { 'odoo/odoo#4': 'odoo-dev:master-round-anne', 'odoo/upgrade#5': 'odoo-dev:master-round-anne', 'odoo/odoo#6': 'x:a-1-fw' },
  });
  expect(['odoo/odoo#1', 'odoo/odoo#3'].map(featureOf)).toEqual(['odoo/enterprise#2', 'odoo/enterprise#2']);
  expect(featureOf('odoo/upgrade#5')).toBe('odoo/odoo#4');
  expect(featureOf('odoo/odoo#6')).toBe('odoo/odoo#6');
});

test('whoever wrote or co-wrote part of a feature is one of its writers', () => {
  const commits = [commit('odoo/odoo#1', DAY), commit('odoo/enterprise#2', DAY, { member: 'bob', coauthor: true })];
  const writers = writersOf(commits, () => 'odoo/odoo#1');
  expect([...(writers.get('odoo/odoo#1') ?? [])]).toEqual([
    ['anne', 1],
    ['bob', 1],
  ]);
});
