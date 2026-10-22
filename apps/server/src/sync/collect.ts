import type { CollectScope, CollectSettings, CollectState, collectSpaces, DashboardConfig } from '@sd/shared';
import { followed, followedSquad, squadOf } from '../config';
import type { Database } from '../db/client';
import { loadPart } from '../db/dashboard';
import { loadContributions, loadCursor, saveCursor } from '../db/git';
import type { SecretStore } from '../security/secrets';
import type { Clone } from '../sources/clones';
import { fetchClones } from '../sources/git-fetch';
import type { Refs } from '../sources/git-history';
import { Github, ghToken } from '../sources/github';
import { Odoo, squadOdooKey } from '../sources/odoo';
import { deriveAndSave } from './derive';
import { syncDesk } from './desk';
import { syncGitBranches, syncGitHistory, windowStart } from './git';
import {
  type GithubContext,
  githubLogins,
  githubMemberReviews,
  githubPrs,
  githubRelatedPrs,
  githubRequests,
  githubRplus,
  saveGithubStatus,
} from './github';
import { syncTasks } from './odoo';
import { relatedWork } from './related';
import { syncWeb } from './web';

export type CollectDeps = {
  db: Database;
  clones: Clone[];
  loadConfig: () => Promise<DashboardConfig>;
  secrets: SecretStore;
  settings: () => Promise<CollectSettings>;
};

/** One collection at a time, on click: its progress goes to whoever listens, step by step and source by source. */
export class Collection {
  state: CollectState = { running: false, scope: null, current: [], ready: [], started: null, finished: null, errors: {}, steps: [] };
  private readonly listeners = new Set<(state: CollectState) => void>();
  /** The step each source is on, and since when. */
  private readonly running = new Map<string, [string, number]>();

  constructor(private readonly deps: CollectDeps) {}

