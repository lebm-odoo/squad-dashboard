# Changelog

Each version has its section, the newest first, its lines written for the people who use the dashboard: Settings › About
shows the notes of the latest release. Versions follow [semantic versioning](https://semver.org/): a fix bumps the patch
(2.0.1), a new feature the minor (2.1.0), a change that needs something from the users (a new requirement, a config to redo,
data to take over) the major (3.0.0). Changes not released yet go under `## Unreleased`; `bun run release` makes them the
version's.

## Unreleased

- The dashboard opens in its own window from the launcher when it runs in Docker too: `scripts/app.sh install docker`.
  Docker starts it again after a reboot.

## 2.0.0 - 2026-10-22

- A new app, to install again: a Bun server with its PostgreSQL database and a page of several pages, in place of
  `collector.py` and `index.html`. It needs Bun 1.4 and PostgreSQL, or Docker: after updating, follow the README, and run
  `bun run import-v1` once to keep the history, the to-dos and the task changes of this version.
- The first page asks what to follow: me alone, or me and my squad; it starts from the squad of the config.json already
  there.
- Me, where the page opens: today, what waits for me, what I am on and what waits for others, the most pressing
  first; my work and my journey, apart from the squad's.
- The work of others I touch shows whole: a review asked of me or given, the PRs of my tasks, with their versions,
  forward-ports, task and reviews. Only these PRs and branches are read, not the rest of their authors' work.
- One card for a piece of work, opened from a feature, a PR or a task anywhere: the stages of its task up to deployment,
  its versions and forward-ports, its reviews, its history, the measures of its size and complexity.
- Odoo tasks of the squad, with an API key of www.odoo.com, read only: their stage on each feature, the review column of
  my pipe, every change of stage kept.
- Me keeps itself up to date while the page is in sight: the reviews asked, the tasks, and the PRs of my desk that moved,
  every 5 minutes and when coming back to the page.
- A review asked of me can be set aside; asked of me directly, I am taken off its reviewers on GitHub. One I gave the r+ to
  stays on Me until the mergebot merged and ported it, and comes back when a push, an r- or a conflict undoes the r+.
- A review asked by a colleague, my squad or the members of my GitHub teams, is set aside: its task and the pipe follow it.
- A reviewer outside the squad is named by their trigram, read from the r+ they gave, rather than by their GitHub login.
- Settings: who I am and my squad, the GitHub logins and the months of arrival, the connections, the collection, the
  display, the data and the version.
- English by default, French from the first page or the settings; light and dark theme; a search of pages, people and
  features (Ctrl K).
- The app is named Dashboard, its logo a D in shades of green; an opening screen once a session, the logo drawing
  itself; the first page shows the logo too.
- In its own window from the application launcher: `scripts/app.sh install`. In Docker: `docker compose up -d --build`,
  the keys pasted on the first page.
- Settings › About tells when a new version is out; `scripts/update.sh` installs it after saving the database.

## 1.0.1 - 2026-10-10

- The update banner only shows for a new version, not for a change of the documentation.

## 1.0.0 - 2026-10-10

- Squad: everyone on one screen, what they are on, merged and reviewed lately.
- Work: the features written and reviewed in one list, or a day by day timeline.
- Journey: one person or the squad against their own past, a reading of the period, questions for a 1:1 kept apart.
- Me: to-dos with references and comments, the reviews GitHub asks of you, what the squad waits for, your own work.
- GitHub logins of the squad, checked and forced from the page.
- The r+ dated by their `robodoo r+` comment, not by the merge.
- A banner when the data is more than a day old, another when a new version of the app is available.
