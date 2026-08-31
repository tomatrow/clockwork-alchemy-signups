#!/usr/bin/env fish

# Trash pb_data, but refuse to do it while a PocketBase is serving it.
#
# WHY THE GUARD: `trash` renames the directory, it does not unlink the open file.
# A running PocketBase keeps its handle on the moved data.db and happily goes on
# serving it from ~/.Trash, while every subsequent `pocketbase migrate up`
# creates and writes a BRAND NEW pb_data the server will never read. The symptom
# is bewildering: the superuser the migration just seeded cannot log in, and the
# admin UI shows a schema that does not match pb_migrations. Confirm with
#   lsof -p (lsof -ti tcp:8090 -sTCP:LISTEN) | grep data.db
# and look for a .Trash path.
#
# Aborting (rather than killing the other instance) is deliberate: that process
# may be someone else's tmux pane. Stop it yourself, or run
# `pnpm --filter scripts kill-pb`.

set -l port 8090
set -l pids (lsof -ti tcp:$port -sTCP:LISTEN)

if test -n "$pids"
	echo ">> aborted: PocketBase is already serving on :$port (pid(s): $pids)."
	echo ">>   Trashing pb_data now would leave that process serving a deleted"
	echo ">>   data.db while every later command writes to a new one."
	echo ">>   Stop it first, or: pnpm --filter scripts kill-pb"
	exit 1
end

if not test -d pb_data
	echo ">> pb_data already absent"
	exit 0
end

trash pb_data