  subscribe(listener: (state: CollectState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** How many follow it: each page open listens to its progress. */
  get followers() {
    return this.listeners.size;
  }

  /** Starts a collection, unless one runs. */
  start(scope: CollectScope) {
    if (this.state.running) return null;
    const now = Date.now() / 1000;
    this.state = { running: true, scope, current: [], ready: [], started: now, finished: null, errors: {}, steps: [] };
    const done = this.run(scope, now)
      .catch((error) => {
        this.state.errors.collecte = (error as Error).message;
      })
      .finally(() => {
        this.state = { ...this.state, running: false, current: [], finished: Date.now() / 1000 };
        this.emit();
      });
    return done;
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  /** Ends the source's step, and starts `label` if any. */
  private mark(source: string, label: string | null) {
    const at = Date.now() / 1000;
    const previous = this.running.get(source);
    if (previous) this.state.steps.push([previous[0], at - previous[1]]);
    if (label) this.running.set(source, [label, at]);
    else this.running.delete(source);
    this.state.current = [...this.running.values()].map(([step]) => step);
    this.emit();
  }

  /** Runs one source: its failure is noted, the others go on. */
  private async attempt(source: string, run: (step: (label: string) => void) => Promise<unknown>) {
    try {
      await run((label) => this.mark(source, label));
    } catch (error) {
      this.state.errors[source] = (error as Error).message;
    } finally {
      this.mark(source, null);
    }
  }

  private ready(space: (typeof collectSpaces)[number]) {
    this.state.ready = [...this.state.ready, space];
    this.emit();
  }

  /**
   * A whole collection goes by space: Moi in a few seconds (the reviews asked, the tasks), then the squad (its branches, PRs,
   * mergebot pages, reviews) with the work of others it touches, and the dashboard computed. The other scopes read one source.
   * Moi alone adds the PRs of my desk that moved, and computes the dashboard again if one did; `watch` is the same, run on its
   * own while a page is in sight.
   */
  private async run(scope: CollectScope, now: number) {
    const { db, clones, secrets } = this.deps;
    const { historyDays: sinceDays, githubReserve, githubConcurrency } = await this.deps.settings();
    const config = await this.deps.loadConfig();
    const email = (await clones[0]?.git.run(['config', 'user.email'], { check: false })) ?? '';
    const me = config.me ?? (email.trim().toLowerCase().split('@')[0] as string);
    const people = followed(config, me);
    const names = new Set(people);
    const lead = followedSquad(config)?.lead ?? me;
    const repos = clones.map(({ repo }) => repo);
    const secret = (name: string) => secrets.get(name).catch(() => null);
    const wants = (...scopes: CollectScope[]) => scope === 'all' || scopes.includes(scope);
    const token = wants('me', 'watch', 'github') ? ((await secret('github_token')) ?? (await ghToken())) : null;
    const odooKey = wants('me', 'watch', 'odoo') ? ((await secret('odoo_api_key')) ?? (await squadOdooKey())) : null;
    const context: GithubContext | null = token
      ? {
          db,
          gh: new Github(token, { reserve: githubReserve, concurrency: githubConcurrency }),
          clones,
          people,
          me,
          lead,
          forced: config.github_logins,
          now,
          sinceDays,
          pending: { prs: 0, rplus: 0 },
        }
      : null;
    const github = (part: (ctx: GithubContext) => Promise<unknown>, source = 'github') =>
      this.attempt(source, async (step) => {
        if (!context) throw new Error('aucun jeton GitHub : le donner dans les réglages, ou `gh auth login` sur cette machine');
        await part({ ...context, step });
      });
    const tasks = () =>
      this.attempt('odoo', async (step) => {
        if (!odooKey) throw new Error('aucune clé API Odoo : la donner dans les réglages');
        await syncTasks(db, new Odoo(odooKey), { squad: people, lead, now, step });
      });
    const derive = () =>
      this.attempt('tableau', async (step) => {
        step('calcul du tableau de bord');
        const squad = squadOf(config, me);
        await deriveAndSave(db, { repos, followed: names, squad, lead, me, forced: config.github_logins, now, sinceDays });
      });

    let logins: Record<string, string> = {};
    if (wants('me', 'watch', 'odoo')) {
      // On its own, Odoo is read every 15 minutes at most: tasks move slower than PRs.
      const tasksRead = scope === 'watch' ? ((await loadCursor<{ at: number }>(db, 'odoo', 'status'))?.at ?? 0) : 0;
      await Promise.all([
        scope !== 'odoo'
          ? github(async (ctx) => {
              // On its own, the logins the dashboard last computed: resolving them asks GitHub for whoever has none yet.
              logins = (scope === 'watch' && (await loadPart<Record<string, string>>(db, 'logins'))?.data) || (await githubLogins(ctx));
              await githubRequests(ctx, logins);
            })
          : null,
        now - tasksRead > 15 * 60 ? tasks() : null,
      ]);
      this.ready('me');
    }
    if (scope === 'odoo') return;
    if (scope === 'me' || scope === 'watch') {
      let desk = { recompute: false, refresh: false, errors: [] as string[] };
      await github(async (ctx) => {
        desk = await syncDesk(ctx);
        if (desk.errors.length) throw new Error(`${desk.errors.length} page(s) mergebot en erreur, ex. ${desk.errors[0]}`);
      }, 'bureau');
      if (desk.recompute) await derive();
      if (desk.recompute || desk.refresh) this.ready('squad');
      return;
    }

    // The PRs and branches of others that Moi shows whole: read along with the people's own.
    const related = await relatedWork(db, { lead, followed: names, repos, now });
    if (scope === 'all') {
      await this.attempt('fetch', async (step) => {
        step('git fetch');
        const fetched = await fetchClones(clones, names, { ...related.branches, ...(await loadContributions(db)) }, token);
        for (const [repo, heads] of Object.entries(fetched.remoteHeads)) await saveCursor(db, 'fetch', repo, { heads, at: now });
        if (fetched.error) throw new Error(fetched.error);
      });
    }
    const since = windowStart(now, sinceDays);
    let refs: Record<string, Refs> | null = null;
    await this.attempt('git', async (step) => {
      refs = await syncGitHistory(db, clones, { members: names, since, now, step });
    });
    // The branches, git's longest part, go along with the network sources, which need the history alone.
    await Promise.all([
      this.attempt('git (branches)', async (step) => {
        if (refs) await syncGitBranches(db, clones, refs, { members: names, related: related.branches, since, now, step });
      }),
      wants('ci')
        ? this.attempt('runbot et mergebot', (step) =>
            syncWeb(db, clones, { followed: names, lead, related: new Set(related.prs), now, step }),
          )
        : null,
      wants('github')
        ? github(async (ctx) => {
            if (scope !== 'all') {
              logins = await githubLogins(ctx);
              await githubRequests(ctx, logins);
            }
            await githubPrs(ctx, logins, names);
            await githubRelatedPrs(ctx, related.prs);
            await githubMemberReviews(ctx, logins, people, 0);
            await githubRplus(ctx);
          })
        : null,
    ]);
    await derive();
    this.ready('squad');
    if (context) {
      const status = await saveGithubStatus(context);
      if (status.stopped) this.state.errors.github = `${status.stopped} (${status.pending} PR et ${status.rplus_pending} r+ à lire)`;
    }
    await saveCursor(db, 'collect', 'last', {
      scope,
      started: now,
      finished: Date.now() / 1000,
      errors: this.state.errors,
      steps: this.state.steps,
    });
  }
}
