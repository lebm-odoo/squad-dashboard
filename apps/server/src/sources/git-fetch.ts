import { ownerOf } from '../domain/branches';
import type { Clone } from './clones';
import { GitError } from './git';
import { readRefs, versionRefs } from './git-history';

/**
 * Fetches what moved: the branches of the people followed, and the others' branches they contributed to or the related work
 * holds, whose head changed on the remote, then the recent version branches. With a GitHub token, over HTTPS, the token passed
 * in git's environment and never on its command line; without, through the clones' own remotes. Returns, per clone, the
 * people's branches the remote has.
 */
export async function fetchClones(
  clones: Clone[],
  names: ReadonlySet<string>,
  contributed: Record<string, string[]>,
  token: string | null,
) {
  const env: Record<string, string> = token
    ? {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
        GIT_TERMINAL_PROMPT: '0',
      }
    : { GIT_TERMINAL_PROMPT: '0' };
  const errors: string[] = [];
  const remoteHeads: Record<string, string[]> = {};
  await Promise.all(
    clones.map(async ({ repo, remote, slug, git }) => {
      const [branches, origin] = token ? [`https://github.com/${slug}.git`, `https://github.com/odoo/${repo}.git`] : [remote, 'origin'];
      const failed = (error: unknown) =>
        errors.push(`${repo} : ${(error as Error).message.split('\n').filter(Boolean).at(-1)?.slice(0, 160)}`);
      let listing: string;
      try {
        listing = await git.run(['ls-remote', '--heads', branches], { env });
      } catch (error) {
        failed(error);
        return;
      }
      const local = await readRefs(git);
      const wanted = listing.split('\n').flatMap((line) => {
        const [sha, ref] = line.split('\t') as [string, string | undefined];
        const name = ref?.replace(/^refs\/heads\//, '');
        return name && (ownerOf(name, names) || `${repo}:${name}` in contributed) ? [[name, sha] as const] : [];
      });
      const stale = wanted
        .filter(([name, sha]) => local[`refs/remotes/${remote}/${name}`] !== sha)
        .map(([name]) => `+refs/heads/${name}:refs/remotes/${remote}/${name}`);
      const versions = versionRefs(local)
        .sort()
        .map((ref) => `+${ref.replace('refs/remotes/origin/', 'refs/heads/')}:${ref}`);
      const batches: [string, string[]][] = [];
      for (let i = 0; i < stale.length; i += 200) batches.push([branches, stale.slice(i, i + 200)]);
      batches.push([origin, versions]);
      for (const [source, refspecs] of batches) {
        if (!refspecs.length) continue;
        await git.run(['fetch', '--no-auto-gc', '--no-write-commit-graph', source, ...refspecs], { env }).catch((error) => {
          if (error instanceof GitError) failed(error);
          else throw error;
        });
      }
      remoteHeads[repo] = wanted.map(([name]) => name).sort();
    }),
  );
  return { remoteHeads, error: errors.join(' ; ') || null };
}
