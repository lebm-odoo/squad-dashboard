#!/usr/bin/env python3
"""Collects the work of a squad from the local git clones, runbot, mergebot and GitHub, and serves the squad page.

Nothing runs on a timer: collections are triggered from the page (or --once). Everything observed is appended to
history.json so it survives reflog expiry, branch deletion and runbot cleanup.
"""
import argparse
import calendar
import collections
import concurrent.futures
import difflib
import gzip
import html
import http.client
import http.server
import json
import math
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def read_version(text):
    """An X.Y.Z version, as written in the VERSION file."""
    m = re.fullmatch(r'\s*(\d+\.\d+\.\d+)\s*', text or '')
    return m.group(1) if m else None


APP_VERSION = read_version((HERE / 'VERSION').read_text()) if (HERE / 'VERSION').exists() else None


def log(*args):
    print(time.strftime('%H:%M:%S'), *args, file=sys.stderr, flush=True)


class Git:
    def __init__(self, path):
        self.path = path

    def run(self, *args, check=True, input=None):
        res = subprocess.run(['git', '-C', str(self.path), *args], capture_output=True, input=input, check=False)
        if check and res.returncode:
            raise RuntimeError(f"git {' '.join(args[:3])}: {res.stderr.decode(errors='replace').strip()}")
        return res.stdout.decode(errors='replace')

    def ok(self, *args):
        return subprocess.run(['git', '-C', str(self.path), *args], capture_output=True).returncode == 0

    def exists(self, rev):
        return self.ok('cat-file', '-e', f'{rev}^{{commit}}')


class Store:
    def __init__(self, path, backup=False):
        self.path = path
        self.backup = backup
        self.lock = threading.RLock()
        try:
            self.data = json.loads(path.read_text())
        except (OSError, ValueError):
            self.data = {}

    def get(self, section, key):
        return self.data.get(section, {}).get(key)

    def section(self, section):
        return self.data.setdefault(section, {})

    def set(self, section, key, value):
        with self.lock:
            self.data.setdefault(section, {})[key] = value

    def save(self):
        with self.lock:
            if self.backup and self.path.exists():
                shutil.copyfile(self.path, self.path.with_suffix('.json.bak'))
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(self.data))
            tmp.replace(self.path)


def domain_of(module):
    if module.startswith('l10n_') and ('payroll' in module or '_hr' in module):
        return 'Payroll (l10n)'
    rules = [
        ('payroll', 'Payroll'), ('hr_holidays', 'Time Off'), ('leave', 'Time Off'),
        ('hr_attendance', 'Attendance'), ('hr_appraisal', 'Appraisal'), ('hr_recruitment', 'Recruitment'),
        ('hr_referral', 'Recruitment'), ('hr_contract', 'Contracts'), ('hr_version', 'Contracts'),
        ('hr_work_entry', 'Work Entries'), ('hr_expense', 'Expenses'), ('hr_skills', 'Skills'),
        ('timesheet', 'Timesheets'), ('planning', 'Planning'), ('documents', 'Documents'),
        ('resource', 'Resource'), ('fleet', 'Fleet'), ('hr', 'Employees'),
    ]
    for needle, domain in rules:
        if module == needle or module.startswith(needle + '_') or (len(needle) > 3 and needle in module):
            return domain
    if module.startswith('l10n_'):
        return 'Localization'
    if module in ('web', 'mail', 'base', 'web_enterprise', 'web_studio', 'bus', 'portal', 'odoo', 'tools'):
        return 'Framework'
    return 'Other'


# The app a module belongs to, by its core name (localisation and test prefixes, bridge suffixes stripped).
TOPIC_APPS = [
    (r'payroll', 'Payroll'), (r'hr_holidays|leave', 'Time Off'), (r'hr_attendance', 'Attendance'), (r'hr_work_entry', 'Work Entries'),
    (r'^resource', 'Resource'), (r'hr_contract_salary', 'Salary Configurator'), (r'hr_skills', 'Skills'), (r'hr_appraisal', 'Appraisal'),
    (r'hr_recruitment|hr_referral', 'Recruitment'), (r'hr_expense', 'Expenses'), (r'timesheet', 'Timesheets'), (r'planning', 'Planning'),
    (r'documents', 'Documents'), (r'fleet', 'Fleet'), (r'hr_version|hr_contract', 'Contracts'), (r'^hr($|_)', 'Employees'),
]
# The big features inside an app, recognised in file paths (and in the PR title when no file tells). In English, like Odoo's.
TOPIC_FEATURES = [
    (r'payslip_run|payrun|pay_run|pay runs?', 'Pay runs'), (r'dmfa', 'DMFA'), (r'dimona', 'Dimona'),
    (r'281|belcotax|273s|274_xx|withholding', 'Tax forms'), (r'holiday_attest|double_pay|double.holiday|pécule', 'Holiday pay'),
    (r'onss', 'ONSS'), (r'salary_rule|rule_parameter|/cp200/|salary rules?', 'Salary rules'), (r'structure', 'Salary structures'),
    (r'payslip_input|input_type', 'Inputs'), (r'worked_days', 'Worked days'), (r'salary_attachment', 'Salary attachments'),
    (r'iso20022|sepa|payment', 'Payments'), (r'declaration|headcount', 'Declarations'), (r'warning', 'Warnings'),
    (r'accrual', 'Accruals'), (r'allocation', 'Allocations'), (r'overtime', 'Overtime'), (r'calendar', 'Working schedules'),
    (r'departure|termination', 'Departures'), (r'benefit', 'Benefits'), (r'gantt', 'Gantt view'), (r'dashboard', 'Dashboards'),
    (r'work_entr|work entr', 'Work entries'), (r'version|contract', 'Contracts'), (r'payslip', 'Payslips'), (r'report', 'Reports'),
]


def topic_of(module, path, title=''):
    """`App › feature` a file belongs to, e.g. `Payroll BE › DMFA` or `Resource › Working schedules`."""
    core = re.sub(r'^l10n_[a-z]{2}_', '', re.sub(r'^test_', '', module))
    app = next((label for pattern, label in TOPIC_APPS if re.search(pattern, core)), None)
    if not app:
        return None
    country = country_of(module.removeprefix('test_'))
    if country:
        app = f'{app} {country}'
    # Inside the module only: its own name (hr_work_entry_contract…) would always match.
    parts = path.lower().split('/')
    where = '/'.join(parts[parts.index(module) + 1:] if module in parts else parts[1:])
    feature = next((label for pattern, label in TOPIC_FEATURES if re.search(pattern, where)), None)
    feature = feature or next((label for pattern, label in TOPIC_FEATURES if re.search(pattern, title.lower())), None)
    if feature == 'Working schedules':
        # resource.calendar, whichever module extends it (Time Off, Payroll BE…): it is the Resource app.
        return 'Resource › Working schedules'
    return f'{app} › {feature}' if feature and feature.lower() not in app.lower() else app


def country_of(module):
    m = re.match(r'l10n_([a-z]{2})(?:_|$)', module)
    return m.group(1).upper() if m else None


def module_of(repo, path):
    parts = path.split('/')
    if repo == 'odoo':
        if parts[0] == 'addons' and len(parts) > 2:
            return parts[1]
        if parts[:2] == ['odoo', 'addons'] and len(parts) > 3:
            return parts[2]
    if repo == 'upgrade' and parts[0] == 'migrations' and len(parts) > 2:
        return parts[1]
    return parts[0] if len(parts) > 1 else '(root)'


def lang_of(path):
    ext = path.rsplit('.', 1)[-1].lower() if '.' in path else ''
    return {
        'py': 'py', 'js': 'js', 'ts': 'js', 'xml': 'xml', 'scss': 'css', 'css': 'css',
        'csv': 'data', 'po': 'i18n', 'pot': 'i18n', 'rst': 'doc', 'md': 'doc',
    }.get(ext, 'other')


# What a line of each kind of file weighs next to a line of Python or JavaScript logic: views, templates, styles and
# tests take less thought per line, data files (CSV, JSON snapshots, XML records) are mostly bulk.
KIND_WEIGHTS = {'back': 1, 'front': 1, 'migration': 0.8, 'rules': 0.8, 'template': 0.7, 'views': 0.6, 'style': 0.5, 'test': 0.5, 'data': 0.15, 'other': 0.1}
# Profile of the work, by the part of the stack the lines belong to.
PROFILE_OF = {'back': 'back', 'migration': 'back', 'rules': 'back', 'front': 'front', 'template': 'front', 'style': 'front', 'views': 'views', 'data': 'data', 'test': 'test', 'other': 'data'}
PROFILES = ['back', 'front', 'views', 'data', 'test']
# Removing code is cheaper than writing it; a moved or renamed line is mechanical, whatever the file.
DELETION_WEIGHT = 0.3
MECHANICAL_WEIGHT = 0.1
# Past a few hundred lines, data is generated or bulk imported: the rest weighs next to nothing.
DATA_FULL_LINES, DATA_BULK_WEIGHT = 300, 0.02
# Below this size, a change is read from its numstat alone: moves and renames are only searched in bigger diffs.
MECHANICAL_MIN_LINES = 100
# Payroll logic lives in XML records too: salary rules hold their Python code. Filled per repo from the clones.
RULE_FILES = {}


def kind_of(repo, path):
    ext = path.rsplit('.', 1)[-1].lower() if '.' in path.rsplit('/', 1)[-1] else ''
    if ext in ('po', 'pot'):
        return None
    if ext in ('csv', 'json', 'yml', 'yaml', 'txt', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'pdf', 'xlsx', 'xls', 'woff', 'woff2', 'ttf', 'xsd', 'html'):
        return 'data'
    test = '/tests/' in path or path.startswith('tests/') or '/static/tests/' in path
    if ext == 'py':
        return 'test' if test else 'migration' if repo == 'upgrade' or '/migrations/' in path or '/upgrades/' in path else 'back'
    if ext in ('js', 'ts', 'mjs'):
        return 'test' if test else 'front'
    if ext in ('scss', 'css', 'less'):
        return 'style'
    if ext == 'xml':
        if test:
            return 'test'
        if '/static/' in path:
            return 'template'
        if path in RULE_FILES.get(repo, ()) or re.search(r'salary_rules?[/_.]|/cp200/', path):
            return 'rules'
        return 'data' if re.search(r'/(data|demo|security)/', path) else 'views'
    return 'other'


def renamed_path(path):
    """The new path of a numstat entry, `a/{b => c}/d` or `a => b` when git detected a rename."""
    return re.sub(r'\{[^}]* => ([^}]*)\}', r'\1', path).split(' => ')[-1].replace('//', '/') if ' => ' in path else path


def mechanical_lines(diff):
    """Lines of a -U0 diff that are mechanical, per path: [added, removed].

    Moved: removed and added identically elsewhere in the same change (code moved between files or modules). Renamed: a
    removed line and the added line facing it differ only by token substitutions that repeat at least 3 times.
    """
    hunks, current, hunk = [], None, None
    for ln in diff.splitlines():
        if ln.startswith('+++ '):
            current = ln[6:] if ln.startswith('+++ b/') else current
        elif ln.startswith('--- '):
            current = ln[6:] if ln.startswith('--- a/') else None
        elif ln.startswith('@@'):
            hunk = (current, [], [])
            hunks.append(hunk)
        elif hunk and ln[:1] in ('+', '-') and not ln.startswith(('+++', '---')):
            (hunk[1] if ln[0] == '+' else hunk[2]).append(ln[1:].strip())
    significant = lambda line: len(line) >= 8
    added = collections.Counter(line for _p, plus, _m in hunks for line in plus if significant(line))
    removed = collections.Counter(line for _p, _pl, minus in hunks for line in minus if significant(line))
    moved = {'+': added & removed, '-': added & removed}
    out = collections.defaultdict(lambda: [0, 0])
    rest = []
    for path, plus, minus in hunks:
        kept = {'+': [], '-': []}
        for side, lines in (('+', plus), ('-', minus)):
            for line in lines:
                if moved[side][line] > 0:
                    moved[side][line] -= 1
                    out[path][0 if side == '+' else 1] += 1
                else:
                    kept[side].append(line)
        rest.append((path, kept['+'], kept['-']))
    tokens = lambda line: re.findall(r'\w+|[^\w\s]', line)
    pairs, substitutions, compared = [], collections.Counter(), 0
    for path, plus, minus in rest:
        for new, old in zip(plus, minus):
            # Long lines (minified code, JSON, base64) are content, not renames; past 20000 pairs the diff is bulk anyway.
            if not significant(new) or new == old or len(new) > 200 or len(old) > 200 or compared >= 20000:
                continue
            compared += 1
            a, b = tokens(old), tokens(new)
            ops = [op for op in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes() if op[0] != 'equal']
            if ops and len(ops) <= 3 and all(op[0] == 'replace' and op[2] - op[1] == 1 and op[4] - op[3] == 1 for op in ops):
                subs = tuple((a[op[1]], b[op[3]]) for op in ops)
                pairs.append((path, subs))
                substitutions.update(set(subs))
    for path, subs in pairs:
        if all(substitutions[sub] >= 3 for sub in subs):
            out[path][0] += 1
            out[path][1] += 1
    return dict(out)


def substance(repo, files, mechanical=None):
    """Weighted lines of a change, its lines per profile, and how many of its lines are mechanical."""
    mechanical = mechanical or {}
    weighted, profile, mech_total, data = 0.0, dict.fromkeys(PROFILES, 0), 0, 0.0
    for path, ins, dels in files:
        kind = kind_of(repo, path)
        if not kind:
            continue
        m_ins, m_dels = mechanical.get(path, (0, 0))
        m_ins, m_dels = min(m_ins, ins), min(m_dels, dels)
        lines = (ins - m_ins) + DELETION_WEIGHT * (dels - m_dels)
        if kind == 'data':
            data += lines
        else:
            weighted += KIND_WEIGHTS[kind] * lines
        weighted += min(MECHANICAL_WEIGHT, KIND_WEIGHTS[kind]) * (m_ins + m_dels)
        profile[PROFILE_OF[kind]] += ins - m_ins + dels - m_dels
        mech_total += m_ins + m_dels
    weighted += KIND_WEIGHTS['data'] * min(data, DATA_FULL_LINES) + DATA_BULK_WEIGHT * max(0, data - DATA_FULL_LINES)
    return {'weighted': round(weighted), 'profile': profile, 'mechanical': mech_total}


def pr_refs(text):
    """PRs a merged commit belongs to: mergebot writes `closes` on the last commit and `Part-of:` on the others."""
    return list(dict.fromkeys(re.findall(r'(?:closes|Part-of:)\s+(odoo/[\w-]+)#(\d+)', text, re.I)))


def related_prs(text):
    """PRs mergebot merged together with this one (same branch in another repo)."""
    return re.findall(r'^Related: (odoo/[\w-]+#\d+)', text, re.M)


def parse_trailers(text):
    tasks = set(re.findall(r'(?i)\btask[-:#\s]+(\d{5,8})\b', text))
    tasks.update(re.findall(r'(?i)project\.task/(\d{5,8})', text))
    return {
        'tasks': sorted(tasks),
        'opws': sorted(set(re.findall(r'(?i)\bopw[-:#\s]+(\d{5,8})\b', text))),
        'closes': pr_refs(text),
        'reviewers': re.findall(r'Signed-off-by: ([^<\n]+?) <', text),
    }


def last_line(error):
    return next((ln.strip() for ln in reversed(str(error).splitlines()) if ln.strip()), str(error))[:160]


PORT_WINDOW = 120 * 86400


def port_subject(subject):
    """A commit subject without the port markers: `[FW][FIX] x` and `[FIX] x` are the same change."""
    return re.sub(r'^\s*(\[(fw|bp|forward-?port|backport)\]\s*)+', '', subject.strip(), flags=re.I).lower()


def is_port_title(subject):
    return bool(re.match(r'\s*\[(fw|bp|forward-?port|backport)\]', subject or '', re.I))


