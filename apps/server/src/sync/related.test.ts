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
            { pr: 'odoo/odoo#1', head: 'master-a-jugj', author: 'jugj-odoo', direct: true, rplus: [] },
            { pr: 'odoo/odoo#2', head: 'master-b-arpi', author: 'arpi-odoo', direct: false, rplus: [] },
            { pr: 'odoo/odoo#3', head: 'master-c-lebm', author: 'lebm-odoo', direct: true, rplus: [] },
            { pr: 'odoo/odoo#6', head: 'master-sale-report', author: 'someone', direct: true, rplus: [] },
          ],
        });
        await insertRows(db, dashboardReview, [{ id: 'r1', reviewer: 'lebm', at: toDate(now - 86400), data: { pr: 'odoo/enterprise#4' } }]);
        await saveMergebot(db, [
          {
            repo: 'odoo/enterprise',
            number: 4,
            state: 'merged',
            label: 'odoo-dev:saas-19.3-d-arpi',
            created_by: 'arpi-odoo',
            fetched: now,
          },
        ]);
        await insertRows(db, odooTask, [
          { id: 7, data: { links: { prs: ['odoo/odoo#5'], branches: ['master-e-kaei'] } }, changes: [], fetchedAt: toDate(now) },
        ]);
        const options = { lead: 'lebm', repos: ['odoo', 'enterprise'], now };
        expect(await relatedWork(db, { ...options, followed: new Set(['lebm']) })).toEqual({
          prs: ['odoo/enterprise#4', 'odoo/odoo#1', 'odoo/odoo#5'],
          branches: {
            'odoo:master-a-jugj': [],
            'enterprise:saas-19.3-d-arpi': [],
            'odoo:master-e-kaei': [],
            'enterprise:master-e-kaei': [],
          },
          owners: ['arpi', 'jugj', 'kaei'],
        });
        const squad = await relatedWork(db, { ...options, followed: new Set(['lebm', 'jugj', 'arpi', 'kaei']) });
        expect(squad).toEqual({ prs: ['odoo/odoo#5'], branches: {}, owners: [] });
      }),
    60_000,
  );
});
