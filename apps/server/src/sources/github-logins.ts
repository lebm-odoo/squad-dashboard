import { memberLogin } from '../domain/logins';
import { mostCommon, re } from '../domain/py';
import type { Clone } from './clones';
import type { Github } from './github';

/**
 * The GitHub login of each member still unknown, from the authors of up to 3 of their merged PRs (40 PRs per query): a PR
 * may have been opened by someone else for them, so the most frequent valid author, their `<trigram>-odoo` login first.
 * Returns the logins found, `''` for a member whose PRs gave none.
 */
export async function resolveLogins(gh: Github, clones: Clone[], missing: ReadonlySet<string>, names: ReadonlySet<string>, now: number) {
  const samples = new Map<string, [string, number][]>();
  for (const { git } of clones) {
    const todo = [...missing].filter((member) => (samples.get(member)?.length ?? 0) < 3).sort();
    if (!todo.length) break;
    const out = await git.run(
      [
        'log',
        'refs/remotes/origin/master',
        `--since=@${now - 730 * 86400}`,
        '--no-merges',
        '-i',
        ...todo.map((member) => `--author=${member}@odoo.com`),
        '--grep=closes odoo/',
        '--format=%ae%x1f%B%x1e',
      ],
      { check: false },
    );
    for (const record of out.split('\x1e')) {
      const trimmed = record.trim();
      const separator = trimmed.indexOf('\x1f');
      const [email, body] = separator < 0 ? [trimmed, ''] : [trimmed.slice(0, separator), trimmed.slice(separator + 1)];
      const member = email.toLowerCase().split('@')[0] as string;
      const closes = new RegExp(`closes (odoo/(?:${re.word}|-)+)#(\\d+)`, 'u').exec(body);
      const prs = samples.get(member) ?? [];
      if (!missing.has(member) || prs.length >= 3 || !closes || body.includes('X-original-commit:') || body.includes('Forward-Port-Of:'))
        continue;
      if (!prs.some(([slug, number]) => slug === closes[1] && number === Number(closes[2])))
        prs.push([closes[1] as string, Number(closes[2])]);
      samples.set(member, prs);
    }
  }
  const pending = [...samples].sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([member, prs]) => prs.map((pr) => [member, pr] as const));
  const votes = new Map<string, Map<string, number>>();
  for (let i = 0; i < pending.length; i += 40) {
    const chunk = pending.slice(i, i + 40);
    const aliases = chunk.map(([, [slug, number]], j) => {
      const [owner, name] = slug.split('/');
      return `p${j}: repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${number}) { author { login } } }`;
    });
    const data = await gh.query(`query { rateLimit { cost remaining resetAt } ${aliases.join(' ')} }`);
    if (!data) return new Map<string, string>();
    chunk.forEach(([member], j) => {
      const login: string = data[`p${j}`]?.pullRequest?.author?.login ?? '';
      if (!memberLogin(member, login, names)) return;
      const counter = votes.get(member) ?? (votes.set(member, new Map()).get(member) as Map<string, number>);
      counter.set(login, (counter.get(login) ?? 0) + 1);
    });
  }
  return new Map(
    [...samples.keys()].map((member) => {
      const counter = votes.get(member) ?? new Map<string, number>();
      const own = [...counter.keys()].find((login) => login.toLowerCase() === `${member}-odoo`);
      return [member, own ?? mostCommon(counter)[0]?.[0] ?? ''];
    }),
  );
}
