import { describe, expect, test } from 'bun:test';
import type { PrDetail } from '../sources/github-prs';
import { loadDashboardInput } from './dashboard-input';
import { savePullRequests } from './github';
import { saveMergebot } from './sources';
import { testDatabaseUrl, withTestDatabase } from './testing';

const closed = (number: number, fetched: number): [string, PrDetail] => [
  `odoo/enterprise#${number}`,
  {
    title: '[FIX] hr_payroll: a fix',
    head_ref: `master-fix-arpi-${number}`,
    head_owner: 'odoo-dev',
    merged_at: null,
    tasks: [],
    opws: [],
    desc_words: 0,
    state: 'CLOSED',
    draft: false,
    author: 'arpi-odoo',
    created_at: 1000,
    closed_at: fetched - 10,
    additions: 1,
    deletions: 0,
    changed_files: 1,
    reviews: [],
    comments: 0,
    force_pushes: [],
    ready_at: [],
    fetched,
  },
];

describe.skipIf(!testDatabaseUrl)('the PRs the dashboard is computed from', () => {
  test(
    'a mergebot page still open is stale once GitHub read the PR closed after it',
    () =>
      withTestDatabase(async (db) => {
        const open = (number: number) => ({
          repo: 'odoo/enterprise',
          number,
          state: 'open',
          phase: 'Blocked',
          blocked: true,
          fetched: 2000,
        });
        await saveMergebot(db, [open(1), open(2)]);
        await savePullRequests(db, new Map([closed(1, 3000), closed(2, 1500)]));
        const { mergebot } = await loadDashboardInput(db, {
          repos: [],
          names: new Set(['arpi']),
          squad: new Set(['lebm']),
          related: [],
          me: 'lebm',
          forced: {},
          now: 4000,
          sinceDays: 30,
        });
        const states = [1, 2].map((number) => mergebot[`odoo/enterprise#${number}`]).map((pr) => [pr?.state, pr?.phase, pr?.blocked]);
        expect(states).toEqual([
          ['closed', 'Closed', false],
          ['open', 'Blocked', true],
        ]);
      }),
    60_000,
  );

  test(
    'an open PR GitHub alone read has no r+: only mergebot tells it',
    () =>
      withTestDatabase(async (db) => {
        const [key, pr] = closed(3, 3000);
        await savePullRequests(db, new Map([[key, { ...pr, state: 'OPEN', closed_at: null }]]));
        const { mergebot } = await loadDashboardInput(db, {
          repos: [],
          names: new Set(['arpi']),
          squad: new Set(['lebm']),
          related: [],
          me: 'lebm',
          forced: {},
          now: 4000,
          sinceDays: 30,
        });
        expect([mergebot[key]?.state, mergebot[key]?.missing_r]).toEqual(['open', true]);
      }),
    60_000,
  );
});
