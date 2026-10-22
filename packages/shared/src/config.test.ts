import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { dashboardConfig } from './config';

const root = resolve(import.meta.dir, '../../..');
const local = Bun.file(resolve(root, 'config.json'));

test('reads the example', async () => {
  const config = dashboardConfig.parse(await Bun.file(resolve(root, 'config.example.json')).json());
  expect(config.squad).toEqual({ lead: 'abcd', members: ['efgh', 'ijkl', 'mnop'] });
});

test.skipIf(!(await local.exists()))('reads the config.json of this machine', async () => {
  expect(dashboardConfig.safeParse(await local.json()).error).toBeUndefined();
});

test('keeps the squad as the V1 wrote it', () => {
  expect(dashboardConfig.parse({ lead: 'abcd', members: ['efgh'] })).toMatchObject({ lead: 'abcd', members: ['efgh'] });
});

test('fills what the file leaves out', () => {
  expect(dashboardConfig.parse({})).toEqual({ github_logins: {}, arrivals: {} });
});

test('refuses a malformed trigram or arrival', () => {
  expect(dashboardConfig.safeParse({ me: 'ABCD' }).success).toBe(false);
  expect(dashboardConfig.safeParse({ arrivals: { abcd: 'janvier' } }).success).toBe(false);
});
