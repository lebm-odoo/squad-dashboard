import type { Database } from '../db/client';
import { loadCursor } from '../db/git';
import { loadGithubAsMergebot } from '../db/github';
import { odooTask } from '../db/schema';
import { loadMergebot } from '../db/sources';
import { authorOf } from '../domain/branches';
import { leadReviewedPrs } from './web';

/**
 * The work of others the people followed touch: the reviews asked of me directly, those I gave in the last 91 days or gave the
 * r+ to, the PRs and branches of the tasks read. Their PRs and branches are read like the followed people's, the rest of their
 * authors' work is not; a PR whose branch is unknown yet is read to learn it.
 */
export async function relatedWork(
  db: Database,
  { lead, followed, repos, now }: { lead: string; followed: ReadonlySet<string>; repos: string[]; now: number },
) {
  const [requests, reviewed, tasks, mergebot, github] = await Promise.all([
    loadCursor<{ prs?: { pr: string; head?: string; author?: string; direct?: boolean }[] }>(db, 'github', 'requests'),
    leadReviewedPrs(db, lead, now),
    db.select({ data: odooTask.data }).from(odooTask),
    loadMergebot(db),
    loadGithubAsMergebot(db),
  ]);
  const asked = (requests?.prs ?? []).filter((p) => p.direct);
  const links = tasks.map(({ data }) => (data as { links?: { prs?: string[]; branches?: string[] } } | null)?.links ?? {});
  const heads = new Map(asked.map((p) => [p.pr, p]));
  const labelOf = (key: string) => mergebot[key]?.label ?? github[key]?.label;
  const branches: Record<string, string[]> = {};
  const owners = new Set<string>();
  const add = (repo: string, branch: string, login?: string | null) => {
    const owner = authorOf(branch, login);
    if (!owner || followed.has(owner)) return false;
    owners.add(owner);
    branches[`${repo}:${branch}`] = [];
    return true;
  };
  const prs = [...new Set([...asked.map((p) => p.pr), ...reviewed, ...links.flatMap((link) => link.prs ?? [])])].filter((key) => {
    if (!/^odoo\/[\w-]+#\d+$/.test(key)) return false;
    const label = labelOf(key);
    const branch = label ? label.slice(label.indexOf(':') + 1) : heads.get(key)?.head;
    const login = mergebot[key]?.created_by || github[key]?.created_by || heads.get(key)?.author;
    return !branch || add(key.slice('odoo/'.length, key.indexOf('#')), branch, login);
  });
  for (const branch of links.flatMap((link) => link.branches ?? [])) for (const repo of repos) add(repo, branch);
  return { prs: prs.sort(), branches, owners: [...owners].sort() };
}
