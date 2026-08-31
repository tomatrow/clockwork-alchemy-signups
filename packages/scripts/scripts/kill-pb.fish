#!/usr/bin/env fish

# Kill whatever is listening on PocketBase's default address (127.0.0.1:8090).
# Targets the port (not the process name) so a stale `pocketbase serve` — or
# anything else squatting on the port — gets cleared. `-sTCP:LISTEN` restricts
# to the listening server, so connected clients (vite, a browser) are left alone.

set -l port 8090
set -l pids (lsof -ti tcp:$port -sTCP:LISTEN)

if test -z "$pids"
	echo ">> nothing listening on :$port"
	exit 0
end

echo ">> killing pid(s) listening on :$port: $pids"
kill $pids
