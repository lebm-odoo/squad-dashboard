import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ownerOf } from '../domain/branches';
import { parseMergebot, parseRunbot, readMergebot } from './web';

// Pages recorded from mergebot and runbot, with what the V1 parsed of them: private, never in git.
const pages = resolve(import.meta.dir, '../../../../parity/fixtures/pages');
const read = (name: string) => Bun.file(resolve(pages, name)).text();

describe.skipIf(!existsSync(pages))('pages read as the V1 read them', () => {
  test('mergebot', async () => {
    const expected: Record<string, Record<string, unknown>> = await Bun.file(resolve(pages, 'mergebot.json')).json();
    // The V1 took the r+ its detached 20.0 port misses for the PR's own.
    Object.assign(expected['odoo/enterprise#135824'] ?? {}, { missing_r: false });
    for (const name of readdirSync(pages).filter((file) => file.startsWith('mb-'))) {
      const [, slug, number] = name.slice(0, -5).split('-') as [string, string, string];
      const repo = slug.replace('_', '/');
      const key = `${repo}#${number}`;
      const parsed =
        expected[key]?.state === 'missing'
          ? { repo, number: Number(number), state: 'missing', fetched: 0 }
          : parseMergebot(await read(name), repo, Number(number), 0);
      // The V1 missed the cells of detached forward-ports, their title before their class, and kept no merge date per cell.
      const page = await read(name);
      const detached = new Set(
        [...page.matchAll(/title="detached"[^>]*>\s*<span[^>]*>\s*<a href="\/[^"]+\/pull\/(\d+)"/g)].map((match) => Number(match[1])),
      );
      const { fetched, ...rest } = parsed;
      const linked = rest.linked?.filter((link) => !detached.has(link.number)).map(({ merged_at, ...link }) => link);
      expect([key, { ...rest, ...(linked && { linked }) }]).toEqual([key, expected[key] as never]);
    }
  });

  test('runbot', async () => {
    const config = await Bun.file(resolve(import.meta.dir, '../../../../config.json')).json();
    const names = new Set<string>([...config.people, ...config.guests]);
    const parsed = parseRunbot(await read('rb-lebm.html'), (name) => ownerOf(name, names) === 'lebm');
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(await Bun.file(resolve(pages, 'runbot.json')).json());
  });
});

test('the forward-ports table holds the detached ports, and when each port merged', () => {
  const merged = (number: number, at: string) =>
    `<td class="table-success"> <span title="merged at ${at}"> <a href="/odoo/odoo/pull/${number}">#${number}</a> </span> </td>`;
  const detached =
    '<td title="detached" class="detached table-warning"> <span title="validated, is not ready"> <a href="/odoo/odoo/pull/3">#3</a> <sup class="text-danger">missing r+</sup> </span> </td>';
  const page = `<h6>x</h6><table><tr class="bg-info "><td>19.0</td>${merged(1, '2026-10-20 18:30:12')}</tr><tr class=" "><td>saas-19.4</td>${merged(2, '2026-10-22 09:03:51')}</tr><tr class=" "><td>20.0</td>${detached}</tr><tr class=" "><td>master</td><td></td></tr></table>`;
  expect(parseMergebot(page, 'odoo/odoo', 1, 0).linked).toEqual([
    { branch: '19.0', repo: 'odoo/odoo', number: 1, state: 'merged', merged_at: Date.parse('2026-10-20T18:30:12Z') / 1000 },
    { branch: 'saas-19.4', repo: 'odoo/odoo', number: 2, state: 'merged', merged_at: Date.parse('2026-10-22T09:03:51Z') / 1000 },
    { branch: '20.0', repo: 'odoo/odoo', number: 3, state: 'open' },
  ]);
});

test("a PR's r+ is read in its own cell, not in its forward-ports'", () => {
  const cell = (number: number, title: string, marks = '') =>
    `<td class="table-warning"><span title="${title}"><a href="/odoo/odoo/pull/${number}">#${number}</a>${marks}</span></td>`;
  const page = (own: string) =>
    `<h6>x</h6><table><tr class="bg-info"><td>16.0</td>${own}</tr><tr class=" "><td>17.0</td>${cell(2, 'opened, is not ready', '<sup class="text-danger">missing r+</sup>')}</tr></table>`;
  expect(parseMergebot(page(cell(1, 'approved, is not ready')), 'odoo/odoo', 1, 0).missing_r).toBe(false);
  expect(parseMergebot(page(cell(1, 'opened', '<sup class="text-danger">missing r+</sup>')), 'odoo/odoo', 1, 0).missing_r).toBe(true);
  expect(parseMergebot(page(cell(1, 'opened')), 'odoo/odoo', 2, 0).missing_r).toBe(true);
});

describe('mergebot pages read again only while they can change', () => {
  const merged = { repo: 'odoo/odoo', number: 1, state: 'merged', fetched: 5000, merged_at: 900, linked: [] };
  const never = (() => {
    throw new Error('lu');
  }) as unknown as typeof fetch;

  test('a merged PR stays as read, unless its forward-ports still move', async () => {
    expect(await readMergebot('odoo/odoo', 1, merged, 10_000, never)).toBe(merged);
    const moving = { ...merged, linked: [{ branch: '18.0', repo: 'odoo/odoo', number: 2, state: 'open' }] };
    const page = new Response('<h6>x</h6><div class="alert alert-success">Merged</div>');
    const read = await readMergebot('odoo/odoo', 1, moving, 10_000, (async () => page) as unknown as typeof fetch);
    expect(read).toMatchObject({ state: 'merged', fetched: 10_000 });
  });

  test('a merged PR read as a port of its chain merged is read once more, for the port mergebot opened after', async () => {
    const chain = {
      ...merged,
      fetched: 6000,
      linked: [{ branch: '18.0', repo: 'odoo/odoo', number: 2, state: 'merged', merged_at: 5500 }],
    };
    const page = new Response('<h6>x</h6><div class="alert alert-success">Merged</div>');
    const read = await readMergebot('odoo/odoo', 1, chain, 10_000, (async () => page) as unknown as typeof fetch);
    expect(read).toMatchObject({ state: 'merged', fetched: 10_000 });
    expect(await readMergebot('odoo/odoo', 1, { ...chain, fetched: 9200 }, 20_000, never)).toMatchObject({ fetched: 9200 });
  });

  test('a merged PR read as it merged is read once more, for the forward-ports mergebot opened after', async () => {
    const early = { ...merged, fetched: 1000 };
    const page = new Response('<h6>x</h6><div class="alert alert-success">Merged</div>');
    const read = await readMergebot('odoo/odoo', 1, early, 10_000, (async () => page) as unknown as typeof fetch);
    expect(read).toMatchObject({ state: 'merged', fetched: 10_000 });
  });

  test('a PR mergebot does not know is kept as missing', async () => {
    const notFound = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await readMergebot('odoo/odoo', 1, undefined, 10_000, notFound)).toEqual({
      repo: 'odoo/odoo',
      number: 1,
      state: 'missing',
      fetched: 10_000,
    });
  });
});
