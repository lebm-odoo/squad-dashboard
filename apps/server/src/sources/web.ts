import { decodeHTML } from 'entities';
import { ownerOf } from '../domain/branches';
import type { RunbotBundle } from '../domain/features';
import { parseTrailers } from '../domain/messages';
import { re, splitWords, strip } from '../domain/py';
import { Slots } from './git';

// Mergebot (Odoo 17, no JSON API) and runbot (no API key possible) are read from their pages, with the V1's patterns: on the
// same page they give the same fields, tested on pages recorded from both sites.

export class WebError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** A page, decoded as the V1 read it; network failures are tried three times, an HTTP error is not. */
export async function getPage(url: string, { timeout = 60_000, fetcher = fetch }: { timeout?: number; fetcher?: typeof fetch } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetcher(url, { headers: { 'user-agent': 'squad-dashboard/2.0' }, signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new WebError(`${url} : HTTP ${response.status}`, response.status);
      return new TextDecoder().decode(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof WebError || attempt === 2) throw error;
      await Bun.sleep(2000 * (attempt + 1));
    }
  }
}

const untag = (html: string, by = ' ') => html.replace(/<[^>]+>/g, by);
const utcTs = (text: string) => Date.parse(`${text.replace(' ', 'T')}Z`) / 1000;

export type MergebotRecord = {
  repo: string;
  number: number;
  state: string;
  fetched: number;
  url?: string;
  mergebot_url?: string;
  phase?: string;
  draft?: boolean;
  blocked?: boolean;
  missing_r?: boolean;
  title?: string;
  created_by?: string;
  label?: string;
  merged_at?: number | null;
  merged_by?: string | null;
  ci?: Record<string, string>;
  review?: string | null;
  linked?: { branch: string; repo: string; number: number; state: string; merged_at?: number }[];
  desc_words?: number;
  tasks?: string[];
  opws?: string[];
};

/** Mergebot's page of a PR: its state, the forward-ports table, the CI and review checklist, the description's ids. */
export function parseMergebot(page: string, repo: string, number: number, fetched: number): MergebotRecord {
  const w = re.word;
  // Like Python's slices, a -1 from a missing marker counts from the end.
  const main = page.slice(page.indexOf('</h6>'));
  const alert = new RegExp(`<div class="alert alert-(${w}+)">${re.space}*(?:<p[^>]*>)?${re.space}*((?:${w}| )+)`, 'u').exec(main);
  const title = /<h3>([\s\S]*?)<\/h3>/.exec(main);
  const merged = new RegExp(
    `<dt>merged</dt>${re.space}*<dd>${re.space}*<span title="([^"]+)">[\\s\\S]*?</span>${re.space}*by${re.space}*<span title="[^"]*">([^<]*)</span>`,
    'u',
  ).exec(main);
  const created = /Created by <span>([^<]*)<\/span>/.exec(page);
  const label = new RegExp(`<dt>label</dt>${re.space}*<dd><span>([^<]*)</span>`, 'u').exec(main);
  const linked: NonNullable<MergebotRecord['linked']> = [];
  for (const [, row] of main.matchAll(/<tr class="[^"]*">([\s\S]*?)<\/tr>/g)) {
    const branch = new RegExp(`<td>((?:${w}|[.\\-])+)</td>`, 'u').exec(row as string);
    // A detached forward-port's cell has its title before its class.
    const cells = new RegExp(
      `<td(?: [^>]*?)? class="([^"]*)"[^>]*>${re.space}*<span title="([^"]*)"[^>]*>${re.space}*<a href="/(odoo/(?:${w}|-)+)/pull/(${re.digit}+)"`,
      'gu',
    );
    for (const [, cellClass, spanTitle, linkedRepo, linkedNumber] of (row as string).matchAll(cells)) {
      const mergedAt = /^merged at (.+)$/.exec(spanTitle as string);
      linked.push({
        branch: branch ? (branch[1] as string) : '',
        repo: linkedRepo as string,
        number: Number(linkedNumber),
        state: (cellClass as string).includes('table-success') ? 'merged' : spanTitle === 'closed' ? 'closed' : 'open',
        ...(mergedAt && { merged_at: utcTs(mergedAt[1] as string) }),
      });
    }
  }
  const description = title ? decodeHTML(untag(main.slice(main.indexOf('</h3>'), main.indexOf('</main>')))) : '';
  const trailers = parseTrailers(decodeHTML(untag(main)));
  const ci = new RegExp(`<li class="${re.space}*(${w}*)${re.space}*">${re.space}*<a href="[^"]*">((?:ci|legal)/(?:${w}|-)+)</a>`, 'gu');
  const review = new RegExp(`<li class="(${w}*)">${re.space}*(Review)${re.boundary}`, 'u').exec(main);
  // The PR's own cell of the forward-ports table: the other cells tell the r+ their ports miss.
  const own = main
    .split('<td')
    .slice(1)
    .map((cell) => cell.slice(0, cell.indexOf('</td>')))
    .find((cell) => cell.includes(`href="/${repo}/pull/${number}"`));
  return {
    repo,
    number,
    url: `https://github.com/${repo}/pull/${number}`,
    mergebot_url: `https://mergebot.odoo.com/${repo}/pull/${number}`,
    state: alert ? (({ success: 'merged', light: 'closed' } as Record<string, string>)[alert[1] as string] ?? 'open') : 'open',
    phase: alert ? strip(alert[2] as string) : '',
    draft: main.includes('is in draft'),
    blocked: main.includes('>Blocked<'),
    missing_r: (own ?? main).includes('missing r+'),
    title: title ? strip(decodeHTML(untag(title[1] as string, ''))) : '',
    created_by: created ? decodeHTML(created[1] as string) : '',
    label: label ? decodeHTML(label[1] as string) : '',
    merged_at: merged ? utcTs(merged[1] as string) : null,
    merged_by: merged ? strip(decodeHTML(merged[2] as string)) : null,
    ci: Object.fromEntries([...main.matchAll(ci)].map(([, state, name]) => [name as string, state || 'pending'])),
    review: review ? review[1] || 'pending' : null,
    linked,
    desc_words: splitWords(description).length,
    tasks: trailers.tasks,
    opws: trailers.opws,
    fetched,
  };
}

