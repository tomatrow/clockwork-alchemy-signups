#!/usr/bin/env fish

# Kills whatever is listening (not just connected) on PocketBase's port.

set -l port 8090
set -l pids (lsof -ti tcp:$port -sTCP:LISTEN)

if test -z "$pids"
	echo ">> nothing listening on :$port"
	exit 0
end

echo ">> killing pid(s) listening on :$port: $pids"
kill $pids
