export type Kind = 'back' | 'front' | 'migration' | 'rules' | 'template' | 'views' | 'style' | 'test' | 'data' | 'other';
/** The XML files of each clone holding salary rules (Python code in records), found once by `git grep`. */
export type RuleFiles = Partial<Record<string, ReadonlySet<string>>>;

export function domainOf(module: string) {
  if (module.startsWith('l10n_') && (module.includes('payroll') || module.includes('_hr'))) return 'Payroll (l10n)';
  const rules = [
    ['payroll', 'Payroll'],
    ['hr_holidays', 'Time Off'],
    ['leave', 'Time Off'],
    ['hr_attendance', 'Attendance'],
    ['hr_appraisal', 'Appraisal'],
    ['hr_recruitment', 'Recruitment'],
    ['hr_referral', 'Recruitment'],
    ['hr_contract', 'Contracts'],
    ['hr_version', 'Contracts'],
    ['hr_work_entry', 'Work Entries'],
    ['hr_expense', 'Expenses'],
    ['hr_skills', 'Skills'],
    ['timesheet', 'Timesheets'],
    ['planning', 'Planning'],
    ['documents', 'Documents'],
    ['resource', 'Resource'],
    ['fleet', 'Fleet'],
    ['hr', 'Employees'],
  ] as const;
  for (const [needle, domain] of rules) {
    if (module === needle || module.startsWith(`${needle}_`) || (needle.length > 3 && module.includes(needle))) return domain;
  }
  if (module.startsWith('l10n_')) return 'Localization';
  if (['web', 'mail', 'base', 'web_enterprise', 'web_studio', 'bus', 'portal', 'odoo', 'tools'].includes(module)) return 'Framework';
  return 'Other';
}

export function countryOf(module: string) {
  return /^l10n_([a-z]{2})(?:_|$)/.exec(module)?.[1]?.toUpperCase() ?? null;
}

/** `App › feature` a file belongs to, e.g. `Payroll BE › DMFA` or `Resource › Working schedules`. */
export function topicOf(module: string, path: string, title = '') {
  const apps: [RegExp, string][] = [
    [/payroll/, 'Payroll'],
    [/hr_holidays|leave/, 'Time Off'],
    [/hr_attendance/, 'Attendance'],
    [/hr_work_entry/, 'Work Entries'],
    [/^resource/, 'Resource'],
    [/hr_contract_salary/, 'Salary Configurator'],
    [/hr_skills/, 'Skills'],
    [/hr_appraisal/, 'Appraisal'],
    [/hr_recruitment|hr_referral/, 'Recruitment'],
    [/hr_expense/, 'Expenses'],
    [/timesheet/, 'Timesheets'],
    [/planning/, 'Planning'],
    [/documents/, 'Documents'],
    [/fleet/, 'Fleet'],
    [/hr_version|hr_contract/, 'Contracts'],
    [/^hr($|_)/, 'Employees'],
  ];
  // The big features inside an app, recognised in file paths, else in the PR title. In English, like Odoo's.
  const features: [RegExp, string][] = [
    [/payslip_run|payrun|pay_run|pay runs?/, 'Pay runs'],
    [/dmfa/, 'DMFA'],
    [/dimona/, 'Dimona'],
    [/281|belcotax|273s|274_xx|withholding/, 'Tax forms'],
    [/holiday_attest|double_pay|double.holiday|pécule/, 'Holiday pay'],
    [/onss/, 'ONSS'],
    [/salary_rule|rule_parameter|\/cp200\/|salary rules?/, 'Salary rules'],
    [/structure/, 'Salary structures'],
    [/payslip_input|input_type/, 'Inputs'],
    [/worked_days/, 'Worked days'],
    [/salary_attachment/, 'Salary attachments'],
    [/iso20022|sepa|payment/, 'Payments'],
    [/declaration|headcount/, 'Declarations'],
    [/warning/, 'Warnings'],
    [/accrual/, 'Accruals'],
    [/allocation/, 'Allocations'],
    [/overtime/, 'Overtime'],
    [/calendar/, 'Working schedules'],
    [/departure|termination/, 'Departures'],
    [/benefit/, 'Benefits'],
    [/gantt/, 'Gantt view'],
    [/dashboard/, 'Dashboards'],
    [/work_entr|work entr/, 'Work entries'],
    [/version|contract/, 'Contracts'],
    [/payslip/, 'Payslips'],
    [/report/, 'Reports'],
  ];
  const core = module.replace(/^test_/, '').replace(/^l10n_[a-z]{2}_/, '');
  let app = apps.find(([pattern]) => pattern.test(core))?.[1];
  if (!app) return null;
  const country = countryOf(module.replace(/^test_/, ''));
  if (country) app = `${app} ${country}`;
  // Inside the module only: its own name (hr_work_entry_contract…) would always match.
  const parts = path.toLowerCase().split('/');
  const where = (parts.includes(module) ? parts.slice(parts.indexOf(module) + 1) : parts.slice(1)).join('/');
  const feature =
    features.find(([pattern]) => pattern.test(where))?.[1] ?? features.find(([pattern]) => pattern.test(title.toLowerCase()))?.[1];
  // resource.calendar, whichever module extends it (Time Off, Payroll BE…), is the Resource app.
  if (feature === 'Working schedules') return 'Resource › Working schedules';
  return feature && !app.toLowerCase().includes(feature.toLowerCase()) ? `${app} › ${feature}` : app;
}

