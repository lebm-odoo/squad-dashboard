import { describe, expect, test } from 'bun:test';
import { parseMergebot, readMergebot } from './web';

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
