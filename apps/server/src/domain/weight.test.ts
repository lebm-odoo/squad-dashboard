import { expect, test } from 'bun:test';
import { changedOpcodes, mechanicalLines, substance } from './weight';

test('weighs lines by the kind of file, deletions and bulk data less', () => {
  const value = substance(
    'odoo',
    [
      ['addons/hr/models/hr.py', 100, 10],
      ['addons/hr/views/hr_views.xml', 50, 0],
      ['addons/hr/data/big.csv', 1000, 0],
    ],
    null,
    {},
  );
  // 100 + 0.3 × 10 = 103, 0.6 × 50 = 30, data 0.15 × 300 + 0.02 × 700 = 59.
  expect(value).toEqual({
    weighted: 192,
    profile: { back: 110, front: 0, views: 50, data: 1000, test: 0 },
    mechanical: 0,
    parts: {
      back: { ins: 100, dels: 10, mechanical: 0, weight: 1, weighted: 103 },
      views: { ins: 50, dels: 0, mechanical: 0, weight: 0.6, weighted: 30 },
      data: { ins: 1000, dels: 0, mechanical: 0, weight: 0.15, weighted: 59 },
    },
  });
});

test('counts moved lines as mechanical, and rounds halves to even like the V1', () => {
  const moved = { 'addons/hr/models/b.py': [10, 0] as [number, number] };
  expect(substance('odoo', [['addons/hr/models/b.py', 10, 0]], moved, {})).toMatchObject({ weighted: 1, mechanical: 10 });
  expect(substance('odoo', [['addons/hr/views/v.xml', 0, 25]], null, {}).weighted).toBe(4);
});

test('finds lines moved between files and lines renamed', () => {
  const diff = [
    '--- a/addons/hr/models/a.py',
    '+++ b/addons/hr/models/a.py',
    '@@ -1,1 +0,0 @@',
    '-def compute_manager(self):',
    '--- a/addons/hr/models/b.py',
    '+++ b/addons/hr/models/b.py',
    '@@ -0,0 +1,1 @@',
    '+def compute_manager(self):',
    '@@ -5,3 +5,3 @@',
    '-    employee.contract_id = x',
    '-    employee.contract_id = y',
    '-    employee.contract_id = z',
    '+    employee.version_id = x',
    '+    employee.version_id = y',
    '+    employee.version_id = z',
  ].join('\n');
  expect(Object.fromEntries(mechanicalLines(diff))).toEqual({ 'addons/hr/models/a.py': [0, 1], 'addons/hr/models/b.py': [4, 3] });
});

test('diffs token sequences like difflib', () => {
  expect(changedOpcodes(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([{ tag: 'replace', i1: 1, i2: 2, j1: 1, j2: 2 }]);
  expect(changedOpcodes(['a', 'b'], ['a', 'b', 'c'])).toEqual([{ tag: 'insert', i1: 2, i2: 2, j1: 2, j2: 3 }]);
});
