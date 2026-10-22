import { expect, test } from 'bun:test';
import { latestRelease, newer } from './release';

test('orders versions part by part, a pre-release before its release', () => {
  expect(newer('2.1.0', '2.0.9')).toBe(true);
  expect(newer('2.0.10', '2.0.9')).toBe(true);
  expect(newer('v2.0.0', '2.0.0-dev')).toBe(true);
  expect(newer('2.0.0-dev', '2.0.0')).toBe(false);
  expect(newer('2.0.0', '2.0.0')).toBe(false);
  expect(newer('1.9.0', '2.0.0-dev')).toBe(false);
});

test('reads the latest release, with the token when there is one', async () => {
  let auth = '';
  const fetcher = (async (_url: string, init: RequestInit) => {
    auth = new Headers(init.headers).get('authorization') ?? '';
    return Response.json({
      tag_name: 'v2.1.0',
      html_url: 'https://github.com/o/r/releases/tag/v2.1.0',
      body: '- a fix',
      published_at: null,
    });
  }) as unknown as typeof fetch;
  expect(await latestRelease('o/r', 'tok', fetcher)).toEqual({
    version: '2.1.0',
    url: 'https://github.com/o/r/releases/tag/v2.1.0',
    notes: '- a fix',
    published_at: null,
  });
  expect(auth).toBe('bearer tok');
  const missing = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
  await expect(latestRelease('o/r', null, missing)).rejects.toThrow('aucune release publiée');
});