/**
 * A PR's mergebot page, read again only while it can change: an open PR after 5 minutes, a merged one whose forward-ports
 * are still open hourly for 30 days, or once more if it was read in the hour of the last merge of its chain, before mergebot
 * opened the next port. A PR mergebot does not know is kept as missing.
 */
export async function readMergebot(repo: string, number: number, cached: MergebotRecord | undefined, now: number, fetcher = fetch) {
  if (cached && now - cached.fetched < 300) return cached;
  const lastMerge = Math.max(cached?.merged_at ?? 0, ...(cached?.linked ?? []).map((link) => link.merged_at ?? 0));
  const portsMoving =
    cached?.state === 'merged' &&
    ((cached.linked ?? []).some((link) => link.state === 'open') || cached.fetched - lastMerge < 3600) &&
    now - (cached.merged_at ?? 0) < 30 * 86400 &&
    now - cached.fetched > 3600;
  if (cached && ['merged', 'closed', 'missing'].includes(cached.state) && !portsMoving) return cached;
  try {
    return parseMergebot(await getPage(`https://mergebot.odoo.com/${repo}/pull/${number}`, { fetcher }), repo, number, now);
  } catch (error) {
    if (error instanceof WebError && error.status === 404) return { repo, number, state: 'missing', fetched: now };
    throw error;
  }
}

/** The pages of many PRs, two at a time and paced: an error on one keeps what was known of it. */
export async function readMergebotAll(keys: string[], cached: Record<string, MergebotRecord>, now: number, fetcher = fetch) {
  const slots = new Slots(2);
  const errors: string[] = [];
  const read = await Promise.all(
    [...keys].sort().map((key) =>
      slots.run(async () => {
        const [repo, number] = key.split('#') as [string, string];
        try {
          const record = await readMergebot(repo, Number(number), cached[key], now, fetcher);
          if (record !== cached[key]) await Bun.sleep(500);
          return record;
        } catch (error) {
          errors.push(`${key} : ${(error as Error).message}`);
          return cached[key];
        }
      }),
    ),
  );
  return { read: read.filter((record): record is MergebotRecord => Boolean(record)), errors };
}

