#!/usr/bin/env fish

# Deploy PocketBase schema + hooks to prod (Coolify).
#
# STUB: the transport steps are printed, not run. Every rsync is behind
# `--dry-run` until the Coolify resource exists and DEPLOY_PB_* are filled in;
# flip DEPLOY_PB_LIVE=1 (or delete the dry-run guard) once verified.
#
# Model: prod is DISPOSABLE. There is no incremental migration story — the
# schema lives inside data.db, so we rebuild a fresh data.db locally with the
# PROD env sourced and replace the prod volume wholesale.
#
# PREREQS / SAFETY:
#   - STOP the PocketBase container in Coolify BEFORE running, START it AFTER.
#   - Prod PocketBase image version must match local (`pocketbase --version`).
#   - This is DESTRUCTIVE to your LOCAL packages/database/pb_data too: it resets
#     and re-migrates with prod values baked in. Re-run `pnpm start` afterwards
#     to get a dev database back.
#   - Remote logs in as a non-root user; rsync runs as root on the far side via
#     --rsync-path="sudo rsync" (passwordless sudo, standard Coolify setup) so it
#     can reach the root-owned /var/lib/docker/volumes paths.

set -l pkg_root (cd (dirname (status filename))/..; pwd)

# --- env -----------------------------------------------------------------
# .env.local first (shared secrets), then .env.production.local (prod overrides).
for file in $pkg_root/.env.local $pkg_root/.env.production.local
	if test -f $file
		for line in (grep -v '^\s*#' $file | grep '=')
			set -l parts (string split -m 1 = -- $line)
			set -gx (string trim $parts[1]) (string trim -c '"\'' -- $parts[2])
		end
	end
end

# --- preflight -----------------------------------------------------------
if test -z "$DEPLOY_PB_HOST" -o -z "$DEPLOY_PB_UUID"
	echo ">> aborted: DEPLOY_PB_HOST/DEPLOY_PB_UUID unset."
	echo ">>   Set them in packages/database/.env.production.local (see .env.example)."
	exit 1
end

if test -z "$PB_APP_URL"
	echo ">> aborted: PB_APP_URL unset — it is baked into settings.meta.appURL and"
	echo ">>   every auth email template at migrate time."
	exit 1
end

if string match -q '*localhost*' -- $PB_APP_URL
	echo ">> aborted: PB_APP_URL points at localhost ($PB_APP_URL) — that would bake"
	echo ">>   the dev origin into prod settings + emails."
	exit 1
end

# TODO: add SMTP_* to this check once the migration actually enables SMTP.

set -l data_src "$pkg_root/pb_data/"
set -l hooks_src "$pkg_root/pb_hooks/"
set -l backup_dst "$pkg_root/pb_data-prod-backup/"
# Quote-delimited so fish stops the variable name at $uuid.
set -l data_dst "$DEPLOY_PB_HOST:/var/lib/docker/volumes/"$DEPLOY_PB_UUID"_pocketbase-data/_data/"
set -l hooks_dst "$DEPLOY_PB_HOST:/var/lib/docker/volumes/"$DEPLOY_PB_UUID"_pocketbase-hooks/_data/"

set -l dry --dry-run
if test "$DEPLOY_PB_LIVE" = 1
	set dry
else
	echo ">> STUB MODE: rsync runs with --dry-run. Set DEPLOY_PB_LIVE=1 to really push."
end

# --- build ---------------------------------------------------------------
echo ">> building fresh data.db (reset -> migrate up) + hooks with prod env baked in"
pnpm --filter database reset; or true # nothing to trash on a clean tree
pnpm --filter database migrate; or exit 1
pnpm --filter database build:hooks; or exit 1

# --- confirm -------------------------------------------------------------
echo ""
echo ">> STOP the PocketBase container in Coolify now."
read -P ">> type 'yes' once it is stopped to continue: " confirm
if test "$confirm" != yes
	echo ">> aborted (did not receive 'yes')."
	exit 1
end

# --- transport -----------------------------------------------------------
echo ">> backing up prod data volume -> pb_data-prod-backup/"
rsync -avz $dry --rsync-path="sudo rsync" $data_dst $backup_dst; or exit 1

echo ">> pushing pb_data -> data volume"
# --delete clears prod's stale data.db-wal/-shm and old storage (safe: disposable).
# Excludes protect prod logs/backups and skip local-only junk.
rsync -avz $dry --delete --rsync-path="sudo rsync" \
	--exclude 'backups/' --exclude '.notify/' \
	--exclude 'auxiliary.db*' --exclude 'types.d.ts' \
	$data_src $data_dst; or exit 1

echo ">> pushing pb_hooks -> hooks volume"
rsync -avz $dry --delete --rsync-path="sudo rsync" $hooks_src $hooks_dst; or exit 1

echo ""
echo ">> done. START the PocketBase container in Coolify."
echo ">> verify: admin UI shows the collections; docker logs <container> --tail 50"
echo ">>         shows the hooks loading."
