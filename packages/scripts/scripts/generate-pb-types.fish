#!/usr/bin/env fish

# Generate TypeScript types for the PocketBase collections into packages/www.
#
# STUB: packages/database has no real collections yet, so this would emit types
# for `_scaffold` and nothing else. It aborts unless PB_TYPEGEN_FORCE=1 so the
# no-op output can't get committed and go stale.
#
# Requires a RUNNING PocketBase (pnpm start): pocketbase-typegen reads the schema
# over the API as a superuser, not from data.db. It logs in with PB_ADMIN_*, the
# same pair the init migration seeds into _superusers — so the values in
# packages/scripts/.env.<stage>.local must match packages/database's file for
# that stage, or the login 400s against an account that doesn't exist.
#
# Credentials are passed as flags rather than via typegen's own `--env` mode,
# which insists on the names PB_TYPEGEN_EMAIL/PB_TYPEGEN_PASSWORD and would
# resurrect the second, drifting copy of the admin identity.
#
# Stage: development by default; PB_ENV=production reads .env.production.local
# instead, so typegen can point at prod without editing files.
#
# Do not hand-edit the output file; it is overwritten.

set -l repo_root (git rev-parse --show-toplevel)
source $repo_root/packages/scripts/scripts/config.fish

set -l pkg_root $repo_root/packages/scripts
set -l stage development
if test "$PB_ENV" = production
	set stage production
end

srcenv $pkg_root/.env.local $pkg_root/.env.$stage.local

set -l out $repo_root/packages/www/src/lib/pocketbase/generated-types.ts

if test "$PB_TYPEGEN_FORCE" != 1
	echo ">> skipped: no real collections in packages/database yet."
	echo ">>   Set PB_TYPEGEN_FORCE=1 to run anyway (would write $out)."
	exit 0
end

if test -z "$PB_TYPEGEN_URL" -o -z "$PB_ADMIN_USERNAME" -o -z "$PB_ADMIN_PASSWORD"
	echo ">> aborted: PB_TYPEGEN_URL/PB_ADMIN_USERNAME/PB_ADMIN_PASSWORD unset"
	echo ">>   (packages/scripts/.env.$stage.local)."
	exit 1
end

mkdir -p (dirname $out)
pocketbase-typegen \
	--url $PB_TYPEGEN_URL \
	--email $PB_ADMIN_USERNAME \
	--password $PB_ADMIN_PASSWORD \
	--out $out; or exit 1
prettier --write $out
