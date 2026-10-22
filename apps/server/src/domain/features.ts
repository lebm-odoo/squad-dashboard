import { trigram } from '@sd/shared';
import { forwardPortOf, namesIn, ownerOf, versionOf } from './branches';
import { countryOf, domainOf, langOf, moduleOf, type RuleFiles, topicOf } from './classify';
import { portSubject, trigramOf } from './messages';
import { mostCommon, re, round, roundTenths } from './py';
import { type FileStat, type Mechanical, type Profile, profiles, substance, type WeightPart } from './weight';

export type Push = { at: number; kind: string; delta: number; added_commits: number; sha: string; repo?: string; src?: string };
export type BranchCommit = { sha: string; author: string; email: string; at: number; ct: number; subject: string; merged?: boolean };
export type BranchRecord = {
  head: string;
  url: string;
  owner?: string | null;
  contributors?: string[];
  on_remote?: boolean | null;
  pushes: Push[];
  base: string;
  base_ref?: string | null;
  commit_count: number;
  noisy?: boolean;
  commits: BranchCommit[];
  files: FileStat[];
  trailers: { tasks: string[]; opws: string[] };
  coauthors?: string[];
  new_models?: number;
  new_fields?: number;
  new_tests?: number;
};
/** A commit merged on a version branch, one row per tracked person who wrote or co-wrote it. */
export type MergedCommit = {
  id: string;
  repo: string;
  sha: string;
  owner: string;
  author: string;
  coauthor: boolean;
  at: number;
  ct: number;
  target: string;
  subject: string;
  fw: boolean;
  files: FileStat[];
  tasks: string[];
  opws: string[];
  closes: [string, string][];
  reviewers: string[];
};
export type MergebotPr = {
  repo: string;
  number: number;
  url?: string;
  mergebot_url?: string;
  state: string;
  phase?: string;
  draft?: boolean;
  blocked?: boolean;
  missing_r?: boolean;
  review?: string | null;
  title?: string;
  merged_at?: number | null;
  merged_by?: string | null;
  created_by?: string;
  ci?: Record<string, string>;
  linked?: unknown[];
  desc_words?: number;
  label?: string;
  tasks?: string[];
  opws?: string[];
};
export type RunbotBundle = {
  id: number;
  url: string;
  branches: { repo: string; deleted: boolean }[];
  prs: { repo: string; number: number; closed: boolean }[];
  batches: { id: number; at: number }[];
};
export type GithubReview = { login: string | null; state: string; at: number };
export type GithubPr = {
  state: string;
  author: string | null;
  created_at: number;
  reviews: GithubReview[];
  comments: number;
  force_pushes: { at: number; actor: string | null; after: string; kind: string }[];
  ready_at?: number[];
};

/** Everything the features are made of: the sources as read, and how they are read. */
export type FeatureSources = {
  /** The people whose features are assembled: me, my squad, and the authors of the work of others I touch. */
  names: ReadonlySet<string>;
  branches: Record<string, Record<string, BranchRecord>>;
  merged: MergedCommit[];
  prs: Record<string, MergebotPr>;
  runbot: Record<string, RunbotBundle>;
  github: Record<string, GithubPr>;
  /** GitHub login, lowercased, to trigram. */
  loginNames: Record<string, string>;
  /** When the clones were last fetched: a runbot batch after it, and after every push known, is a push not seen yet. */
  lastFetch: number;
  ruleFiles: RuleFiles;
  mechanics: (repo: string, files: FileStat[], revs: string[]) => Mechanical;
};

type PrRow = Record<string, unknown> & { repo: string; number: number; state: string; title?: string; merged_at?: number | null };
type Received = GithubReview & { who: string | null };
export type Feature = ReturnType<typeof feature> & { archived?: boolean; port_of?: string };

const counted = (counter: Map<string, number>, key: string, n = 1) => counter.set(key, (counter.get(key) ?? 0) + n);

/** The version of a branch's name, unless its PR was retargeted since to another stable version. */
function featureVersion(name: string, prs: { repo: string; number: number; linked?: unknown }[]) {
  const target = prs
    .map(
      (pr) =>
        (pr.linked as { repo: string; number: number; branch: string }[] | null | undefined)?.find(
          (link) => link.repo === pr.repo && link.number === pr.number,
        )?.branch,
    )
    .find((branch) => /^(?:saas-)?\d+\.\d+$/.test(branch ?? ''));
  return (versionOf(name) !== 'master' && target) || versionOf(name);
}