/** Runbot's bundles matching a search, those `keep` accepts: their branches, PRs and last batches. */
export function parseRunbot(page: string, keep: (name: string) => boolean) {
  const bundles: Record<string, RunbotBundle & { batches: RunbotBatch[] }> = {};
  const w = re.word;
  for (const row of page.split('<div class="row bundle_row">').slice(1)) {
    const match = /href="\/runbot\/bundle\/(\d+)" title="View Bundle ([^"]+)"/.exec(row);
    if (!match || !keep(decodeHTML(match[2] as string))) continue;
    const links = [
      ...row.matchAll(
        new RegExp(
          `href="https://github.com/((?:${w}|-)+/(?:${w}|-)+)/(tree|pull)/([^"]+)" title="[^"]*">${re.space}*<span[^>]*>[^<]*</span>${re.space}*<span class="([^"]*)"`,
          'gu',
        ),
      ),
    ];
    const batches: RunbotBatch[] = [];
    for (const tile of row.split('<div class="batch_tile">').slice(1)) {
      const batch = new RegExp(`card bg-((?:${w}|-)+?)-subtle[\\s\\S]*?href="/runbot/batch/(${re.digit}+)" title="([^"]+)"`, 'u').exec(
        tile,
      );
      if (!batch) continue;
      const counted = (pattern: RegExp) => {
        const counter: Record<string, number> = {};
        for (const [, value] of tile.matchAll(pattern)) counter[value as string] = (counter[value as string] ?? 0) + 1;
        return counter;
      };
      const states = counted(new RegExp(`data-global_state="(${w}+)"`, 'gu'));
      batches.push({
        id: Number(batch[2]),
        at: utcTs(batch[3] as string),
        state: batch[1] as string,
        results: counted(new RegExp(`data-global_result="(${w}+)"`, 'gu')),
        running: Object.entries(states).reduce((total, [state, n]) => total + (state !== 'done' ? n : 0), 0),
        failed: [...new Set([...tile.matchAll(/btn-danger disabled">[\s\S]*?<span>([^<]+)<\/span>/g)].map((m) => m[1] as string))].sort(),
      });
    }
    bundles[decodeHTML(match[2] as string)] = {
      id: Number(match[1]),
      url: `https://runbot.odoo.com/runbot/bundle/${match[1]}`,
      branches: links
        .filter(([, , kind]) => kind === 'tree')
        .map(([, repo, , , cls]) => ({ repo: repo as string, deleted: (cls as string).includes('line-through') })),
      prs: links
        .filter(([, repo, kind]) => kind === 'pull' && (repo as string).startsWith('odoo/'))
        .map(([, repo, , number, cls]) => ({
          repo: repo as string,
          number: Number(number),
          closed: (cls as string).includes('line-through'),
        })),
      batches,
    };
  }
  return bundles;
}
export type RunbotBatch = { id: number; at: number; state: string; results: Record<string, number>; running: number; failed: string[] };

/**
 * The bundles of each member: one search each, four at a time. A bundle named after the member is theirs; a branch they
 * contributed to is searched by its name.
 */
export async function readRunbot(members: string[], contributed: string[], names: ReadonlySet<string>, fetcher = fetch) {
  const queries: [string, (name: string) => boolean][] = [
    ...members.map((member): [string, (name: string) => boolean] => [member, (name) => ownerOf(name, names) === member]),
    ...[...contributed]
      .sort()
      .slice(0, 15)
      .map((branch): [string, (name: string) => boolean] => [branch, (name) => name === branch]),
  ];
  const slots = new Slots(4);
  const pages = await Promise.all(
    queries.map(([query, keep]) =>
      slots.run(async () => {
        const page = await getPage(`https://runbot.odoo.com/runbot/r-d-1?search=${encodeURIComponent(query)}&limit=500`, {
          timeout: 120_000,
          fetcher,
        });
        if (page.slice(0, 2000).includes('Check in progress')) throw new WebError('runbot a répondu par un challenge anti-bot');
        await Bun.sleep(2000);
        return parseRunbot(page, keep);
      }),
    ),
  );
  return Object.assign({}, ...pages) as Record<string, RunbotBundle>;
}
