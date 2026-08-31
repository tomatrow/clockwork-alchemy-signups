# `scripts`

Fish + tmux orchestration for the dev loop, plus PocketBase odd jobs. Nothing
here is imported by another package — these are entry points.

## Commands

Run from the repo root:

- `pnpm start` → `scripts/start.fish` — the dev loop in tmux. Three panes:
  | pane | cwd | command |
  | --- | --- | --- |
  | top-left | `packages/database` | `pnpm start` — reset + migrate + build hooks + serve on `:8090` |
  | top-right | `packages/www` | `pnpm dev` — SvelteKit on `:5173` |
  | bottom | `packages/database` | `dev:hooks` — `tsdown --watch` |
- `pnpm --filter scripts kill-pb` — kill whatever is listening on `:8090`
  (by port, not process name, so a stale server or any squatter gets cleared).
- `pnpm --filter scripts generate-pb-types` — **stub.** Would write
  `packages/www/src/lib/pocketbase/generated-types.ts`, but exits early until
  there are real collections; `PB_TYPEGEN_FORCE=1` overrides.

## Env

`packages/scripts/.env.local` + `.env.<stage>.local` (see `.env.example`), loaded
by the `srcenv` helper in `scripts/config.fish`. Stage is `development` unless
`PB_ENV=production`. Currently `PB_TYPEGEN_URL`, `PB_ADMIN_USERNAME`,
`PB_ADMIN_PASSWORD`.

`PB_ADMIN_*` is the superuser the **database package's init migration seeds**,
repeated here because pocketbase-typegen logs in over the API as a superuser and
the two packages don't read each other's env files. **Keep them in sync per
stage** — if they diverge, typegen authenticates against an account that doesn't
exist. `generate-pb-types.fish` passes them as `--url/--email/--password` rather
than using typegen's `--env` mode, which demands the names
`PB_TYPEGEN_EMAIL`/`PB_TYPEGEN_PASSWORD` and would reintroduce a second,
driftable copy of the admin identity.

Keep the split straight: these are consumed by _scripts_. The vars in
`packages/database/.env.*.local` are consumed by _the init migration_ and baked
into `data.db`, and `DEPLOY_PB_*` live there too because `deploy.fish` is a
database-package script.

## Mechanics

- **`config.fish` is sourced twice**: once by the script itself, and again by
  every pane via `--preamble`. Panes are fresh interactive shells, so they get
  neither the functions nor `mise activate` otherwise — and without mise there
  is no `pocketbase` on PATH.
- **`tmux_dev_panes` only ever addresses pane `-t 0`.** tmux renumbers panes on
  every split, so creation order is not index order; everything else relies on
  `split-window` acting on the currently active pane. Get this wrong and a pane
  splits the wrong neighbour — it looks plausible until you notice which command
  landed where.
- **Its flags are declared `=`, never `=?`.** fish accepts an optional-value
  flag only as `--flag=value`; given `--flag value` it sets the flag empty and
  leaves the value as a stray positional, silently dropping the pane.
  `--max-args=0` makes such a stray a loud failure.
- **The hooks watcher waits on `/api/health`.** tsdown runs with `clean: true`,
  so starting it early would wipe `pb_hooks/` out from under the initial
  `build:hooks` that the left pane does before serving. Once running, a tsdown
  rebuild is what trips PocketBase's own restart-on-change.
- `start.fish` `cd`s to the git root first, so it works from any subdirectory.
- **The session is named `clockwork`**, so clean up with
  `tmux kill-session -t clockwork` — never `tmux kill-server`, which takes out
  every unrelated session on the machine.
- `start.fish --detached` builds the session without attaching, for use from a
  non-tty (CI, a script, an agent); the attaching form fails there with
  "open terminal failed: not a terminal".
- **Env values are read at migrate time and the migration guards each one**, so
  a clone with no `packages/database/.env.*.local` still boots. Note that
  `meta.appURL` is _validated_ by PocketBase — assigning it a blank
  `PB_APP_URL` fails the entire migration, which is why it is set conditionally.
