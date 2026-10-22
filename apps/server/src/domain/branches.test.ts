import { expect, test } from 'bun:test';
import { authorOf, forwardPortOf, isRecentVersionRef, namesIn, ownerOf, versionOf } from './branches';

const names = new Set(['abc', 'lebm', 'romc']);

test('finds the owner of a branch; a 3-letter trigram only at the end', () => {
  expect(ownerOf('master-hr-fix-lebm', names)).toBe('lebm');
  expect(ownerOf('master-abc-refactor-hr', names)).toBeNull();
  expect(ownerOf('master-refactor-hr-abc', names)).toBe('abc');
  expect(ownerOf('master-refactor-hr-abc-v2', names)).toBe('abc');
  expect(ownerOf('17.0-15.0-fix-hr-lebm-1234-fw', names)).toBe('lebm');
});

test('finds who a branch of someone not listed is named after, by their login or its trailing trigram', () => {
  expect(authorOf('master-dimona-jugj', 'jugj-odoo')).toBe('jugj');
  expect(authorOf('17.0-15.0-fix-gantt-jugj-1234-fw')).toBe('jugj');
  expect(authorOf('master-payroll-tivisse-v2', 'tivisse')).toBe('tivisse');
  expect(authorOf('master-payroll-yti', 'tivisse')).toBe('yti');
  expect(authorOf('master-crash-fix')).toBeNull();
  expect(authorOf('master-sale-report')).toBeNull();
});

test('sees pair work and forward-ports', () => {
  expect([...namesIn('master-hr-lebm-romc', names)].sort()).toEqual(['lebm', 'romc']);
  expect(forwardPortOf('17.0-15.0-fix-hr-lebm-1234-fw')).toBe('15.0-fix-hr-lebm');
  expect(forwardPortOf('master-fix-hr-lebm')).toBeNull();
});

test('reads versions', () => {
  expect(versionOf('saas-18.2-fix-hr-lebm')).toBe('saas-18.2');
  expect(versionOf('fix-hr-lebm')).toBe('master');
  expect(isRecentVersionRef('refs/remotes/origin/saas-17.4')).toBe(true);
  expect(isRecentVersionRef('refs/remotes/origin/15.0')).toBe(false);
  expect(isRecentVersionRef('refs/remotes/origin/master')).toBe(true);
});
