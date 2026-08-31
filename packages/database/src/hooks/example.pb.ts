/// <reference path="../../pb_data/types.d.ts" />

// STUB hook; safe to delete once there is a real hook.
// Files must be named `*.pb.ts` for PocketBase to auto-load the compiled output.
// Handler bodies are re-evaluated standalone and cannot reference module-scope bindings.

onRecordsListRequest((e) => {
	$app.logger().debug("list request", "collection", e.collection?.name)
	e.next()
}, "_scaffold")

// TODO: real hooks, likely
//   - signups.pb.ts   capacity + deadline enforcement on create
//   - mailerLog.pb.ts metadata-only log of outgoing confirmation email
