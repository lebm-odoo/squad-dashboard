# Contributing

`master` holds the released versions: the installed apps follow it, and **Update and restart** takes what is there. Every
change comes through a pull request into `master`, and each one that changes the app (`collector.py`, `index.html`) is a
new version.

## A change, from start to end

```sh
gh repo clone lebm-odoo/squad-dashboard && cd squad-dashboard   # once

git fetch origin
git switch -c fix/board-alignment origin/master                 # fix/<what> or feat/<what>
# edit, try it with python3 collector.py
```

Then, in the same branch, the new version:

- `VERSION`: the next version (see below), e.g. `1.0.1` → `1.0.2`;
- `CHANGELOG.md`: its section on top, one line per change, written for the people who use the page (the update banner
  shows these lines):

  ```md
  ## 1.0.2 - 2026-10-20

  - Board: fix the alignment on narrow screens.
  ```

```sh
git add -A
git commit -m "Board: fix the alignment on narrow screens"
git push -u origin fix/board-alignment
gh pr create --base master --fill
```

The pull request becomes **one commit** on `master`, whose message is the title and description of the pull request:
write them like a commit message (what, and why), and keep them right if the review changes things. Commits like
"fix review" can stay in the branch: they disappear at the merge.

After a review: **Squash and merge**. The release workflow then tags `v1.0.2`, publishes the release with the changelog
section, and the installed apps show their update banner.

If `master` moved in the meantime (another pull request merged), put your branch on top of it:

```sh
git fetch origin
git rebase origin/master
# a conflict on VERSION or CHANGELOG.md: keep the other version's section, put yours on top with the version after it
git add VERSION CHANGELOG.md && git rebase --continue
git push --force-with-lease
```

Your own branch can be rebased and force-pushed (`--force-with-lease` refuses if someone else pushed to it); `master`
never: no direct push, no force.

A pull request that only touches the documentation or the workflows needs no new version: the apps take it with the next
one, without a banner.

## Versions

[Semantic versioning](https://semver.org/), in `VERSION`:

| Change | Bump | Example |
| --- | --- | --- |
| a fix | patch | 1.2.0 → 1.2.1 |
| a new feature, compatible | minor | 1.2.1 → 1.3.0 |
| something to redo on each install (a requirement, the config) | major | 1.3.0 → 2.0.0 |

## Checks

On every pull request into `master` (`.github/workflows/checks.yml`): the collector compiles, the script of the page
parses, and when the app changed, `VERSION` is greater than on `master` and `CHANGELOG.md` has its section. To run the
first two locally:

```sh
python3 -m py_compile collector.py
sed -n '/^<script>$/,/^<\/script>$/p' index.html | sed '1d;$d' > /tmp/page.js && node --check /tmp/page.js
```
