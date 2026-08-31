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
`reset:hard` (also trash `pb_hooks`).

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
aborts unless `DEPLOY_PB_HOST` / `DEPLOY_PB_UUID` / `PB_APP_URL` are set in
`.env.production.local`. It also refuses a localhost `PB_APP_URL`, which would
otherwise get baked into prod's settings and auth emails.

The script **destroys your local `pb_data`** (it re-migrates with prod values).
Run `pnpm --filter database start` afterwards to get a dev database back.

Stop the container in Coolify before running, start it after; the script pauses
for confirmation. Prod's data volume is pulled into `pb_data-prod-backup/` first.