/** The member behind a GitHub login: the known logins, else the trigram of a `<trigram>-odoo` login. */
export function loginName(sources: Pick<FeatureSources, 'loginNames'>, login: string | null) {
  const key = (login ?? '').toLowerCase();
  if (Object.hasOwn(sources.loginNames, key)) return sources.loginNames[key] as string;
  const bare = key.replace(/-odoo$/, '');
  return bare !== key && trigram.safeParse(bare).success ? bare : login;
}

export function feature(
  sources: FeatureSources,
  name: string,
  owner: string,
  repos: Record<string, BranchRecord>,
  prs: Record<string, MergebotPr | PrRow>,
  mergedCommits: MergedCommit[],
  bundle: RunbotBundle | undefined,
  { orphan = false, contributors = [] as string[], coauthored = false } = {},
) {
  const clean = Object.fromEntries(Object.entries(repos).filter(([, record]) => !record.noisy));
  const filesByRepo = new Map(Object.entries(clean).map(([repo, record]) => [repo, record.files]));
  // Sorted: the V1 took them from a Python set, so its ties (the fifth topic, the main domain) varied from run to run.
  const mergedRepos = [...new Set(mergedCommits.map((commit) => commit.repo))].filter((repo) => !filesByRepo.has(repo)).sort();
  const summed = (repo: string, files: (commit: MergedCommit) => [string, [number, number]][]) => {
    const totals = new Map<string, [number, number]>();
    for (const commit of mergedCommits.filter((c) => c.repo === repo)) {
      for (const [path, [ins, dels]] of files(commit)) {
        const slot = totals.get(path) ?? (totals.set(path, [0, 0]).get(path) as [number, number]);
        slot[0] += ins;
        slot[1] += dels;
      }
    }
    return totals;
  };
  for (const repo of mergedRepos) {
    const totals = summed(repo, (commit) => commit.files.map(([path, ins, dels]) => [path, [ins, dels]]));
    filesByRepo.set(
      repo,
      [...totals].map(([path, [ins, dels]]) => [path, ins, dels]),
    );
  }

  // Only the current head of a branch: the snapshots of its past pushes are never valued.
  const mechanical = new Map<string, Mechanical>(
    Object.entries(clean).map(([repo, record]) => [repo, sources.mechanics(repo, record.files, [record.base, record.head])]),
  );
  for (const repo of mergedRepos) {
    const totals = summed(repo, (commit) => Object.entries(sources.mechanics(repo, commit.files, [commit.sha])));
    mechanical.set(repo, Object.fromEntries(totals));
  }
  const values = [...filesByRepo].map(([repo, files]) => substance(repo, files, mechanical.get(repo) ?? null, sources.ruleFiles));
  const value = {
    weighted: values.reduce((total, v) => total + v.weighted, 0),
    mechanical: values.reduce((total, v) => total + v.mechanical, 0),
    profile: Object.fromEntries(profiles.map((key) => [key, values.reduce((total, v) => total + v.profile[key], 0)])) as Record<
      Profile,
      number
    >,
  };
  const parts: Record<string, WeightPart> = {};
  for (const [kind, part] of values.flatMap((v) => Object.entries(v.parts))) {
    const total = parts[kind] ?? { ins: 0, dels: 0, mechanical: 0, weight: part.weight, weighted: 0 };
    parts[kind] = total;
    total.ins += part.ins;
    total.dels += part.dels;
    total.mechanical += part.mechanical;
    total.weighted += part.weighted;
  }
  for (const part of Object.values(parts)) part.weighted = roundTenths(part.weighted);

  const totals = { ins: 0, dels: 0, files: 0, test_lines: 0, i18n_lines: 0, migration_lines: 0 };
  const [modules, langs, domains, countries] = [
    new Map<string, number>(),
    new Map<string, number>(),
    new Map<string, number>(),
    new Set<string>(),
  ];
  for (const [repo, files] of filesByRepo) {
    for (const [path, ins, dels] of files) {
      const lang = langOf(path);
      if (lang === 'i18n') {
        totals.i18n_lines += ins + dels;
        continue;
      }
      totals.ins += ins;
      totals.dels += dels;
      totals.files += 1;
      if (path.includes('/tests/') || path.startsWith('tests/')) totals.test_lines += ins + dels;
      if (repo === 'upgrade' || path.includes('/migrations/')) totals.migration_lines += ins + dels;
      const module = moduleOf(repo, path);
      counted(modules, module, ins + dels);
      counted(langs, lang, ins + dels);
      counted(domains, domainOf(module), ins + dels);
      const country = countryOf(module);
      if (country) countries.add(country);
    }
  }
  const newModels = Object.values(clean).reduce((total, record) => total + (record.new_models ?? 0), 0);
  const newFields = Object.values(clean).reduce((total, record) => total + (record.new_fields ?? 0), 0);
  // Weighted lines: moves, renames and bulk data do not make a change complex. odoo and enterprise weigh the same; a migration
  // script makes a change somewhat harder.
  const factors = {
    taille: 35 * Math.min(1, Math.log10(1 + value.weighted) / Math.log10(1 + 3000)),
    fichiers: 15 * Math.min(1, Math.log10(1 + totals.files) / Math.log10(1 + 60)),
    modules: 15 * Math.min(1, Math.max(0, modules.size - 1) / 5),
    schéma: Math.min(10, newModels * 3 + newFields * 0.5),
    migration: totals.migration_lines ? 8 : 0,
    frontend: (langs.get('js') ?? 0) + (langs.get('css') ?? 0) ? 5 : 0,
  };

  let pushes: Push[] = Object.entries(repos).flatMap(([repo, record]) => record.pushes.map((push) => ({ ...push, repo })));
  const githubPrs: GithubPr[] = [];
  for (const pr of Object.values(prs)) {
    const gh = sources.github[`${pr.repo}#${pr.number}`];
    if (!gh || gh.state === 'MISSING') continue;
    githubPrs.push(gh);
    // The reflog only brackets a push between two fetches; GitHub knows when it happened.
    const exact = new Map(gh.force_pushes.map((push) => [push.after, push.at]));
    pushes = pushes.map((push) => (exact.has(push.sha) ? { ...push, at: exact.get(push.sha) as number } : push));
    const known = new Set(pushes.map((push) => push.sha));
    pushes.push(
      ...gh.force_pushes
        .filter((push) => !known.has(push.after) && (push.actor === null || push.actor === gh.author))
        .map((push) => ({
          at: push.at,
          kind: push.kind,
          delta: 0,
          added_commits: 0,
          sha: push.after,
          repo: pr.repo.split('/')[1] as string,
          src: 'github',
        })),
    );
  }
  const latestPush = Math.max(...pushes.map((push) => push.at), sources.lastFetch);
  for (const batch of bundle?.batches ?? []) {
    // A runbot batch after the last fetch and every known push means commits git has not seen yet: keep a trace.
    if (batch.at > latestPush + 1800) {
      pushes.push({ at: batch.at, kind: 'unknown', delta: 0, added_commits: 0, sha: `runbot-${batch.id}`, repo: 'runbot', src: 'runbot' });
    }
  }
  pushes.sort((a, b) => a.at - b.at);

  let received: Received[] = [];
  const reviewDelays: number[] = [];
  for (const gh of githubPrs) {
    const others = gh.reviews.filter((review) => review.login !== gh.author && !/bot|copilot|robodoo/i.test(review.login ?? ''));
    received.push(...others.map((review) => ({ ...review, who: loginName(sources, review.login) })));
    if (others.length) {
      const first = Math.min(...others.map((review) => review.at));
      // A draft is not waiting for review: count from the last "ready for review" before the first review.
      const ready = (gh.ready_at ?? []).filter((at) => at <= first);
      reviewDelays.push(Math.max(0, first - (ready.length ? Math.max(...ready) : gh.created_at)));
    }
  }
  // One review per reviewer and verdict on the whole feature: the same approval on its odoo and enterprise PRs, within 30
  // minutes, is one review.
  received.sort((a, b) => a.at - b.at);
  const last = new Map<string, number>();
  received = received.filter((review) => {
    const key = `${review.who}\u0000${review.state}`;
    const kept = !last.has(key) || review.at - (last.get(key) as number) >= 1800;
    last.set(key, review.at);
    return kept;
  });

  const commits: (BranchCommit & { repo: string })[] = Object.entries(repos).flatMap(([repo, record]) =>
    record.commits.map((commit) => ({ ...commit, repo })),
  );
  for (const commit of mergedCommits) {
    if (!commits.some((other) => other.subject === commit.subject && other.repo === commit.repo)) {
      commits.push({
        sha: commit.sha,
        author: commit.owner,
        email: `${commit.owner}@odoo.com`,
        at: commit.at,
        ct: commit.ct,
        subject: commit.subject,
        repo: commit.repo,
        merged: true,
      });
    }
  }
  commits.sort((a, b) => a.at - b.at);
  const tagPattern = new RegExp(`^${re.space}*\\[(${re.word}+)\\]`, 'u');
  const tags = new Map<string, number>();
  for (const commit of commits) counted(tags, tagPattern.exec(commit.subject)?.[1]?.toUpperCase() ?? 'AUTRE');

  const [tasks, opws, reviewers] = [new Set<string>(), new Set<string>(), new Set<string>()];
  for (const record of Object.values(repos)) {
    for (const task of record.trailers.tasks) tasks.add(task);
    for (const opw of record.trailers.opws) opws.add(opw);
  }
  for (const commit of mergedCommits) {
    for (const task of commit.tasks) tasks.add(task);
    for (const opw of commit.opws) opws.add(opw);
    for (const reviewer of commit.reviewers) reviewers.add(trigramOf(reviewer));
  }
  const fields = [
    'repo',
    'number',
    'url',
    'mergebot_url',
    'state',
    'phase',
    'draft',
    'blocked',
    'missing_r',
    'review',
    'title',
    'merged_at',
  ] as const;
  let prList: PrRow[] = [];
  // In a stable order: the title of the feature is its first PR's, whatever order the PRs were read in.
  for (const pr of Object.values(prs).sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.number - b.number))) {
    for (const task of (pr.tasks as string[] | undefined) ?? []) tasks.add(task);
    for (const opw of (pr.opws as string[] | undefined) ?? []) opws.add(opw);
    const row = Object.fromEntries(
      [...fields, 'merged_by', 'ci', 'linked', 'desc_words', 'created_by'].map((key) => [
        key,
        (pr as Record<string, unknown>)[key] ?? null,
      ]),
    );
    prList.push(row as PrRow);
    if (pr.merged_by) reviewers.add(trigramOf(pr.merged_by as string));
  }
  if (orphan) {
    const closes = [...new Set(mergedCommits.flatMap((commit) => commit.closes.map(([slug, number]) => `${slug}#${number}`)))];
    const [firstCommit] = mergedCommits as [MergedCommit];
    prList = closes.map((key) => {
      const [slug, number] = key.split('#') as [string, string];
      return {
        repo: slug,
        number: Number(number),
        url: `https://github.com/${slug}/pull/${number}`,
        mergebot_url: `https://mergebot.odoo.com/${slug}/pull/${number}`,
        state: 'merged',
        title: firstCommit.subject,
        merged_at: firstCommit.ct,
      };
    });
  }
  const states = new Set(prList.map((pr) => pr.state));
  let status = (['merged', 'open', 'closed'] as const).find((state) => states.has(state)) ?? 'wip';
  let mergedTimes = prList.flatMap((pr) => (pr.merged_at ? [pr.merged_at] : []));
  if (!mergedTimes.length && mergedCommits.length) {
    mergedTimes = [Math.min(...mergedCommits.map((commit) => commit.ct))];
    status = 'merged';
  }
  const title = prList.find((pr) => pr.title)?.title || ([...commits].reverse()[0]?.subject ?? '');
  const topics = new Map<string, number>();
  for (const [repo, files] of filesByRepo) {
    for (const [path, ins, dels] of files) {
      if (langOf(path) === 'i18n' || path.endsWith('__init__.py') || path.endsWith('__manifest__.py')) continue;
      const topic = topicOf(moduleOf(repo, path), path, title);
      if (topic) counted(topics, topic, ins + dels);
    }
  }
  const titleTag = tagPattern.exec(title)?.[1];
  const ownCommits = commits.filter((commit) => commit.email.split('@')[0] === owner);
  const opened = githubPrs.map((gh) => gh.created_at);
  const activity = [
    ...pushes.map((push) => push.at),
    ...ownCommits.map((commit) => commit.ct),
    ...ownCommits.map((commit) => commit.at),
    ...mergedTimes,
    ...opened,
  ];
  const fwOf = forwardPortOf(name);
  const version = featureVersion(name, prList);
  const tagTotal = [...tags.values()].reduce((total, n) => total + n, 0);
  let kind: string;
  if (fwOf || (mergedCommits.length && mergedCommits.every((commit) => commit.fw))) kind = 'forward-port';
  else if (name.includes('onboarding') || Object.values(repos).some((record) => (record.base_ref ?? '').includes('onboarding')))
    kind = 'onboarding';
  else if (titleTag ? titleTag.toUpperCase() === 'FIX' : (tags.get('FIX') ?? 0) * 2 > tagTotal) kind = 'fix';
  else if (version !== 'master') kind = 'stable';
  else kind = 'feature';
  const onRemote = Object.values(repos).map((record) => record.on_remote);
  const sum = (items: number[]) => items.reduce((total, n) => total + n, 0);

  return {
    name,
    owner,
    title,
    orphan,
    contributors: [...contributors],
    coauthored,
    branch_author: orphan
      ? (mergedCommits.find((commit) => commit.author)?.author ?? null)
      : (name
          .replace(/-\d+-fw$/, '')
          .split(/[-_.]/)
          .at(-1) as string),
    version,
    fw_of: fwOf,
    kind,
    noisy: Object.values(repos).some((record) => record.noisy),
    own_commits: ownCommits.length,
    repos: [...filesByRepo.keys()].sort(),
    branches: Object.fromEntries(
      Object.entries(repos).map(([repo, record]) => [
        repo,
        {
          url: record.url,
          head: record.head,
          commit_count: record.commit_count,
          base_ref: record.base_ref ?? null,
          noisy: record.noisy ?? false,
          on_remote: record.on_remote ?? null,
          ins: sum(record.files.map((file) => file[1])),
          dels: sum(record.files.map((file) => file[2])),
          files: record.files.length,
        },
      ]),
    ),
    deleted:
      !Object.keys(repos).length ||
      onRemote.every((value) => value === false) ||
      Boolean(bundle?.branches.length && bundle.branches.every((branch) => branch.deleted)),
    size: totals.ins + totals.dels,
    ...totals,
    weighted: value.weighted,
    mechanical: value.mechanical,
    profile: value.profile,
    weight_parts: parts,
    modules: Object.fromEntries(mostCommon(modules)),
    langs: Object.fromEntries(langs),
    domains: Object.fromEntries(mostCommon(domains)),
    domain: mostCommon(domains)[0]?.[0] ?? 'Unknown',
    countries: [...countries].sort(),
    topics: Object.fromEntries(mostCommon(topics).slice(0, 5)),
    new_models: newModels,
    new_fields: newFields,
    new_tests: Object.values(clean).reduce((total, record) => total + (record.new_tests ?? 0), 0),
    complexity: round(
      Math.min(
        100,
        Object.values(factors).reduce((total, n) => total + n, 0),
      ),
    ),
    complexity_factors: Object.fromEntries(Object.entries(factors).map(([key, n]) => [key, roundTenths(n)])),
    commit_count: commits.length,
    tags: Object.fromEntries(tags),
    commits: commits.slice(-40),
    pushes,
    first_at: activity.length ? Math.min(...activity) : null,
    last_at: activity.length ? Math.max(...activity) : null,
    merged_at: mergedTimes.length ? Math.min(...mergedTimes) : null,
    tasks: [...tasks].sort(),
    opws: [...opws].sort(),
    reviewers: [...reviewers].sort(),
    prs: prList,
    status,
    runbot: bundle ? { id: bundle.id, url: bundle.url, batches: bundle.batches } : null,
    gh: githubPrs.length
      ? {
          opened_at: Math.min(...opened),
          first_review_at: received.length ? Math.min(...received.map((review) => review.at)) : null,
          first_review_delay: reviewDelays.length ? Math.min(...reviewDelays) : null,
          reviews_received: received.length,
          reviewers: [...new Set(received.flatMap((review) => (review.who ? [review.who] : [])))].sort(),
          force_pushes: sum(githubPrs.map((gh) => gh.force_pushes.length)),
          comments: sum(githubPrs.map((gh) => gh.comments)),
          received,
        }
      : null,
  };
}

