# Squad dashboard

A local page for a squad leader: what each person of the squad is working on, what they reviewed, and how their own work
evolves. It is meant to be shown in front of the whole squad: no ranking, no score, nobody compared with anybody.

## What it shows

- **Squad**: everyone on one screen, one row per member: what they are on now, what they merged and reviewed lately.
- **Work**: the features written and reviewed in one list (reviewers, forward-ports, details on click), or as a day by day
  timeline.
- **Journey**: one person, or the squad, over 3, 6 or 12 months or since their arrival, against their own past only: a
  reading of the period (what went well, notable achievements), the activity week by week, the trend month by month, the
  topics. Questions for a 1:1 stay in a block closed by default.
- **Me**, for the squad leader, in three blocks:
  - *To do*: your to-dos, and the reviews GitHub asks of you, directly then through your GitHub teams (code owners), dated
    by the last request, with the origin of the PR in colour (`opw` customer bug, `sentry` error or slowness from a customer
    database, `upg` upgrade, `task` R&D task); set aside when already r+, already validated by a teammate, or a PR of the
    team routed through a GitHub team;
  - *The squad*: its PRs ready for a review, the forward-ports blocked on the mergebot, who reviews each member;
  - *My work*: what you are on, merged and reviewed, over the period chosen there.

A to-do is a comment (several lines) about a reference: a feature, a PR (a review asked of you, one you gave) or the journey
of a person. The **+** of any of them, everywhere on the page, adds one with a comment written right away; what has an open
to-do is marked everywhere, and a to-do whose PR waits for your review stands out. To-dos are kept in `todos.json`.

## Requirements

- Python 3, no dependency.
- The `odoo`, `enterprise` and `upgrade` clones in one folder, by default the parent of this one (else `--root`).
- The `dev` remote (odoo-dev) in `odoo` and `enterprise`, `origin` in `upgrade`.
- `git config user.email` set to `<trigram>@odoo.com` in the `odoo` clone.
- [`gh`](https://cli.github.com/) logged in (`gh auth login`), else `--no-github`. With the `read:org` scope, the page also
  knows your GitHub teams and their members.

## Run

```sh
python3 collector.py
```

Then open http://127.0.0.1:8766/, give your trigram and your squad's, and the collection starts. The first one reads two
years of history for each person: it takes a while. Nothing runs in the background: **↻ Update** reads everything again,
**↻ Reload my reviews** (in Me) only the reviews asked of you, in a few seconds. A banner tells when the data is more than a
day old.

Only the squad is read: its branches on odoo-dev (a targeted `git fetch`), its merged commits and r+ in git, runbot and
mergebot for its PRs, and on GitHub its PRs, its reviews, the review requests of the lead and the `robodoo r+` comments that
date each r+ (the commit of an r+ is dated by the merge, which the mergebot does on its own later).

Without the server, `index.html` also opens directly on the last data collected.

### Updating the app

At start, then every hour, the collector runs a `git fetch` of its own clone. When its upstream branch has new commits, a
banner says so with **Update and restart**: a fast-forward (`git merge --ff-only`), then the collector restarts on the new
code and the page reloads. It needs a git clone with an upstream branch and access to its remote (the same keys as for
cloning it). A clone with local changes or commits is never touched: the banner then asks for a `git pull` by hand. The
squad icon of the header shows the version, when it was checked, and **Check now**.

## Configuration

`config.json` is created on the first run and filled by the page; it can also be edited by hand (read again on the fly).
See `config.example.json`. The squad icon of the header opens the squad and its **GitHub logins**: the login used for each
person and where it comes from (their branches, their PRs, the account of the token, forced), to check them and force a
wrong or unknown one.

| Key | Content |
| --- | --- |
| `lead` | your trigram |
| `members` | the trigrams of the squad |
| `github_logins` | `{"trigram": "login"}` when a GitHub login is not deduced from the PRs |
| `arrivals` | `{"trigram": "YYYY-MM"}`: work before that month is not counted, and Journey can start there |

## Data

`cache.json`, `history.json`, `data.json`, `data.js` and `todos.json` are generated and stay local: they hold data of
private repositories, do not share them. `history.json` keeps what git, runbot and GitHub end up forgetting (pushes seen by
the reflogs, deleted branches): do not delete it.

To start from an existing `history.json` of the same format, set the squad up first, then:

```sh
python3 collector.py --import-history path/to/history.json
```

Only the people of the squad are taken over; what is already here is kept.

## Versions

The version installed is in `VERSION`, what each version brings in `CHANGELOG.md`. `master` holds released versions only:
see `CONTRIBUTING.md` for the branches, the version bumps and the checks of a pull request.

## Options

| Option | Effect |
| --- | --- |
| `--root` | folder of the clones |
| `--port` | port of the server (8766) |
| `--since-days` | depth read in git for the merges and the reviews (730) |
| `--fetch` / `--no-fetch` | also `git fetch` on a git-only update / never |
| `--github-budget` | GraphQL calls at most per collection (40) |
| `--github-rplus-budget` | GraphQL calls at most per collection to date the r+ (25, 20 PRs per call), resumed at the next update |
| `--no-github` | do not read GitHub |
| `--once` | collect once, then quit |
| `--import-history FILE` | take over a `history.json` of the same format for the squad, then quit |
