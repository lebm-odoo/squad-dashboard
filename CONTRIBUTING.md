# Contributing

## Branches

- `master` holds released versions only: the installed apps follow it, and **Update and restart** takes what is there. It is
  protected: every change comes through a pull request.
- Work happens on short branches from `master`: `fix/<what>` for a fix, `feat/<what>` for a new feature.
- A pull request into `master` is a release: it bumps `VERSION` and adds its section to `CHANGELOG.md`. The checks refuse it
  otherwise.
- To ship several fixes or features as one version, merge their pull requests into `next` (no version bump needed there),
  then open one pull request from `next` into `master` with the bump and the changelog.

## Versions

[Semantic versioning](https://semver.org/), in `VERSION`:

| Change | Bump | Example |
| --- | --- | --- |
| a fix | patch | 1.2.0 → 1.2.1 |
| a new feature, compatible | minor | 1.2.1 → 1.3.0 |
| something to redo on each install (a requirement, the config) | major | 1.3.0 → 2.0.0 |

`CHANGELOG.md` gets a `## X.Y.Z - YYYY-MM-DD` section with one line per change, written for the people who use the page:
the app shows these lines when a new version is available.

Once merged into `master`, the release workflow tags `vX.Y.Z` and publishes a GitHub release with the changelog section.
Prefer **Squash and merge**: one commit per pull request, its title as the subject.

## Checks

On every pull request into `master` (`.github/workflows/checks.yml`): the collector compiles, the script of the page
parses, `VERSION` is greater than on `master`, and `CHANGELOG.md` has its section. To run the first two locally:

```sh
python3 -m py_compile collector.py
sed -n '/^<script>$/,/^<\/script>$/p' index.html | sed '1d;$d' > /tmp/page.js && node --check /tmp/page.js
```

## Protecting `master`

Once the repository is on GitHub, an admin of the repository protects `master` (Settings → Branches → Add rule, or
Settings → Rules → Rulesets): require a pull request with at least one approval, require the `checks` status check, and
block force-pushes and deletion. With `gh`:

```sh
gh api -X PUT repos/<owner>/<repo>/branches/master/protection --input - <<'JSON'
{
  "required_status_checks": {"strict": true, "contexts": ["checks"]},
  "enforce_admins": false,
  "required_pull_request_reviews": {"required_approving_review_count": 1},
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Protected branches on a private repository need a paid GitHub plan for its owner (an organisation on GitHub Team or
Enterprise); on a public repository they are free.
