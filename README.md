# Dashboard

A local dashboard for an R&D developer and their squad, once named the squad dashboard: what waits for you today, your
work and your reviews first, then, when you follow your squad, what each of its people is on and how their work evolves.

## What it shows

- **Me**, where the page opens:
  - *Today*: what waits for you, what you are on and what waits for others, the most pressing first: your code (changes
    asked, CI failing, blocked on the mergebot, forward-ports that need a hand), the reviews GitHub asks of you, directly
    then through your GitHub teams (code owners), and the review column of your pipe in Odoo; your to-dos; what you merged
    and reviewed over the last 2 weeks to 3 months.
  - *My work*: your features and reviews in one list, or as a day by day timeline.
  - *My journey*: you against your own past, over 3, 6 or 12 months or since your arrival.

  The work of others you touch shows whole: a review asked of you or given, the PRs of one of your tasks, with their
  versions, forward-ports, task and reviews.
- **Squad**, when you follow it: everyone on one screen, what they are on, merged and reviewed lately, what the squad waits
  for; its work and its journeys, person by person.
- **One card** for a piece of work, opened from a feature, a PR or a task anywhere: the stages of its task up to
  deployment, its versions and forward-ports, its reviews, its history, the measures of its size and complexity.

A to-do is a comment about a reference: a feature, a PR, a task or the journey of a person. The **+** of any of them adds
one; what has an open to-do is marked everywhere.

## Requirements

