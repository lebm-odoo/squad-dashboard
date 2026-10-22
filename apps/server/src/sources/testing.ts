import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A throwaway clone whose commits are dated an hour apart, by whoever `commit` is given. */
export async function makeClone() {
  const path = await mkdtemp(join(tmpdir(), 'sd-clone-'));
  let clock = 1_790_000_000;
  const git = (args: string[], env: Record<string, string> = {}) => {
    const out = Bun.spawnSync(['git', '-C', path, ...args], { env: { ...process.env, ...env } });
    if (out.exitCode) throw new Error(out.stderr.toString());
    return out.stdout.toString().trim();
  };
  const commit = (email: string, message: string) => {
    clock += 3600;
    const date = `@${clock} +0000`;
    git(['commit', '-q', '--allow-empty', '-m', message], {
      GIT_AUTHOR_NAME: email,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: email,
      GIT_COMMITTER_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q', '-b', 'master']);
  return { path, git, commit };
}
