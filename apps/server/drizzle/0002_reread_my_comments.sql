-- PRs closed by the mergebot were left out of the r+ I gave unasked: my comments of the month are read once more.
UPDATE "sync_cursor" SET "value" = "value" - 'comments_from' WHERE "source" = 'github' AND "key" = 'requests';
