import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// `repo` names a clone (odoo, enterprise, upgrade) in the git_ tables, and a GitHub repository (odoo/odoo) everywhere else.
const instant = (name: string) => timestamp(name, { withTimezone: true });

export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
});

// Every section of the V1 archive as it was, so that nothing it kept is lost whatever the typed tables leave out.
export const v1Archive = pgTable(
  'v1_archive',
  {
    file: text('file').notNull(),
    section: text('section').notNull(),
    key: text('key').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.file, t.section, t.key] })],
);

export const gitBranch = pgTable(
  'git_branch',
  {
    repo: text('repo').notNull(),
    name: text('name').notNull(),
    head: text('head').notNull(),
    owner: text('owner'),
    url: text('url'),
    onRemote: boolean('on_remote'),
    contributors: text('contributors').array().notNull().default([]),
    base: text('base'),
    baseRef: text('base_ref'),
    commitCount: integer('commit_count'),
    noisy: boolean('noisy'),
    patchId: text('patch_id'),
    commits: jsonb('commits'),
    files: jsonb('files'),
    trailers: jsonb('trailers'),
    coauthors: text('coauthors').array(),
    newModels: integer('new_models'),
    newFields: integer('new_fields'),
    newTests: integer('new_tests'),
  },
  (t) => [primaryKey({ columns: [t.repo, t.name] })],
);

// A branch as it stood at a head, by head: a branch that did not move, or a push already classified, is not read again.
export const gitSnapshot = pgTable(
  'git_snapshot',
  {
    repo: text('repo').notNull(),
    head: text('head').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.head] })],
);

// What each reflog entry did to its branch, classified once with the refs of its time.
export const gitTransition = pgTable(
  'git_transition',
  {
    repo: text('repo').notNull(),
    old: text('old').notNull(),
    next: text('next').notNull(),
    loggedAt: instant('logged_at').notNull(),
    kind: text('kind').notNull(),
    delta: integer('delta').notNull(),
    addedCommits: integer('added_commits').notNull(),
    at: instant('at').notNull(),
    sha: text('sha').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.old, t.next, t.loggedAt] })],
);

// The branches of others where a member wrote or co-wrote a commit not merged yet.
export const gitContribution = pgTable(
  'git_contribution',
  {
    repo: text('repo').notNull(),
    branch: text('branch').notNull(),
    people: text('people').array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.branch] })],
);

// The commits of the version branches a member wrote, co-wrote or signed off: filtering git's whole history takes 8 s a clone.
export const gitCommit = pgTable(
  'git_commit',
  {
    repo: text('repo').notNull(),
    sha: text('sha').notNull(),
    authorName: text('author_name').notNull(),
    authorEmail: text('author_email').notNull(),
    at: instant('at').notNull(),
    ct: instant('ct').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    files: jsonb('files').notNull(),
    rootAuthor: text('root_author'),
    // git log's order, newest first: commits of one merge share their date, and the V1 kept the first of a PR's r+.
    ordinal: integer('ordinal').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.sha] })],
);

// Moved and renamed lines of a commit (`revs` = its sha) or of a branch (`base:head`), shas cut to 12 characters.
export const gitMechanical = pgTable(
  'git_mechanical',
  {
    repo: text('repo').notNull(),
    revs: text('revs').notNull(),
    lines: jsonb('lines').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.revs] })],
);

export const gitPush = pgTable(
  'git_push',
  {
    repo: text('repo').notNull(),
    branch: text('branch').notNull(),
    sha: text('sha').notNull(),
    at: instant('at').notNull(),
    kind: text('kind').notNull(),
    delta: integer('delta').notNull(),
    addedCommits: integer('added_commits').notNull(),
    source: text('source').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.branch, t.sha, t.at] })],
);

export const githubPr = pgTable(
  'github_pr',
  {
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    title: text('title'),
    authorLogin: text('author_login'),
    headRef: text('head_ref'),
    headOwner: text('head_owner'),
    state: text('state'),
    mergedAt: instant('merged_at'),
    // What the description names, as mergebot read it from the page: the PRs mergebot is not asked about get them here.
    tasks: text('tasks').array(),
    opws: text('opws').array(),
    descWords: integer('desc_words'),
    draft: boolean('draft'),
    createdAt: instant('created_at'),
    closedAt: instant('closed_at'),
    additions: integer('additions'),
    deletions: integer('deletions'),
    changedFiles: integer('changed_files'),
    comments: integer('comments'),
    readyAt: instant('ready_at').array(),
    fetchedAt: instant('fetched_at'),
  },
  (t) => [primaryKey({ columns: [t.repo, t.number] })],
);

