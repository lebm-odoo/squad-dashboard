import { describe, expect, test } from 'bun:test';
import { saveCursor } from '../db/git';
import { insertRows, toDate } from '../db/rows';
import { dashboardReview, odooTask } from '../db/schema';
import { saveMergebot } from '../db/sources';
import { testDatabaseUrl, withTestDatabase } from '../db/testing';
import { relatedWork } from './related';

describe.skipIf(!testDatabaseUrl)('the related work', () => {
  test(
    'the reviews asked of me directly or given, the PRs and branches of the tasks: of people not followed only',
    () =>
      withTestDatabase(async (db) => {
        const now = 100_000_000;
        await saveCursor(db, 'github', 'requests', {
          prs: [
            { pr: 'odoo/odoo#1', head: 'master-a-carl', author: 'carl-odoo', direct: true, rplus: [] },
            { pr: 'odoo/odoo#2', head: 'master-b-eric', author: 'eric-odoo', direct: false, rplus: [] },
            { pr: 'odoo/odoo#3', head: 'master-c-anne', author: 'anne-odoo', direct: true, rplus: [] },
            { pr: 'odoo/odoo#6', head: 'master-sale-report', author: 'someone', direct: true, rplus: [] },
          ],
        });
        await insertRows(db, dashboardReview, [{ id: 'r1', reviewer: 'anne', at: toDate(now - 86400), data: { pr: 'odoo/enterprise#4' } }]);
        await saveMergebot(db, [
          {
            repo: 'odoo/enterprise',
            number: 4,
            state: 'merged',
            label: 'odoo-dev:saas-19.3-d-eric',
            created_by: 'eric-odoo',
            fetched: now,
          },
        ]);
        await insertRows(db, odooTask, [
          { id: 7, data: { links: { prs: ['odoo/odoo#5'], branches: ['master-e-fred'] } }, changes: [], fetchedAt: toDate(now) },
        ]);
        const options = { lead: 'anne', repos: ['odoo', 'enterprise'], now };
        expect(await relatedWork(db, { ...options, followed: new Set(['anne']) })).toEqual({
          prs: ['odoo/enterprise#4', 'odoo/odoo#1', 'odoo/odoo#5'],
          branches: {
            'odoo:master-a-carl': [],
            'enterprise:saas-19.3-d-eric': [],
            'odoo:master-e-fred': [],
            'enterprise:master-e-fred': [],
          },
          owners: ['carl', 'eric', 'fred'],
        });
        const squad = await relatedWork(db, { ...options, followed: new Set(['anne', 'carl', 'eric', 'fred']) });
        expect(squad).toEqual({ prs: ['odoo/odoo#5'], branches: {}, owners: [] });
      }),
    60_000,
  );
});
