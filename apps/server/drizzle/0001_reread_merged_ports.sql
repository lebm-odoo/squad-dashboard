-- The pages of the PRs merged this month were read without the detached forward-ports nor the merge date of each port:
-- dated back to their merge, they are read once more.
UPDATE "mergebot_pr" SET "fetched_at" = "merged_at" WHERE "state" = 'merged' AND "merged_at" > now() - interval '30 days';
