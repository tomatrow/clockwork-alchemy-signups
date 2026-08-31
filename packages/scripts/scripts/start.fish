#!/usr/bin/env fish

# The dev loop. Three tmux panes:
#
#   top-left    packages/database  pnpm start  — trash pb_data, migrate, build
#                                               hooks, serve on :8090
#   top-right   packages/www       pnpm dev    — SvelteKit on :5173
#   bottom      packages/database  dev:hooks   — tsdown --watch
#
# Everything dies with the session, including the local database — which is the
# point: `pnpm start` resets pb_data every time, so the schema in
# packages/database/pb_migrations is the only source of truth. See
# packages/database/README.md.
#
# The hooks watcher gets its own pane rather than riding along with `start`
# because PocketBase loads hooks at boot; tsdown rewriting pb_hooks/ is what
# triggers PocketBase's own file-watch restart. It waits on :8090 first so its
# `clean: true` wipe of pb_hooks can't race the initial build:hooks that the
# left pane runs before serving.

set -l repo_root (git rev-parse --show-toplevel)
cd $repo_root

source $repo_root/packages/scripts/scripts/config.fish

set -l preamble "source $repo_root/packages/scripts/scripts/config.fish"

# Pass-through so this can be exercised without a terminal:
#   ./packages/scripts/scripts/start.fish --detached
set -l extra
if contains -- --detached $argv
	set extra --detached
end

# Dev env for the migrate step. .env.local is stage-independent;
# .env.development.local holds the dev origin (PB_APP_URL) and the dev superuser
# (PB_ADMIN_USERNAME/PB_ADMIN_PASSWORD, seeded into _superusers by the init
# migration). deploy.fish is the ONLY thing that sources .env.production.local,
# which is precisely what keeps the dev admin password out of prod's data.db.
#
# Both files are optional (srcenv skips missing ones) and the migration guards
# every value it reads, so a fresh clone still comes up — just with PocketBase's
# default appURL, no SMTP, and an installer link instead of a seeded admin.
tmux_dev_panes $extra \
	--name=clockwork \
	--preamble=$preamble \
	--left 'cd packages/database; srcenv .env.local .env.development.local; pnpm run start' \
	--right 'cd packages/www; pnpm run dev' \
	--center 'cd packages/database; curl -sf --retry 30 --retry-all-errors --retry-delay 1 http://127.0.0.1:8090/api/health >/dev/null; pnpm run dev:hooks'

# TODO: once packages/database has real collections, add a fourth pane (or fold
# into --center) running `pnpm --filter scripts generate-pb-types` after the
# health check, so the client types track the schema. Stubbed for now.
