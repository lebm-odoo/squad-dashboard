import { Octokit } from '@octokit/core';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import Bottleneck from 'bottleneck';
import { Slots } from './git';

// biome-ignore lint/suspicious/noExplicitAny: GraphQL answers are read field by field, as their queries ask.
export type Data = Record<string, any>;

/** The instant of a GitHub timestamp, `2026-10-16T11:15:17Z`, in seconds. */
export const isoTs = (text: string) => Date.parse(text) / 1000;

type Failure = { name?: string; status?: number; message: string; data?: Data; response?: { headers?: Record<string, string> } };

/**
 * GraphQL on the user's quota: aliased batches cost one point each, searches are paced as the secondary limit wants (20 a
 * minute). Heavy queries go one at a time: four at once spend GitHub's CPU allowance (60 s a minute) and hit its
 * secondary limit within minutes. On that limit, the query waits what GitHub says and goes on slower; once stopped (quota
 * near the reserve, token refused, GitHub failing, the limit hit again and again), no query is sent and `stopped` says why.
 */
export class Github {
  remaining: number | null = null;
  resetAt: string | null = null;
  spent = 0;
  calls = 0;
  stopped: string | null = null;
  /** Queries GitHub gave up on, timed out: each costs as long as the timeout. */
  timeouts = 0;
  /** Milliseconds spent waiting on the secondary limit. */
  waited = 0;
  private failures = 0;
  private limits = 0;
  private pause = 0;
  private lastCall = 0;
  private searchTokens = 10;
  private refilled = Date.now();
  private searching: Promise<void> = Promise.resolve();
  private readonly octokit;
  private readonly slots: Slots;

  constructor(
    token: string,
    private readonly options: {
      reserve?: number;
      concurrency?: number;
      fetch?: typeof fetch;
      searchPause?: number;
      retryBase?: number;
      /** Between two queries once the secondary limit was hit. */
      slowPause?: number;
    } = {},
  ) {
    const Client = Octokit.plugin(throttling, retry);
    this.slots = new Slots(options.concurrency ?? 1);
    this.octokit = new Client({
      auth: token,
      userAgent: 'squad-dashboard',
      request: options.fetch ? { fetch: options.fetch } : {},
      // A 502 or 504 is GitHub timing out on a heavy query: asking again costs as long, the caller splits it instead.
      retry: { retries: 1, retryAfterBaseValue: options.retryBase ?? 1000, doNotRetry: [400, 401, 403, 404, 410, 422, 451, 502, 504] },
      throttle: {
        // The plugin would send GraphQL queries one a second, as writes: the pace is set here instead.
        write: new Bottleneck.Group({ maxConcurrent: options.concurrency ?? 1, minTime: 0 }),
        onRateLimit: () => false,
        onSecondaryRateLimit: () => false,
      },
    });
  }

  /** Takes `login` off the reviewers a PR asks for: the one write of this client, on the user's click. */
  async removeReviewer(key: string, login: string) {
    const [owner, repo, number] = key.split(/[/#]/) as [string, string, string];
    await this.octokit.request('DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', {
      owner,
      repo,
      pull_number: Number(number),
      reviewers: [login],
    });
  }

  /**
   * The data of a query, the aliases GitHub could not resolve left null; `null` when stopped, or when GitHub failed on the
   * whole query (a 502 on a heavy batch, to be split by the caller).
   */
  async query(text: string, { searches = 0, countFailure = true } = {}): Promise<Data | null> {
    if (this.stopped) return null;
    if (this.remaining !== null && this.remaining < (this.options.reserve ?? 500)) {
      this.stopped = `quota GraphQL bas (${this.remaining}), reprise après ${this.resetAt}`;
      return null;
    }
    if (searches) await this.paced(searches);
    return this.slots.run(async () => {
      for (let attempt = 0; ; attempt++) {
        if (this.stopped) return null;
        await Bun.sleep(Math.max(0, this.lastCall + this.pause - Date.now()));
        this.lastCall = Date.now();
        let data: Data | null;
        try {
          data = (await this.octokit.graphql(text)) as Data;
        } catch (error) {
          const wait = attempt ? null : this.limitedFor(error as Failure);
          if (wait !== null) {
            this.waited += wait;
            await Bun.sleep(wait);
            continue;
          }
          data = this.failed(error as Failure, countFailure);
        }
        this.calls++;
        const rate = data?.rateLimit;
        if (rate) {
          this.spent += rate.cost;
          [this.remaining, this.resetAt] = [rate.remaining, rate.resetAt];
        }
        return data;
      }
    });
  }

  /** How long to wait on GitHub's secondary limit, as it says or a minute; null for any other failure, or past three. */
  private limitedFor(error: Failure) {
    const headers = error.response?.headers ?? {};
    if ((error.status !== 403 && error.status !== 429) || headers['x-ratelimit-remaining'] === '0' || ++this.limits > 3) return null;
    this.pause = this.options.slowPause ?? 2000;
    return 1000 * Number(headers['retry-after'] ?? 60);
  }

  private failed(error: Failure, countFailure: boolean) {
    // Some aliases failed (an unknown login, a PR gone): the others' data stands.
    if (error.name === 'GraphqlResponseError' && error.data && Object.keys(error.data).length) return error.data;
    const headers = error.response?.headers ?? {};
    if (error.status === 401) this.stopped = 'jeton GitHub refusé';
    else if ((error.status === 403 || error.status === 429) && headers['x-ratelimit-remaining'] === '0')
      this.stopped = `quota GitHub épuisé, reprise après ${new Date(Number(headers['x-ratelimit-reset'] ?? 0) * 1000).toLocaleTimeString('fr')}`;
    else if (error.status === 403 || error.status === 429)
      this.stopped = 'limite secondaire de GitHub atteinte trop souvent : reprise au prochain rafraîchissement';
    else if (error.status && error.status >= 500) {
      if (error.status === 502 || error.status === 504) this.timeouts++;
      if (countFailure && ++this.failures >= 3) this.stopped = 'GitHub renvoie des erreurs 5xx, arrêt pour cette collecte';
    } else this.stopped = error.message.slice(0, 200);
    return null;
  }

  /**
   * Searches within GitHub's secondary limit, about 20 a minute: a burst of 10 at once, then one every 3 seconds. A short
   * refresh goes at full speed, a long collection at the pace the V1 found safe.
   */
  private paced(searches: number) {
    const every = 3 * (this.options.searchPause ?? 1000);
    const turn = this.searching.then(async () => {
      const refill = () => {
        const now = Date.now();
        this.searchTokens = Math.min(10, this.searchTokens + (every ? (now - this.refilled) / every : 10));
        this.refilled = now;
      };
      refill();
      if (this.searchTokens < searches) {
        await Bun.sleep((searches - this.searchTokens) * every);
        refill();
      }
      this.searchTokens -= searches;
    });
    this.searching = turn;
    return turn;
  }
}

/** The token given to the server (GH_TOKEN), else the GitHub CLI's when it is installed and logged in. */
export async function ghToken() {
  const given = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (given) return given;
  try {
    const proc = Bun.spawn(['gh', 'auth', 'token'], { stdout: 'pipe', stderr: 'ignore' });
    const token = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 && token ? token : null;
  } catch {
    return null;
  }
}
