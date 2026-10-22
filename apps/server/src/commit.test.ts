import { expect, test } from 'bun:test';
import { appendFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runningCommit } from './commit';
import { makeClone } from './sources/testing';

test('names the commit the server runs, with a + for changes not committed', async () => {
  const clone = await makeClone();
  try {
    await writeFile(join(clone.path, 'a.txt'), 'one\n');
    clone.git(['add', 'a.txt']);
    const head = clone.commit('anne@odoo.com', '[IMP] hr: a thing');
    expect(runningCommit(clone.path)).toBe(clone.git(['rev-parse', '--short', head]));
    await appendFile(join(clone.path, 'a.txt'), 'two\n');
    expect(runningCommit(clone.path)).toEndWith('+');
    expect(runningCommit(tmpdir())).toBe(process.env.COMMIT || null);
  } finally {
    await rm(clone.path, { recursive: true, force: true });
  }
});