export function moduleOf(repo: string, path: string) {
  const parts = path.split('/');
  if (repo === 'odoo') {
    if (parts[0] === 'addons' && parts.length > 2) return parts[1] as string;
    if (parts[0] === 'odoo' && parts[1] === 'addons' && parts.length > 3) return parts[2] as string;
  }
  if (repo === 'upgrade' && parts[0] === 'migrations' && parts.length > 2) return parts[1] as string;
  return parts.length > 1 ? (parts[0] as string) : '(root)';
}

export function langOf(path: string) {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  const langs: Record<string, string> = {
    py: 'py',
    js: 'js',
    ts: 'js',
    xml: 'xml',
    scss: 'css',
    css: 'css',
    csv: 'data',
    po: 'i18n',
    pot: 'i18n',
    rst: 'doc',
    md: 'doc',
  };
  return Object.hasOwn(langs, ext) ? (langs[ext] as string) : 'other';
}

export function kindOf(repo: string, path: string, ruleFiles: RuleFiles): Kind | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const ext = name.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  if (ext === 'po' || ext === 'pot') return null;
  const data = [
    'csv',
    'json',
    'yml',
    'yaml',
    'txt',
    'svg',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'pdf',
    'xlsx',
    'xls',
    'woff',
    'woff2',
    'ttf',
    'xsd',
    'html',
  ];
  if (data.includes(ext)) return 'data';
  const test = path.includes('/tests/') || path.startsWith('tests/') || path.includes('/static/tests/');
  if (ext === 'py')
    return test ? 'test' : repo === 'upgrade' || path.includes('/migrations/') || path.includes('/upgrades/') ? 'migration' : 'back';
  if (ext === 'js' || ext === 'ts' || ext === 'mjs') return test ? 'test' : 'front';
  if (ext === 'scss' || ext === 'css' || ext === 'less') return 'style';
  if (ext === 'xml') {
    if (test) return 'test';
    if (path.includes('/static/')) return 'template';
    if (ruleFiles[repo]?.has(path) || /salary_rules?[/_.]|\/cp200\//.test(path)) return 'rules';
    return /\/(data|demo|security)\//.test(path) ? 'data' : 'views';
  }
  return 'other';
}

/** The new path of a numstat entry, `a/{b => c}/d` or `a => b` when git detected a rename. */
export function renamedPath(path: string) {
  if (!path.includes(' => ')) return path;
  return (
    path
      .replace(/\{[^}]* => ([^}]*)\}/g, '$1')
      .split(' => ')
      .at(-1) as string
  ).replaceAll('//', '/');
}
