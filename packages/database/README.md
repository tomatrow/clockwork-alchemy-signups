# `database`

PocketBase: schema, hooks, and deploy. Replaces the Airtable base from
`packages/www-old`.

**Everything here is a stub.** The collections aren't modelled yet — see the
TODOs in `pb_migrations/1788214630_init_schema.js`.

## Layout

| Path                  | What                                                                 |
| --------------------- | -------------------------------------------------------------------- |
| `pb_migrations/`      | Committed. One init migration builds the whole database.             |
| `src/hooks/*.pb.ts`   | Committed. Hook source, authored in TypeScript.                      |
| `scripts/deploy.fish` | Committed. Rebuild + push to Coolify.                                |
| `pb_hooks/`           | **Generated** by tsdown, gitignored, wiped on every build.           |
| `pb_data/`            | **Local database**, gitignored, thrown away freely.                  |
| `.env.*.local`        | Gitignored. Read at _migrate_ time, not runtime. See `.env.example`. |

Env is **stage-scoped**: `.env.local` for stage-independent values,
`.env.development.local` / `.env.production.local` for everything else —
including the superuser credentials. See [Superuser](#superuser).

`pocketbase` comes from `mise.toml` — run `mise install` if it's not on PATH.

## Everyday use

```sh
pnpm --filter database start        # reset -> migrate -> build:hooks -> serve
pnpm --filter database dev:hooks    # rebuild hooks on change, in a second pane
```

`start` **deletes `pb_data` every time.** That is the intended loop: the schema
lives in `pb_migrations/`, so the database is disposable and always
reproducible. Nothing you enter in the admin UI survives — put it in the
migration's seed section instead.

Other scripts: `serve`, `migrate`, `build:hooks`, `reset` (trash `pb_data`),
`reset:hard` (also wipe `pb_hooks`).

### `reset` refuses to run while PocketBase is serving

Not a nicety — it prevents a genuinely confusing failure. `trash` _renames_ the
directory rather than unlinking the open file, so a running PocketBase keeps
serving `data.db` from `~/.Trash` while `migrate` creates and writes a brand-new
`pb_data` that the server never reads. The symptoms are a superuser that cannot
log in and an admin UI whose schema doesn't match `pb_migrations/`. Diagnose with:

```sh
lsof -p $(lsof -ti tcp:8090 -sTCP:LISTEN) | grep data.db   # a .Trash path = ghost db
```

So `reset` aborts rather than killing a server that might be another tmux pane.
Stop it yourself, or run `pnpm --filter scripts kill-pb`. `start` is chained with
`&&` for the same reason: a refused reset must stop the whole sequence.

## Superuser

The **init migration seeds `_superusers`** from `PB_ADMIN_USERNAME` /
`PB_ADMIN_PASSWORD`, so `migrate up` alone yields a database you can log into at
<http://127.0.0.1:8090/_/>. Without it, every start prints a fresh one-time
installer link, because every start trashes `pb_data`.

Seeded in the migration rather than by a `pocketbase superuser upsert` script for
the same reason the schema is: the account is part of the database's definition,
reproduced by one command.

```js
const superuser = new Record(app.findCollectionByNameOrId("_superusers"))
superuser.set("email", adminEmail)
superuser.setPassword(adminPassword) // hashes + sets tokenKey; set("password") does not
app.save(superuser)
```

The same pair authenticates **pocketbase-typegen**, which reads the schema over
the API as a superuser — so `packages/scripts/.env.<stage>.local` repeats these
two values and they must match. Duplication is deliberate: neither package reads
the other's env, and the previous "fall back to `PB_TYPEGEN_*`" arrangement hid
which account was authoritative.

### These live in the per-stage env file, never `.env.local`

`start.fish` sources `.env.local` + `.env.development.local`; `deploy.fish`
sources `.env.local` + `.env.production.local`. Because `PB_ADMIN_*` is only ever
in the per-stage files, the dev password **cannot** be baked into prod's
`data.db` — the structure enforces it, no comparison guard needed. Put a distinct
pair in `.env.production.local`.

- **Unset is non-fatal in dev** — the migration skips the seed, logs a note, and
  you use the installer link as before.
- **`deploy.fish` aborts on unset**, alongside its `PB_APP_URL` checks: shipping a
  prod database whose only way in is an easily-missed installer link is a broken
  deploy.
- Password must be **>= 10 chars** (PocketBase's minimum). The migration throws
  early with that message, because PocketBase's own error is a validation dump
  mid-`migrate` that reads as a broken migration.
- **Re-running `migrate up` against a database that already has this account
  fails** with `email: Value must be unique.` Irrelevant in the normal loop,
  since `start` resets `pb_data` first — but it is why `migrate down 1 && migrate
up` does _not_ work: PocketBase refuses to delete the only existing superuser,
  so `down` leaves the record behind (it logs a note) and the following `up`
  collides with it. Use `reset` + `migrate`.

## Batch API

`settings.batch.enabled = true` in the init migration is **required**, not tuning:
`runic-pocketbase-collection` routes every optimistic write through a single
transactional `POST /api/batch`, and PocketBase ships that endpoint disabled. If
you ever see all mutations failing while single-record reads are fine, check this
first — the failure surfaces at the endpoint, so it looks like a client bug.

No S3, by decision: uploaded files and backups live on the local PocketBase
volume.

## Migrations

While there is no prod data worth keeping, **edit the init migration in place**
rather than adding follow-up migrations — `reset` + `migrate` makes it moot. Once
prod is real, that flips and this section needs rewriting.

Values from `.env.*.local` are baked into `data.db` at migrate time via
`$os.getenv`; PocketBase never reads them again. This is why deploying means
re-migrating locally with the prod env sourced.

## Hooks

`src/hooks/*.ts` → tsdown → `pb_hooks/*.js`, loaded by PocketBase at boot. Never
edit `pb_hooks/` by hand.

- **The `.pb` in the filename is load-bearing.** PocketBase auto-loads only
  `*.pb.js`. A bare `foo.ts` becomes `pb_hooks/foo.js`, which is _not_
  auto-loaded — it's a plain CJS module for shared logic, pulled in with
  `require(`${\_\_hooks}/foo.js`)`. Use the split deliberately.
- **Handlers must not reference module-scope bindings.** PocketBase re-evaluates
  each handler body standalone, so captured variables are `undefined` at run
  time. Inline the logic, or `require()` from _inside_ the handler. This fails at
  request time, not build time — it's the most common way to break a hook.
- **goja/JSVM limits** (enforced by `tsdown.config.ts`): CJS only, no Node
  builtins, ES2020, and no event loop — no `async`/`await`, Promises, or timers.
- **Build before serve.** Hooks load at startup; `start` handles the ordering.
- **Typings:** JSVM globals come from `pb_data/types.d.ts`, which PocketBase
  generates on first boot. `pb_data` is gitignored, so on a fresh clone hook
  typechecking fails until you've run `serve` once.

## Deploy

Prod is PocketBase on Coolify, and it is treated as **disposable**. The schema
rides inside `data.db`, so `scripts/deploy.fish` rebuilds a fresh `data.db`
locally with the prod env sourced and replaces the prod docker volume wholesale.

```sh
pnpm --filter database deploy
```

Currently a stub: rsync runs with `--dry-run` unless `DEPLOY_PB_LIVE=1`, and it
aborts unless `DEPLOY_PB_HOST` / `DEPLOY_PB_UUID` / `PB_APP_URL` /
`PB_ADMIN_USERNAME` / `PB_ADMIN_PASSWORD` are set in `.env.production.local`. It
also refuses a localhost `PB_APP_URL`, which would otherwise get baked into
prod's settings and auth emails.

The script **destroys your local `pb_data`** (it re-migrates with prod values).
Run `pnpm --filter database start` afterwards to get a dev database back.

Stop the container in Coolify before running, start it after; the script pauses
for confirmation. Prod's data volume is pulled into `pb_data-prod-backup/` first.

### Durability caveat — resolve before launch

"Prod is disposable" is inherited from a project whose prod data genuinely was.
Here it will hold **workshop signups**: real names and emails that exist nowhere
else, with no S3 and no backup cron configured. Two consequences:

- Every deploy **replaces** prod's `data.db` with a freshly migrated local one,
  destroying all signups. The pre-push pull into `pb_data-prod-backup/` is the
  only copy, it is not committed, and it is overwritten on the next deploy.
- Losing the Coolify volume loses everything.

So either enable `settings.backups` (plus somewhere off-box to put them), or
switch to additive migrations and drop the volume-replace step, before the first
real signup. Until then, treat deploys as safe only while the database is empty.
