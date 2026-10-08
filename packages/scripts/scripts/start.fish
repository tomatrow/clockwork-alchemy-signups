#!/usr/bin/env fish

# The dev loop. Run it from an empty tmux window; it splits that window into
# three panes (the one you ran it in becomes top-left):
#
#   top-left    packages/database  pnpm start  — trash pb_data, migrate, build
#                                               hooks, serve on :8090
#   top-right   packages/www       pnpm dev    — SvelteKit on :5173
#   bottom      packages/database  dev:hooks   — tsdown --watch
#
# `pnpm start` resets pb_data on every run, so pb_migrations is the only
# source of truth. The hooks watcher waits on :8090 before starting, so its
# clean rebuild of pb_hooks doesn't race the initial build the left pane runs.

set -l repo_root (git rev-parse --show-toplevel)
cd $repo_root

source $repo_root/packages/scripts/scripts/config.fish

# Panes are fresh shells (and the left one keeps whatever cwd you ran this
# from), so each gets config.fish and the repo root before its command.
set -l preamble "source $repo_root/packages/scripts/scripts/config.fish; cd $repo_root"

# Dev env for the migrate step: .env.local plus the dev-stage overrides.
tmux_dev_panes \
	--preamble=$preamble \
	--left 'cd packages/database; srcenv .env.local .env.development.local; pnpm run start' \
	--right 'cd packages/www; pnpm run dev' \
	--center 'cd packages/database; curl -sf --retry 30 --retry-all-errors --retry-delay 1 http://127.0.0.1:8090/api/health >/dev/null; pnpm run dev:hooks'

# TODO: once packages/database has real collections, add a fourth pane running
# `pnpm --filter scripts generate-pb-types` after the health check.