def rplus_command(body):
    """Whether a GitHub comment or review body gives the mergebot an r+: a `robodoo r+` line, maybe among other commands."""
    for line in (body or '').splitlines():
        m = re.match(r'\s*@?(?:robodoo|mergebot|hansen)\b[:,]?\s*(.*)', line, re.I)
        if m and 'r+' in (word.strip('.,;:!') for word in m.group(1).split()):
            return True
    return False


def is_bot(login):
    return bool(re.search(r'bot|robodoo', login or '', re.I))


def is_merged_commit(message):
    """A commit as mergebot merged it: its trailers only exist once merged."""
    return bool(re.search(r'^(closes odoo/[\w-]+#\d+|X-original-commit: |Signed-off-by: )', message, re.M | re.I))


def coauthors_of(text):
    return {e.lower().split('@')[0] for e in re.findall(r'^Co-authored-by: [^<\n]*<([^>]+)>', text, re.M | re.I)}


def trigram_of(name):
    m = re.search(r'\((\w+)\)\s*$', name)
    return m.group(1).lower() if m else name.strip()


def version_of(branch):
    m = re.match(r'^(master|saas-\d+\.\d+|\d+\.\d+)-', branch)
    return m.group(1) if m else 'master'


def recent_version_ref(ref):
    m = re.search(r'/(?:saas-)?(\d+)\.\d+$', ref)
    return ref.endswith('/master') or bool(m and int(m.group(1)) >= 16)


def utc_ts(text):
    return calendar.timegm(time.strptime(text, '%Y-%m-%d %H:%M:%S'))


def iso_ts(text):
    return calendar.timegm(time.strptime(text, '%Y-%m-%dT%H:%M:%SZ'))


def gh_pr(node):
    """Keeps what the page needs from a GraphQL pull request node."""
    stats = lambda commit: (commit.get('additions'), commit.get('deletions'), commit.get('changedFilesIfAvailable'))
    force_pushes = []
    for item in node['timelineItems']['nodes']:
        if item['__typename'] != 'HeadRefForcePushedEvent' or not item.get('afterCommit'):
            continue
        before, after = item.get('beforeCommit') or {}, item['afterCommit']
        known = 'additions' in after and 'additions' in before
        # Odoo PRs are mostly one commit per repo: an unchanged head diff size means a plain rebase.
        same = known and stats(before) == stats(after)
        force_pushes.append({
            'at': iso_ts(item['createdAt']), 'actor': (item.get('actor') or {}).get('login'),
            'before': before.get('oid', '')[:12], 'after': after['oid'][:12],
            'kind': 'unknown' if not known else 'rebase' if same else 'rebase+code',
            'delta': 0 if same or not known else abs((after.get('additions') or 0) - (before.get('additions') or 0))
            + abs((after.get('deletions') or 0) - (before.get('deletions') or 0)),
        })
    return {
        'state': node['state'], 'draft': node['isDraft'], 'author': (node.get('author') or {}).get('login'),
        'created_at': iso_ts(node['createdAt']), 'closed_at': node['closedAt'] and iso_ts(node['closedAt']),
        'additions': node['additions'], 'deletions': node['deletions'], 'changed_files': node['changedFiles'],
        'reviews': [
            {'login': (r.get('author') or {}).get('login'), 'state': r['state'], 'at': iso_ts(r['submittedAt'])}
            for r in node['reviews']['nodes'] if r.get('submittedAt')
        ],
        'comments': node['comments']['totalCount'], 'force_pushes': force_pushes,
        'ready_at': [iso_ts(i['createdAt']) for i in node['timelineItems']['nodes'] if i['__typename'] == 'ReadyForReviewEvent'],
        'fetched': time.time(),
    }


class GitHub:
    """GraphQL through the gh CLI, which keeps the credentials: one call at a time, paced, budgeted, stopped near the quota."""

    def __init__(self, store, budget):
        self.store = store
        self.budget = budget
        self.calls = 0
        self.last_call = 0
        self.remaining = None
        self.reset_at = None
        self.failures = 0
        self.stopped = None if shutil.which('gh') else 'gh not found'

    def query(self, text, search=False, retry=True, count_failure=True, searches=1):
        if self.stopped:
            return None
        if self.calls >= self.budget:
            self.stopped = f'budget of {self.budget} calls reached, the rest at the next update'
            return None
        pause_until = self.store.get('github_meta', 'pause_until') or 0
        if time.time() < pause_until:
            self.stopped = f"paused until {time.strftime('%H:%M', time.localtime(pause_until))} after a rate limit"
            return None
        # The search API has its own secondary limit, reached at 20 searches a minute over a hundred calls.
        time.sleep(max(0, (3 * searches + 2 if search else 1.5) - (time.time() - self.last_call)))
        try:
            res = subprocess.run(['gh', 'api', 'graphql', '-f', f'query={text}'], capture_output=True, timeout=90)
        except subprocess.TimeoutExpired:
            self.stopped = 'GitHub does not answer (timeout)'
            return None
        self.last_call = time.time()
        self.calls += 1
        out, err = res.stdout.decode(errors='replace'), res.stderr.decode(errors='replace')
        if re.search(r'HTTP 50[0-4]', err):
            if retry:
                time.sleep(10)
                return self.query(text, search, retry=False, count_failure=count_failure, searches=searches)
            if count_failure:
                self.failures += 1
                if self.failures >= 3:
                    self.stopped = 'GitHub answers with 5xx errors, stopped for this collection'
            return None
        try:
            body = json.loads(out)
        except ValueError:
            body = {}
        # Only the error messages tell a rate limit: the data holds PR titles, where words like "secondary" are common.
        errors = [body.get('message') or ''] + [f'{e.get("type", "")} {e.get("message", "")}' for e in body.get('errors') or [] if isinstance(e, dict)]
        if re.search(r'rate.?limit|abuse|secondary', ' '.join([err, *errors]), re.I):
            if retry:
                # A secondary limit usually lifts after a minute.
                time.sleep(65)
                return self.query(text, search, retry=False, count_failure=count_failure, searches=searches)
            self.store.set('github_meta', 'pause_until', time.time() + 900)
            self.stopped = 'GitHub rate limit: paused for 15 min'
            return None
        if not body:
            self.stopped = (err or out).strip()[:200] or f'gh failed ({res.returncode})'
            return None
        data = body.get('data') or {}
        if not data:
            self.stopped = ((body.get('errors') or [{}])[0].get('message') or 'empty GraphQL answer')[:200]
            return None
        if rate := data.get('rateLimit'):
            self.remaining, self.reset_at = rate['remaining'], rate['resetAt']
            if self.remaining < 1500:
                self.stopped = f'GraphQL quota low ({self.remaining}), stopped until the reset ({rate["resetAt"]})'
        return data


def schema_counts(git, base, head):
    """Net models/fields added outside tests: a definition moved elsewhere in the same diff cancels out."""
    added, removed = collections.Counter(), collections.Counter()
    for ln in git.run('diff', '-U0', base, head, '--', '*.py', ':(exclude)*/tests/*', check=False).splitlines():
        if ln[:1] not in ('+', '-') or ln.startswith(('+++', '---')):
            continue
        side = added if ln[0] == '+' else removed
        if m := re.match(r"\s*_name\s*=\s*['\"]([\w.]+)['\"]", ln[1:]):
            side[('model', m.group(1))] += 1
        elif m := re.match(r'\s*(\w+)\s*=\s*fields\.\w+\(', ln[1:]):
            side[('field', m.group(1))] += 1
    net = added - removed
    tests = git.run('diff', '-U0', base, head, '--', '*/tests/*', check=False)
    return {
        'new_models': sum(v for (kind, _), v in net.items() if kind == 'model'),
        'new_fields': sum(v for (kind, _), v in net.items() if kind == 'field'),
        'new_tests': sum(1 for ln in tests.splitlines() if re.match(r'\+\s*(async\s+)?(def test_\w+\(|test\(["\'])', ln)),
        'schema_v': 2,
    }


