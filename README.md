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

## Stack

- **Server**: [Bun](https://bun.sh) 1.4 running TypeScript, [Hono](https://hono.dev) for the HTTP API and the live progress
  (server-sent events), [Drizzle](https://orm.drizzle.team) over PostgreSQL, Zod to check what comes in.
- **Page**: [Svelte 5](https://svelte.dev) with SvelteKit as a single-page app the server hands out, Tailwind 4 and
  shadcn-svelte components, TanStack Query and Table, LayerChart for the charts.
- **Sources**, read on a click: the local `odoo`, `enterprise` and `upgrade` clones (git), GitHub's GraphQL API, runbot and
  mergebot pages, and Odoo's JSON-2 API (read only).
- **Data**: one PostgreSQL database, `squad_dashboard`, holding what was read and the dashboard computed from it;
  `config.json` for who you are and your squad; the secrets in the system keyring, or in an encrypted vault in Docker.
- One repository of Bun workspaces: `apps/server`, `apps/web`, `packages/shared` (the config and API types both use).

## Requirements

- [Bun](https://bun.sh) 1.4 and a local PostgreSQL reachable through its socket, or Docker with Compose.
- The `odoo`, `enterprise` and `upgrade` clones in one folder, by default the parent of this one.
- The `dev` remote (odoo-dev) in `odoo` and `enterprise`, `origin` in `upgrade`.
- `git config user.email` set to `<trigram>@odoo.com` in the `odoo` clone: it tells who you are.
- A GitHub token with the `read:org` scope, an Odoo API key optionally: see [Tokens](#tokens).

### Tokens

The first page and Settings › Connections tell which are found, and how to get them.

- **GitHub**, needed. With the [GitHub CLI](https://cli.github.com/), the dashboard reads its token on its own:
  `gh auth login --scopes read:org`, or `gh auth refresh --scopes read:org` when already logged in. Without it,
  [create a classic token](https://github.com/settings/tokens/new?description=Dashboard&scopes=repo,read:org) with the
  `repo` and `read:org` scopes, authorize it for the odoo organization if GitHub asks (Configure SSO), and paste it in
  Settings › Connections.
- **Odoo**, optional, for the tasks of the squad: on [www.odoo.com](https://www.odoo.com/odoo), logged in, your avatar,
  **My Profile**, **Account Security**, **New API Key**, with an end date; paste it in Settings › Connections.

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
scripts/app.sh install          # once: "Dashboard" in the launcher (~/.local/share/applications)
scripts/app.sh install docker   # the same, when the dashboard runs in Docker
scripts/app.sh [docker]         # what the launcher runs
```

The script starts the server when none answers on the port; that server stops on its own 30 seconds after its last window
closed, once a running collection is over. In Docker, it runs `docker compose up -d` instead, and the dashboard stays up:
Docker brings it back after a reboot. Without the rights on Docker, the desktop asks the password (pkexec). The server's
log goes to `~/.local/share/squad-dashboard/server.log`, Chrome's to `chrome.log` next to it. The window has its own
Chrome profile, and the links to GitHub, mergebot or runbot open in the default browser, where you are logged in: the
script follows them from the server, in Docker too. For the compositor, the window is `chrome-127.0.0.1__-Default` (its
Wayland app-id).

### With Docker

Requirements: Docker and Compose (Fedora: `sudo dnf install moby-engine docker-compose`, then
`sudo systemctl enable --now docker`), and the clones in the parent folder (else `SD_CLONES=<their folder>`).

```sh
docker compose up -d --build
```

Then <http://localhost:8766>, or the app in the launcher after `scripts/app.sh install docker` (see
[In its own window](#in-its-own-window)). The app listens on this machine only, and its database is reachable by it alone. Docker's
database is its own, empty at first: `scripts/docker-restore.sh` copies the one of this machine into it instead of
collecting everything again.

The container has neither `gh`, nor the keyring, nor your home git config: the first page asks your trigram when the
`odoo` clone's git e-mail does not give it, then a passphrase for the vault and the two keys, pasted by hand.

| Secret | Kept where | Goes where |
| --- | --- | --- |
| GitHub token | the vault `/data/secrets.vault` of the `data` volume: AES-256-GCM, its key derived from your passphrase by scrypt and kept in memory only | `api.github.com`, and `github.com` for the fetch, in a header given to git by its environment, never on a command line |
| Odoo API key | the same vault | `www.odoo.com` (JSON-2 API), read only |

They are never in the image, in the container's environment (`docker inspect`), in config.json, in the database, in the
logs or in the page: the settings only tell whether there is one and where it comes from. The vault locks at each restart
of the container: the opening screen then asks its passphrase. Forgotten, nothing can open it: « Passphrase
forgotten? » erases the vault, then a new passphrase and new keys (revoke the old ones). `config.json` lives in the same
volume.

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
an older server holds the port (`fuser -k 8766/tcp` stops it). The image holds no git: Docker shows the commit when it is
given at build, `SD_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build`, as `scripts/update.sh docker` does.

## What git holds

The code, the scripts and `config.example.json`, nothing else: `config.json`, the V1's `history.json`, `cache.json` and
`todos.json`, `data/`, `backups/`, `.env` and the built page stay on this machine (`.gitignore`), the database and the
secrets live outside the folder. On another machine: clone, follow [Run](#run), and the first page writes the config.

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
| `CONFIG_PATH` | `config.json` at the root (`/data/config.json` in Docker) | What the dashboard follows |
| `SECRET_STORE` | `keyring` (`file` in Docker) | The system keyring, or the encrypted vault |
| `RUNTIME` | `bun` (`docker` in Docker) | The update command the page shows |
| `DATA_DIR` | `~/.local/share/squad-dashboard` (`/data` in Docker) | Encrypted vault |
| `HOST`, `PORT` | `127.0.0.1`, `8766` | Where the server listens |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Host names accepted (against DNS rebinding) |
| `CLONES_DIR` | the parent folder (`/clones` in Docker) | The `odoo`, `enterprise` and `upgrade` clones |
| `SD_PORT`, `SD_DB_PASSWORD` | `8766`, `squad_dashboard` | Published port and database password, for `docker compose` |
| `SD_CLONES`, `TZ` | `..`, `Europe/Brussels` | Folder of the clones mounted in Docker, time zone of the working days |
