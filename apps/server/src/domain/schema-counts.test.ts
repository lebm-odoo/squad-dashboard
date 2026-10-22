import { expect, test } from 'bun:test';
import { schemaCounts } from './schema-counts';

test('counts new models, fields and tests; a moved definition cancels out', () => {
  const python = [
    "+    _name = 'hr.version'",
    '+    wage = fields.Monetary()',
    '+    manager_id = fields.Many2one("hr.employee")',
    '-    manager_id = fields.Many2one("hr.employee")',
  ].join('\n');
  const tests = ['+    def test_version_wage(self):', '+test("opens the form", async () => {', '+    helper = 1'].join('\n');
  expect(schemaCounts(python, tests)).toEqual({ newModels: 1, newFields: 1, newTests: 2 });
});
