import { describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { loadGitInput } from '../db/dashboard-input';
import { loadCursor } from '../db/git';
import { gitBranch, gitCommit } from '../db/schema';
import { testDatabaseUrl, withTestDatabase } from '../db/testing';
import { Git, Slots } from '../sources/git';
import { makeClone } from '../sources/testing';
import { type GitCursor, syncGit } from './git';

describe.skipIf(!testDatabaseUrl)('git sync', () => {
  test('reads the clone once, then only what moved', async () => {
    const clone = await makeClone();
    try {
      const fix = clone.commit('anne@odoo.com', '[FIX] hr: a fix\n\ncloses odoo/odoo#1\n\nSigned-off-by: Bob (bob) <bob@odoo.com>');
      clone.git(['update-ref', 'refs/remotes/origin/master', fix]);
      clone.git(['update-ref', 'refs/remotes/dev/master-hr-thing-anne', clone.commit('anne@odoo.com', '[IMP] hr: a thing')]);
      const clones = [{ repo: 'odoo', remote: 'dev', slug: 'odoo-dev/odoo', git: new Git(clone.path, new Slots(4)) }];
      const members = new Set(['anne', 'bob']);
      const options = { members, since: 1_780_000_000, now: 1_791_000_000 };

      await withTestDatabase(async (db) => {
        await syncGit(db, clones, options);
        let input = await loadGitInput(db, ['odoo'], members);
        expect(input.merged.map((row) => row.id)).toEqual([`${fix}:anne`]);
        expect(input.reviews.map((row) => [row.reviewer, row.pr])).toEqual([['bob', 'odoo/odoo#1']]);
        expect(input.signed.map((row) => row.id)).toEqual(['bob:odoo/odoo#1']);
        expect(Object.keys(input.branches)).toEqual(['master-hr-thing-anne']);
        expect((await db.select({ head: gitBranch.head }).from(gitBranch))[0]?.head).toBe(
          clone.git(['rev-parse', 'refs/remotes/dev/master-hr-thing-anne']).slice(0, 12),
        );

        clone.git(['checkout', '-q', fix]);
        const next = clone.commit('bob@odoo.com', '[IMP] hr: next\n\ncloses odoo/odoo#2\n\nSigned-off-by: Anne (anne) <anne@odoo.com>');
        clone.git(['update-ref', 'refs/remotes/origin/master', next]);
        await syncGit(db, clones, options);
        const cursor = await loadCursor<GitCursor>(db, 'git', 'odoo');
        expect(cursor?.heads).toEqual([next]);
        expect((await db.select({ sha: gitCommit.sha }).from(gitCommit)).map((row) => row.sha).sort()).toEqual([fix, next].sort());
        input = await loadGitInput(db, ['odoo'], members);
        expect(input.merged.map((row) => row.id).sort()).toEqual([`${fix}:anne`, `${next}:bob`].sort());
        expect(input.signed.map((row) => row.id).sort()).toEqual(['anne:odoo/odoo#2', 'bob:odoo/odoo#1']);
      });
    } finally {
      await rm(clone.path, { recursive: true, force: true });
    }
  }, 60_000);
});
