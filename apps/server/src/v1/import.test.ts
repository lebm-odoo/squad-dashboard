import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { appMeta, gitContribution, githubPr, gitMechanical, odooTask } from '../db/schema';
import { testDatabaseUrl, withTestDatabase } from '../db/testing';
import { importV1, type V1Cache, type V1History } from './import';

const history: V1History = {
  branches: {
    'odoo:master-hr-fix-abcd': {
      head: 'aaaaaaaaaaaa',
      owner: 'abcd',
      on_remote: true,
      pushes: [{ kind: 'new', delta: 0, added_commits: 1, at: 1790000000, sha: 'aaaaaaaaaaaa' }],
      files: [['addons/hr/models/hr.py', 3, 1]],
    },
  },
  contributed: { 'odoo:master-hr-fix-abcd': ['efgh'] },
  github: {
    'odoo/odoo#1': {
      state: 'MERGED',
      author: 'abcd-odoo',
      created_at: 1790000000,
      reviews: [{ login: 'efgh-odoo', state: 'APPROVED', at: 1790050000 }],
      force_pushes: [{ at: 1790010000, actor: 'abcd-odoo', before: 'a', after: 'b', kind: 'rebase', delta: 0 }],
      fetched: 1790200000,
    },
  },
  gh_reviews: {
    'efgh:odoo/odoo#1:a': {
      reviewer: 'efgh',
      pr: 'odoo/odoo#1',
      t: 1790050000,
      state: 'APPROVED',
      author_login: 'abcd-odoo',
      subject: '[FIX] hr: x',
    },
    'efgh:odoo/enterprise#2:b': {
      reviewer: 'efgh',
      pr: 'odoo/enterprise#2',
      t: 1790060000,
      state: 'COMMENTED',
      author_login: 'ijkl-odoo',
      subject: '[IMP] hr: y',
    },
    'zzzz:odoo/odoo#3:c': { reviewer: 'zzzz', pr: 'odoo/odoo#3', t: 1790070000, state: 'APPROVED', author_login: 'x', subject: 's' },
  },
  github_search: { efgh: { login: 'efgh-odoo' } },
  team_logins: { abcd: 'abcd-odoo', ijkl: '' },
  rplus: { 'odoo/odoo#1': { at: 1790300000, r: [['efgh-odoo', 1790060000]] } },
  github_meta: { viewer: 'abcd-odoo' },
  odoo_tasks: { '4567': { changes: [[1790000000, 'Dev', '01_in_progress']] } },
};
const cache: V1Cache = {
  snap: { 'odoo:aaaaaaaaaaaa': { base: 'bbbbbbbbbbbb', commit_count: 1 } },
  pushes: { 'odoo:0000:aaaa:1790000000': { kind: 'new', delta: 0, added_commits: 1, at: 1790000000, sha: 'aaaaaaaaaaaa' } },
  mechanics: { 'odoo:bbbbbbbbbbbbbbbb:aaaaaaaaaaaaaaaa': { 'addons/hr/models/hr.py': [2, 2] } },
  remote_heads: { odoo: ['master-hr-fix-abcd'] },
  mergebot: { 'odoo/odoo#1': { repo: 'odoo/odoo', number: 1, state: 'merged', merged_at: 1790100000, fetched: 1790200000 } },
  runbot: {
    bundles: { 'master-hr-fix-abcd': { id: 7, url: 'https://runbot.odoo.com/runbot/bundle/7', branches: [], prs: [], batches: [] } },
  },
};

describe.skipIf(!testDatabaseUrl)('V1 import', () => {
  test(
    'keeps every section and projects the facts, once',
    () =>
      withTestDatabase(async (db) => {
        const todo = { id: 't1', text: 'look at it', done: false, at: 1790000000 };
        const first = await importV1(db, history, cache, [todo]);
        const totals = Object.fromEntries(Object.entries(first.tables).map(([table, { total }]) => [table, total]));
        expect(totals).toEqual({
          v1_archive: 14,
          git_branch: 1,
          git_push: 1,
          github_pr: 2,
          github_review: 2,
          github_force_push: 1,
          github_rplus_scan: 1,
          github_rplus: 1,
          person_login: 2,
          mergebot_pr: 1,
          runbot_bundle: 1,
          git_snapshot: 1,
          git_transition: 1,
          git_mechanical: 1,
          git_contribution: 1,
          sync_cursor: 3,
          archive_entry: 0,
          odoo_task: 1,
          app_meta: 1,
        });
        expect(first.unmappedReviewers).toEqual(['zzzz']);
        expect(await db.select({ title: githubPr.title, state: githubPr.state }).from(githubPr).where(eq(githubPr.number, 1))).toEqual([
          { title: '[FIX] hr: x', state: 'MERGED' },
        ]);
        expect(await db.select().from(gitContribution)).toEqual([{ repo: 'odoo', branch: 'master-hr-fix-abcd', people: ['efgh'] }]);
        expect(await db.select({ revs: gitMechanical.revs }).from(gitMechanical)).toEqual([{ revs: 'bbbbbbbbbbbb:aaaaaaaaaaaa' }]);
        expect(await db.select({ id: odooTask.id, data: odooTask.data }).from(odooTask)).toEqual([{ id: 4567, data: null }]);
        expect((await db.select({ value: appMeta.value }).from(appMeta))[0]?.value).toEqual([todo]);

        const second = await importV1(db, history, cache, [{ ...todo, text: 'changed' }]);
        expect(Object.fromEntries(Object.entries(second.tables).map(([table, { total }]) => [table, total]))).toEqual(totals);
      }),
    30_000,
  );
});
