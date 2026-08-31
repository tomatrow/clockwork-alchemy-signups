#!/usr/bin/env fish

# Generates TypeScript types for the PocketBase collections into packages/www.
#
# STUB: no real collections exist yet, so this aborts unless PB_TYPEGEN_FORCE=1.
#
# Requires a running PocketBase (pnpm start); pocketbase-typegen reads the
# schema over the API as a superuser using PB_ADMIN_* from
# packages/scripts/.env.<stage>.local, which must match packages/database's
# credentials for that stage.
#
# Stage defaults to development; PB_ENV=production reads .env.production.local.
#
# The output file is overwritten on every run.

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
