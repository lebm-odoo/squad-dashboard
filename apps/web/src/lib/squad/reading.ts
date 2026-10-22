import { cap, fdate, fdays, fmt, fmt1, pct } from '../format.ts';
import { m } from '../i18n.svelte.ts';
import { DAY, type Facts, type Feat, lineValue, median, now, type Rev } from './model.ts';

export type Signal = {
  weight: number;
  text: string;
  question?: string;
  suggestion?: string;
  sources?: (Feat | Rev)[] | null;
  open?: boolean;
};
type Evolution = { comparable: boolean; rows: { key: string; dir: number; change: number; b: number | null; r: number | null }[] };

/**
 * The reading of a period, from the work alone: what went well, the achievements, and, kept apart for a 1:1, questions and
 * suggestions. Every point keeps its sources.
 */
export function reading(a: {
  W: Facts;
  R: Facts;
  B: Facts;
  evo: Evolution;
  single: string | null;
  people: string[];
  canReview: boolean;
  stale: Feat[];
}) {
  const { W, R, B, evo, single } = a;
  const words = m().journey.signals;
  const good: Signal[] = [];
  const talk: Signal[] = [];
  const add = (list: Signal[], weight: number, text: string, more: Partial<Signal> = {}) => list.push({ weight, text, ...more });
  const big = W.sized.filter((f) => (f.complexity ?? 0) >= 50).sort((x, y) => (y.complexity ?? 0) - (x.complexity ?? 0));
  if (big.length) add(good, 1 + Math.min(2, big.length / 2), words.big(big.length, big[0]?.title || big[0]?.name || ''), { sources: big });
  if (W.hardFixes.length >= 2) add(good, 1.5, words.hardFixes(W.hardFixes.length), { sources: W.hardFixes });
  const fixTested = W.fixes.length ? W.fixesTested.length / W.fixes.length : null;
  if (W.fixes.length >= 4 && fixTested != null && fixTested >= 0.7)
    add(good, 1, words.fixesTested(W.fixesTested.length, W.fixes.length), { sources: W.fixesTested });
  else if (single && W.fixes.length >= 4 && fixTested != null && fixTested < 0.3)
    add(talk, 1, words.fixesUntested(W.fixesTested.length, W.fixes.length), {
      suggestion: words.fixesUntestedTip,
      sources: W.fixes.filter((f) => !f.test_lines),
    });
  if (W.featuresSized.length >= 3 && W.featuresTested.length / W.featuresSized.length >= 0.6)
    add(good, 1, words.featuresTested(W.featuresTested.length, W.featuresSized.length), { sources: W.featuresTested });
  if (W.reviewed.length >= 5 && (W.cleanShare ?? 0) >= 0.8) add(good, 2, words.clean(pct(W.cleanShare)), { sources: W.clean });
  if (single && W.heavy.length >= 2 && W.heavy.length / W.reviewed.length >= 0.2)
    add(talk, 2, words.heavy(W.heavy.length), { question: words.heavyQuestion, sources: W.heavy });
  if (W.descWords != null && W.opened.length >= 4) {
    const described = W.opened
      .filter((f) => a.people.includes(f.owner))
      .sort((x, y) => (median(y.prs.map((p) => p.desc_words)) ?? 0) - (median(x.prs.map((p) => p.desc_words)) ?? 0));
    if (W.descWords >= 100) add(good, 1, words.described(fmt(W.descWords)), { sources: described });
    else if (single && W.descWords < 25)
      add(talk, 0, words.shortDesc(fmt(W.descWords)), { suggestion: words.shortDescTip, sources: described.reverse() });
  }
  if (W.mechanical >= 500 && W.mechanical >= 0.3 * W.rawLines)
    add(good, 1, words.refactoring(fmt(W.mechanical), fmt(W.rawLines)), {
      sources: [...W.sized]
        .filter((f) => f.mechanical)
        .sort((x, y) => (y.mechanical ?? 0) - (x.mechanical ?? 0))
        .slice(0, 8),
    });
  const seen = new Set(B.domains.map(([d]) => d));
  const fresh = evo.comparable && seen.size ? R.domains.map(([d]) => d).filter((d) => !seen.has(d)) : [];
  if (fresh.length) add(good, 2, words.fresh(fresh.join(', ')), { sources: R.active.filter((f) => fresh.includes(f.domain ?? '')) });
  const [topDomain] = W.domains;
  if (W.domains.length >= 4)
    add(
      good,
      1,
      words.versatile(
        W.domains.length,
        W.domains
          .slice(0, 5)
          .map(([d, n]) => `${d} ${n}`)
          .join(', '),
      ),
    );
  else if (single && topDomain && W.active.length >= 6 && topDomain[1] / W.active.length >= 0.8)
    add(talk, 1, words.focused(topDomain[0], pct(topDomain[1] / W.active.length)), { question: words.focusedQuestion(topDomain[0]) });
  if (W.countries.length >= 2)
    add(good, 1, words.countries(W.countries.length, `${W.countries.slice(0, 10).join(', ')}${W.countries.length > 10 ? '…' : ''}`), {
      sources: W.active.filter((f) => f.countries?.length),
    });
  if (W.reviews.length)
    add(
      good,
      W.reviews.length >= 2 * W.months ? 2 : 1,
      words.reviewed(W.reviews.length, W.reviewedAuthors.length, W.rplus, W.validations.length),
      {
        sources: W.reviews,
      },
    );
  else if (single && a.canReview && W.months >= 1) add(talk, 2, words.noReview, { question: words.noReviewQuestion });
  if (W.together.length >= 2) add(good, 1, words.together(!!single, W.together.length), { sources: W.together });
  if (single && W.weeks >= 8 && W.activeWeeks / W.weeks >= 0.8) add(good, 1, words.steady(W.activeWeeks, W.weeks));
  if (single && W.closed.length >= 3) add(talk, 1, words.closed(W.closed.length), { question: words.closedQuestion, sources: W.closed });
  if (single && a.stale.length >= 3) add(talk, 1, words.stale(a.stale.length), { question: words.staleQuestion, sources: a.stale });
  const idle = (now() - R.lastWork) / DAY;
  if (single && R.lastWork && idle >= 14 && R.rebasesSince(R.lastWork) >= 3)
    add(talk, 3, words.rebasesOnly(Math.round(idle), R.rebasesSince(R.lastWork), fdate(R.lastWork)), {
      question: words.rebasesOnlyQuestion,
    });
  if (single && R.gap && R.gap.days >= 21)
    add(talk, 1, words.gap(R.gap.days, fdate(R.gap.from), fdate(R.gap.to)), { question: words.gapQuestion });
  if (single && W.code + W.rebase >= 20 && (W.rebaseRatio ?? 0) > 0.5)
    add(talk, 1, words.rebases(pct(W.rebaseRatio)), { question: words.rebasesQuestion });
  if (single && W.firstReview != null && W.opened.length >= 4 && W.firstReview >= 5)
    add(talk, 1, words.firstReview(fdays(W.firstReview)), {
      question: words.firstReviewQuestion,
      sources: W.opened
        .filter((f) => f._firstReview != null)
        .sort((x, y) => (y._firstReview ?? 0) - (x._firstReview ?? 0))
        .slice(0, 10),
    });
  const show: Record<string, (n: number | null) => string> = {
    perMonth: fmt1,
    complexity: fmt,
    lead: fdays,
    cleanShare: pct,
    activeDays: fmt1,
    reviews: fmt1,
  };
  for (const row of evo.rows.filter((r) => r.change && r.dir)) {
    if (!single && row.key === 'activeDays') continue;
    const format = show[row.key] ?? fmt;
    const text = words.evolution(cap(words.evoLabels[row.key] ?? row.key), row.change > 0, format(row.b), format(row.r));
    const sources = row.key === 'reviews' ? R.reviews : row.key === 'activeDays' ? null : R.merged;
    if (row.change * row.dir > 0) add(good, 2, text, { sources });
    else if (single) {
      const [kind, note] = words.followUp[row.key] ?? [];
      add(talk, 2, text, { ...(kind ? { [kind]: note } : {}), sources });
    }
  }
  if (single) for (const question of words.open) add(talk, -1, question, { open: true });
  const achievements = W.sized
    .filter((f) => f.merged_at)
    .sort((x, y) => (y.complexity ?? 0) - (x.complexity ?? 0) || lineValue(y) - lineValue(x))
    .slice(0, 5);
  return { good: good.sort((x, y) => y.weight - x.weight), talk: talk.sort((x, y) => y.weight - x.weight), achievements };
}