- [Bun](https://bun.sh) 1.4 and a local PostgreSQL reachable through its socket, or Docker with Compose.
- The `odoo`, `enterprise` and `upgrade` clones in one folder, by default the parent of this one.
- The `dev` remote (odoo-dev) in `odoo` and `enterprise`, `origin` in `upgrade`.
- `git config user.email` set to `<trigram>@odoo.com` in the `odoo` clone: it tells who you are.
- [`gh`](https://cli.github.com/) logged in (`gh auth login`), or a token given in Settings › Connections. With the
  `read:org` scope, the dashboard also knows your GitHub teams and their members.
- Optional: an API key of www.odoo.com, to read the tasks of the squad (see [Odoo](#odoo)).

## Run

```sh
bun install
bun run build   # the page, in apps/web/build: again after each update of the code
bun run start   # http://localhost:8766
```

The `squad_dashboard` database is created and migrated at the first start. The GitHub token comes from `gh auth token`,
the Odoo key from the keyring, and who you are from your git e-mail.

### In its own window

The dashboard also opens alone, in a Chrome window without tabs or address bar, from the application launcher:

```sh
scripts/app.sh install   # once: "Dashboard" in the launcher (~/.local/share/applications)
scripts/app.sh           # what the launcher runs
```

The script starts the server when none answers on the port; that server stops on its own 30 seconds after its last window
closed, once a running collection is over. Its log goes to `~/.local/share/squad-dashboard/server.log`, Chrome's to
`chrome.log` next to it. The window has its own Chrome profile, and
the links to GitHub, mergebot or runbot open in the default browser, where you are logged in. For the compositor, the
window is `chrome-127.0.0.1__-Default` (its Wayland app-id).

### With Docker

Requirements: Docker and Compose (Fedora: `sudo dnf install moby-engine docker-compose`, then
`sudo systemctl enable --now docker`), the clones in the parent folder (else `SD_CLONES=<their folder>`), and
`gh auth login` done.

```sh
scripts/docker-up.sh   # docker compose up -d --build, with the gh token, the Odoo key and your git e-mail
```

Then <http://localhost:8766>. The app listens on this machine only, and its database is reachable by it alone. After a
restart of the session, run the script again: it puts back the secrets, which do not survive the logout. Without being in
the `docker` group, the scripts go through `sudo` and ask for your password. Docker's database is its own, empty at first:
`scripts/docker-restore.sh` copies the one of this machine into it instead of collecting everything again.

The container has neither `gh`, nor the keyring, nor your git config: `scripts/docker-up.sh` hands them over.

| Secret | Comes from | Kept where | Goes where |
| --- | --- | --- | --- |
| GitHub token | `gh auth token`, or `GH_TOKEN=…` | `$XDG_RUNTIME_DIR/squad-dashboard/github_token`: in memory, mode 600, wiped at logout; mounted read-only in `/run/secrets/` of the `app` container alone | `api.github.com`, and `github.com` for the fetch, in a header given to git by its environment, never on a command line |
| Odoo API key | the keyring (`secret-tool`, where the V1 kept it), or `ODOO_API_KEY=…` | `$XDG_RUNTIME_DIR/squad-dashboard/odoo_api_key`, mounted the same way | `www.odoo.com` (JSON-2 API), read only |
| Token or key given in Settings › Connections | you | the vault `/data/secrets.vault` of the `data` volume: AES-256-GCM, its key derived from your passphrase by scrypt and kept in memory only; locked at each restart | before the two others |

They are never in the image, in the container's environment (`docker inspect`), in config.json, in the database, in the
logs or in the page: the settings only tell whether there is one and where it comes from. `gh auth token` is your CLI's
token, with all its rights: to bound what the container holds, give it one of its own, `GH_TOKEN=<token>
scripts/docker-up.sh`, a classic token with `repo` and `read:org`.

## First launch

The first page asks what the dashboard follows:

- **Me**: what waits for me, my work and my reviews, my Odoo tasks.
- **Me and my squad**: me first, plus the work, journeys and reviews of my squad (its lead and members).

Your trigram comes from your git e-mail, the squad from the config.json of the V1 when there is one. The choice goes to
config.json (created if missing); Settings › Me › Change asks again. The page is in English; this first page and Settings ›
Display switch it to French.

## Coming from the V1

The V1 (`collector.py` and `index.html`) is gone, its files are not: `config.json`, `history.json`, `cache.json` and
`todos.json` stay in this folder, out of git. The first page starts from the squad of its `config.json`, and once, before
the first collection:

```sh
bun run import-v1   # or: bun run import-v1 <folder of the V1 files>
```

takes over what only the V1 kept: the pushes seen by the reflogs and the deleted branches of `history.json`, the dates of
the r+, the changes of stage of the Odoo tasks, which Odoo does not keep, the mergebot and runbot pages of `cache.json`, and
the to-dos. Running it again only adds what is missing and overwrites nothing. The Odoo key the V1 kept in the keyring is
read as it is.

## Collect

A collection starts from **Update** in the page, or from the command line. It goes by space: Me in a few seconds (the
reviews asked of you, the Odoo tasks), then the squad (its branches, PRs, runbot and mergebot pages, reviews) with the work
of others you touch, and the dashboard computed. Nothing runs in the background, with one exception: while a page is in
sight, it reads again on its own what Me needs, 5 minutes after the last collection and as soon as you come back to it (the
reviews asked, the tasks every 15 minutes at most, the PRs of your desk that moved).

```sh
bun run collect          # everything: targeted fetch, clones, runbot and mergebot, GitHub, Odoo, then the dashboard
bun run collect git      # the clones as they are, without network; also me, ci, github, odoo
```

Only you and your squad are read whole: their branches on odoo-dev (a targeted `git fetch`), their merged commits and r+
in git, runbot and mergebot for their PRs, on GitHub their PRs and their reviews. Of the others, only the PRs and branches
you touch. The first collection reads two years of history (Settings › Collection): it takes a few minutes; the next ones
read only what moved.

### Odoo

An API key of www.odoo.com lets the dashboard read the tasks of the squad, to link them to the PRs: the open tasks
assigned to the squad in the R&D projects, the ones closed there in the last 60 days and every one its branches and PRs
name, with their stage, state, reviewer and tags. A branch or PR names a task by `task-123456`, `Task Id: 123456` or its
link; a task names its PRs, branches or runbot bundles by their link in its description. Without either, a feature
without a task and an open task of the same person with close names are joined as a guess, marked ⚠. Create a key in Odoo
(your avatar, **My Profile**, **Account Security**, **New API Key**, with an end date), then give it in Settings ›
Connections. The dashboard sends Odoo nothing but `search_read`, `read`, `search_count` and `fields_get`, and refuses any
other call before it leaves.

## Data and safety

- The server listens on 127.0.0.1 only and refuses other host names (against DNS rebinding).
- It writes to GitHub only on a click: **Set aside** on a review asked of you directly takes you off its reviewers. Asked
  of one of your teams, already given your r+, or with a read-only token, it is only hidden, until it is asked again.
- Secrets live in the keyring of this machine (outside Docker) or in the encrypted vault (Docker), never in config.json,
  the database, the logs or the page.
- The crossed eye of the header hides Squad and goes back to Me: for a screen share or someone passing by.
- The database holds data of private repositories: do not share it.

## Configuration

`config.json` is written by the first page and the settings; it can also be edited by hand.

| Key | Content |
| --- | --- |
| `me` | your trigram, when your git e-mail does not tell it |
| `follow` | `me` or `squad` |
| `squad` | `{"lead": "abcd", "members": [...]}` |
| `github_logins` | `{"trigram": "login"}` when a GitHub login is not deduced from the PRs |
| `arrivals` | `{"trigram": "YYYY-MM"}`: work before that month is not counted, and a journey can start there |

See `config.example.json`.

## Updating

```sh
scripts/update.sh bun      # or docker; with bun, start the server again afterwards: bun run start
```

The script takes the latest published release: it saves the database in `backups/`, moves the code to the release's tag,
then rebuilds the page, or rebuilds and restarts Docker. The server migrates the database as it starts. Settings › About
tells when a version is out: it is read on GitHub on a click and with each full update, never in the background. To go
back: `git checkout <previous tag>`, then `pg_restore --clean` of the backup.

Settings › About also shows the commit the answering server runs and when it started: still the old one after a restart,
an older server holds the port (`fuser -k 8766/tcp` stops it).

## Versions

The version installed is in `package.json`, what each version brings in `CHANGELOG.md`. `master` holds released versions
only: see `CONTRIBUTING.md` for a change from start to end.

## Development

```sh
bun install
bun run dev     # server on :8766, reloaded on change; Vite on :5173
bun run check   # Biome, TypeScript, svelte-check
TEST_DATABASE_URL='postgres:///postgres?host=/var/run/postgresql' bun run test
```

Everything runs under Bun, Node is not needed. The database schema is in [docs/database.md](docs/database.md), generated by
`bun run db:diagram`.

| Variable | Default | Role |
| --- | --- | --- |
| `DATABASE_URL` | `postgres:///squad_dashboard?host=/var/run/postgresql` | PostgreSQL database |
| `CONFIG_PATH` | `config.json` at the root | What the dashboard follows |
| `SECRET_STORE` | `keyring` (`file` in Docker) | The system keyring, or the encrypted vault |
| `RUNTIME` | `bun` (`docker` in Docker) | The update command the page shows |
| `DATA_DIR` | `~/.local/share/squad-dashboard` (`/data` in Docker) | Encrypted vault |
| `HOST`, `PORT` | `127.0.0.1`, `8766` | Where the server listens |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Host names accepted (against DNS rebinding) |
| `CLONES_DIR` | the parent folder (`/clones` in Docker) | The `odoo`, `enterprise` and `upgrade` clones |
| `SD_PORT`, `SD_DB_PASSWORD` | `8766`, `squad_dashboard` | Published port and database password, for `docker compose` |
| `SD_CLONES`, `TZ` | `..`, `Europe/Brussels` | Folder of the clones mounted in Docker, time zone of the working days |
