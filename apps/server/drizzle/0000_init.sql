CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_entry" (
	"section" text NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_entry_section_key_pk" PRIMARY KEY("section","key")
);
--> statement-breakpoint
CREATE TABLE "dashboard_feature" (
	"name" text PRIMARY KEY NOT NULL,
	"owner" text,
	"archived" boolean NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_part" (
	"part" text PRIMARY KEY NOT NULL,
	"data" jsonb,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_review" (
	"id" text PRIMARY KEY NOT NULL,
	"reviewer" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_branch" (
	"repo" text NOT NULL,
	"name" text NOT NULL,
	"head" text NOT NULL,
	"owner" text,
	"url" text,
	"on_remote" boolean,
	"contributors" text[] DEFAULT '{}' NOT NULL,
	"base" text,
	"base_ref" text,
	"commit_count" integer,
	"noisy" boolean,
	"patch_id" text,
	"commits" jsonb,
	"files" jsonb,
	"trailers" jsonb,
	"coauthors" text[],
	"new_models" integer,
	"new_fields" integer,
	"new_tests" integer,
	CONSTRAINT "git_branch_repo_name_pk" PRIMARY KEY("repo","name")
);
--> statement-breakpoint
CREATE TABLE "git_commit" (
	"repo" text NOT NULL,
	"sha" text NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"ct" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"files" jsonb NOT NULL,
	"root_author" text,
	"ordinal" integer NOT NULL,
	CONSTRAINT "git_commit_repo_sha_pk" PRIMARY KEY("repo","sha")
);
--> statement-breakpoint
CREATE TABLE "git_contribution" (
	"repo" text NOT NULL,
	"branch" text NOT NULL,
	"people" text[] NOT NULL,
	CONSTRAINT "git_contribution_repo_branch_pk" PRIMARY KEY("repo","branch")
);
--> statement-breakpoint
CREATE TABLE "git_mechanical" (
	"repo" text NOT NULL,
	"revs" text NOT NULL,
	"lines" jsonb NOT NULL,
	CONSTRAINT "git_mechanical_repo_revs_pk" PRIMARY KEY("repo","revs")
);
--> statement-breakpoint
CREATE TABLE "git_push" (
	"repo" text NOT NULL,
	"branch" text NOT NULL,
	"sha" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"delta" integer NOT NULL,
	"added_commits" integer NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "git_push_repo_branch_sha_at_pk" PRIMARY KEY("repo","branch","sha","at")
);
--> statement-breakpoint
CREATE TABLE "git_snapshot" (
	"repo" text NOT NULL,
	"head" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "git_snapshot_repo_head_pk" PRIMARY KEY("repo","head")
);
--> statement-breakpoint
CREATE TABLE "git_transition" (
	"repo" text NOT NULL,
	"old" text NOT NULL,
	"next" text NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"delta" integer NOT NULL,
	"added_commits" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"sha" text NOT NULL,
	CONSTRAINT "git_transition_repo_old_next_logged_at_pk" PRIMARY KEY("repo","old","next","logged_at")
);
--> statement-breakpoint
CREATE TABLE "github_force_push" (
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"after" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"before" text,
	"actor" text,
	"kind" text NOT NULL,
	"delta" integer NOT NULL,
	CONSTRAINT "github_force_push_repo_number_after_at_pk" PRIMARY KEY("repo","number","after","at")
);
--> statement-breakpoint
CREATE TABLE "github_pr" (
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"title" text,
	"author_login" text,
	"head_ref" text,
	"head_owner" text,
	"state" text,
	"merged_at" timestamp with time zone,
	"tasks" text[],
	"opws" text[],
	"desc_words" integer,
	"draft" boolean,
	"created_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"additions" integer,
	"deletions" integer,
	"changed_files" integer,
	"comments" integer,
	"ready_at" timestamp with time zone[],
	"fetched_at" timestamp with time zone,
	CONSTRAINT "github_pr_repo_number_pk" PRIMARY KEY("repo","number")
);
--> statement-breakpoint
CREATE TABLE "github_review" (
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"login" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"detailed" boolean DEFAULT false NOT NULL,
	"searched" boolean DEFAULT false NOT NULL,
	CONSTRAINT "github_review_repo_number_login_submitted_at_state_pk" PRIMARY KEY("repo","number","login","submitted_at","state")
);
--> statement-breakpoint
CREATE TABLE "github_rplus" (
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"login" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "github_rplus_repo_number_login_at_pk" PRIMARY KEY("repo","number","login","at")
);
--> statement-breakpoint
CREATE TABLE "github_rplus_scan" (
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"missing" boolean DEFAULT false NOT NULL,
	CONSTRAINT "github_rplus_scan_repo_number_pk" PRIMARY KEY("repo","number")
);
--> statement-breakpoint
CREATE TABLE "mergebot_pr" (
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"state" text NOT NULL,
	"phase" text,
	"draft" boolean,
	"blocked" boolean,
	"missing_r" boolean,
	"review" text,
	"title" text,
	"created_by" text,
	"label" text,
	"merged_at" timestamp with time zone,
	"merged_by" text,
	"ci" jsonb,
	"linked" jsonb,
	"desc_words" integer,
	"tasks" text[],
	"opws" text[],
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mergebot_pr_repo_number_pk" PRIMARY KEY("repo","number")
);
--> statement-breakpoint
CREATE TABLE "odoo_task" (
	"id" integer PRIMARY KEY NOT NULL,
	"data" jsonb,
	"changes" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_login" (
	"member" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runbot_bundle" (
	"name" text PRIMARY KEY NOT NULL,
	"bundle_id" integer NOT NULL,
	"url" text NOT NULL,
	"branches" jsonb NOT NULL,
	"prs" jsonb NOT NULL,
	"batches" jsonb NOT NULL,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_cursor" (
	"source" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_cursor_source_key_pk" PRIMARY KEY("source","key")
);
--> statement-breakpoint
CREATE TABLE "v1_archive" (
	"file" text NOT NULL,
	"section" text NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "v1_archive_file_section_key_pk" PRIMARY KEY("file","section","key")
);
