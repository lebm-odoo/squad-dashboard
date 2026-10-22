/** The squad dashboard's data, as /api/squad/data sends it: the shape the squad dashboard read from its data.json. */
export type Linked = { repo: string; number: number; branch: string; state: string };

export type Pr = {
  repo: string;
  number: number;
  state: 'open' | 'merged' | 'closed';
  title?: string;
  draft?: boolean;
  ci?: Record<string, string>;
  linked?: Linked[];
  blocked?: boolean;
  missing_r?: boolean;
  /** The mergebot's review status of this PR alone: ok once it has its r+. */
  review?: string;
  phase?: string;
  mergebot_url?: string;
  url?: string;
  merged_at?: number | null;
  desc_words?: number;
};

export type Received = { who: string; state: string; at: number };

export type Feature = {
  name: string;
  title?: string;
  owner: string;
  contributors?: string[];
  kind: 'feature' | 'fix' | 'stable' | 'onboarding' | 'forward-port';
  version: string;
  status: 'merged' | 'open' | 'closed' | 'wip';
  merged_at?: number | null;
  deleted?: boolean;
  noisy?: boolean;
  prs: Pr[];
  pushes: { at: number; kind: string; repo: string; delta?: number; added_commits?: number; sha?: string; src?: string }[];
  commits: Commit[];
  gh?: { received: Received[]; opened_at?: number | null; first_review_delay?: number | null } | null;
  tasks: string[];
  topics?: Record<string, number>;
  domain?: string;
  fw_of?: string;
  port_of?: string;
  runbot?: { id: number; url: string } | null;
  reviewers: string[];
  rplus?: Record<string, number>;
  branches: Record<string, { url: string; base_ref?: string }>;
  modules: Record<string, number>;
  opws: string[];
  countries: string[];
  profile?: Record<string, number>;
  complexity?: number;
  coauthored?: boolean;
  commit_count?: number;
  test_lines?: number;
  new_models?: number;
  new_fields?: number;
  migration_lines?: number;
  mechanical?: number;
  weighted?: number;
  size?: number;
  files?: number;
  ins?: number;
  dels?: number;
  new_tests?: number;
  complexity_factors?: Record<string, number>;
  /** The weighted lines by kind of file: its lines, the mechanical ones among them, its weight, what it brought. */
  weight_parts?: Record<string, { ins: number; dels: number; mechanical: number; weight: number; weighted: number }>;
};

export type Commit = { email?: string; at: number; ct?: number; subject?: string; sha?: string; repo?: string; merged?: boolean };

export type Review = {
  id: string;
  reviewer: string;
  pr: string;
  t: number;
  author: string;
  subject?: string;
  src: string;
  state?: string;
  fw?: boolean;
  onboarding?: boolean;
  feature?: string;
  target?: string;
};

export type Task = {
  id: number;
  name: string;
  project?: string;
  stage?: string;
  stage_id?: number;
  state: string;
  people: string[];
  squad: string[];
  reviewer?: string | null;
  tags: string[];
  parent?: { id: number; name: string } | null;
  stage_since?: number | null;
  created?: number | null;
  updated?: number | null;
  links?: { prs?: string[]; branches?: string[]; bundles?: number[] };
  changes?: [number, string, string][];
};

export type ReviewedPr = {
  state: string;
  merged_at: number | null;
  blocked: boolean;
  missing_r: boolean;
  branch: string | null;
  linked: Linked[];
  tasks: string[];
  url?: string;
};

export type Request = {
  pr: string;
  url: string;
  title: string;
  draft?: boolean;
  author?: string;
  who?: string | null;
  /** The branch of the PR. */
  head?: string;
  /** The branch it targets: a PR retargeted keeps the version of its first target in its name. */
  base?: string;
  created_at: number;
  asked_at?: number | null;
  direct?: boolean;
  teams: string[];
  other_teams: number;
  ids: Record<string, string[]>;
  /** By my squad or a member of my GitHub teams. */
  colleague?: boolean;
  validations: [string, string, number][];
  rplus: [string, number][];
  /** When I gave it the r+: no longer mine to review, followed until merged and ported. */
  rplus_at?: number;
  /** What can undo the r+: whether GitHub merges it (`CONFLICTING`), its last push, the r- given to it. */
  mergeable?: string | null;
  pushed_at?: number | null;
  rminus?: [string, number][];
};

export type SquadData = {
  generated_at: number | null;
  me: string;
  squad: { lead: string; members: string[] } | null;
  org: { squads: Record<string, string[]>; arrivals: Record<string, string> };
  review_requests: {
    login: string;
    at: number;
    total: number;
    prs: Request[];
    followed?: Request[];
    teams?: string[];
    complete?: boolean;
  } | null;
  version_forks: Record<string, number>;
  features: Feature[];
  reviews: Review[];
  reviewed_prs: Record<string, ReviewedPr>;
  odoo: {
    tasks: Record<string, Task>;
    stages: Record<string, { fold?: boolean }>;
    at: number | null;
    error: string | null;
    not_found: string[];
  };
  logins: Record<string, string | null>;
};
