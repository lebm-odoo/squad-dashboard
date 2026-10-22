import { zValidator } from '@hono/zod-validator';
import type { DashboardConfig } from '@sd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { followedSquad, squadOf } from '../config';
import { type Feature, loginName } from '../domain/features';
import { requestsReport } from '../domain/reviews';
import type { DashboardStore, SettingsPort } from './store';

export type SpaceDeps = {
  store: DashboardStore;
  settings: Pick<SettingsPort, 'discardedRequests'>;
  loadConfig: () => Promise<DashboardConfig>;
  whoami: () => Promise<string>;
};

/** Moi and Squad: open to whoever opens the page on this machine. */
export function spaceRoutes({ store, settings, loadConfig, whoami }: SpaceDeps) {
  // The reviews asked as the last reading left them, before any computing: a reload of Moi shows them at once. One set aside
  // stays so until it is asked again, one given the r+ until given it again.
  const meRequests = async (config: DashboardConfig, me: string) => {
    const [found, logins, discarded] = await Promise.all([
      store.cursor<Parameters<typeof requestsReport>[0]>('github', 'requests'),
      store.part<Record<string, string>>('logins'),
      settings.discardedRequests(),
    ]);
    const loginNames = Object.fromEntries(Object.entries(logins?.data ?? {}).map(([member, login]) => [login.toLowerCase(), member]));
    const report = requestsReport(found, squadOf(config, me), (login) => loginName({ loginNames }, login));
    return (
      report && {
        ...report,
        prs: report.prs.filter((p) => (discarded[p.pr] ?? -1) < (p.asked_at ?? 0)),
        followed: report.followed.filter((p) => (discarded[p.pr] ?? -1) < p.rplus_at),
      }
    );
  };
  return (
    new Hono()
      .get('/meta', async (c) => {
        const config = await loadConfig();
        const squad = followedSquad(config);
        const [since, logins, forks] = await Promise.all([
          store.part<number | null>('history_since'),
          store.part<Record<string, string>>('logins'),
          store.versionForks(),
        ]);
        return c.json({
          me: config.me ?? (await whoami()),
          squad: squad ?? null,
          logins: logins?.data ?? {},
          history_since: since?.data ?? null,
          computed_at: since?.computedAt ?? null,
          version_forks: forks,
        });
      })
      .get('/me', async (c) => {
        const config = await loadConfig();
        const me = config.me ?? (await whoami());
        const [requests, tasks] = await Promise.all([meRequests(config, me), store.tasks([me])]);
        return c.json({ me, requests, tasks });
      })
      // The squad dashboard's data, its pages computing on it as they did: the features and reviews of the squad (of me
      // alone without one), the reviews asked, the PRs reviewed, the Odoo tasks. A card opened on a piece of work the squad
      // never touched asks for it too, with its forward-ports and ports by hand.
      .get('/squad/data', zValidator('query', z.object({ feature: z.string().min(1).max(500).optional() })), async (c) => {
        const { feature } = c.req.valid('query');
        const config = await loadConfig();
        const me = config.me ?? (await whoami());
        const squad = followedSquad(config);
        const people = [...new Set([me, ...(squad ? [squad.lead, ...squad.members] : [])])];
        const [features, reviews, requests, since, logins, odoo, forks, sources] = await Promise.all([
          store.featuresOf(people),
          store.reviewsOf(people),
          meRequests(config, me),
          store.part<number | null>('history_since'),
          store.part<Record<string, string>>('logins'),
          store.odoo(),
          store.versionForks(),
          store.sources(),
        ]);
        const reviewed = [
          ...new Set([
            ...reviews.flatMap((review) => (String(review.pr).includes('#') ? [String(review.pr)] : [])),
            ...(requests?.followed ?? []).map((p) => p.pr),
          ]),
        ];
        // A review shows the whole feature it is on, whoever wrote it: its other PRs, versions, forward-ports and task.
        const links = Object.values(odoo.tasks).map((task) => (task as { links?: { prs?: string[]; branches?: string[] } }).links ?? {});
        const [linked, family] = await Promise.all([
          store.featuresLinked(
            [...reviewed, ...(requests?.prs ?? []).map((p) => p.pr), ...links.flatMap((l) => l.prs ?? [])],
            links.flatMap((l) => l.branches ?? []),
          ),
          feature ? store.featuresLinked([], [feature]) : [],
        ]);
        // What a forward-port or a port by hand comes from, for the card to show the work whole.
        const roots = family
          .flatMap((f) => [f.fw_of, f.port_of])
          .filter((name): name is string => !!name && !family.some((f) => f.name === name));
        const shown = [
          ...new Map(
            [...features, ...linked, ...family, ...(roots.length ? await store.featuresLinked([], roots) : [])].map((f) => [f.name, f]),
          ).values(),
        ];
        const pages = await store.mergebot([...reviewed, ...shown.flatMap((f) => f.prs.map((pr) => `${pr.repo}#${pr.number}`))]);
        // The mergebot pages Moi's refresh read since the dashboard was computed: their CI, r+ and blocks show without
        // computing it again, which a merge or a new review does.
        const current = (f: Feature) => ({
          ...f,
          prs: f.prs.map((pr) => {
            const page = pages[`${pr.repo}#${pr.number}`];
            if (!page || page.fetched <= (since?.computedAt ?? 0)) return pr;
            const { phase, draft, blocked, missing_r, review, ci, linked } = page;
            return { ...pr, phase, draft, blocked, missing_r, review, ci, linked };
          }),
        });
        const digest = (key: string, pr: Record<string, unknown>) => {
          const linked = (pr.linked ?? []) as { repo: string; number: number; branch: string }[];
          const [repo, number] = key.split('#');
          return {
            state: pr.state,
            merged_at: pr.merged_at ?? null,
            blocked: pr.blocked ?? false,
            missing_r: pr.missing_r ?? false,
            branch: linked.find((link) => link.repo === repo && link.number === Number(number))?.branch ?? null,
            linked,
            tasks: pr.tasks ?? [],
            url: pr.mergebot_url,
          };
        };
        return c.json({
          generated_at: since?.computedAt ?? null,
          me,
          squad: squad ?? null,
          org: {
            squads: squad ? { [squad.lead]: squad.members } : {},
            arrivals: Object.fromEntries(Object.entries(config.arrivals).filter(([member]) => people.includes(member))),
          },
          review_requests: requests,
          history_since: since?.data ?? null,
          version_forks: forks,
          features: shown.map(current),
          reviews,
          reviewed_prs: Object.fromEntries(reviewed.flatMap((key) => (pages[key] ? [[key, digest(key, pages[key])]] : []))),
          odoo: { ...odoo, url: 'https://www.odoo.com', error: null },
          logins: Object.fromEntries(people.map((member) => [member, logins?.data?.[member] ?? null])),
          sources,
        });
      })
      .get('/squad', async (c) => {
        const squad = followedSquad(await loadConfig());
        if (!squad) return c.json({ lead: null, members: [], tasks: [] });
        return c.json({ ...squad, tasks: await store.tasks([squad.lead, ...squad.members]) });
      })
  );
}
