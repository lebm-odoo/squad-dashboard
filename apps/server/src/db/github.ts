import { and, eq } from 'drizzle-orm';
import type { GhReview } from '../domain/groups';
import type { MissingPr, PrDetail } from '../sources/github-prs';
import type { FoundReview, SearchCursor } from '../sources/github-search';
import type { Database } from './client';
import { insertRows, toDate, toUnix } from './rows';
import { githubForcePush, githubPr, githubReview, githubRplus, githubRplusScan, personLogin, syncCursor } from './schema';

const prId = (key: string) => {
  const [repo, number] = key.split('#') as [string, string];
  return { repo, number: Number(number) };
};
/** GitHub's own format, which the V1 kept in its keys: no milliseconds. */
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** PRs read in full replace what was known of them; their reviews by the same people too, a dismissed one changes state. */
export async function savePullRequests(db: Database, read: Map<string, PrDetail | MissingPr>) {
  await db.transaction(async (tx) => {
    for (const [key, pr] of read) {
      const id = prId(key);
      const detail = pr.state === 'MISSING' ? null : (pr as PrDetail);
      const columns = {
        ...(detail
          ? {
              title: detail.title,
              headRef: detail.head_ref,
              headOwner: detail.head_owner,
              mergedAt: detail.merged_at ? toDate(detail.merged_at) : null,
              tasks: detail.tasks,
              opws: detail.opws,
              descWords: detail.desc_words,
            }
          : {}),
        state: pr.state,
        draft: detail?.draft ?? null,
        authorLogin: detail?.author ?? null,
        createdAt: detail ? toDate(detail.created_at) : null,
        closedAt: detail?.closed_at ? toDate(detail.closed_at) : null,
        additions: detail?.additions ?? null,
        deletions: detail?.deletions ?? null,
        changedFiles: detail?.changed_files ?? null,
        comments: detail?.comments ?? null,
        readyAt: (detail?.ready_at ?? []).map(toDate),
        fetchedAt: toDate(pr.fetched),
      };
      await tx
        .insert(githubPr)
        .values({ ...id, ...columns })
        .onConflictDoUpdate({ target: [githubPr.repo, githubPr.number], set: columns });
      await tx.delete(githubForcePush).where(and(eq(githubForcePush.repo, id.repo), eq(githubForcePush.number, id.number)));
      if (!detail) continue;
      // The PR's reviews are now these: a dismissed one changed state, the old state stays only if a search found it.
      const ofPr = and(eq(githubReview.repo, id.repo), eq(githubReview.number, id.number));
      await tx.update(githubReview).set({ detailed: false }).where(ofPr);
      await tx.delete(githubReview).where(and(ofPr, eq(githubReview.searched, false)));
      const reviews = detail.reviews.map((review) => ({
        ...id,
        login: review.login ?? 'ghost',
        submittedAt: toDate(review.at),
        state: review.state,
        detailed: true,
      }));
      await insertRows(tx, githubReview, reviews, ['detailed']);
      await insertRows(
        tx,
        githubForcePush,
        detail.force_pushes.map((push) => ({ ...id, ...push, at: toDate(push.at) })),
      );
    }
  });
}

/** Reviews found by searching a member's: the PR's title, author and branch come with them. */
export async function saveFoundReviews(db: Database, found: FoundReview[], logins: Record<string, string>) {
  const prs = new Map(found.map((review) => [review.pr, review]));
  await db.transaction(async (tx) => {
    await insertRows(
      tx,
      githubPr,
      [...prs.values()].map((review) => ({
        ...prId(review.pr),
        title: review.title,
        authorLogin: review.authorLogin,
        headRef: review.headRef,
      })),
      ['title', 'headRef'],
    );
    await insertRows(
      tx,
      githubReview,
      found.map((review) => ({
        ...prId(review.pr),
        login: logins[review.member] as string,
        submittedAt: new Date(review.submittedAt),
        state: review.state,
        searched: true,
      })),
      ['searched'],
    );
  });
}

export async function saveRplus(db: Database, read: Map<string, { at: number; r: [string, number][]; missing?: true }>) {
  await db.transaction(async (tx) => {
    for (const [key, entry] of read) {
      const id = prId(key);
      const scan = { scannedAt: toDate(entry.at), missing: Boolean(entry.missing) };
      await tx
        .insert(githubRplusScan)
        .values({ ...id, ...scan })
        .onConflictDoUpdate({ target: [githubRplusScan.repo, githubRplusScan.number], set: scan });
      await tx.delete(githubRplus).where(and(eq(githubRplus.repo, id.repo), eq(githubRplus.number, id.number)));
      await insertRows(
        tx,
        githubRplus,
        entry.r.map(([login, at]) => ({ ...id, login, at: toDate(at) })),
      );
    }
  });
}

export const saveDeducedLogins = (db: Database, logins: Map<string, string>) =>
  insertRows(
    db,
    personLogin,
    [...logins].map(([member, login]) => ({ member, login, source: 'deduced' })),
    ['login', 'source'],
  );

