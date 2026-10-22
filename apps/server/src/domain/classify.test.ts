import { expect, test } from 'bun:test';
import { domainOf, kindOf, langOf, moduleOf, renamedPath, topicOf } from './classify';

test('finds the module of a path in each clone', () => {
  expect(moduleOf('odoo', 'addons/hr_holidays/models/hr_leave.py')).toBe('hr_holidays');
  expect(moduleOf('odoo', 'odoo/addons/base/models/res_users.py')).toBe('base');
  expect(moduleOf('upgrade', 'migrations/hr/18.0.1.1/pre-migrate.py')).toBe('hr');
  expect(moduleOf('enterprise', 'README.md')).toBe('(root)');
});

test('tells kinds of files apart, salary rules included', () => {
  const rules = { enterprise: new Set(['l10n_be_hr_payroll/data/cp200/employee_salary_data.xml']) };
  expect(kindOf('enterprise', 'l10n_be_hr_payroll/data/cp200/employee_salary_data.xml', rules)).toBe('rules');
  expect(kindOf('odoo', 'addons/hr/views/hr_views.xml', {})).toBe('views');
  expect(kindOf('odoo', 'addons/hr/data/hr_data.xml', {})).toBe('data');
  expect(kindOf('odoo', 'addons/hr/static/src/views/list.xml', {})).toBe('template');
  expect(kindOf('odoo', 'addons/hr/tests/test_hr.py', {})).toBe('test');
  expect(kindOf('upgrade', 'migrations/hr/18.0.1.1/pre-migrate.py', {})).toBe('migration');
  expect(kindOf('odoo', 'addons/hr/i18n/fr.po', {})).toBeNull();
});

test('names domains and topics', () => {
  expect(domainOf('l10n_be_hr_payroll')).toBe('Payroll (l10n)');
  expect(domainOf('hr_holidays_attendance')).toBe('Time Off');
  expect(topicOf('l10n_be_hr_payroll', 'l10n_be_hr_payroll/models/hr_dmfa.py')).toBe('Payroll BE › DMFA');
  expect(topicOf('hr_holidays', 'addons/hr_holidays/models/resource_calendar.py')).toBe('Resource › Working schedules');
  expect(topicOf('account', 'addons/account/models/account_move.py')).toBeNull();
});

test('reads languages and renames', () => {
  expect(langOf('addons/hr/static/src/app.ts')).toBe('js');
  expect(langOf('Makefile')).toBe('other');
  expect(renamedPath('addons/{hr_contract => hr_version}/models/hr.py')).toBe('addons/hr_version/models/hr.py');
  expect(renamedPath('old.py => new.py')).toBe('new.py');
});