class Collector:
    def __init__(self, args):
        self.args = args
        root = Path(args.root)
        self.repos = {
            'odoo': (Git(root / 'odoo'), 'dev', 'odoo-dev/odoo'),
            'enterprise': (Git(root / 'enterprise'), 'dev', 'odoo-dev/enterprise'),
            'upgrade': (Git(root / 'upgrade'), 'origin', 'odoo/upgrade'),
        }
        self.cache = Store(HERE / 'cache.json')
        self.archive = Store(HERE / 'history.json', backup=True)
        self.load_config()
        self.data = None
        self.login_names = {}
        self.last_fetch = 0
        self.runbot = self.cache.get('runbot', 'bundles') or {}
        self.web_status = {'runbot_at': 0, 'runbot_error': None, 'mergebot_error': None, 'fetch_error': None}
        self.lock = threading.Lock()
        self.requests = queue.Queue()
        self.status = {'state': 'idle', 'step': '', 'last_error': None}
        self.step_started = time.time()

    def load_config(self):
        """config.json: the squad (its lead and members), GitHub logins forced by hand, arrival months. Created on the first
        run with the user of the clones as the lead; the page then asks for the squad."""
        path = HERE / 'config.json'
        self.me = self.repos['odoo'][0].run('config', 'user.email', check=False).strip().lower().split('@')[0]
        try:
            self.config = json.loads(path.read_text())
        except (OSError, ValueError):
            self.config = {'lead': self.me, 'members': [], 'github_logins': {}, 'arrivals': {}}
            path.write_text(json.dumps(self.config, indent=2) + '\n')
        self.config_mtime = path.stat().st_mtime
        self.lead = self.config.get('lead') or self.me
        self.names = list(dict.fromkeys(n for n in [self.lead, *(self.config.get('members') or [])] if n))

    def squad(self):
        members = [n for n in self.names if n != self.lead]
        return {'lead': self.lead, 'members': members} if members else None

    def org(self):
        """What the page knows of the organisation: the squad and the arrival months, when given."""
        return {'squads': {self.lead: [n for n in self.names if n != self.lead]}, 'arrivals': self.config.get('arrivals') or {}}

    def reload_config_if_edited(self):
        """config.json may be edited by hand while the server runs: never overwrite those edits with a stale copy."""
        try:
            if (HERE / 'config.json').stat().st_mtime != self.config_mtime:
                self.load_config()
        except OSError:
            pass

    def set_squad(self, lead, members):
        """The squad set up on the page, written to config.json. Returns who is new, to collect them."""
        self.reload_config_if_edited()
        squad = list(dict.fromkeys([lead, *members]))
        new = [n for n in squad if n not in self.names]
        self.config.update(lead=lead, members=[m for m in squad if m != lead])
        (HERE / 'config.json').write_text(json.dumps(self.config, indent=2, ensure_ascii=False) + '\n')
        self.load_config()
        return new

    def step(self, label):
        now = time.time()
        if self.status.get('step'):
            log(f"{self.status['step']}: {now - self.step_started:.1f}s")
        self.status['step'], self.step_started = label, now

    def names_in(self, branch):
        """Every person of the squad a branch is named after: `…-abcd-efgh` is pair work."""
        tokens = re.split(r'[-_.]', re.sub(r'-\d+-fw$', '', branch).lower())
        return {t for i, t in enumerate(tokens) if t in self.names and (len(t) >= 4 or i >= len(tokens) - 2)}

    def owner_of(self, branch, names=None):
        """Name token of the branch; a 3-letter trigram only counts as the trailing token, being too common elsewhere."""
        tokens = re.split(r'[-_.]', re.sub(r'-\d+-fw$', '', branch).lower())
        names = set(self.names if names is None else names)
        for i in range(len(tokens) - 1, -1, -1):
            token = tokens[i]
            if token not in names:
                continue
            trailing = i == len(tokens) - 1 or (
                i == len(tokens) - 2 and re.fullmatch(r'v\d+|\d+|temp|tmp|wip|bis|old|backup|bkp', tokens[-1])
            )
            if len(token) >= 4 or trailing:
                return token
        return None

    def fw_of(self, branch):
        m = re.match(r'^(?:master|saas-\d+\.\d+|\d+\.\d+)-((?:saas-\d+\.\d+|\d+\.\d+)-.+)-\d+-fw$', branch)
        return m.group(1) if m else None

    def load_refs(self):
        self.refs = {
            repo: dict(
                line.split('\0')
                for line in git.run('for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/remotes/').splitlines()
            )
            for repo, (git, _remote, _slug) in self.repos.items()
        }
        if not RULE_FILES:
            self.load_rule_files()

    def version_refs(self, repo):
        return {ref: sha for ref, sha in self.refs[repo].items() if ref.startswith('refs/remotes/origin/') and recent_version_ref(ref)}

    def version_forks(self):
        """When each version branch left master (date of its merge-base with master): what master was at a given time."""
        git = self.repos['odoo'][0]
        master = 'refs/remotes/origin/master'
        if master not in self.refs['odoo']:
            return {}
        forks = {}
        for ref in self.version_refs('odoo'):
            if ref == master:
                continue
            base = git.run('merge-base', master, ref, check=False).strip()
            stamp = git.run('show', '-s', '--format=%ct', base, check=False).strip() if base else ''
            if stamp.isdigit():
                forks[ref.removeprefix('refs/remotes/origin/')] = int(stamp)
        return forks

    def base_candidates(self, repo, branch):
        refs, remote = self.refs[repo], self.repos[repo][1]
        parts = branch.split('-')
        prefixes = [f'refs/remotes/{remote}/' + '-'.join(parts[:i]) for i in range(len(parts) - 1, 1, -1)]
        ordered = [*prefixes, f'refs/remotes/origin/{version_of(branch)}', 'refs/remotes/origin/master', *sorted(self.version_refs(repo))]
        return [r for r in dict.fromkeys(ordered) if r in refs]

    def pick_base(self, git, head, candidates):
        """Closest ancestor among the version branches and the parent branches suggested by the name."""
        floor = int(git.run('rev-list', '--count', head, '--not', *candidates, check=False).strip() or 0)
        best = None
        for ref in candidates:
            merge_base = git.run('merge-base', ref, head, check=False).strip()
            count = int(git.run('rev-list', '--count', f'{merge_base}..{head}').strip()) if merge_base else 0
            if count and (best is None or count < best[0]):
                best = (count, merge_base, ref)
                if count <= floor:
                    break
        return (best[1], best[2]) if best else (head, candidates[0] if candidates else '')

    def fetch(self):
        """Targeted fetch: the branches of the squad (and the ones it co-authored) that moved, and the recent version branches."""
        self.load_refs()
        errors = []
        contributed = self.archive.section('contributed')
        squad = set(self.names)
        for repo, (git, remote, _slug) in self.repos.items():
            try:
                listing = git.run('ls-remote', '--heads', remote)
            except RuntimeError as e:
                errors.append(f'{repo}: {last_line(e)}')
                continue
            heads = {}
            for line in listing.splitlines():
                sha, _, ref = line.partition('\t')
                heads[ref.removeprefix('refs/heads/')] = sha
            wanted = {n: sha for n, sha in heads.items() if self.owner_of(n, squad) or f'{repo}:{n}' in contributed}
            local = self.refs[repo]
            stale = [f'+refs/heads/{n}:refs/remotes/{remote}/{n}' for n, sha in wanted.items() if local.get(f'refs/remotes/{remote}/{n}') != sha]
            versions = [f'+{ref.replace("refs/remotes/origin/", "refs/heads/")}:{ref}' for ref in sorted(self.version_refs(repo))]
            batches = [(remote, stale[i:i + 200]) for i in range(0, len(stale), 200)] + [('origin', versions)]
            for source, refspecs in batches:
                try:
                    git.run('fetch', '--no-auto-gc', '--no-write-commit-graph', source, *refspecs)
                except RuntimeError as e:
                    errors.append(f'{repo}: {last_line(e)}')
            self.cache.set('remote_heads', repo, sorted(wanted))
            log(f'fetch {repo}: {len(stale)} branch(es) updated')
        self.web_status['fetch_error'] = '; '.join(errors) or None

    def load_rule_files(self):
        for repo, (git, _remote, _slug) in self.repos.items():
            out = git.run('grep', '-l', '-E', 'amount_python_compute|condition_python', 'refs/remotes/origin/master', '--', '*.xml', check=False)
            RULE_FILES[repo] = {ln.split(':', 1)[1] for ln in out.splitlines() if ':' in ln}

    def mechanics(self, repo, git, files, *revs):
        """Moved and renamed lines of a commit (one rev) or of a diff between two revs, read once per change."""
        if sum(ins + dels for path, ins, dels in files if kind_of(repo, path)) < MECHANICAL_MIN_LINES:
            return {}
        key = f'{repo}:{":".join(revs)}'
        if (cached := self.cache.get('mechanics', key)) is None:
            args = ['show', '--format=', revs[0]] if len(revs) == 1 else ['diff', *revs]
            cached = mechanical_lines(git.run(*args, '-U0', '--no-color', '-M', '--no-ext-diff', check=False))
            self.cache.set('mechanics', key, cached)
        return cached

    def snapshot(self, repo, git, head, branch):
        key = f'{repo}:{head}'
        if cached := self.cache.get('snap', key):
            if cached.get('schema_v') != 2:
                cached.update(schema_counts(git, cached['base'], head))
            if cached['commits'] and 'merged' not in cached['commits'][0]:
                raw = git.run('log', '-n', '150', '--format=%H%x1f%B%x1e', f'{cached["base"]}..{head}', check=False)
                bodies = {sha.strip()[:12]: body for sha, _, body in (rec.partition('\x1f') for rec in raw.split('\x1e')) if sha.strip()}
                for c in cached['commits']:
                    c['merged'] = is_merged_commit(bodies.get(c['sha'], ''))
            if 'coauthors' not in cached:
                cached['coauthors'] = sorted(coauthors_of(git.run('log', '--format=%B', f'{cached["base"]}..{head}', check=False)))
            return cached
        base, base_ref = self.pick_base(git, head, self.base_candidates(repo, branch))
        log_out = git.run('log', '-n', '150', '--format=%H%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s%x1f%b%x1e', f'{base}..{head}')
        commits, messages = [], []
        for rec in log_out.split('\x1e'):
            if rec := rec.strip('\n'):
                sha, an, ae, at, ct, subject, body = rec.split('\x1f')
                commits.append({'sha': sha[:12], 'author': an, 'email': ae.lower(), 'at': int(at), 'ct': int(ct), 'subject': subject,
                                'merged': is_merged_commit(body)})
                messages.append(subject + '\n' + body)
        files = []
        for line in git.run('diff', '--numstat', base, head).splitlines():
            ins, dels, path = line.split('\t', 2)
            files.append([renamed_path(path), 0 if ins == '-' else int(ins), 0 if dels == '-' else int(dels)])
        full_diff = git.run('diff', base, head)
        commit_count = int(git.run('rev-list', '--count', f'{base}..{head}').strip() or 0)
        snap = {
            'base': base[:12], 'base_ref': base_ref.removeprefix('refs/remotes/'),
            'commit_count': commit_count, 'noisy': commit_count > 60, 'commits': commits, 'files': files,
            'patch_id': git.run('patch-id', '--stable', input=full_diff.encode()).split(' ')[0] if full_diff else 'empty',
            'trailers': parse_trailers('\n'.join(messages)), 'coauthors': sorted(coauthors_of('\n'.join(messages))),
            **schema_counts(git, base, head),
        }
        self.cache.set('snap', key, snap)
        return snap

    def diff_lines(self, git, base, head):
        lines, current = collections.Counter(), ''
        for ln in git.run('diff', '-U0', base, head, check=False).splitlines():
            if ln.startswith(('--- a/', '+++ b/')):
                current = ln[6:]
            elif ln.startswith(('---', '+++', '@@')):
                continue
            elif ln[:1] in ('+', '-'):
                lines[(current, ln[0], ln[1:].strip())] += 1
        return lines

    def transition(self, repo, git, branch, old, new):
        if not (git.exists(old) and git.exists(new)):
            return {'kind': 'unknown', 'delta': 0, 'added_commits': 0}
        snap_old = self.snapshot(repo, git, old, branch)
        snap_new = self.snapshot(repo, git, new, branch)
        if snap_old['noisy'] or snap_new['noisy']:
            return {'kind': 'noise', 'delta': 0, 'added_commits': 0}
        if git.ok('merge-base', '--is-ancestor', old, new):
            delta = sum(
                int(a) + int(d)
                for a, d, _ in (ln.split('\t', 2) for ln in git.run('diff', '--numstat', old, new).splitlines())
                if a != '-'
            )
            return {'kind': 'push', 'delta': delta, 'added_commits': int(git.run('rev-list', '--count', f'{old}..{new}').strip())}
        if snap_old['patch_id'] != snap_new['patch_id']:
            before = self.diff_lines(git, snap_old['base'], old)
            after = self.diff_lines(git, snap_new['base'], new)
            if delta := sum(((before - after) + (after - before)).values()):
                return {
                    'kind': 'rebase+code' if snap_old['base'] != snap_new['base'] else 'amend', 'delta': delta,
                    'added_commits': snap_new['commit_count'] - snap_old['commit_count'],
                }
        return {'kind': 'rebase', 'delta': 0, 'added_commits': 0}

    def pushes(self, repo, git, remote, branch, head, snap):
        path = git.path / '.git' / 'logs' / 'refs' / 'remotes' / remote / branch
        try:
            lines = path.read_text(errors='replace').splitlines()
        except OSError:
            return []
        result, prev_ts = [], 0
        for line in lines:
            parts = line.partition('\t')[0].split(' ')
            old, new, ts = parts[0], parts[1], int(parts[-2])
            key = f'{repo}:{old}:{new}:{ts}'
            entry = self.cache.get('pushes', key)
            if not entry:
                ct = int(git.run('log', '-1', '--format=%ct', new, check=False).strip() or ts)
                # The reflog stamps the fetch; the commit date is closer to the push when it falls after the previous fetch.
                at = max(ct, prev_ts) if ct <= ts else ts
                if set(old) == {'0'}:
                    entry = {'kind': 'new', 'delta': 0, 'added_commits': snap['commit_count'] if new == head else 0}
                else:
                    try:
                        entry = self.transition(repo, git, branch, old, new)
                    except RuntimeError as e:
                        log(f'transition {repo}/{branch}: {e}')
                        entry = {'kind': 'unknown', 'delta': 0, 'added_commits': 0}
                entry = {**entry, 'at': at, 'sha': new[:12]}
                self.cache.set('pushes', key, entry)
            result.append(entry)
            prev_ts = ts
        return result

    def scan_git(self):
        self.load_refs()
        branches, seen = {}, set()
        history = self.archive.section('branches')
        contributed = self.archive.section('contributed')
        for repo, (git, remote, slug) in self.repos.items():
            remote_heads = self.cache.get('remote_heads', repo)
            prefix = f'refs/remotes/{remote}/'
            for ref, head in self.refs[repo].items():
                branch = ref.removeprefix(prefix)
                owner = self.owner_of(branch)
                if not ref.startswith(prefix) or branch == 'HEAD' or not (owner or f'{repo}:{branch}' in contributed):
                    continue
                try:
                    snap = self.snapshot(repo, git, head, branch)
                except RuntimeError as e:
                    log(f'snapshot {repo}/{branch}: {e}')
                    continue
                key = f'{repo}:{branch}'
                seen.add(key)
                pushes = self.pushes(repo, git, remote, branch, head, snap)
                known = {(p['sha'], p['at']) for p in pushes}
                pushes += [p for p in (history.get(key) or {}).get('pushes', []) if (p['sha'], p['at']) not in known]
                record = {
                    'head': head[:12], 'url': f'https://github.com/{slug}/tree/{branch}', 'owner': owner,
                    'contributors': contributed.get(key, []),
                    'on_remote': (branch in remote_heads) if remote_heads is not None else None,
                    'pushes': sorted(pushes, key=lambda p: p['at']), **snap,
                }
                history[key] = record
                branches.setdefault(branch, {})[repo] = record
        for key, record in history.items():
            repo, branch = key.split(':', 1)
            if key not in seen and (self.owner_of(branch) or key in contributed):
                git = self.repos[repo][0]
                if record.get('schema_v') != 2 and git.exists(record['head']):
                    record.update(schema_counts(git, record['base'], record['head']))
                branches.setdefault(branch, {})[repo] = {**record, 'on_remote': False}
        return branches

    def coauthor_pattern(self):
        return 'Co-authored-by: .*<(' + '|'.join(map(re.escape, self.names)) + r')@odoo\.com>'

    def discover_contributed(self):
        """Open branches of other people holding a commit co-authored by a tracked person."""
        store = self.archive.section('contributed')
        since = time.strftime('%Y-%m-%d', time.localtime(time.time() - 180 * 86400))
        names = set(self.names)
        self.load_refs()
        for repo, (git, remote, _slug) in self.repos.items():
            found = collections.defaultdict(set)
            coauthored = git.run(
                'log', f'--remotes={remote}/*', f'--since={since}', '--no-merges', '-E', '-i', f'--grep={self.coauthor_pattern()}',
                '--source', '--format=\x1e%H%x1f%S%x1f%ae%x1f%B', check=False,
            )
            # Commits written by a tracked person on a branch named after someone else (a PR opened for them).
            authored = git.run(
                'log', f'--remotes={remote}/*', f'--since={since}', '--no-merges', '-i', *[f'--author={n}@odoo.com' for n in sorted(names)],
                '--source', '--format=\x1e%H%x1f%S%x1f%ae%x1f%B', check=False,
            )
            for rec in (coauthored + authored).split('\x1e'):
                if not rec.strip():
                    continue
                sha, source, email, body = rec.strip('\n').split('\x1f', 3)
                # Already merged elsewhere (mergebot trailers): the branch is only based on a newer master than ours.
                if is_merged_commit(body):
                    continue
                branch = source.removeprefix('refs/remotes/').removeprefix(f'{remote}/')
                if 'onboarding' in branch and not coauthors_of(body) & names:
                    continue
                if (self.owner_of(branch) or f'refs/remotes/{remote}/{branch}' not in self.refs[repo]
                        or re.fullmatch(r'master|saas-\d+\.\d+|\d+\.\d+|HEAD', branch) or re.match(r'(tmp|staging)\.', branch)):
                    continue
                bases = {f'refs/remotes/origin/{version_of(branch)}', 'refs/remotes/origin/master'} & set(self.refs[repo])
                if any(git.ok('merge-base', '--is-ancestor', sha, ref) for ref in bases):
                    continue
                found[f'{repo}:{branch}'] |= (coauthors_of(body) | {email.lower().split('@')[0]}) & names
            # Branches still there are judged again on each scan: a contribution that no longer holds goes away.
            for key in [k for k in store if k.startswith(f'{repo}:') and f'refs/remotes/{remote}/{k.split(":", 1)[1]}' in self.refs[repo]]:
                if key not in found:
                    del store[key]
            for key, people in found.items():
                if people:
                    store[key] = sorted(people)

    def from_version_refs(self, section, since, fn, names=None):
        """Runs fn on each recent version branch; when a branch only moved forward, only the new commits are read."""
        out = {}
        signature = f'v7:{since}:{",".join(sorted(names or self.names))}'
        for repo, (git, _remote, _slug) in self.repos.items():
            for ref, head in self.version_refs(repo).items():
                entry = self.cache.get(section, f'{repo}:{ref}')
                if entry and entry['signature'] == signature and entry['head'] == head:
                    rows = entry['rows']
                elif entry and entry['signature'] == signature and git.ok('merge-base', '--is-ancestor', entry['head'], head):
                    rows = entry['rows'] + fn(git, repo, ref, since, f'{entry["head"]}..{head}')
                else:
                    rows = fn(git, repo, ref, since, head)
                self.cache.set(section, f'{repo}:{ref}', {'head': head, 'signature': signature, 'rows': rows})
                for row in rows:
                    out.setdefault(row['id'], row)
        return list(out.values())

    def from_version_history(self, section, fn, names, version='v2'):
        """Runs fn once over the whole history of every version branch; later runs only read the commits added since."""
        out = {}
        signature = f'{version}:{",".join(sorted(names))}'
        for repo, (git, _remote, _slug) in self.repos.items():
            heads = sorted({sha for ref, sha in self.refs[repo].items() if re.fullmatch(r'refs/remotes/origin/(master|(saas-)?\d+\.\d+)', ref)})
            entry = self.cache.get(section, repo)
            if not entry or entry['signature'] != signature:
                rows = fn(git, repo, heads)
            else:
                rows = entry['rows'] + (fn(git, repo, [*heads, '--not', *entry['heads']]) if heads != entry['heads'] else [])
            self.cache.set(section, repo, {'heads': heads, 'signature': signature, 'rows': rows})
            for row in rows:
                out.setdefault(row['id'], row)
        return list(out.values())

    def merged_on(self, git, repo, ref, since, revs):
        """Merged commits authored or co-authored by a tracked person: one row per (commit, tracked person)."""
        fmt = '--format=\x1e%H%x1f%ae%x1f%at%x1f%ct%x1f%s%x1f%b%x1d'
        authored = git.run(
            'log', revs, f'--since={since}', '--no-merges', '-i', *[f'--author={n}@odoo.com' for n in self.names], '--numstat', fmt,
            check=False,
        )
        coauthored = git.run(
            'log', revs, f'--since={since}', '--no-merges', '-E', '-i', f'--grep={self.coauthor_pattern()}', '--numstat', fmt, check=False,
        )
        commits, names = {}, set(self.names)
        for raw in (authored, coauthored):
            for rec in raw.split('\x1e'):
                if not rec.strip():
                    continue
                meta, _, stats = rec.partition('\x1d')
                sha, ae, at, ct, subject, body = meta.split('\x1f')
                author = ae.lower().split('@')[0]
                files = [
                    [renamed_path(p[2]), 0 if p[0] == '-' else int(p[0]), 0 if p[1] == '-' else int(p[1])]
                    for p in (ln.split('\t', 2) for ln in stats.strip().splitlines()) if len(p) == 3
                ]
                for owner in ({author} | coauthors_of(body)) & names:
                    commits[f'{sha}:{owner}'] = {
                        'id': f'{sha}:{owner}', 'repo': repo, 'sha': sha[:12], 'owner': owner, 'author': author,
                        'coauthor': owner != author, 'at': int(at), 'ct': int(ct),
                        'target': ref.removeprefix('refs/remotes/origin/'), 'subject': subject,
                        'fw': 'X-original-commit:' in body, 'files': files, **parse_trailers(subject + '\n' + body),
                    }
        return list(commits.values())

    def root_author(self, git, repo, sha):
        """Author of the commit a forward-port chain started from, following X-original-commit links."""
        store = self.cache.section('fw_roots')
        key = f'{repo}:{sha}'
        if key not in store:
            current, author = sha, None
            for _ in range(12):
                out = git.run('log', '-1', '--format=%ae%x1f%B', current, check=False)
                if not out:
                    break
                email, _, message = out.partition('\x1f')
                author = email.strip().lower().split('@')[0]
                origin = re.search(r'^X-original-commit: ([0-9a-f]{7,40})', message, re.M)
                if not origin:
                    break
                current = origin.group(1)
            store[key] = author
        return store[key]

    def reviews_on(self, git, repo, ref, since, revs, names=None):
        """r+ given, read from the Signed-off-by trailers mergebot writes for each approver."""
        names = names or self.names
        pattern = 'Signed-off-by: .*<(' + '|'.join(map(re.escape, names)) + r')@odoo\.com>'
        raw = git.run(
            'log', revs, f'--since={since}', '--no-merges', '-E', '-i', f'--grep={pattern}', '--name-only',
            '--format=\x1e%H%x1f%ae%x1f%ct%x1f%s%x1f%b%x1d', check=False,
        )
        rows = []
        for rec in raw.split('\x1e'):
            if not rec.strip():
                continue
            meta, _, paths = rec.partition('\x1d')
            sha, ae, ct, subject, body = meta.split('\x1f')
            author = ae.lower().split('@')[0]
            signers = [e.lower().split('@')[0] for e in re.findall(r'^Signed-off-by: [^<\n]*<([^>]+)>', body, re.M)]
            forward_port = 'X-original-commit:' in body or is_port_title(subject)
            if forward_port:
                # A forward-port repeats the original sign-offs and appends the one who approved the port; the original
                # author approving their own port is no review, even when the port was re-authored by whoever fixed it.
                root = self.root_author(git, repo, sha)
                signers = [s for s in signers[-1:] if s != root] if len(signers) >= 2 else []
            closes = pr_refs(body)
            pr = f'{closes[0][0]}#{closes[0][1]}' if closes else f'{repo}@{sha[:12]}'
            related = related_prs(body)
            modules = {module_of(repo, p) for p in paths.split('\n') if p.strip()}
            writers = {author} | coauthors_of(body)
            for signer in signers:
                if signer not in writers and signer in names:
                    rows.append({
                        'id': f'{signer}:{pr}', 'reviewer': signer, 'pr': pr, 'related': related, 'feature': min([pr, *related]),
                        'repo': repo, 't': int(ct), 'author': author,
                        'subject': subject, 'target': ref.removeprefix('refs/remotes/origin/'), 'fw': forward_port,
                        'hr': any(domain_of(m) not in ('Other', 'Framework', 'Localization') for m in modules),
                        'fix': subject.lstrip().upper().startswith('[FIX]'),
                    })
        return rows

    def history_merged_on(self, git, repo, revs, squad, coauthored=False):
        """Merged commits of the squad over the whole history, light: their PR, its related PRs, the subject."""
        select = (
            ['-E', '-i', '--grep=Co-authored-by: .*<(' + '|'.join(map(re.escape, sorted(squad))) + r')@odoo\.com>'] if coauthored
            else ['-i', *[f'--author={m}@odoo.com' for m in squad]]
        )
        raw = git.run('log', *revs, '--ignore-missing', '--no-merges', *select, '--format=\x1e%H%x1f%ae%x1f%at%x1f%ct%x1f%s%x1f%b', check=False)
        rows = []
        for rec in raw.split('\x1e'):
            if not rec.strip():
                continue
            sha, ae, at, ct, subject, body = rec.split('\x1f', 5)
            author = ae.lower().split('@')[0]
            members = (coauthors_of(body) & squad) - {author} if coauthored else {author} & squad
            if not members or 'X-original-commit:' in body:
                continue
            closes = next(iter(pr_refs(body)), None)
            rows.extend({
                'id': f'{sha}:{member}' if coauthored else sha, 'member': member, 'coauthor': coauthored,
                'pr': f'{closes[0]}#{closes[1]}' if closes else f'{repo}@{sha[:12]}', 'related': related_prs(body), 'subject': port_subject(subject),
                'at': int(at), 'ct': int(ct),
            } for member in members)
        return rows

    def history_reviews_on(self, git, repo, revs, squad):
        """r+ given by the squad on original PRs over the whole history, read from the Signed-off-by trailers of mergebot."""
        raw = git.run(
            'log', *revs, '--ignore-missing', '--no-merges', '-E', '-i',
            '--grep=Signed-off-by: .*<(' + '|'.join(map(re.escape, sorted(squad))) + r')@odoo\.com>',
            '--format=\x1e%H%x1f%ae%x1f%ct%x1f%s%x1f%b', check=False,
        )
        rows = []
        for rec in raw.split('\x1e'):
            if not rec.strip() or 'X-original-commit:' in rec:
                continue
            sha, ae, ct, subject, body = rec.split('\x1f', 4)
            # A forward-port, by mergebot or by hand, is no review: only the original change counts.
            if is_port_title(subject):
                continue
            author = ae.lower().split('@')[0]
            closes = pr_refs(body)
            signers = {e.lower().split('@')[0] for e in re.findall(r'^Signed-off-by: [^<\n]*<([^>]+)>', body, re.M)}
            # One r+ per feature: the linked PRs of the other repos are approved along with it.
            prs = [f'{closes[0][0]}#{closes[0][1]}' if closes else f'{repo}@{sha[:12]}', *related_prs(body)]
            rows.extend(
                {'id': f'{signer}:{min(prs)}', 'reviewer': signer, 't': int(ct), 'author': author, 'prs': prs, 'sha': sha[:12]}
                for signer in signers & squad - {author} - coauthors_of(body)
            )
        return rows

    def squad_history(self):
        """Merged commits and r+ of the squad over the whole history, read once, then only what was added since: which PRs
        make one feature (the odoo, enterprise and upgrade parts of a change) and who wrote each feature."""
        squad = set(self.names)
        commits = self.from_version_history(
            'history_commits', lambda git, repo, revs: self.history_merged_on(git, repo, revs, squad), squad, 'v1',
        ) + self.from_version_history(
            'history_coauthored', lambda git, repo, revs: self.history_merged_on(git, repo, revs, squad, coauthored=True), squad, 'v1',
        )
        self.history_reviews = self.from_version_history('history_reviews', lambda git, repo, revs: self.history_reviews_on(git, repo, revs, squad), squad, 'v1')
        self.feature_of = self.feature_groups(self.history_reviews, commits)
        # Who wrote or co-wrote each feature, read from the merged commits: a PR opened by someone else still belongs to
        # them, and their own review of it is no review.
        self.writers = collections.defaultdict(collections.Counter)
        for c in commits:
            self.writers[self.feature_of(c['pr'])][c['member']] += 1

    def github_rplus(self, keys, batch=20):
        """When each r+ was given: the `robodoo r+` comments and reviews of merged PRs, newest first, on their own budget.

        The Signed-off-by trailer tells who approved, but its commit is dated by the merge, which the mergebot does on its
        own, hours or days after the r+. A merged PR no longer changes: each one is read once. A batch GitHub fails on is
        split, a lone PR that still fails is tried again in a week."""
        store = self.archive.section('rplus')
        gh = GitHub(self.archive, self.args.github_rplus_budget)
        todo = [k for k in dict.fromkeys(keys) if re.fullmatch(r'odoo/[\w-]+#\d+', k)
                and (k not in store or (store[k].get('missing') and time.time() - store[k]['at'] > 7 * 86400))]
        self.step(f'github r+ ({len(todo)} PR)')
        chunks, done = [todo[i:i + batch] for i in range(0, len(todo), batch)], 0
        while chunks and not gh.stopped:
            chunk = chunks.pop(0)
            fields = []
            for j, key in enumerate(chunk):
                slug, number = key.split('#')
                owner, name = slug.split('/')
                fields.append(
                    f'p{j}: repository(owner: "{owner}", name: "{name}") {{ pullRequest(number: {number}) {{ '
                    'comments(last: 100) { nodes { author { login } createdAt body } } '
                    'reviews(last: 50) { nodes { author { login } submittedAt body } } } }'
                )
            data = gh.query(f'query {{ rateLimit {{ cost remaining resetAt }} {" ".join(fields)} }}', retry=False, count_failure=len(chunk) == 1)
            if data is None:
                if len(chunk) > 1 and not gh.stopped:
                    chunks[:0] = [chunk[:len(chunk) // 2], chunk[len(chunk) // 2:]]
                elif not gh.stopped:
                    store[chunk[0]] = {'at': time.time(), 'missing': True, 'r': []}
                continue
            for j, key in enumerate(chunk):
                node = (data.get(f'p{j}') or {}).get('pullRequest')
                if not node:
                    store[key] = {'at': time.time(), 'missing': True, 'r': []}
                    continue
                given = [[(c.get('author') or {}).get('login') or '', iso_ts(c['createdAt'])]
                         for c in node['comments']['nodes'] if c and c.get('createdAt') and rplus_command(c.get('body'))]
                given += [[(r.get('author') or {}).get('login') or '', iso_ts(r['submittedAt'])]
                          for r in node['reviews']['nodes'] if r and r.get('submittedAt') and rplus_command(r.get('body'))]
                store[key] = {'at': time.time(), 'r': sorted(given, key=lambda x: x[1])}
                done += 1
        self.rplus_pending = len(todo) - done
        log(f'github r+: {gh.calls} call(s), {done}/{len(todo)} PR' + (f' — {gh.stopped}' if gh.stopped else ''))
        return gh

    def rplus_at(self, reviewer, prs, merged):
        """When the reviewer gave the r+ that let the PR merge: their last `robodoo r+` up to the merge, else the merge."""
        store = self.archive.section('rplus')
        times = [t for pr in prs for login, t in (store.get(pr) or {}).get('r', ()) if self.login_name(login) == reviewer and t <= merged + 3600]
        return max(times) if times else merged

    def feature_rplus(self, feature):
        """The r+ of each reviewer of a feature, dated by their `robodoo r+` on its merged PRs."""
        store, reviewers, out = self.archive.section('rplus'), set(feature.get('reviewers') or ()), {}
        for p in feature.get('prs') or ():
            if p.get('state') != 'merged':
                continue
            for login, t in (store.get(f'{p["repo"]}#{p["number"]}') or {}).get('r', ()):
                who = self.login_name(login)
                if who in reviewers and (not p.get('merged_at') or t <= p['merged_at'] + 3600):
                    out[who] = max(out.get(who, 0), t)
        return out

    def feature_groups(self, review_rows, commits=()):
        """Key of the feature a PR belongs to, the same for its odoo, enterprise and upgrade PRs.

        PRs are linked by the Related trailers of the merged commits and by their branch name, which also joins the PRs
        not merged yet or merged without the trailer.
        """
        parent = {}

        def find(x):
            parent.setdefault(x, x)
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                # The smallest PR names the feature, as min(closes, Related) does on the r+ ids.
                low, high = sorted((ra, rb), key=lambda k: (k.startswith('branch:'), k))
                parent[high] = low

        linked = [r.get('prs', ()) for r in review_rows] + [(r['pr'], *r.get('related', ())) for r in self.archive.section('reviews').values()]
        linked += [(c['pr'], *c.get('related', ())) for c in commits if c.get('related')]
        # Ports by hand: the same subject by the same person, merged within 4 months, on another version.
        by_subject = collections.defaultdict(list)
        for c in commits:
            if c.get('subject'):
                by_subject[(c['member'], c['subject'])].append(c)
        for cs in by_subject.values():
            cs.sort(key=lambda c: c['ct'])
            linked += [(a['pr'], b['pr']) for a, b in zip(cs, cs[1:]) if b['ct'] - a['ct'] <= PORT_WINDOW and a['pr'] != b['pr']]
        for prs in linked:
            for pr in prs[1:]:
                union(prs[0], pr)
        branches = [(r['pr'], r.get('head_ref')) for r in self.archive.section('gh_reviews').values()]
        branches += [(key, (pr.get('label') or '').split(':', 1)[-1]) for key, pr in self.cache.section('mergebot').items() if isinstance(pr, dict)]
        for pr, branch in branches:
            # Forward-port branches of fw-bot carry the name of the original one with a suffix: they stay apart.
            if branch and not branch.endswith('-fw') and '#' in pr:
                union(pr, f'branch:{branch}')

        return find

    def http_get(self, url, timeout=60, attempts=3):
        req = urllib.request.Request(url, headers={'User-Agent': f'squad-dashboard/{APP_VERSION or "dev"}', 'Accept-Encoding': 'gzip'})
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    raw = resp.read()
                    if resp.headers.get('Content-Encoding') == 'gzip':
                        raw = gzip.decompress(raw)
                    return raw.decode('utf-8', errors='replace')
            except urllib.error.HTTPError:
                raise
            except (OSError, http.client.HTTPException):
                if attempt == attempts - 1:
                    raise
                time.sleep(2 * (attempt + 1))

    def scrape_runbot(self, queries):
        """queries: (search text, predicate on bundle names) pairs, one runbot page each."""
        bundles = {}
        for query, keep in queries:
            page = self.http_get(f'https://runbot.odoo.com/runbot/rd-1?search={urllib.parse.quote(query)}&limit=500', timeout=120)
            if 'Check in progress' in page[:2000]:
                raise RuntimeError('runbot answered with an anti-bot challenge')
            for row in page.split('<div class="row bundle_row">')[1:]:
                m = re.search(r'href="/runbot/bundle/(\d+)" title="View Bundle ([^"]+)"', row)
                if not m or not keep(html.unescape(m.group(2))):
                    continue
                links = re.findall(
                    r'href="https://github.com/([\w-]+/[\w-]+)/(tree|pull)/([^"]+)" title="[^"]*">\s*'
                    r'<span[^>]*>[^<]*</span>\s*<span class="([^"]*)"', row,
                )
                batches = []
                for tile in row.split('<div class="batch_tile">')[1:]:
                    bm = re.search(r'card bg-([\w-]+?)-subtle.*?href="/runbot/batch/(\d+)" title="([^"]+)"', tile, re.S)
                    if bm:
                        states = collections.Counter(re.findall(r'data-global_state="(\w+)"', tile))
                        batches.append({
                            'id': int(bm.group(2)), 'at': utc_ts(bm.group(3)), 'state': bm.group(1),
                            'results': dict(collections.Counter(re.findall(r'data-global_result="(\w+)"', tile))),
                            'running': sum(v for k, v in states.items() if k != 'done'),
                            'failed': sorted(set(re.findall(r'btn-danger disabled">.*?<span>([^<]+)</span>', tile, re.S))),
                        })
                bundles[html.unescape(m.group(2))] = {
                    'id': int(m.group(1)), 'url': f'https://runbot.odoo.com/runbot/bundle/{m.group(1)}',
                    'branches': [{'repo': r, 'deleted': 'line-through' in c} for r, kind, _v, c in links if kind == 'tree'],
                    'prs': [{'repo': r, 'number': int(v), 'closed': 'line-through' in c} for r, kind, v, c in links if kind == 'pull' and r.startswith('odoo/')],
                    'batches': batches,
                }
            time.sleep(2)
        return bundles

    def mergebot_pr(self, slug, number):
        key = f'{slug}#{number}'
        cached = self.cache.get('mergebot', key)
        if cached and time.time() - cached['fetched'] < 300:
            return cached
        # A merged PR stays as read, but its table of forward-ports moves on for a while after the merge.
        ports_moving = (cached and cached['state'] == 'merged' and any(lk['state'] == 'open' for lk in cached.get('linked', ()))
                        and time.time() - (cached.get('merged_at') or 0) < 30 * 86400 and time.time() - cached['fetched'] > 3600)
        if cached and cached['state'] in ('merged', 'closed', 'missing') and not ports_moving:
            return cached
        url = f'https://mergebot.odoo.com/{slug}/pull/{number}'
        time.sleep(0.5)
        try:
            page = self.http_get(url)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            self.cache.set('mergebot', key, {'repo': slug, 'number': number, 'state': 'missing', 'fetched': time.time()})
            return None
        main = page[page.find('</h6>'):]
        alert = re.search(r'<div class="alert alert-(\w+)">\s*(?:<p[^>]*>)?\s*([\w ]+)', main)
        state = {'success': 'merged', 'light': 'closed'}.get(alert.group(1), 'open') if alert else 'open'
        title_m = re.search(r'<h3>(.*?)</h3>', main, re.S)
        merged_m = re.search(r'<dt>merged</dt>\s*<dd>\s*<span title="([^"]+)">.*?</span>\s*by\s*<span title="[^"]*">([^<]*)</span>', main, re.S)
        created_m = re.search(r'Created by <span>([^<]*)</span>', page)
        label_m = re.search(r'<dt>label</dt>\s*<dd><span>([^<]*)</span>', main)
        linked = []
        for row in re.findall(r'<tr class="[^"]*">(.*?)</tr>', main, re.S):
            branch = re.search(r'<td>([\w.\-]+)</td>', row)
            for cell_class, span_title, repo, n in re.findall(
                r'<td class="([^"]*)">\s*<span title="([^"]*)"[^>]*>\s*<a href="/(odoo/[\w-]+)/pull/(\d+)"', row,
            ):
                linked.append({
                    'branch': branch.group(1) if branch else '', 'repo': repo, 'number': int(n),
                    'state': 'merged' if 'table-success' in cell_class else 'closed' if span_title == 'closed' else 'open',
                })
        description = html.unescape(re.sub(r'<[^>]+>', ' ', main[main.find('</h3>'):main.find('</main>')])) if title_m else ''
        trailers = parse_trailers(html.unescape(re.sub(r'<[^>]+>', ' ', main)))
        result = {
            'repo': slug, 'number': number, 'url': f'https://github.com/{slug}/pull/{number}', 'mergebot_url': url,
            'state': state, 'phase': alert.group(2).strip() if alert else '',
            'draft': 'is in draft' in main, 'blocked': '>Blocked<' in main, 'missing_r': 'missing r+' in main,
            'title': html.unescape(re.sub(r'<[^>]+>', '', title_m.group(1))).strip() if title_m else '',
            'created_by': html.unescape(created_m.group(1)) if created_m else '',
            'label': html.unescape(label_m.group(1)) if label_m else '',
            'merged_at': utc_ts(merged_m.group(1)) if merged_m else None,
            'merged_by': html.unescape(merged_m.group(2)).strip() if merged_m else None,
            'ci': {name: st or 'pending' for st, name in re.findall(r'<li class="\s*(\w*)\s*">\s*<a href="[^"]*">((?:ci|legal)/[\w-]+)</a>', main)},
            'review': next((st or 'pending' for st, _item in re.findall(r'<li class="(\w*)">\s*(Review)\b', main)), None),
            'linked': linked, 'desc_words': len(description.split()),
            'tasks': trailers['tasks'], 'opws': trailers['opws'], 'fetched': time.time(),
        }
        self.cache.set('mergebot', key, result)
        return result

    def mergebot_all(self, pr_keys):
        self.step(f'mergebot ({len(pr_keys)} PR)')
        errors = []

        def one(key):
            try:
                return self.mergebot_pr(*key)
            except Exception as e:  # noqa: BLE001
                errors.append(f'{key[0]}#{key[1]}: {e}')
                return self.cache.get('mergebot', f'{key[0]}#{key[1]}')

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(one, sorted(pr_keys)))
        self.web_status['mergebot_error'] = f'{len(errors)} error(s), e.g. {errors[0]}' if errors else None
        return {f'{r["repo"]}#{r["number"]}': r for r in results if r and r['state'] != 'missing'}

    def cached_prs(self, pr_keys):
        return {f'{s}#{n}': pr for s, n in pr_keys if (pr := self.cache.get('mergebot', f'{s}#{n}')) and pr['state'] != 'missing'}

    def pr_query(self, keys, light=False):
        commit = 'oid' if light else 'oid additions deletions changedFilesIfAvailable'
        fragment = """
        fragment F on PullRequest {
          state isDraft createdAt closedAt additions deletions changedFiles author { login }
          reviews(first: 50) { nodes { author { login } state submittedAt } }
          comments { totalCount }
          timelineItems(first: 100, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT, READY_FOR_REVIEW_EVENT]) {
            nodes {
              __typename
              ... on HeadRefForcePushedEvent {
                createdAt actor { login }
                beforeCommit { COMMIT }
                afterCommit { COMMIT }
              }
              ... on ReadyForReviewEvent { createdAt }
            }
          }
        }"""
        aliases = []
        for i, key in enumerate(keys):
            slug, number = key.split('#')
            owner, name = slug.split('/')
            aliases.append(f'p{i}: repository(owner: "{owner}", name: "{name}") {{ pullRequest(number: {int(number)}) {{ ...F }} }}')
        return 'query { viewer { login } rateLimit { cost remaining resetAt } ' + ' '.join(aliases) + ' }' + fragment.replace('COMMIT', commit)

    def github_sync(self, prs, web_names, contributed=(), only=None):
        gh = GitHub(self.archive, self.args.github_budget)
        store = self.archive.section('github')
        wanted = []
        for key, pr in prs.items():
            label = pr['label'].split(':', 1)[-1]
            if (self.owner_of(label) not in web_names and label not in contributed) or label.endswith('-fw') or not re.fullmatch(r'odoo/[\w-]+#\d+', key):
                continue
            cached = store.get(key)
            if not cached or (cached['state'] == 'OPEN' and time.time() - cached['fetched'] > 600):
                wanted.append((pr['state'] != 'open', -(pr.get('merged_at') or time.time()), key))
        keys = [key for *_, key in sorted(wanted)]
        self.step(f'github ({len(keys)} PR)')
        done = 0
        pr_budget = max(1, self.args.github_budget - 2 * len(web_names))
        chunks = [(keys[i:i + 10], False) for i in range(0, len(keys), 10)]
        while chunks and not gh.stopped and gh.calls < pr_budget:
            chunk, light = chunks.pop(0)
            data = gh.query(self.pr_query(chunk, light), retry=False, count_failure=light)
            if data is None:
                # Diff sizes of huge commits make GitHub time out: split the batch, then read a lone PR without them.
                if len(chunk) > 1:
                    chunks[:0] = [(chunk[:len(chunk) // 2], light), (chunk[len(chunk) // 2:], light)]
                elif not light:
                    chunks.insert(0, (chunk, True))
                elif not gh.stopped:
                    store[chunk[0]] = {'state': 'MISSING', 'reason': 'too heavy for the API', 'fetched': time.time()}
                continue
            if viewer := (data.get('viewer') or {}).get('login'):
                self.archive.set('github_meta', 'viewer', viewer)
            for j, key in enumerate(chunk):
                node = (data.get(f'p{j}') or {}).get('pullRequest')
                store[key] = gh_pr(node) if node else {'state': 'MISSING', 'fetched': time.time()}
            done += len(chunk)
        logins = self.github_logins()
        self.resolve_logins(gh, logins)
        self.github_reviews(gh, {n: logins[n] for n in web_names if n in logins})
        if not only:
            # On their own budgets: every page of the review requests, and the r+ to date.
            asked = GitHub(self.archive, 8)
            self.review_requests(asked, logins.get(self.lead))
            for other in (asked, self.github_rplus(self.rplus_keys)):
                gh.calls += other.calls
                gh.remaining = other.remaining if other.remaining is not None else gh.remaining
                gh.stopped = gh.stopped or (other.stopped if other.stopped and 'budget' not in other.stopped else None)
        self.archive.set('github_meta', 'status', {
            'at': time.time(), 'calls': gh.calls, 'remaining': gh.remaining, 'reset_at': gh.reset_at, 'stopped': gh.stopped,
            'pending': len(keys) - done, 'rplus_pending': getattr(self, 'rplus_pending', None),
        })
        log(f'github: {gh.calls} call(s), {done}/{len(keys)} PR, quota left {gh.remaining}' + (f' — {gh.stopped}' if gh.stopped else ''))

    def review_requests(self, gh, login, limit=300):
        """Open PRs where GitHub asks the user for a review, directly or through one of their GitHub teams, in any repository,
        every page of the search: when it was last asked, the ids of the PR description (task, opw, sentry, upg), and who
        already reviewed it or gave the r+, read from its last reviews and comments. A page GitHub fails on is read again
        smaller; one cut short keeps what was read."""
        if not re.fullmatch(r'[A-Za-z0-9-]+', login or ''):
            return False
        search = f'type:pr state:open review-requested:{login} archived:false sort:updated-desc'
        who = '__typename ... on User { login } ... on Team { slug }'
        mine = lambda r: (r.get('login') or '').lower() == login.lower()
        prs, total, cursor, size, my_teams, team_logins, complete = [], None, None, 50, None, [], False
        while len(prs) < limit:
            after = f', after: "{cursor}"' if cursor and re.fullmatch(r'[A-Za-z0-9+/=_-]+', cursor) else ''
            # The user's teams in the organisation and their members: which of the teams asked is theirs, and who is in the
            # team (needs read:org, else unknown).
            teams_field = (f'org: organization(login: "odoo") {{ teams(first: 20, userLogins: ["{login}"]) {{ nodes {{ slug members(first: 100) {{ totalCount nodes {{ login }} }} }} }} }} '
                           if my_teams is None else '')
            data = gh.query(
                f'query {{ rateLimit {{ cost remaining resetAt }} {teams_field}s: search(query: "{search}", type: ISSUE, first: {size}{after}) {{ issueCount pageInfo {{ hasNextPage endCursor }} nodes {{ ... on PullRequest {{ '
                f'number title url isDraft createdAt updatedAt headRefName body repository {{ nameWithOwner }} author {{ login }} '
                f'reviewRequests(first: 30) {{ nodes {{ requestedReviewer {{ {who} }} }} }} '
                f'timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 30) {{ nodes {{ ... on ReviewRequestedEvent {{ createdAt requestedReviewer {{ {who} }} }} }} }} '
                f'reviews(last: 30) {{ nodes {{ author {{ login }} state submittedAt body }} }} '
                f'comments(last: 30) {{ nodes {{ author {{ login }} createdAt body }} }} }} }} }} }}',
                search=True, retry=False,
            )
            if data is None or not data.get('s'):
                if size > 20 and not gh.stopped:
                    size = 20
                    continue
                break
            if my_teams is None:
                nodes = [t for t in (((data.get('org') or {}).get('teams') or {}).get('nodes') or []) if t and t.get('slug')]
                my_teams = {t['slug'] for t in nodes}
                # A team of the whole organisation (odoo-staff) is no team: only the small ones tell who works together.
                team_logins = sorted({m['login'] for t in nodes if ((t.get('members') or {}).get('totalCount') or 0) <= 100
                                      for m in ((t.get('members') or {}).get('nodes') or []) if m and m.get('login')})
            total = data['s']['issueCount']
            for node in data['s']['nodes']:
                if not node or not node.get('repository'):
                    continue
                asked = [r['requestedReviewer'] for r in node['reviewRequests']['nodes'] if r and r.get('requestedReviewer')]
                requested = {r['slug'] for r in asked if r.get('__typename') == 'Team' and r.get('slug')}
                teams = sorted(requested & my_teams) if my_teams else sorted(requested)
                events = [e for e in node['timelineItems']['nodes'] if e and e.get('createdAt')]
                # The last request that brought it to the user (or a team of theirs), else the last request of the PR.
                to_me = [iso_ts(e['createdAt']) for e in events if e.get('requestedReviewer') and (mine(e['requestedReviewer']) or e['requestedReviewer'].get('slug') in teams)]
                body = node.get('body') or ''
                reviews = [r for r in node['reviews']['nodes'] if r and r.get('submittedAt')]
                prs.append({
                    'pr': f'{node["repository"]["nameWithOwner"]}#{node["number"]}', 'url': node['url'], 'title': node['title'], 'draft': node['isDraft'],
                    'author': (node.get('author') or {}).get('login') or '', 'head': node.get('headRefName') or '',
                    'created_at': iso_ts(node['createdAt']), 'updated_at': iso_ts(node['updatedAt']),
                    'asked_at': max(to_me) if to_me else max((iso_ts(e['createdAt']) for e in events), default=None),
                    'direct': any(mine(r) for r in asked), 'teams': teams, 'other_teams': len(requested - set(teams)),
                    'ids': {kind: sorted(set(re.findall(rf'(?i)\b{kind}[-:#\s]+(\d{{4,12}})\b', body))) for kind in ('opw', 'sentry', 'upg', 'task')},
                    'reviews': [[(r.get('author') or {}).get('login') or '', r['state'], iso_ts(r['submittedAt'])] for r in reviews],
                    'rplus': [[(c.get('author') or {}).get('login') or '', iso_ts(c['createdAt'])] for c in node['comments']['nodes'] if c and c.get('createdAt') and rplus_command(c.get('body'))]
                    + [[(r.get('author') or {}).get('login') or '', iso_ts(r['submittedAt'])] for r in reviews if rplus_command(r.get('body'))],
                })
            if not data['s']['pageInfo']['hasNextPage']:
                complete = True
                break
            cursor = data['s']['pageInfo']['endCursor']
        if total is None:
            return False
        self.cache.set('github_requests', 'me', {
            'login': login, 'at': time.time(), 'total': total, 'prs': prs, 'complete': complete, 'teams': sorted(my_teams or ()),
            'team_logins': team_logins, 'v': 2,
        })
        return True

    def refresh_me(self):
        """The short reload of the Me tab: the review requests alone, set into the data already built; nothing else is read."""
        if self.args.no_github:
            raise RuntimeError('GitHub disabled (--no-github)')
        self.step('github: review requests')
        logins = self.github_logins()
        self.login_names = {login.lower(): name for name, login in logins.items()}
        login = logins.get(self.lead)
        if not login:
            raise RuntimeError('GitHub login of the lead unknown: set it in github_logins of config.json')
        gh = GitHub(self.archive, 8)
        if not self.review_requests(gh, login):
            raise RuntimeError(gh.stopped or 'GitHub could not be read')
        self.cache.save()
        with self.lock:
            if self.data:
                self.data['review_requests'] = self.requests_report()
                self.write_data()
        self.step('')
        log(f'review requests: {len(self.data["review_requests"]["prs"]) if self.data else "?"} PR')

    def member_login(self, member, login):
        """Whether a GitHub login can be the person's: not a bot, not the `<trigram>-odoo` login of someone else of the squad."""
        if not login or is_bot(login):
            return False
        bare = re.sub(r'-odoo$', '', login.lower())
        return bare == member or bare == login.lower() or bare not in self.names

    def resolve_logins(self, gh, logins):
        """GitHub login of each person of the squad not known from their branches, from the authors of up to 3 of their merged
        PRs (40 PRs per light query): a PR may have been opened by someone else for them, or by the forward-port bot, so the
        most frequent valid one."""
        store = self.archive.section('team_logins')
        missing = {m for m in self.names if m not in logins and (m not in store or (store[m] and not self.member_login(m, store[m])))}
        samples = collections.defaultdict(list)
        for git, _remote, _slug in self.repos.values():
            todo = sorted(m for m in missing if len(samples[m]) < 3)
            if not todo:
                break
            raw = git.run(
                'log', 'refs/remotes/origin/master', '--since=730 days ago', '--no-merges', '-i',
                *[f'--author={m}@odoo.com' for m in todo], '--grep=closes odoo/', '--format=%ae%x1f%B%x1e',
                check=False,
            )
            for rec in raw.split('\x1e'):
                email, _, body = rec.strip().partition('\x1f')
                member = email.lower().split('@')[0]
                closes = re.search(r'closes (odoo/[\w-]+)#(\d+)', body)
                if member not in missing or len(samples[member]) >= 3 or not closes or 'X-original-commit:' in body or 'Forward-Port-Of:' in body:
                    continue
                pr = (closes.group(1), int(closes.group(2)))
                if pr not in samples[member]:
                    samples[member].append(pr)
        pending = [(member, pr) for member, prs in sorted(samples.items()) for pr in prs]
        votes = collections.defaultdict(collections.Counter)
        for i in range(0, len(pending), 40):
            chunk = pending[i:i + 40]
            aliases = ' '.join(
                f'p{j}: repository(owner: "{slug.split("/")[0]}", name: "{slug.split("/")[1]}") {{ pullRequest(number: {number}) {{ author {{ login }} }} }}'
                for j, (_member, (slug, number)) in enumerate(chunk)
            )
            data = gh.query(f'query {{ rateLimit {{ cost remaining resetAt }} {aliases} }}')
            if data is None:
                return
            for j, (member, _pr) in enumerate(chunk):
                login = (((data.get(f'p{j}') or {}).get('pullRequest') or {}).get('author') or {}).get('login') or ''
                if self.member_login(member, login):
                    votes[member][login] += 1
        for member in samples:
            own = [login for login in votes[member] if login.lower() == f'{member}-odoo']
            store[member] = own[0] if own else votes[member].most_common(1)[0][0] if votes[member] else ''

    def login_name(self, login):
        """The person behind a GitHub login: config.json and the deduced logins, else a `<trigram>-odoo` login of the squad."""
        key = (login or '').lower()
        if key in self.login_names:
            return self.login_names[key]
        bare = re.sub(r'-odoo$', '', key)
        return bare if bare != key and bare in self.names else login

    def github_logins(self):
        return {member: login for member, (login, _source) in self.github_login_sources().items()}

    def github_login_sources(self):
        """Login of each person and where it comes from: config (forced), branches (authors of the PRs of their branches),
        pr (authors of PRs closing their commits), viewer (the account of the token)."""
        counts = collections.defaultdict(collections.Counter)
        for key, pr in self.archive.section('github').items():
            label = (self.cache.get('mergebot', key) or {}).get('label', '')
            owner = self.owner_of(label.split(':', 1)[-1])
            author = pr.get('author')
            if owner and author and not is_bot(author):
                counts[owner][author] += 1
        logins = {name: (c.most_common(1)[0][0], 'branches') for name, c in counts.items() if self.member_login(name, c.most_common(1)[0][0])}
        if (viewer := self.archive.get('github_meta', 'viewer')) and self.me not in logins:
            logins[self.me] = (viewer, 'viewer')
        # One login per member, one member per login: a login already taken is not another member's.
        taken = {login.lower() for login, _source in logins.values()}
        for member, login in self.archive.section('team_logins').items():
            if member in self.names and member not in logins and self.member_login(member, login) and login.lower() not in taken:
                logins[member] = (login, 'pr')
                taken.add(login.lower())
        logins.update({member: (login, 'config') for member, login in (self.config.get('github_logins') or {}).items() if login})
        return logins

    def squad_logins(self):
        """For the page: the GitHub login of each person of the squad, where it comes from, and a guess set aside."""
        sources, store = self.github_login_sources(), self.archive.section('team_logins')
        forced = self.config.get('github_logins') or {}
        return [{
            'member': m, 'login': sources.get(m, ('', ''))[0], 'source': sources.get(m, ('', 'none'))[1], 'forced': forced.get(m, ''),
            'rejected': store[m] if store.get(m) and not self.member_login(m, store[m]) else '',
        } for m in self.names]

    def force_logins(self, logins):
        """GitHub logins forced from the page; an empty one goes back to the deduced login."""
        self.reload_config_if_edited()
        forced = dict(self.config.get('github_logins') or {})
        for member, login in logins.items():
            if login:
                forced[member] = login
            else:
                forced.pop(member, None)
        self.config['github_logins'] = forced
        (HERE / 'config.json').write_text(json.dumps(self.config, indent=2, ensure_ascii=False) + '\n')
        self.load_config()

    def review_search_start(self):
        return time.strftime('%Y-%m-01', time.gmtime(time.time() - self.args.since_days * 86400))

    def github_reviews(self, gh, logins, fresh_for=0, batch=5):
        """Reviews submitted on GitHub (comments, approvals, change requests), resumed from where the last search stopped.

        Five members per call, one aliased search each. Oldest update first: a search stops at 1000 results, so past 900
        the next one starts again from the last update date.
        """
        store = self.archive.section('gh_reviews')
        progress = self.archive.section('github_search')
        until = time.strftime('%Y-%m-%d', time.gmtime(time.time() - 86400))
        pending = []
        for name, login in logins.items():
            if not re.fullmatch(r'[A-Za-z0-9-]+', login):
                continue
            state = progress.get(name) if (progress.get(name) or {}).get('login') == login else {}
            if state.get('until') and time.time() - state.get('at', 0) < fresh_for:
                continue
            # Cursors of the searches sorted by relevance (v1) cannot resume a sorted one.
            cursor = state.get('cursor') if state.get('v') == 2 else None
            pending.append({
                'name': name, 'login': login, 'start': state.get('start') or state.get('until') or self.review_search_start(),
                'cursor': cursor, 'offset': state.get('offset', 0) if cursor else 0, 'moved': False,
            })

        def pause(item):
            progress[item['name']] = {'login': item['login'], 'start': item['start'], 'cursor': item['cursor'], 'offset': item['offset'], 'v': 2}

        while pending and not gh.stopped:
            chunk = pending[:batch]
            fields = []
            for j, item in enumerate(chunk):
                login = item['login']
                search = (f'type:pr reviewed-by:{login} -author:{login} repo:odoo/odoo repo:odoo/enterprise repo:odoo/upgrade '
                          f'updated:>={item["start"]} sort:updated-asc')
                after = f', after: "{item["cursor"]}"' if item['cursor'] and re.fullmatch(r'[A-Za-z0-9+/=_-]+', item['cursor']) else ''
                fields.append(
                    f's{j}: search(query: "{search}", type: ISSUE, first: 50{after}) {{ '
                    f'pageInfo {{ hasNextPage endCursor }} nodes {{ ... on PullRequest {{ number title headRefName updatedAt repository {{ nameWithOwner }} '
                    f'author {{ login }} reviews(author: "{login}", first: 10) {{ nodes {{ state submittedAt }} }} }} }} }}'
                )
            data = gh.query(f'query {{ rateLimit {{ cost remaining resetAt }} {" ".join(fields)} }}', search=True, searches=len(chunk))
            if data is None:
                break
            for j, item in enumerate(chunk):
                result = data.get(f's{j}')
                if not result:
                    # This search failed alone: kept for the next refresh.
                    pause(item)
                    pending.remove(item)
                    continue
                name, login = item['name'], item['login']
                item['moved'] = True
                for node in result['nodes']:
                    if not node or (node.get('author') or {}).get('login') == login:
                        continue
                    pr = f'{node["repository"]["nameWithOwner"]}#{node["number"]}'
                    for review in node['reviews']['nodes']:
                        if review.get('submittedAt'):
                            store[f'{name}:{pr}:{review["submittedAt"]}'] = {
                                'reviewer': name, 'pr': pr, 'repo': pr.split('/')[1].split('#')[0], 't': iso_ts(review['submittedAt']),
                                'state': review['state'], 'author_login': (node.get('author') or {}).get('login') or '',
                                'head_ref': node.get('headRefName') or '',
                                'subject': node['title'], 'fix': node['title'].lstrip().upper().startswith('[FIX]'),
                            }
                page, nodes = result['pageInfo'], [n for n in result['nodes'] if n]
                if not page['hasNextPage']:
                    progress[name] = {'login': login, 'until': until, 'at': time.time(), 'v': 2}
                    pending.remove(item)
                    continue
                item['cursor'], item['offset'] = page['endCursor'], item['offset'] + len(nodes)
                if item['offset'] >= 900 and nodes:
                    item['start'], item['cursor'], item['offset'] = nodes[-1]['updatedAt'][:10], None, 0
        # Cut by the budget or the quota: whoever was halfway resumes at their cursor.
        for item in pending:
            if item['moved']:
                pause(item)

    def build(self, scope='all', only=None):
        t0 = time.time()
        self.reload_config_if_edited()
        self.status.update(state='running', scope=scope, target=only)
        if scope == 'me':
            self.refresh_me()
            return
        web_names = [n for n in (only or self.names) if n in self.names]
        # 'ci' reads runbot and mergebot, 'github' only GitHub, 'all' both; each but 'git' starts with its own sources.
        ci, github = scope in ('all', 'ci'), scope in ('all', 'github')
        if (ci and not self.args.no_fetch) or self.args.fetch:
            self.step('git fetch')
            self.fetch()
        if ci and web_names:
            self.step('co-authored branches')
            self.discover_contributed()
        contributed = {
            key.split(':', 1)[1] for key, people in self.archive.section('contributed').items() if set(people) & set(web_names)
        }
        self.step('git scan')
        heads = [git.path / '.git' / 'FETCH_HEAD' for git, _remote, _slug in self.repos.values()]
        self.last_fetch = min((h.stat().st_mtime for h in heads if h.exists()), default=0)
        branches = self.scan_git()
        # Anchored on the first of the month: a moving date would invalidate the incremental caches every day.
        since = time.strftime('%Y-%m-01', time.localtime(time.time() - self.args.since_days * 86400))
        self.step('merged commits and reviews')
        merged = self.from_version_refs('merged_refs', since, self.merged_on)
        reviews = self.from_version_refs('review_refs', since, self.reviews_on)
        self.step('history of the squad')
        self.squad_history()
        if ci and web_names:
            self.step(f'runbot ({", ".join(web_names)})' if only else 'runbot')
            try:
                queries = [(n, lambda b, n=n: self.owner_of(b) == n) for n in web_names]
                queries += [(b, lambda name, b=b: name == b) for b in sorted(contributed)[:15]]
                fresh = self.scrape_runbot(queries)
                self.runbot = {k: v for k, v in self.runbot.items() if self.owner_of(k) not in web_names} | fresh
                self.cache.set('runbot', 'bundles', self.runbot)
                self.web_status.update(runbot_at=time.time(), runbot_error=None)
            except Exception as e:  # noqa: BLE001
                log(f'runbot: {e}')
                self.web_status['runbot_error'] = str(e)

        pr_keys = {(p['repo'], p['number']) for b in self.runbot.values() for p in b['prs']}
        pr_keys.update((slug, int(n)) for c in merged for slug, n in c['closes'])
        prs = self.cached_prs(pr_keys)
        if ci and web_names:
            targets = {
                (p['repo'], p['number']) for name, b in self.runbot.items() if self.owner_of(name) in web_names or name in contributed
                for p in b['prs']
            }
            targets.update((slug, int(n)) for c in merged if c['owner'] in web_names for slug, n in c['closes'])
            prs.update(self.mergebot_all(targets))
            linked = {(lk['repo'], lk['number']) for pr in prs.values() if self.owner_of(pr['label'].split(':', 1)[-1]) in web_names for lk in pr['linked']}
            if linked - set(targets):
                prs.update(self.mergebot_all(linked - set(targets)))

        # The r+ to date, the ones shown first ahead: the squad's reviews, its features', then its older r+.
        newest = lambda rows, key: sorted(rows, key=lambda r: -r[key])
        self.rplus_keys = (
            [r['pr'] for r in newest([*reviews, *self.archive.section('reviews').values()], 't') if r['reviewer'] in self.names]
            + [f'{slug}#{n}' for c in newest(merged, 'ct') if c['owner'] in self.names for slug, n in c['closes']]
            + [r['prs'][0] for r in newest(self.history_reviews, 't') if r.get('prs')]
        )
        if github and web_names and not self.args.no_github:
            self.github_sync(prs, web_names, contributed, only)
        logins = self.github_logins()
        self.login_names = {login.lower(): name for name, login in logins.items()}

        features = self.archived(self.assemble(branches, merged, prs))
        for f in features:
            f['rplus'] = self.feature_rplus(f)
        squad = set(self.names)
        stored_reviews = self.archive.section('reviews')
        stored_reviews.update({r['id']: r for r in reviews})
        # Whoever wrote part of the feature did not review it.
        for key in [k for k, r in stored_reviews.items() if r['reviewer'] == r['author'] or r['reviewer'] in self.writers.get(self.feature_of(r['pr']), ())]:
            del stored_reviews[key]
        # Dated by the r+ comment; the commit of the trailer is dated by the merge, kept apart.
        review_rows = [
            {**r, 't': self.rplus_at(r['reviewer'], [r['pr']], r['t']), 'merged_at': r['t'], 'squad': r['author'] in squad, 'src': 'r+', 'feature': self.feature_of(r['pr'])}
            for r in stored_reviews.values() if r['reviewer'] in self.names
        ]
        for key, r in self.archive.section('gh_reviews').items():
            if r['reviewer'] in self.names:
                author = self.login_name(r['author_login'])
                forward_port = bool(re.search(r'bot|robodoo', r['author_login'], re.I))
                if forward_port:
                    # Forward-ports are opened by fw-bot: the branch name tells whose change it carries.
                    branch = r.get('head_ref') or (self.cache.get('mergebot', r['pr']) or {}).get('label', '').split(':', 1)[-1]
                    author = self.owner_of(branch) or author
                writers = self.writers.get(self.feature_of(r['pr'])) or {}
                if writers and author not in writers:
                    author = writers.most_common(1)[0][0]
                if author == r['reviewer'] or r['reviewer'] in writers:
                    continue
                review_rows.append({
                    'id': key, 'reviewer': r['reviewer'], 'pr': r['pr'], 'repo': r['repo'], 't': r['t'], 'author': author,
                    'subject': r['subject'], 'target': '', 'fw': forward_port, 'hr': False, 'fix': r['fix'],
                    'squad': author in squad, 'src': 'github', 'state': r['state'], 'onboarding': 'onboarding' in (r.get('head_ref') or ''),
                    'feature': self.feature_of(r['pr']),
                })
        # Reviews on the PRs of a port (another version of a change merged first) are no review work.
        port_prs = {f'{p["repo"]}#{p["number"]}' for f in features if f['kind'] == 'forward-port' for p in f['prs']}
        for r in review_rows:
            if r['pr'] in port_prs or is_port_title(r.get('subject')):
                r['fw'] = True
        github_store = self.archive.section('github')
        oldest = [f['first_at'] for f in features if f.get('first_at')] + [r['t'] for r in review_rows]
        data = {
            'generated_at': time.time(), 'duration': round(time.time() - t0, 1), 'since': since,
            'names': self.names, 'squad': self.squad(), 'org': self.org(), 'review_requests': self.requests_report(),
            'history_since': min(oldest) if oldest else None,
            'version_forks': self.version_forks(),
            'sources': {
                'git': {
                    'branches': sum(len(v) for v in branches.values()), 'merged_commits': len(merged), 'fetch': not self.args.no_fetch,
                    'fetch_error': self.web_status['fetch_error'],
                    'fetched_at': {
                        repo: (git.path / '.git' / 'FETCH_HEAD').stat().st_mtime
                        for repo, (git, _remote, _slug) in self.repos.items() if (git.path / '.git' / 'FETCH_HEAD').exists()
                    },
                },
                'runbot': {'bundles': len(self.runbot), 'at': self.web_status['runbot_at'], 'error': self.web_status['runbot_error']},
                'mergebot': {'prs': len(prs), 'error': self.web_status['mergebot_error']},
                'archive': {'features': len(self.archive.section('features')), 'reviews': len(stored_reviews), 'branches': len(self.archive.section('branches'))},
                'github': {
                    **(self.archive.get('github_meta', 'status') or {}), 'enabled': not self.args.no_github,
                    'prs': sum(1 for v in github_store.values() if v['state'] != 'MISSING'),
                    'reviews': len(self.archive.section('gh_reviews')), 'logins': logins,
                },
            },
            'features': features, 'reviews': review_rows,
        }
        self.cache.save()
        self.archive.save()
        with self.lock:
            self.data = data
        self.write_data()
        self.step('')
        log(f'{len(features)} features, {len(review_rows)} reviews in {data["duration"]}s')

    def requests_report(self):
        """The review requests read last, told apart for the page: whether the author is in the team (the members of the
        user's GitHub teams when GitHub tells them, else the squad; also by the branch name), the reviews of other team
        members (validations) and the r+ given by anyone else."""
        found = self.cache.get('github_requests', 'me')
        if not found or found.get('v') != 2:
            return None
        me = found['login'].lower()
        team = {login.lower() for login in found.get('team_logins') or ()} | {login.lower() for login in self.github_logins().values()}
        squad = set(self.names)
        out = []
        for p in found['prs']:
            author = p['author'].lower()
            out.append({
                **{k: v for k, v in p.items() if k not in ('reviews', 'rplus')}, 'who': self.login_name(p['author']),
                'team_author': author in team or self.owner_of(p.get('head') or '', squad) is not None,
                'validations': [[self.login_name(login), state, at] for login, state, at in p['reviews'] if login.lower() not in (me, author) and login.lower() in team],
                'rplus': [[self.login_name(login), at] for login, at in p['rplus'] if login.lower() != me],
            })
        return {**{k: v for k, v in found.items() if k != 'team_logins'}, 'prs': out}

    def write_data(self):
        payload = json.dumps(self.data)
        (HERE / 'data.json').write_text(payload)
        # Loaded by a <script> tag so the page also works from file:// without the server.
        (HERE / 'data.js').write_text(f'window.DASHBOARD_DATA = {payload};\n')

    def archived(self, features):
        """Stores every feature seen and re-adds the ones no source reports any more."""
        store = self.archive.section('features')
        current = {f['name'] for f in features}
        current_prs = {f'{p["repo"]}#{p["number"]}' for f in features for p in f['prs']}
        for f in features:
            store[f['name']] = f
        for name, f in store.items():
            if name in current or not ({f['owner'], *f.get('contributors', [])} & set(self.names)):
                continue
            if not f.get('orphan') and not f.get('coauthored') and self.owner_of(name) != f['owner']:
                continue
            if any(f'{p["repo"]}#{p["number"]}' in current_prs for p in f['prs']):
                continue
            features.append({**f, 'archived': True})
        return features

    def assemble(self, branches, merged, prs):
        label_of = {key: pr['label'].split(':', 1)[-1] for key, pr in prs.items()}
        tracked = set(self.names)
        commits_by_pr = collections.defaultdict(list)
        for c in merged:
            for slug, n in c['closes']:
                commits_by_pr[f'{slug}#{n}'].append(c)
        # Credited: the people the branch is named after, the authors of its commits and its co-authors (Co-authored-by).
        # A commit also on a branch of its own author was only stacked here: it stays theirs, not this branch's.
        own_branches = collections.defaultdict(set)
        for name, repos in branches.items():
            for rec in repos.values():
                for c in rec.get('commits', []):
                    if self.owner_of(name) == c['email'].split('@')[0]:
                        own_branches[c['sha']].add(name)
        people, authored = collections.defaultdict(set), collections.defaultdict(collections.Counter)
        for name, repos in branches.items():
            for rec in repos.values():
                if rec.get('noisy'):
                    continue
                people[name].update(set(rec.get('coauthors', [])) & tracked)
                # The exercise base of someone else's onboarding is no work of its author's.
                if 'onboarding' in name and not self.owner_of(name):
                    continue
                for c in rec.get('commits', []):
                    author = c['email'].split('@')[0]
                    if c['email'].endswith('@odoo.com') and author in tracked and not c.get('merged') and not own_branches[c['sha']] - {name}:
                        authored[name][author] += 1
        # People found on other people's branches by `discover_contributed`: co-authors, or authors of a commit of its own.
        for name, repos in branches.items():
            for rec in repos.values():
                people[name].update(p for p in rec.get('contributors', []) if p in rec.get('coauthors', []) or authored[name][p])
        for key, cs in commits_by_pr.items():
            if lbl := label_of.get(key):
                people[lbl].update(c['owner'] for c in cs)
                authored[lbl].update(c['owner'] for c in cs if not c.get('coauthor'))
        for name, counter in authored.items():
            people[name].update(counter)
        names = set(branches) | set(self.runbot) | {lbl for lbl in label_of.values() if self.owner_of(lbl) or people.get(lbl)}
        prs_by_name = collections.defaultdict(dict)
        for key, lbl in label_of.items():
            prs_by_name[lbl][key] = prs[key]
        for name, bundle in self.runbot.items():
            for p in bundle['prs']:
                key = f'{p["repo"]}#{p["number"]}'
                prs_by_name[name].setdefault(key, prs.get(key) or {
                    'repo': p['repo'], 'number': p['number'], 'url': f'https://github.com/{p["repo"]}/pull/{p["number"]}',
                    'mergebot_url': f'https://mergebot.odoo.com/{p["repo"]}/pull/{p["number"]}',
                    'state': 'closed' if p['closed'] else 'open', 'title': '', 'tasks': [], 'opws': [], 'linked': [], 'ci': {},
                })
        attached = {key for name in names for key in prs_by_name.get(name, {})}
        orphans = collections.defaultdict(list)
        for key, cs in commits_by_pr.items():
            if key not in attached:
                orphans[f'{cs[0]["target"]}-{cs[0]["subject"]} ({key})'].extend(cs)

        def unique(records):
            # A commit co-authored by two tracked people has a row each; files must be counted once.
            return list({c['sha']: c for c in sorted(records, key=lambda c: not c.get('coauthor'))}.values())

        features = []
        for name in sorted(names):
            owner = self.owner_of(name)
            contributors = (people.get(name, set()) | self.names_in(name)) & tracked
            if not owner and not contributors:
                continue
            writers = authored.get(name) or collections.Counter()
            primary = owner or next((p for p, _n in writers.most_common()), None) or sorted(contributors)[0]
            feature_prs = prs_by_name.get(name, {})
            cs = unique(c for key in feature_prs for c in commits_by_pr.get(key, []))
            features.append(self.feature(
                name, primary, branches.get(name, {}), feature_prs, cs, self.runbot.get(name),
                contributors=sorted(contributors - {primary}), coauthored=not owner and primary not in writers,
            ))
        for name, records in orphans.items():
            authors = [c['owner'] for c in records if not c.get('coauthor')]
            primary = authors[0] if authors else records[0]['owner']
            features.append(self.feature(
                name, primary, {}, {}, unique(records), None, orphan=True,
                contributors=sorted({c['owner'] for c in records} - {primary}), coauthored=not authors,
            ))
        # The same change merged on several versions (a commit mergebot carried over, or a port by hand with the same title,
        # within 4 months) is one feature: the first one counts, the other versions are its ports.
        groups = collections.defaultdict(list)
        for f in features:
            if f['kind'] not in ('forward-port', 'onboarding') and f.get('merged_at') and f.get('title'):
                groups[(f['owner'], port_subject(f['title']))].append(f)
        for group in groups.values():
            group.sort(key=lambda f: f.get('first_at') or f['merged_at'])
            for f in group[1:]:
                if f['merged_at'] - group[0]['merged_at'] <= PORT_WINDOW:
                    f['kind'], f['port_of'] = 'forward-port', group[0]['name']
        return features

    def feature(self, name, owner, repos, prs, merged_commits, bundle, orphan=False, contributors=(), coauthored=False):
        clean = {r: v for r, v in repos.items() if not v.get('noisy')}
        files_by_repo = {r: v['files'] for r, v in clean.items()}
        for repo in {c['repo'] for c in merged_commits} - set(files_by_repo):
            agg = collections.defaultdict(lambda: [0, 0])
            for c in merged_commits:
                if c['repo'] == repo:
                    for path, a, d in c['files']:
                        agg[path][0] += a
                        agg[path][1] += d
            files_by_repo[repo] = [[p, a, d] for p, (a, d) in agg.items()]

        # Only the current head of a branch: the snapshots of its past pushes are never valued.
        mechanical = {r: self.mechanics(r, self.repos[r][0], v['files'], v['base'], v['head']) for r, v in clean.items()}
        for repo in set(files_by_repo) - set(clean):
            git = self.repos[repo][0]
            agg = collections.defaultdict(lambda: [0, 0])
            for c in merged_commits:
                if c['repo'] == repo:
                    for path, (a, d) in self.mechanics(repo, git, c['files'], c['sha']).items():
                        agg[path][0] += a
                        agg[path][1] += d
            mechanical[repo] = agg
        values = [substance(repo, files, mechanical.get(repo)) for repo, files in files_by_repo.items()]
        value = {
            'weighted': sum(v['weighted'] for v in values), 'mechanical': sum(v['mechanical'] for v in values),
            'profile': {k: sum(v['profile'][k] for v in values) for k in PROFILES},
        }
        totals = {'ins': 0, 'dels': 0, 'files': 0, 'test_lines': 0, 'i18n_lines': 0, 'migration_lines': 0}
        modules, langs, domains, countries = collections.Counter(), collections.Counter(), collections.Counter(), set()
        for repo, files in files_by_repo.items():
            for path, ins, dels in files:
                lang = lang_of(path)
                if lang == 'i18n':
                    totals['i18n_lines'] += ins + dels
                    continue
                totals['ins'] += ins
                totals['dels'] += dels
                totals['files'] += 1
                if '/tests/' in path or path.startswith('tests/'):
                    totals['test_lines'] += ins + dels
                if repo == 'upgrade' or '/migrations/' in path:
                    totals['migration_lines'] += ins + dels
                module = module_of(repo, path)
                modules[module] += ins + dels
                langs[lang] += ins + dels
                domains[domain_of(module)] += ins + dels
                if country := country_of(module):
                    countries.add(country)
        size = totals['ins'] + totals['dels']
        new_models = sum(r.get('new_models', 0) for r in clean.values())
        new_fields = sum(r.get('new_fields', 0) for r in clean.values())
        factors = {
            # Weighted lines: moves, renames and bulk data do not make a change complex.
            'size': 35 * min(1, math.log10(1 + value['weighted']) / math.log10(1 + 3000)),
            'files': 15 * min(1, math.log10(1 + totals['files']) / math.log10(1 + 60)),
            'modules': 15 * min(1, max(0, len(modules) - 1) / 5),
            # odoo and enterprise weigh the same: no bonus per repo; a migration script makes a change somewhat harder.
            'schema': min(10, new_models * 3 + new_fields * 0.5),
            'migration': 8 if totals['migration_lines'] else 0,
            'frontend': 5 if langs.get('js', 0) + langs.get('css', 0) else 0,
        }

        pushes = [{**p, 'repo': repo} for repo, r in repos.items() for p in r['pushes']]
        github_prs = []
        for pr in prs.values():
            gh = self.archive.get('github', f'{pr["repo"]}#{pr["number"]}')
            if gh and gh['state'] != 'MISSING':
                github_prs.append(gh)
                exact = {fp['after']: fp['at'] for fp in gh['force_pushes']}
                # The reflog only brackets a push between two fetches; GitHub knows when it happened.
                pushes = [{**p, 'at': exact[p['sha']]} if p['sha'] in exact else p for p in pushes]
                known = {p['sha'] for p in pushes}
                pushes.extend(
                    {'at': fp['at'], 'kind': fp['kind'], 'delta': 0, 'added_commits': 0, 'sha': fp['after'],
                     'repo': pr['repo'].split('/')[1], 'src': 'github'}
                    for fp in gh['force_pushes'] if fp['after'] not in known and fp['actor'] in (None, gh['author'])
                )
        latest_push = max([p['at'] for p in pushes] + [self.last_fetch], default=0)
        for batch in (bundle or {}).get('batches', []):
            # A runbot batch after the last fetch and every known push means commits git has not seen yet: keep a trace.
            if batch['at'] > latest_push + 1800:
                pushes.append({'at': batch['at'], 'kind': 'unknown', 'delta': 0, 'added_commits': 0, 'sha': f'runbot-{batch["id"]}', 'repo': 'runbot', 'src': 'runbot'})
        pushes.sort(key=lambda p: p['at'])
        received, review_delays = [], []
        for gh in github_prs:
            others = [rv for rv in gh['reviews'] if rv['login'] != gh['author'] and not re.search(r'bot|copilot|robodoo', rv['login'] or '', re.I)]
            received.extend({**rv, 'who': self.login_name(rv['login'])} for rv in others)
            if others:
                first = min(rv['at'] for rv in others)
                # A draft is not waiting for review: count from the last "ready for review" before the first review.
                start = max([t for t in gh.get('ready_at', []) if t <= first], default=gh['created_at'])
                review_delays.append(max(0, first - start))
        # One review per reviewer and verdict on the whole feature: the same approval on its odoo and enterprise PRs,
        # within 30 minutes, is one review.
        received.sort(key=lambda rv: rv['at'])
        last, unique_received = {}, []
        for rv in received:
            key = (rv['who'], rv['state'])
            if key not in last or rv['at'] - last[key] >= 1800:
                unique_received.append(rv)
            last[key] = rv['at']
        received = unique_received
        commits = [{**c, 'repo': repo} for repo, r in repos.items() for c in r['commits']]
        for c in merged_commits:
            if not any(x['subject'] == c['subject'] and x['repo'] == c['repo'] for x in commits):
                commits.append({'sha': c['sha'], 'author': c['owner'], 'email': f'{c["owner"]}@odoo.com',
                                'at': c['at'], 'ct': c['ct'], 'subject': c['subject'], 'repo': c['repo'], 'merged': True})
        commits.sort(key=lambda c: c['at'])
        tags = collections.Counter()
        for c in commits:
            m = re.match(r'\s*\[(\w+)\]', c['subject'])
            tags[m.group(1).upper() if m else 'OTHER'] += 1

        tasks, opws, reviewers = set(), set(), set()
        for r in repos.values():
            tasks.update(r['trailers']['tasks'])
            opws.update(r['trailers']['opws'])
        for c in merged_commits:
            tasks.update(c['tasks'])
            opws.update(c['opws'])
            reviewers.update(map(trigram_of, c['reviewers']))
        pr_list = []
        # In a stable order: the title of the feature is its first PR's, whatever order the PRs were read in.
        for pr in sorted(prs.values(), key=lambda p: (p['repo'], p['number'])):
            tasks.update(pr.get('tasks', []))
            opws.update(pr.get('opws', []))
            pr_list.append({k: pr.get(k) for k in (
                'repo', 'number', 'url', 'mergebot_url', 'state', 'phase', 'draft', 'blocked', 'missing_r', 'review',
                'title', 'merged_at', 'merged_by', 'ci', 'linked', 'desc_words', 'created_by',
            )})
            if pr.get('merged_by'):
                reviewers.add(trigram_of(pr['merged_by']))
        if orphan:
            pr_list = [{'repo': slug, 'number': int(n), 'url': f'https://github.com/{slug}/pull/{n}',
                        'mergebot_url': f'https://mergebot.odoo.com/{slug}/pull/{n}', 'state': 'merged',
                        'title': merged_commits[0]['subject'], 'merged_at': merged_commits[0]['ct']}
                       for slug, n in {tuple(x) for c in merged_commits for x in c['closes']}]
        states = {p['state'] for p in pr_list}
        status = next((s for s in ('merged', 'open', 'closed') if s in states), 'wip')
        merged_ts = [p['merged_at'] for p in pr_list if p.get('merged_at')]
        if not merged_ts and merged_commits:
            merged_ts = [min(c['ct'] for c in merged_commits)]
            status = 'merged'
        title = next((p['title'] for p in pr_list if p.get('title')), None) or next((c['subject'] for c in reversed(commits)), '')
        topics = collections.Counter()
        for repo, files in files_by_repo.items():
            for path, ins, dels in files:
                if lang_of(path) != 'i18n' and not path.endswith(('__init__.py', '__manifest__.py')):
                    if topic := topic_of(module_of(repo, path), path, title):
                        topics[topic] += ins + dels
        title_tag = re.match(r'\s*\[(\w+)\]', title)
        own_commits = [c for c in commits if c['email'].split('@')[0] == owner]
        opened = [gh['created_at'] for gh in github_prs]
        activity = [p['at'] for p in pushes] + [c['ct'] for c in own_commits] + [c['at'] for c in own_commits] + merged_ts + opened
        fw_of = self.fw_of(name)
        if fw_of or (merged_commits and all(c.get('fw') for c in merged_commits)):
            # Every merged commit carries X-original-commit: a port of a change merged on another version first.
            kind = 'forward-port'
        elif 'onboarding' in name or any('onboarding' in (v.get('base_ref') or '') for v in repos.values()):
            kind = 'onboarding'
        elif (title_tag.group(1).upper() == 'FIX') if title_tag else tags.get('FIX', 0) * 2 > sum(tags.values()):
            kind = 'fix'
        elif version_of(name) != 'master':
            kind = 'stable'
        else:
            kind = 'feature'
        on_remote = [r.get('on_remote') for r in repos.values()]
        return {
            'name': name, 'owner': owner, 'title': title, 'orphan': orphan,
            'contributors': list(contributors), 'coauthored': coauthored,
            'branch_author': next((c['author'] for c in merged_commits if c.get('author')), None) if orphan
            else re.split(r'[-_.]', re.sub(r'-\d+-fw$', '', name))[-1],
            'version': version_of(name), 'fw_of': fw_of, 'kind': kind,
            'noisy': any(v.get('noisy') for v in repos.values()), 'own_commits': len(own_commits),
            'repos': sorted(files_by_repo),
            'branches': {r: {'url': v['url'], 'head': v['head'], 'commit_count': v['commit_count'], 'base_ref': v.get('base_ref'),
                             'noisy': v.get('noisy', False),
                             'on_remote': v.get('on_remote'), 'ins': sum(f[1] for f in v['files']),
                             'dels': sum(f[2] for f in v['files']), 'files': len(v['files'])}
                         for r, v in repos.items()},
            'deleted': not repos or all(v is False for v in on_remote) or bool(
                bundle and bundle['branches'] and all(b['deleted'] for b in bundle['branches'])),
            'size': size, **totals, 'weighted': value['weighted'], 'mechanical': value['mechanical'], 'profile': value['profile'],
            'modules': dict(modules.most_common()), 'langs': dict(langs), 'domains': dict(domains.most_common()),
            'domain': domains.most_common(1)[0][0] if domains else 'Unknown', 'countries': sorted(countries),
            'topics': dict(topics.most_common(5)),
            'new_models': new_models, 'new_fields': new_fields, 'new_tests': sum(r.get('new_tests', 0) for r in clean.values()),
            'complexity': round(min(100, sum(factors.values()))),
            'complexity_factors': {k: round(v, 1) for k, v in factors.items()},
            'commit_count': len(commits), 'tags': dict(tags), 'commits': commits[-40:], 'pushes': pushes,
            'first_at': min(activity) if activity else None, 'last_at': max(activity) if activity else None,
            'merged_at': min(merged_ts) if merged_ts else None,
            'tasks': sorted(tasks), 'opws': sorted(opws), 'reviewers': sorted(reviewers),
            'prs': pr_list, 'status': status,
            'runbot': {'id': bundle['id'], 'url': bundle['url'], 'batches': bundle['batches']} if bundle else None,
            'gh': {
                'opened_at': min(opened), 'first_review_at': min((rv['at'] for rv in received), default=None),
                'first_review_delay': min(review_delays, default=None),
                'reviews_received': len(received),
                'reviewers': sorted({rv['who'] for rv in received if rv['who']}),
                'force_pushes': sum(len(gh['force_pushes']) for gh in github_prs), 'comments': sum(gh['comments'] for gh in github_prs),
                'received': sorted(received, key=lambda rv: rv['at']),
            } if github_prs else None,
        }

    def request(self, scope='all', only=None):
        self.status['state'] = 'running'
        self.requests.put({'scope': scope, 'only': only})

    def loop(self):
        while True:
            req = self.requests.get()
            failure = None
            try:
                self.build(**req)
            except Exception as e:  # noqa: BLE001
                log(f'collection failed: {e!r}')
                self.step('')
                failure = repr(e)
            self.status['last_error'] = failure
            if self.requests.empty():
                self.status.update(state='error' if failure else 'idle', last_run=time.time())


TODOS = HERE / 'todos.json'


def clean_todos(items):
    """The to-dos sent by the squad page, checked: a comment (several lines), done or not, and what it refers to: a feature,
    a PR or a journey, or a feature name alone."""
    if not isinstance(items, list) or len(items) > 1000:
        raise ValueError('a list of to-dos is expected')
    out = []
    for t in items:
        if not isinstance(t, dict) or not isinstance(t.get('id'), str) or not isinstance(t.get('text', ''), str):
            raise ValueError('invalid to-do')
        ref = t.get('ref')
        if ref is not None:
            if not isinstance(ref, dict) or ref.get('type') not in ('feature', 'pr', 'journey') or not isinstance(ref.get('key'), str) or not ref['key']:
                raise ValueError('invalid reference')
            ref = {k: ref[k][:500] for k in ('type', 'key', 'label', 'who', 'window') if isinstance(ref.get(k), str) and ref[k]} | (
                {'url': ref['url'][:500]} if isinstance(ref.get('url'), str) and ref['url'].startswith('https://') else {})
        text = t.get('text', '').strip()[:4000]
        if not text and not ref and not t.get('feature'):
            raise ValueError('invalid to-do')
        item = {'id': t['id'][:40], 'text': text, 'done': bool(t.get('done')), 'at': float(t.get('at') or time.time())}
        if t.get('done_at'):
            item['done_at'] = float(t['done_at'])
        if ref:
            item['ref'] = ref
        if isinstance(t.get('feature'), str) and t['feature']:
            item['feature'] = t['feature'][:500]
        out.append(item)
    return out


class AppVersion:
    """Where the clone of this app stands against its upstream branch: commits behind and ahead, local changes. Read with a
    git fetch at start, then every hour or when asked; updated only when asked, and only by a fast-forward, so that nothing
    local is ever lost. Needs a git clone with an upstream branch, and access to its remote."""

    def __init__(self):
        self.git = Git(HERE)
        self.lock = threading.Lock()
        self.state = {'checked': None}

    def check(self, fetch=True):
        with self.lock:
            state = {'checked': time.time(), 'clone': (HERE / '.git').exists(), 'version': APP_VERSION}
            if state['clone']:
                upstream = self.git.run('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}', check=False).strip()
                state.update(head=self.git.run('rev-parse', '--short', 'HEAD', check=False).strip(), upstream=upstream or None,
                             dirty=bool(self.git.run('status', '--porcelain', '--untracked-files=no', check=False).strip()))
                if upstream:
                    if fetch:
                        try:
                            self.git.run('fetch', '--quiet', upstream.split('/', 1)[0])
                        except RuntimeError as e:
                            state['error'] = last_line(e)
                    count = lambda revs: int(self.git.run('rev-list', '--count', revs, check=False).strip() or 0)
                    state.update(behind=count('HEAD..@{u}'), ahead=count('@{u}..HEAD'),
                                 changes=[line for line in self.git.run('log', '--format=%s', '-n', '8', 'HEAD..@{u}', check=False).splitlines() if line])
                    # The version on the branch followed, and what its changelog says of the versions newer than this one.
                    if state['behind']:
                        state['latest'] = read_version(self.git.run('show', '@{u}:VERSION', check=False))
                        state['notes'] = changelog_since(self.git.run('show', '@{u}:CHANGELOG.md', check=False), APP_VERSION)[:6]
            self.state = state
            return state

    def update(self):
        """Fast-forwards the clone to its upstream branch. Returns whether there was anything to take."""
        state = self.check()
        if not state.get('upstream'):
            raise RuntimeError('this folder is no git clone with an upstream branch: update it by hand')
        if state.get('error'):
            raise RuntimeError(f'the remote could not be read: {state["error"]}')
        if state.get('dirty') or state.get('ahead'):
            raise RuntimeError('this clone has local changes or commits: update it by hand (git pull)')
        if not state.get('behind'):
            return False
        with self.lock:
            self.git.run('merge', '--ff-only', '@{u}')
        self.check(fetch=False)
        return True

    def watch(self, every=3600):
        while True:
            try:
                self.check()
            except Exception as e:  # noqa: BLE001
                log(f'version check: {e}')
            time.sleep(every)


def changelog_since(text, version):
    """The entries of a changelog newer than a version, the newest first: [{'version': 'X.Y.Z', 'items': [...]}]."""
    key = lambda v: tuple(int(n) for n in v.split('.'))
    out, entry = [], None
    for line in (text or '').splitlines():
        if m := re.match(r'##\s+(\d+\.\d+\.\d+)', line):
            entry = {'version': m.group(1), 'items': []} if not version or key(m.group(1)) > key(version) else None
            if entry:
                out.append(entry)
        elif entry and re.match(r'\s*[-*]\s+', line):
            entry['items'].append(re.sub(r'^\s*[-*]\s+', '', line).strip())
    return out


def restart():
    """Runs the collector again in the same process, on the code just taken, once the answer has left."""
    time.sleep(0.5)
    log('restarting on the new version')
    os.execv(sys.executable, [sys.executable, *sys.argv])


def serve(collector, port, version):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(HERE), **kw)

        def log_message(self, *_a):
            pass

        def end_headers(self):
            # The page and its data change with every update: always revalidate instead of using a stale copy.
            self.send_header('Cache-Control', 'no-cache')
            super().end_headers()

        def send_json(self, payload, code=200):
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def read_json(self):
            try:
                return json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
            except ValueError:
                return {}

        def do_GET(self):
            if self.path.startswith('/api/data'):
                with collector.lock:
                    data = collector.data
                self.send_json(data if data is not None else {'pending': True})
            elif self.path.startswith('/api/logins'):
                self.send_json({'logins': collector.squad_logins()})
            elif self.path.startswith('/api/requests'):
                with collector.lock:
                    self.send_json({'review_requests': collector.data and collector.data.get('review_requests')})
            elif self.path.startswith('/api/todos'):
                try:
                    self.send_json({'todos': json.loads(TODOS.read_text())})
                except (OSError, ValueError):
                    self.send_json({'todos': []})
            elif self.path.startswith('/api/status'):
                self.send_json({
                    **collector.status, 'data_at': collector.data and collector.data['generated_at'],
                    'config': {'squad': collector.squad(), 'org': collector.org()}, 'me': collector.me, 'version': version.state,
                })
            elif self.path == '/' or self.path.startswith(('/?', '/#', '/index.html')):
                self.path = '/index.html'
                super().do_GET()
            elif self.path.startswith('/data.js'):
                self.path = '/data.js'
                super().do_GET()
            else:
                self.send_error(404)

        def do_POST(self):
            if self.path.startswith('/api/refresh'):
                if collector.status['state'] != 'running':
                    scope = re.search(r'scope=(\w+)', self.path)
                    collector.request(scope.group(1) if scope and scope.group(1) in ('git', 'ci', 'github', 'all', 'me') else 'all')
                self.send_json({'ok': True})
            elif self.path.startswith('/api/logins'):
                try:
                    logins = self.read_json().get('github_logins')
                    if not isinstance(logins, dict) or not all(
                            isinstance(k, str) and re.fullmatch(r'[a-z]{2,8}', k) and isinstance(v, str) and re.fullmatch(r'[A-Za-z0-9-]{0,39}', v.strip())
                            for k, v in logins.items()):
                        raise ValueError('github_logins: {trigram: GitHub login}')
                except ValueError as e:
                    self.send_json({'error': str(e)}, 400)
                    return
                with collector.lock:
                    collector.force_logins({k: v.strip() for k, v in logins.items()})
                self.send_json({'ok': True, 'logins': collector.squad_logins()})
            elif self.path.startswith('/api/version'):
                try:
                    if 'update' in self.path:
                        if collector.status['state'] == 'running':
                            raise RuntimeError('a collection is running: update once it is over')
                        updated = version.update()
                        self.send_json({'ok': True, 'restarting': updated, 'version': version.state})
                        if updated:
                            threading.Thread(target=restart, daemon=True).start()
                    else:
                        self.send_json({'ok': True, 'version': version.check()})
                except RuntimeError as e:
                    self.send_json({'error': str(e), 'version': version.state}, 400)
            elif self.path.startswith('/api/todos'):
                try:
                    todos = clean_todos(self.read_json().get('todos'))
                except (ValueError, TypeError) as e:
                    self.send_json({'error': str(e)}, 400)
                    return
                tmp = TODOS.with_suffix('.tmp')
                tmp.write_text(json.dumps(todos, indent=1, ensure_ascii=False))
                tmp.replace(TODOS)
                self.send_json({'ok': True, 'todos': todos})
            elif self.path.startswith('/api/squad'):
                body = self.read_json()
                lead = str(body.get('lead', '')).strip().lower()
                members = [str(m).strip().lower() for m in body.get('members') or [] if str(m).strip()]
                if not all(re.fullmatch(r'[a-z]{2,8}', n) for n in [lead, *members]) or not members:
                    self.send_json({'error': 'invalid trigrams (2 to 8 letters), at least one member'}, 400)
                    return
                with collector.lock:
                    new = collector.set_squad(lead, members)
                    if collector.data:
                        collector.data.update(squad=collector.squad(), org=collector.org(), names=collector.names)
                        collector.write_data()
                if new:
                    collector.request('all', only=new)
                self.send_json({'ok': True, 'config': {'squad': collector.squad(), 'org': collector.org()}, 'collecting': bool(new)})
            else:
                self.send_error(404)

    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
    log(f'squad page on http://127.0.0.1:{port}/')
    server.serve_forever()


def import_history(collector, path):
    """Takes over a history.json of the same format, for the people of the squad only: the pushes the reflogs have since
    forgotten, the branches since deleted, the reviews and the PRs already read. What is already here is kept."""
    other = json.loads(Path(path).read_text())
    squad = set(collector.names)
    owned = lambda key: collector.owner_of(key.split(':', 1)[-1], squad) is not None
    keep = {
        'branches': lambda k, v: owned(k) or bool(set(v.get('contributors') or ()) & squad),
        'features': lambda k, f: bool({f.get('owner'), *(f.get('contributors') or ())} & squad),
        'reviews': lambda k, r: r.get('reviewer') in squad,
        'gh_reviews': lambda k, r: r.get('reviewer') in squad,
        'github_search': lambda k, v: k in squad,
        'contributed': lambda k, people: bool(set(people) & squad),
    }
    store, counts = collector.archive, {}
    for section, wanted in keep.items():
        mine = store.section(section)
        taken = {k: v for k, v in (other.get(section) or {}).items() if wanted(k, v)}
        for key, value in taken.items():
            if section == 'branches' and key in mine:
                # Both saw the branch: the pushes of each, once.
                seen = {(p['sha'], p['at']) for p in mine[key].get('pushes', [])}
                extra = [p for p in value.get('pushes', []) if (p['sha'], p['at']) not in seen]
                mine[key]['pushes'] = sorted(mine[key].get('pushes', []) + extra, key=lambda p: p['at'])
            else:
                mine.setdefault(key, value)
        counts[section] = len(taken)
    # The PRs of those features and reviews, as GitHub and the r+ comments told them.
    prs = {f'{p["repo"]}#{p["number"]}' for f in store.section('features').values() for p in f.get('prs', [])}
    prs |= {r['pr'] for section in ('reviews', 'gh_reviews') for r in store.section(section).values()}
    for section in ('github', 'rplus'):
        mine = store.section(section)
        taken = {k: v for k, v in (other.get(section) or {}).items() if k in prs}
        for key, value in taken.items():
            mine.setdefault(key, value)
        counts[section] = len(taken)
    for member, login in (other.get('team_logins') or {}).items():
        if member in squad and login:
            store.section('team_logins').setdefault(member, login)
    store.save()
    log('imported: ' + ', '.join(f'{n} {section}' for section, n in counts.items()))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', default=str(HERE.parent), help='folder holding the odoo, enterprise and upgrade clones')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--since-days', type=int, default=730, help='depth read in git for the merges and the reviews of the squad')
    parser.add_argument('--fetch', action='store_true', help='also git fetch on a git-only update')
    parser.add_argument('--no-fetch', action='store_true', help='never git fetch (rely on the fetches of the IDE)')
    parser.add_argument('--github-budget', type=int, default=40, help='GraphQL calls at most per collection (20 PRs per call)')
    parser.add_argument('--github-rplus-budget', type=int, default=25,
                        help='GraphQL calls at most per collection to date the r+ (the `robodoo r+` comments, 20 PRs per call), resumed at the next update')
    parser.add_argument('--no-github', action='store_true', help='do not read GitHub')
    parser.add_argument('--once', action='store_true', help='collect once, then quit')
    parser.add_argument('--import-history', metavar='FILE',
                        help='take over a history.json of the same format for the people of the squad (set the squad up first), then quit')
    args = parser.parse_args()
    collector = Collector(args)
    if args.import_history:
        if not collector.squad():
            raise SystemExit('No squad yet: open the page to set it up (or fill lead and members in config.json), then import.')
        import_history(collector, args.import_history)
        return
    if args.once:
        collector.build()
        return
    try:
        collector.data = json.loads((HERE / 'data.json').read_text())
    except (OSError, ValueError):
        pass
    threading.Thread(target=collector.loop, daemon=True).start()
    version = AppVersion()
    threading.Thread(target=version.watch, daemon=True).start()
    serve(collector, args.port, version)


if __name__ == '__main__':
    main()
