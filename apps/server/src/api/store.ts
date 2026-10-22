import type { CollectSettings, DashboardConfig, Todo } from '@sd/shared';
import type { Feature, MergebotPr } from '../domain/features';
import type { Release } from '../release';

export type FeatureQuery = {
  /** Owner or contributor. */
  person?: string[];
  owner?: string[];
  kind?: string[];
  status?: string[];
  archived?: boolean;
  /** Words of the name or the title. */
  q?: string;
  /** Last activity, in seconds. */
  since?: number;
  until?: number;
  sort: 'last_at' | 'first_at' | 'merged_at' | 'size' | 'weighted' | 'complexity' | 'name';
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
};
export type ReviewQuery = {
  reviewer?: string[];
  author?: string[];
  since?: number;
  until?: number;
  limit: number;
  offset: number;
};
/** A feature without what only its own page shows: its PRs, commits, pushes, branches, runbot and GitHub details. */
export type FeatureSummary = Omit<Feature, 'prs' | 'commits' | 'pushes' | 'runbot' | 'gh' | 'complexity_factors' | 'branches'> & {
  pr_count: number;
};

/** Where each source stands: the last collection, each clone's reading, each network source's status. */
export type SourcesState = {
  collect: unknown;
  git: Record<string, { fetched_at: number | null; since: number; read_at: number }>;
  web: unknown;
  github: unknown;
  odoo: unknown;
};

/** The dashboard as the routes read it, whatever stores it. */
export interface DashboardStore {
  features(query: FeatureQuery): Promise<{ total: number; items: FeatureSummary[] }>;
  feature(name: string): Promise<Feature | null>;
  reviews(query: ReviewQuery): Promise<{ total: number; items: Record<string, unknown>[] }>;
  part<T>(name: string): Promise<{ data: T; computedAt: number } | null>;
  /** What a collection read last of a source, before any computing: Moi's reviews asked, read a few seconds ago. */
  cursor<T>(source: string, key: string): Promise<T | null>;
  sources(): Promise<SourcesState>;
  versionForks(): Promise<Record<string, number>>;
  tasks(people: string[]): Promise<Record<string, unknown>[]>;
  /** Every feature of these people, whole: the squad's pages compute on them, as the squad dashboard did. */
  featuresOf(people: string[]): Promise<Feature[]>;
  /** The features holding these PRs or named so, whoever wrote them, with their forward-ports and their ports by hand. */
  featuresLinked(prs: string[], names: string[]): Promise<Feature[]>;
  reviewsOf(people: string[]): Promise<Record<string, unknown>[]>;
  /** Mergebot's pages of these PRs, those it knows. */
  mergebot(keys: string[]): Promise<Record<string, MergebotPr & { fetched: number }>>;
  /** The squad's Odoo tasks by id, the stages they are in, and the last reading. */
  odoo(): Promise<{ tasks: Record<string, unknown>; stages: Record<string, unknown>; at: number | null; not_found: string[] }>;
}

export type Check = { ok: boolean; detail: string };
/** Where a key comes from: the vault, a Docker secret, the server's environment, the host's tools (gh, the keyring), nowhere. */
export type KeySource = 'vault' | 'secret' | 'env' | 'host' | 'none';
export type ConnectionChecks = {
  github: Check & { source: KeySource; login?: string; scopes?: string[]; remaining?: number };
  odoo: Check & { source: KeySource; user?: string };
  clones: (Check & { repo: string; path: string; remotes: Record<string, string>; fetched_at: number | null })[];
  runbot: Check;
  mergebot: Check;
};
export type LoginRow = { member: string; login: string; source: string; forced: string; rejected: string };
/** This version and the latest release, as the last check read it. */
export type UpdateState = {
  current: string;
  repo: string;
  runtime: 'bun' | 'docker';
  /** The commit of the code that answers, and when its server started: an old server still running shows. */
  commit: string | null;
  started_at: number;
  latest: Release | null;
  newer: boolean;
  checked_at: number | null;
  error: string | null;
};

/** What the settings read and change, beyond config.json and the secrets. */
export interface SettingsPort {
  saveConfig(
    patch: Partial<Pick<DashboardConfig, 'me' | 'follow' | 'github_logins' | 'arrivals'>> & { squad?: DashboardConfig['squad'] | null },
  ): Promise<DashboardConfig>;
  loginReport(): Promise<LoginRow[]>;
  todos(): Promise<Todo[]>;
  saveTodos(todos: Todo[]): Promise<Todo[]>;
  collectSettings(): Promise<CollectSettings>;
  saveCollectSettings(settings: CollectSettings): Promise<CollectSettings>;
  /** Reads each connection once: run on a click, never on its own. */
  check(): Promise<ConnectionChecks>;
  dataStats(): Promise<{ size: number; tables: Record<string, number> }>;
  derive(): Promise<{ features: number; reviews: number; seconds: number }>;
  updates(): Promise<UpdateState>;
  /** Reads the latest release on GitHub: on a click, and with each full collection, never on its own. */
  checkUpdates(): Promise<UpdateState>;
  /** The review requests set aside by a click, and when: one asked again since shows again. */
  discardedRequests(): Promise<Record<string, number>>;
  /** Sets a review request aside, and takes me off its reviewers on GitHub when asked of me directly and not given my r+. */
  discardRequest(pr: string): Promise<{ removed: boolean; error: string | null }>;
}