/** Every PR read in full, as the V1 kept it in its `github` section. */
export async function loadPullRequests(db: Database) {
  const [prs, reviews, pushes] = await Promise.all([
    db.select().from(githubPr),
    db.select().from(githubReview).where(eq(githubReview.detailed, true)).orderBy(githubReview.submittedAt),
    db.select().from(githubForcePush).orderBy(githubForcePush.at),
  ]);
  const group = <T extends { repo: string; number: number }>(rows: T[]) => {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const key = `${row.repo}#${row.number}`;
      (groups.get(key) ?? (groups.set(key, []).get(key) as T[])).push(row);
    }
    return groups;
  };
  const [reviewsOf, pushesOf] = [group(reviews), group(pushes)];
  return Object.fromEntries(
    prs.flatMap((pr) => {
      if (!pr.fetchedAt || !pr.state) return [];
      const key = `${pr.repo}#${pr.number}`;
      if (pr.state === 'MISSING') return [[key, { state: 'MISSING', fetched: toUnix(pr.fetchedAt) }]];
      return [
        [
          key,
          {
            state: pr.state,
            draft: pr.draft,
            author: pr.authorLogin,
            created_at: pr.createdAt && toUnix(pr.createdAt),
            closed_at: pr.closedAt && toUnix(pr.closedAt),
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changedFiles,
            reviews: (reviewsOf.get(key) ?? []).map((review) => ({
              login: review.login === 'ghost' ? null : review.login,
              state: review.state,
              at: toUnix(review.submittedAt),
            })),
            comments: pr.comments,
            force_pushes: (pushesOf.get(key) ?? []).map(({ at, actor, before, after, kind, delta }) => ({
              at: toUnix(at),
              actor,
              before: before ?? '',
              after,
              kind,
              delta,
            })),
            ready_at: (pr.readyAt ?? []).map(toUnix),
            fetched: toUnix(pr.fetchedAt),
          },
        ],
      ];
    }),
  );
}

/** The reviews the members' searches found on the PRs of others: the login each member was searched with tells whose. */
export async function loadMemberReviews(db: Database, searched: Record<string, SearchCursor>) {
  const memberOf = new Map(Object.entries(searched).map(([member, cursor]) => [cursor.login.toLowerCase(), member]));
  const rows = await db
    .select({ review: githubReview, title: githubPr.title, author: githubPr.authorLogin, headRef: githubPr.headRef })
    .from(githubReview)
    .innerJoin(githubPr, and(eq(githubPr.repo, githubReview.repo), eq(githubPr.number, githubReview.number)))
    .orderBy(githubReview.submittedAt);
  const out: Record<string, GhReview> = {};
  for (const { review, title, author, headRef } of rows) {
    const member = memberOf.get(review.login.toLowerCase());
    if (!member || !review.searched || title === null || author === review.login) continue;
    const pr = `${review.repo}#${review.number}`;
    out[`${member}:${pr}:${iso(review.submittedAt)}`] = {
      reviewer: member,
      pr,
      repo: review.repo.split('/')[1] as string,
      t: toUnix(review.submittedAt),
      state: review.state,
      author_login: author ?? '',
      head_ref: headRef ?? '',
      subject: title,
      fix: title.trimStart().toUpperCase().startsWith('[FIX]'),
    };
  }
  return out;
}

export async function loadRplus(db: Database) {
  const [scans, given] = await Promise.all([db.select().from(githubRplusScan), db.select().from(githubRplus).orderBy(githubRplus.at)]);
  const out: Record<string, { at: number; r: [string, number][]; missing?: boolean }> = {};
  for (const scan of scans) {
    out[`${scan.repo}#${scan.number}`] = { at: toUnix(scan.scannedAt), r: [], ...(scan.missing ? { missing: true } : {}) };
  }
  for (const row of given) out[`${row.repo}#${row.number}`]?.r.push([row.login, toUnix(row.at)]);
  return out;
}

export async function loadCursors<T>(db: Database, source: string) {
  const rows = await db.select().from(syncCursor).where(eq(syncCursor.source, source));
  return Object.fromEntries(rows.map((row) => [row.key, row.value as T]));
}

export async function saveCursors(db: Database, source: string, cursors: Record<string, unknown>) {
  await insertRows(
    db,
    syncCursor,
    Object.entries(cursors).map(([key, value]) => ({ source, key, value, updatedAt: new Date() })),
    ['value', 'updatedAt'],
  );
}

export async function loadDeducedLogins(db: Database) {
  const rows = await db.select().from(personLogin).where(eq(personLogin.source, 'deduced'));
  return Object.fromEntries(rows.map((row) => [row.member, row.login]));
}

/**
 * The PRs mergebot was not asked about, as mergebot would show them, from what GitHub gave: they join their branch's feature.
 * Who merged is left out: on GitHub, the mergebot itself. GitHub does not tell the r+: an open PR has none until mergebot says.
 */
export async function loadGithubAsMergebot(db: Database) {
  const rows = await db.select().from(githubPr);
  return Object.fromEntries(
    rows.flatMap((pr) => {
      if (!pr.fetchedAt || !pr.state || pr.state === 'MISSING' || !pr.headRef || !pr.headOwner) return [];
      return [
        [
          `${pr.repo}#${pr.number}`,
          {
            repo: pr.repo,
            number: pr.number,
            url: `https://github.com/${pr.repo}/pull/${pr.number}`,
            mergebot_url: `https://mergebot.odoo.com/${pr.repo}/pull/${pr.number}`,
            state: pr.state.toLowerCase(),
            phase: '',
            draft: pr.draft ?? false,
            blocked: false,
            missing_r: pr.state === 'OPEN',
            review: null,
            title: pr.title ?? '',
            created_by: pr.authorLogin ?? '',
            label: `${pr.headOwner}:${pr.headRef}`,
            merged_at: pr.mergedAt && toUnix(pr.mergedAt),
            merged_by: null,
            ci: {},
            linked: [],
            desc_words: pr.descWords ?? 0,
            tasks: pr.tasks ?? [],
            opws: pr.opws ?? [],
            fetched: toUnix(pr.fetchedAt),
          },
        ],
      ];
    }),
  );
}
