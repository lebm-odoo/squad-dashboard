import { length } from './py';

const tokensOf = (branch: string) =>
  branch
    .replace(/-\d+-fw$/, '')
    .toLowerCase()
    .split(/[-_.]/);

export function versionOf(branch: string) {
  return /^(master|saas-\d+\.\d+|\d+\.\d+)-/.exec(branch)?.[1] ?? 'master';
}

export function isRecentVersionRef(ref: string) {
  const major = /\/(?:saas-)?(\d+)\.\d+$/.exec(ref)?.[1];
  return ref.endsWith('/master') || (major !== undefined && Number(major) >= 16);
}

const suffix = /^(?:v\d+|\d+|temp|tmp|wip|bis|old|backup|bkp)$/;

/** The person a branch is named after: a 3-letter trigram counts only as the trailing token, being too common elsewhere. */
export function ownerOf(branch: string, names: ReadonlySet<string>) {
  const tokens = tokensOf(branch);
  const last = tokens.at(-1) as string;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i] as string;
    if (!names.has(token)) continue;
    const trailing = i === tokens.length - 1 || (i === tokens.length - 2 && suffix.test(last));
    if (length(token) >= 4 || trailing) return token;
  }
  return null;
}

/**
 * Who the branch of someone nobody listed is named after: their `<trigram>-odoo` login when the branch holds it, else the
 * trigram R&D puts at the end of a branch's name.
 */
export function authorOf(branch: string, login?: string | null) {
  const bare = (login ?? '').toLowerCase().replace(/-odoo$/, '');
  const tokens = tokensOf(branch);
  const last = suffix.test(tokens.at(-1) as string) ? tokens.at(-2) : tokens.at(-1);
  const trigram = last && /^[a-z]{2,5}$/.test(last) && !['fix', 'imp', 'add', 'ref', 'rev', 'rem', 'mov', 'test', 'perf'].includes(last);
  return ownerOf(branch, new Set([...(bare ? [bare] : []), ...(trigram ? [last] : [])]));
}

/** Every person a branch is named after: `…-lebm-romc` is pair work. */
export function namesIn(branch: string, names: ReadonlySet<string>) {
  const tokens = tokensOf(branch);
  return new Set(tokens.filter((token, i) => names.has(token) && (length(token) >= 4 || i >= tokens.length - 2)));
}

/** The original branch of a forward-port branch made by the bot: `17.0-15.0-fix-x-abcd-1234-fw` → `15.0-fix-x-abcd`. */
export function forwardPortOf(branch: string) {
  return /^(?:master|saas-\d+\.\d+|\d+\.\d+)-((?:saas-\d+\.\d+|\d+\.\d+)-.+)-\d+-fw$/.exec(branch)?.[1] ?? null;
}
