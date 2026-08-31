/// <reference path="../../pb_data/types.d.ts" />

// STUB hook — proves the tsdown -> pb_hooks -> PocketBase pipeline works.
// Safe to delete once there is a real hook.
//
// Two rules that bite every time (see README):
//   1. The `.pb` in the filename is load-bearing: PocketBase only auto-loads
//      `pb_hooks/*.pb.js`. A bare `foo.ts` compiles to a plain CJS module you
//      must `require(`${__hooks}/foo.js`)` from inside a handler.
//   2. Handler bodies are re-evaluated standalone, so they CANNOT reference
//      module-scope bindings — inline the logic or require() inside the body.

onRecordsListRequest((e) => {
	$app.logger().debug("list request", "collection", e.collection?.name)
	e.next()
}, "_scaffold")

// TODO: real hooks, likely
//   - signups.pb.ts   capacity + deadline enforcement on create
//   - mailerLog.pb.ts metadata-only log of outgoing confirmation email
