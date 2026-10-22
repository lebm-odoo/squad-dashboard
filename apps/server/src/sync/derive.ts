import { and, eq, notInArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { loadDashboardInput } from '../db/dashboard-input';
import { insertRows, toDate } from '../db/rows';
import { archiveEntry, dashboardFeature, dashboardPart, dashboardReview } from '../db/schema';
import { deriveDashboard } from '../domain/dashboard';
import { relatedWork } from './related';

type DeriveOptions = Omit<Parameters<typeof loadDashboardInput>[1], 'names' | 'related'> & {
  /** Whose work is read whole: me, and my squad when it is followed. */
  followed: ReadonlySet<string>;
  /** Whose reviews and tasks bring the work of others: the lead's, or mine. */
  lead: string;
};

/**
 * Computes the dashboard from the facts in the database and replaces the previous one, with what the archive keeps. The
 * authors of the work of others the people followed touch have their features too, made of that work alone.
 */
export async function deriveAndSave(db: Database, { followed, lead, ...options }: DeriveOptions) {
  const started = performance.now();
  const related = await relatedWork(db, { lead, followed, repos: options.repos, now: options.now });
  const input = await loadDashboardInput(db, { ...options, names: new Set([...followed, ...related.owners]), related: related.prs });
  const { archive, features, reviews, ...parts } = deriveDashboard(input);
  const at = toDate(options.now);
  await db.transaction(async (tx) => {
    await insertRows(
      tx,
      archiveEntry,
      Object.entries(archive.features).map(([key, data]) => ({ section: 'features', key, data, updatedAt: at })),
      ['data', 'updatedAt'],
    );
    // The archive drops the r+ newer rules no longer count: a reviewer who wrote part of the feature.
    await tx
      .delete(archiveEntry)
      .where(and(eq(archiveEntry.section, 'reviews'), notInArray(archiveEntry.key, Object.keys(archive.reviews))));
    await insertRows(
      tx,
      archiveEntry,
      Object.entries(archive.reviews).map(([key, data]) => ({ section: 'reviews', key, data, updatedAt: at })),
      ['data', 'updatedAt'],
    );
    await tx.delete(dashboardFeature);
    await insertRows(
      tx,
      dashboardFeature,
      features.map((feature) => ({ name: feature.name, owner: feature.owner ?? null, archived: Boolean(feature.archived), data: feature })),
    );
    await tx.delete(dashboardReview);
    await insertRows(
      tx,
      dashboardReview,
      reviews.map((review) => ({
        id: review.id as string,
        reviewer: review.reviewer as string,
        at: toDate(review.t as number),
        data: review,
      })),
    );
    await insertRows(
      tx,
      dashboardPart,
      Object.entries(parts).map(([part, data]) => ({ part, data: data ?? null, computedAt: at })),
      ['data', 'computedAt'],
    );
  });
  return { features: features.length, reviews: reviews.length, seconds: (performance.now() - started) / 1000 };
}
