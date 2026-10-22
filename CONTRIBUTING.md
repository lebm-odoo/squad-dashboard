# Contributing

`master` holds the released versions: the installed dashboards update to its tags. Every change comes through a pull
request into `master`.

## A change, from start to end

```sh
gh repo clone lebm-odoo/squad-dashboard && cd squad-dashboard   # once
bun install

git fetch origin
git switch -c fix/board-alignment origin/master                 # fix/<what> or feat/<what>
bun run dev                                                     # try it: server on :8766, page on :5173
```

In the same branch, note what changes for the people who use the dashboard under `## Unreleased` in `CHANGELOG.md`, one
line per change:

```md
## Unreleased

- Squad: the board keeps its columns aligned on narrow screens.
```

Then the checks, and the pull request:

```sh
bun run check
TEST_DATABASE_URL='postgres:///postgres?host=/var/run/postgresql' bun run test
git commit -am "Squad: the board keeps its columns aligned on narrow screens"
git push -u origin fix/board-alignment
gh pr create --base master --fill
```

The pull request becomes **one commit** on `master`, whose message is its title and description: write them like a commit
message (what, and why), and keep them right if the review changes things. After a review: **Squash and merge**.

If `master` moved in the meantime, put the branch on top of it (`git rebase origin/master`, then
`git push --force-with-lease`); `master` itself is never force-pushed.

A pull request that only touches the documentation or the workflows needs no line in the changelog.

## A release

A release is a pull request too, made of the changes already under `## Unreleased`, or the last change with its own:

```sh
bun run release patch   # or minor, major, or a number: the checks, then the CHANGELOG section and package.json in one commit
```

Once it is merged, the release workflow sees a version of `package.json` not tagged yet: it runs the checks again, tags
`master` with `vX.Y.Z` and publishes the GitHub release with the notes of its section. The installed dashboards show it in
Settings › About, and `scripts/update.sh` installs it.

| Change | Bump | Example |
| --- | --- | --- |
| a fix | patch | 2.1.0 → 2.1.1 |
| a new feature, compatible | minor | 2.1.1 → 2.2.0 |
| something to redo on each install (a requirement, the config, data to take over) | major | 2.2.0 → 3.0.0 |

## Checks

On every pull request (`.github/workflows/ci.yml`): Biome, TypeScript and svelte-check (`bun run check`), the tests
against a PostgreSQL (`bun run test`), the build of the page and of the Docker image.
