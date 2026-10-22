import { expect, test } from 'bun:test';
import { authorOf, forwardPortOf, isRecentVersionRef, namesIn, ownerOf, versionOf } from './branches';

const names = new Set(['abc', 'anne', 'bert']);

test('finds the owner of a branch; a 3-letter trigram only at the end', () => {
  expect(ownerOf('master-hr-fix-anne', names)).toBe('anne');
  expect(ownerOf('master-abc-refactor-hr', names)).toBeNull();
  expect(ownerOf('master-refactor-hr-abc', names)).toBe('abc');
  expect(ownerOf('master-refactor-hr-abc-v2', names)).toBe('abc');
  expect(ownerOf('17.0-15.0-fix-hr-anne-1234-fw', names)).toBe('anne');
});

test('finds who a branch of someone not listed is named after, by their login or its trailing trigram', () => {
  expect(authorOf('master-dimona-carl', 'carl-odoo')).toBe('carl');
  expect(authorOf('17.0-15.0-fix-gantt-carl-1234-fw')).toBe('carl');
  expect(authorOf('master-payroll-dorine-v2', 'dorine')).toBe('dorine');
  expect(authorOf('master-payroll-dor', 'dorine')).toBe('dor');
  expect(authorOf('master-crash-fix')).toBeNull();
  expect(authorOf('master-sale-report')).toBeNull();
});

test('sees pair work and forward-ports', () => {
  expect([...namesIn('master-hr-anne-bert', names)].sort()).toEqual(['anne', 'bert']);
  expect(forwardPortOf('17.0-15.0-fix-hr-anne-1234-fw')).toBe('15.0-fix-hr-anne');
  expect(forwardPortOf('master-fix-hr-anne')).toBeNull();
});

test('reads versions', () => {
  expect(versionOf('saas-18.2-fix-hr-anne')).toBe('saas-18.2');
  expect(versionOf('fix-hr-anne')).toBe('master');
  expect(isRecentVersionRef('refs/remotes/origin/saas-17.4')).toBe(true);
  expect(isRecentVersionRef('refs/remotes/origin/15.0')).toBe(false);
  expect(isRecentVersionRef('refs/remotes/origin/master')).toBe(true);
});
