import { ownerOf } from './branches';
import { isBot, trigramOf } from './messages';
import { mostCommon } from './py';

export type LoginSource = 'config' | 'branches' | 'pr' | 'viewer';

/** Whether a GitHub login can be the member's: not a bot, not the `<trigram>-odoo` login of another member. */
export function memberLogin(member: string, login: string | null | undefined, names: ReadonlySet<string>) {
  if (!login || isBot(login)) return false;
  const bare = login.toLowerCase().replace(/-odoo$/, '');
  return bare === member || bare === login.toLowerCase() || !names.has(bare);
}

/**
 * The login of each member and where it comes from: forced in config.json, the authors of the PRs of their branches, the
 * authors of the PRs closing their commits, or the account of the token for oneself. One login per member, one member per
 * login.
 */
export function githubLoginSources(input: {
  github: Record<string, { author?: string | null }>;
  labels: Record<string, string | undefined>;
  names: ReadonlySet<string>;
  me: string;
  viewer: string | null | undefined;
  deduced: Record<string, string>;
  forced: Record<string, string>;
}) {
  const counts = new Map<string, Map<string, number>>();
  for (const [key, pr] of Object.entries(input.github)) {
    const label = input.labels[key] ?? '';
    const owner = ownerOf(label.includes(':') ? label.slice(label.indexOf(':') + 1) : label, input.names);
    if (!owner || !pr.author || isBot(pr.author)) continue;
    const counter = counts.get(owner) ?? (counts.set(owner, new Map()).get(owner) as Map<string, number>);
    counter.set(pr.author, (counter.get(pr.author) ?? 0) + 1);
  }
  const logins = new Map<string, [string, LoginSource]>();
  for (const [member, counter] of counts) {
    const [login] = mostCommon(counter)[0] as [string, number];
    if (memberLogin(member, login, input.names)) logins.set(member, [login, 'branches']);
  }
  if (input.viewer && !logins.has(input.me)) logins.set(input.me, [input.viewer, 'viewer']);
  const taken = new Set([...logins.values()].map(([login]) => login.toLowerCase()));
  for (const [member, login] of Object.entries(input.deduced)) {
    if (input.names.has(member) && !logins.has(member) && memberLogin(member, login, input.names) && !taken.has(login.toLowerCase())) {
      logins.set(member, [login, 'pr']);
      taken.add(login.toLowerCase());
    }
  }
  for (const [member, login] of Object.entries(input.forced)) if (login) logins.set(member, [login, 'config']);
  return logins;
}

/**
 * The trigram behind the GitHub login of a reviewer nobody listed: on a merged PR the mergebot signed off for one reviewer
 * alone, the login that wrote its one `robodoo r+`. Each login goes to the trigram it came with most often.
 */
export function rplusLogins(
  merged: { closes: [string, string][]; reviewers: string[] }[],
  rplus: Record<string, { r: [string, number][] } | undefined>,
) {
  const votes = new Map<string, Map<string, number>>();
  for (const commit of merged) {
    const [signer, ...others] = new Set(commit.reviewers.map(trigramOf));
    if (!signer || others.length || !/^[a-z]{2,8}$/.test(signer)) continue;
    for (const [slug, number] of commit.closes) {
      const [login, ...more] = new Set((rplus[`${slug}#${number}`]?.r ?? []).map(([who]) => who.toLowerCase()));
      if (!login || more.length || isBot(login)) continue;
      const counter = votes.get(login) ?? new Map<string, number>();
      votes.set(login, counter.set(signer, (counter.get(signer) ?? 0) + 1));
    }
  }
  return new Map([...votes].map(([login, counter]) => [login, mostCommon(counter)[0]?.[0] as string]));
}

/** For the settings: each member's login, where it comes from, the one forced, and a guess set aside as invalid. */
export function loginReport(
  people: string[],
  sources: Record<string, [string, LoginSource]>,
  forced: Record<string, string>,
  deduced: Record<string, string>,
  members: ReadonlySet<string>,
) {
  return [...new Set([...people, ...Object.keys(forced)])].sort().map((member) => ({
    member,
    login: sources[member]?.[0] ?? '',
    source: sources[member]?.[1] ?? 'none',
    forced: forced[member] ?? '',
    rejected: deduced[member] && !memberLogin(member, deduced[member], members) ? deduced[member] : '',
  }));
}
