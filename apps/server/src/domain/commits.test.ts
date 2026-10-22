import { describe, expect, test } from 'bun:test';
import { authoredBy, firstOfEach, mergedOn, reviewsOn, signedOn, trailerNames, type VersionCommit, writtenOn } from './commits';

const commit = (overrides: Partial<VersionCommit>): VersionCommit => ({
  sha: 'a'.repeat(40),
  authorName: 'Ann (anne)',
  authorEmail: 'anne@odoo.com',
  at: 100,
  ct: 200,
  subject: '[FIX] hr: a fix',
  body: 'closes odoo/odoo#12\n\nSigned-off-by: Bob (bob) <bob@odoo.com>\n',
  files: [['addons/hr/models/hr.py', 10, 2]],
  ...overrides,
});

describe('the filters the V1 asked git for', () => {
  test('an author matches as a git regex, its dots matching anything', () => {
    expect(authoredBy(new Set(['anne']))(commit({ authorEmail: 'anne@odooXcom' }))).toBe(true);
    expect(authoredBy(new Set(['anne']))(commit({ authorEmail: 'anne@gmail.com' }))).toBe(false);
  });

  test('a trailer matches on one line of the message, whatever its case', () => {
    expect(trailerNames('Signed-off-by', new Set(['bob']))(commit({}))).toBe(true);
    expect(trailerNames('Signed-off-by', new Set(['bob']))(commit({ body: 'Signed-off-by: Bob\n<bob@odoo.com>' }))).toBe(false);
    expect(trailerNames('Co-authored-by', new Set(['bob']))(commit({ body: 'co-authored-by: B <BOB@odoo.com>' }))).toBe(true);
  });
});

describe('rows read from the version branches', () => {
  test('a commit gives one merged row per person who wrote or co-wrote it', () => {
    const rows = mergedOn(
      'odoo',
      'refs/remotes/origin/17.0',
      [commit({ body: 'Co-authored-by: B <bob@odoo.com>' })],
      new Set(['anne', 'bob']),
    );
    expect(rows.map((row) => [row.owner, row.coauthor, row.target])).toEqual([
      ['anne', false, '17.0'],
      ['bob', true, '17.0'],
    ]);
  });

  test('a forward-port counts the last sign-off only, unless it is the original author', () => {
    const port = (rootAuthor: string) =>
      commit({ body: 'X-original-commit: abcdef1\nSigned-off-by: A <anne@odoo.com>\nSigned-off-by: C <carl@odoo.com>', rootAuthor });
    expect(reviewsOn('odoo', 'refs/remotes/origin/18.0', [port('dora')], new Set(['carl']))[0]).toMatchObject({
      reviewer: 'carl',
      fw: true,
    });
    expect(reviewsOn('odoo', 'refs/remotes/origin/18.0', [port('carl')], new Set(['carl']))).toEqual([]);
  });

  test('ports are no work of their own, and an r+ on a commit one co-wrote is no review', () => {
    expect(writtenOn('odoo', [commit({ body: 'X-original-commit: abcdef1' })], new Set(['anne']), false)).toEqual([]);
    const coauthored = commit({ body: 'Co-authored-by: B <bob@odoo.com>\nSigned-off-by: B <bob@odoo.com>' });
    expect(signedOn('odoo', [coauthored], new Set(['anne', 'bob']))).toEqual([]);
    expect(signedOn('odoo', [commit({})], new Set(['anne', 'bob']))).toMatchObject([{ id: 'bob:odoo/odoo#12', reviewer: 'bob' }]);
  });

  test('of rows with the same id, the first is kept', () => {
    expect(
      firstOfEach([
        { id: 'x', n: 1 },
        { id: 'x', n: 2 },
      ]),
    ).toEqual([{ id: 'x', n: 1 }]);
  });
});
