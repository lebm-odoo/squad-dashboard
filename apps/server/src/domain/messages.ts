import { re, splitLines, splitWords, strip, stripChars } from './py';

const unique = <T>(items: T[]) => [...new Set(items)];

/** PRs a merged commit belongs to: mergebot writes `closes` on the last commit and `Part-of:` on the others. */
export function prRefs(text: string): [string, string][] {
  const pattern = new RegExp(`(?:closes|Part-of:)${re.space}+(odoo/(?:${re.word}|-)+)#(${re.digit}+)`, 'giu');
  return unique([...text.matchAll(pattern)].map((match) => `${match[1]}#${match[2]}`)).map((key) => key.split('#') as [string, string]);
}

/** PRs mergebot merged together with this one (same branch in another repo). */
export function relatedPrs(text: string) {
  return [...text.matchAll(new RegExp(`${re.lineStart}Related: (odoo/(?:${re.word}|-)+#${re.digit}+)`, 'gu'))].map(
    (match) => match[1] as string,
  );
}

export function parseTrailers(text: string) {
  const ids = (pattern: string) => [...text.matchAll(new RegExp(pattern, 'giu'))].map((match) => match[1] as string);
  const number = `(${re.digit}{5,8})${re.boundary}`;
  return {
    tasks: unique([
      ...ids(`${re.boundary}task[-:#${re.space.slice(1, -1)}]+${number}`),
      ...ids(`project\\.task/(${re.digit}{5,8})`),
    ]).sort(),
    opws: unique(ids(`${re.boundary}opw[-:#${re.space.slice(1, -1)}]+${number}`)).sort(),
    closes: prRefs(text),
    reviewers: [...text.matchAll(/Signed-off-by: ([^<\n]+?) </g)].map((match) => match[1] as string),
  };
}

/** A commit subject without the port markers: `[FW][FIX] x` and `[FIX] x` are the same change. */
export function portSubject(subject: string) {
  return strip(subject)
    .replace(new RegExp(`^${re.space}*(\\[(fw|bp|forward-?port|backport)\\]${re.space}*)+`, 'iu'), '')
    .toLowerCase();
}

export function isPortTitle(subject: string | null | undefined) {
  return new RegExp(`^${re.space}*\\[(fw|bp|forward-?port|backport)\\]`, 'iu').test(subject ?? '');
}

/** Whether a GitHub comment or review body gives the mergebot `order`, an r+ or an r-: a `robodoo r+` line, maybe among others. */
export function mergebotCommand(body: string | null | undefined, order: 'r+' | 'r-') {
  const command = new RegExp(`^${re.space}*@?(?:robodoo|mergebot|hansen)${re.boundary}[:,]?${re.space}*(.*)`, 'iu');
  return splitLines(body ?? '').some((line) => {
    const match = command.exec(line);
    return match ? splitWords(match[1] as string).some((word) => stripChars(word, '.,;:!') === order) : false;
  });
}

export function isBot(login: string | null | undefined) {
  return /bot|robodoo/i.test(login ?? '');
}

/** A commit as mergebot merged it: its trailers only exist once merged. */
export function isMergedCommit(message: string) {
  return new RegExp(`${re.lineStart}(closes odoo/(?:${re.word}|-)+#${re.digit}+|X-original-commit: |Signed-off-by: )`, 'iu').test(message);
}

export function coauthorsOf(text: string) {
  const emails = [...text.matchAll(new RegExp(`${re.lineStart}Co-authored-by: [^<\\n]*<([^>]+)>`, 'giu'))];
  return new Set(emails.map((match) => (match[1] as string).toLowerCase().split('@')[0] as string));
}

export function trigramOf(name: string) {
  const match = new RegExp(`\\((${re.word}+)\\)${re.space}*$`, 'u').exec(name);
  return match ? (match[1] as string).toLowerCase() : strip(name);
}