export const githubReview = pgTable(
  'github_review',
  {
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    login: text('login').notNull(),
    submittedAt: instant('submitted_at').notNull(),
    state: text('state').notNull(),
    // Read with its PR, or found by searching the reviewer's reviews, or both: the PR's reviews are the first, the
    // reviewer's review work the second.
    detailed: boolean('detailed').notNull().default(false),
    searched: boolean('searched').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.repo, t.number, t.login, t.submittedAt, t.state] })],
);

export const githubForcePush = pgTable(
  'github_force_push',
  {
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    after: text('after').notNull(),
    at: instant('at').notNull(),
    before: text('before'),
    actor: text('actor'),
    kind: text('kind').notNull(),
    delta: integer('delta').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.number, t.after, t.at] })],
);

// The `robodoo r+` comments of merged PRs: who gave the r+ and when, the merge coming later on its own.
export const githubRplus = pgTable(
  'github_rplus',
  {
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    login: text('login').notNull(),
    at: instant('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.number, t.login, t.at] })],
);

export const githubRplusScan = pgTable(
  'github_rplus_scan',
  {
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    scannedAt: instant('scanned_at').notNull(),
    missing: boolean('missing').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.repo, t.number] })],
);

export const personLogin = pgTable('person_login', {
  member: text('member').primaryKey(),
  login: text('login').notNull(),
  source: text('source').notNull(),
});

export const mergebotPr = pgTable(
  'mergebot_pr',
  {
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    state: text('state').notNull(),
    phase: text('phase'),
    draft: boolean('draft'),
    blocked: boolean('blocked'),
    missingR: boolean('missing_r'),
    review: text('review'),
    title: text('title'),
    createdBy: text('created_by'),
    label: text('label'),
    mergedAt: instant('merged_at'),
    mergedBy: text('merged_by'),
    ci: jsonb('ci'),
    linked: jsonb('linked'),
    descWords: integer('desc_words'),
    tasks: text('tasks').array(),
    opws: text('opws').array(),
    fetchedAt: instant('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.number] })],
);

export const runbotBundle = pgTable('runbot_bundle', {
  name: text('name').primaryKey(),
  bundleId: integer('bundle_id').notNull(),
  url: text('url').notNull(),
  branches: jsonb('branches').notNull(),
  prs: jsonb('prs').notNull(),
  batches: jsonb('batches').notNull(),
  fetchedAt: instant('fetched_at'),
});

// The squad's Odoo tasks as last read, and every change of stage or state seen, which Odoo does not keep; a task known only
// from the squad dashboard's history has no data until Odoo is read.
export const odooTask = pgTable('odoo_task', {
  id: integer('id').primaryKey(),
  data: jsonb('data'),
  changes: jsonb('changes').notNull(),
  fetchedAt: instant('fetched_at').notNull(),
});

// What the sources forget and the dashboard keeps: features whose branches are gone, r+ out of the window of git reads.
export const archiveEntry = pgTable(
  'archive_entry',
  {
    section: text('section').notNull(),
    key: text('key').notNull(),
    data: jsonb('data').notNull(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.section, t.key] })],
);

// The dashboard as last computed from the facts above, replaced whole in one transaction: a page never reads half of it.
export const dashboardFeature = pgTable('dashboard_feature', {
  name: text('name').primaryKey(),
  owner: text('owner'),
  archived: boolean('archived').notNull(),
  data: jsonb('data').notNull(),
});

export const dashboardReview = pgTable('dashboard_review', {
  id: text('id').primaryKey(),
  reviewer: text('reviewer').notNull(),
  at: instant('at').notNull(),
  data: jsonb('data').notNull(),
});

// The rest of the dashboard, by part: review requests, logins, the first day of the history.
export const dashboardPart = pgTable('dashboard_part', {
  part: text('part').primaryKey(),
  data: jsonb('data'),
  computedAt: instant('computed_at').notNull(),
});

// Where each source's last collection stopped: the git heads read, GitHub's updatedAt, Odoo's write_date.
export const syncCursor = pgTable(
  'sync_cursor',
  {
    source: text('source').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.source, t.key] })],
);