export function assemble(sources: FeatureSources): Feature[] {
  const { names: tracked, branches, merged, prs, runbot } = sources;
  // `owner:branch`, the part after the first colon, like Python's `split(':', 1)[-1]`.
  const branchOf = (label: string) => (label.includes(':') ? label.slice(label.indexOf(':') + 1) : label);
  const labelOf = new Map(Object.entries(prs).map(([key, pr]) => [key, branchOf(pr.label ?? '')]));
  const commitsByPr = new Map<string, MergedCommit[]>();
  for (const commit of merged) {
    for (const [slug, number] of commit.closes) {
      const key = `${slug}#${number}`;
      commitsByPr.set(key, [...(commitsByPr.get(key) ?? []), commit]);
    }
  }
  // Credited: the people the branch is named after, the authors of its commits and its co-authors. A commit also on a branch
  // of its own author was only stacked here: it stays theirs, not this branch's.
  const ownBranches = new Map<string, Set<string>>();
  for (const [name, repos] of Object.entries(branches)) {
    for (const record of Object.values(repos)) {
      for (const commit of record.commits) {
        if (ownerOf(name, tracked) === commit.email.split('@')[0]) {
          ownBranches.set(commit.sha, (ownBranches.get(commit.sha) ?? new Set()).add(name));
        }
      }
    }
  }
  const people = new Map<string, Set<string>>();
  const authored = new Map<string, Map<string, number>>();
  const peopleOf = (name: string) => people.get(name) ?? (people.set(name, new Set()).get(name) as Set<string>);
  const authoredOf = (name: string) => authored.get(name) ?? (authored.set(name, new Map()).get(name) as Map<string, number>);
  for (const [name, repos] of Object.entries(branches)) {
    for (const record of Object.values(repos)) {
      if (record.noisy) continue;
      for (const person of record.coauthors ?? []) if (tracked.has(person)) peopleOf(name).add(person);
      // The exercise base of someone else's onboarding is no work of its author's.
      if (name.includes('onboarding') && !ownerOf(name, tracked)) continue;
      for (const commit of record.commits) {
        const author = commit.email.split('@')[0] as string;
        const stacked = [...(ownBranches.get(commit.sha) ?? [])].some((branch) => branch !== name);
        if (commit.email.endsWith('@odoo.com') && tracked.has(author) && !commit.merged && !stacked) counted(authoredOf(name), author);
      }
    }
  }
  // People found on other people's branches: co-authors, or authors of a commit of their own.
  for (const [name, repos] of Object.entries(branches)) {
    for (const record of Object.values(repos)) {
      for (const person of record.contributors ?? []) {
        if ((record.coauthors ?? []).includes(person) || authoredOf(name).get(person)) peopleOf(name).add(person);
      }
    }
  }
  for (const [key, commits] of commitsByPr) {
    const label = labelOf.get(key);
    if (!label) continue;
    for (const commit of commits) peopleOf(label).add(commit.owner);
    for (const commit of commits) if (!commit.coauthor) counted(authoredOf(label), commit.owner);
  }
  for (const [name, counter] of authored) for (const person of counter.keys()) peopleOf(name).add(person);

  const names = new Set([
    ...Object.keys(branches),
    ...Object.keys(runbot),
    ...[...labelOf.values()].filter((label) => ownerOf(label, tracked) || people.get(label)?.size),
  ]);
  const prsByName = new Map<string, Record<string, MergebotPr | PrRow>>();
  const prsOf = (name: string) => prsByName.get(name) ?? (prsByName.set(name, {}).get(name) as Record<string, MergebotPr | PrRow>);
  for (const [key, label] of labelOf) prsOf(label)[key] = prs[key] as MergebotPr;
  for (const [name, bundle] of Object.entries(runbot)) {
    for (const pr of bundle.prs) {
      const key = `${pr.repo}#${pr.number}`;
      const known = prsOf(name);
      if (Object.hasOwn(known, key)) continue;
      known[key] = prs[key] ?? {
        repo: pr.repo,
        number: pr.number,
        url: `https://github.com/${pr.repo}/pull/${pr.number}`,
        mergebot_url: `https://mergebot.odoo.com/${pr.repo}/pull/${pr.number}`,
        state: pr.closed ? 'closed' : 'open',
        title: '',
        tasks: [],
        opws: [],
        linked: [],
        ci: {},
      };
    }
  }
  const attached = new Set([...names].flatMap((name) => Object.keys(prsByName.get(name) ?? {})));
  const orphans = new Map<string, MergedCommit[]>();
  for (const [key, commits] of commitsByPr) {
    if (attached.has(key)) continue;
    const [first] = commits as [MergedCommit];
    const name = `${first.target}-${first.subject} (${key})`;
    orphans.set(name, [...(orphans.get(name) ?? []), ...commits]);
  }
  // A commit co-authored by two tracked people has a row each; files must be counted once.
  const unique = (records: MergedCommit[]) => {
    const bySha = new Map<string, MergedCommit>();
    for (const commit of [...records].sort((a, b) => Number(!a.coauthor) - Number(!b.coauthor))) bySha.set(commit.sha, commit);
    return [...bySha.values()];
  };

  const features: Feature[] = [];
  for (const name of [...names].sort()) {
    const owner = ownerOf(name, tracked);
    const contributors = new Set([...(people.get(name) ?? []), ...namesIn(name, tracked)].filter((person) => tracked.has(person)));
    if (!owner && !contributors.size) continue;
    const writers = authored.get(name) ?? new Map<string, number>();
    const primary = owner ?? mostCommon(writers)[0]?.[0] ?? ([...contributors].sort()[0] as string);
    const featurePrs = prsByName.get(name) ?? {};
    const commits = unique(Object.keys(featurePrs).flatMap((key) => commitsByPr.get(key) ?? []));
    contributors.delete(primary);
    features.push(
      feature(sources, name, primary, branches[name] ?? {}, featurePrs, commits, runbot[name], {
        contributors: [...contributors].sort(),
        coauthored: !owner && !writers.has(primary),
      }),
    );
  }
  for (const [name, records] of orphans) {
    const authors = records.filter((commit) => !commit.coauthor).map((commit) => commit.owner);
    const primary = authors[0] ?? (records[0] as MergedCommit).owner;
    const others = [...new Set(records.map((commit) => commit.owner))].filter((person) => person !== primary).sort();
    features.push(
      feature(sources, name, primary, {}, {}, unique(records), undefined, {
        orphan: true,
        contributors: others,
        coauthored: !authors.length,
      }),
    );
  }

  // The same change merged on several versions (a commit mergebot carried over, or a port by hand with the same title, within
  // 4 months) is one feature: the first one counts, the other versions are its ports.
  const portWindow = 120 * 86400;
  const groups = new Map<string, Feature[]>();
  for (const f of features) {
    if (f.kind === 'forward-port' || f.kind === 'onboarding' || !f.merged_at || !f.title) continue;
    const key = `${f.owner}\u0000${portSubject(f.title)}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.first_at || (a.merged_at as number)) - (b.first_at || (b.merged_at as number)));
    const [first] = group as [Feature];
    for (const f of group.slice(1)) {
      if ((f.merged_at as number) - (first.merged_at as number) <= portWindow) {
        f.kind = 'forward-port';
        f.port_of = first.name;
      }
    }
  }
  return features;
}

/** Keeps every feature seen and adds back the ones no source reports any more. */
export function archived(features: Feature[], archive: Record<string, Feature>, names: ReadonlySet<string>) {
  const current = new Set(features.map((f) => f.name));
  const currentPrs = new Set(features.flatMap((f) => f.prs.map((pr) => `${pr.repo}#${pr.number}`)));
  for (const f of features) archive[f.name] = f;
  const added = Object.entries(archive).filter(([name, f]) => {
    if (current.has(name) || ![f.owner, ...(f.contributors ?? [])].some((person) => names.has(person))) return false;
    if (!f.orphan && !f.coauthored && ownerOf(name, names) !== f.owner) return false;
    return !f.prs.some((pr) => currentPrs.has(`${pr.repo}#${pr.number}`));
  });
  return [...features, ...added.map(([, f]) => ({ ...f, archived: true }))];
}
