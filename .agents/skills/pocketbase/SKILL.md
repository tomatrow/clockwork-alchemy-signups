---
name: pocketbase
description: Work with a live PocketBase backend using the official PocketBase JS SDK (bundled, no install; Node 18+) — read, search, create, update, and delete records, inspect collection schemas, upload files, run transactional batches, run read-only SQL, and write data-migration scripts. Use this skill whenever the user wants to query, seed, fix, migrate, clean up, or otherwise touch data in a PocketBase database — including phrasings like "add a row to my pb", "what's in the posts collection", "update these records", "bulk import this CSV into PocketBase", "check the users table", or any mention of PB_URL, pb_data, _superusers, pb.collection(...), or a /api/collections/ URL — even if the user doesn't say "API" or "SDK".
---

# PocketBase

Talk to a live PocketBase instance with the **official PocketBase JS SDK**. It's bundled at `scripts/vendor/` (v0.28.1, MIT), so nothing needs installing: just Node 18+. You write normal SDK code (`pb.collection("posts").getList(...)`); this skill supplies an already-authenticated `pb`.

- **One-off operations:** `node scripts/pb.mjs run '<sdk code>'`
- **Anything with logic** (imports, backfills, transforms): a Node script that calls `connect()` from `scripts/client.mjs`

Both share one login and the same safety layer. On top of the plain SDK, `client.mjs` adds only four things:

- **Credentials:** reads them from env vars.
- **Token cache:** reuses one token across processes instead of logging in on every call.
- **Guest-fallback detection:** catches the case where PocketBase quietly treats an invalid token as a guest instead of rejecting it.
- **Destructive-operation guard:** blocks deletes, schema changes, settings changes, backup restores, and SQL writes unless explicitly allowed.

It also switches off the SDK's browser-oriented auto-cancellation, and prints SDK errors as compact JSON.

`references/api.md` covers: the SDK method for every endpoint, filter syntax, value formats for each field type, update modifiers, batch, files, auth, schema edits, SQL, realtime, and raw HTTP. For exact method signatures, grep `scripts/vendor/pocketbase.es.d.mts`.

## Setup

| Variable | Purpose |
| --- | --- |
| `PB_URL` | Base URL, e.g. `https://pb.example.com` (required) |
| `PB_TOKEN` | A ready-made auth token — preferred for agents, see "Credentials" |
| `PB_EMAIL` / `PB_PASSWORD` | Credentials for password auth |
| `PB_AUTH_COLLECTION` | Auth collection to log in to (default `_superusers`) |

If `PB_URL` isn't set, ask the user for it and for credentials rather than guessing.

```bash
PB="node scripts/pb.mjs"      # path relative to this skill
$PB health
$PB auth                      # collection, id, superuser yes/no, token expiry
```

**Superuser vs. regular user matters.** Superusers bypass every API rule and can read schemas and run SQL. Regular auth users are bound by each collection's rules and get 403s outside them.

**A bad token doesn't error on public endpoints.** PocketBase silently treats the caller as a guest: public collections return 200 with only guest-visible rows, protected ones return 403. The cached-token logic catches this, but if results look thin or you hit unexpected 403s, run `$PB auth` before concluding the data isn't there.

## `run`: SDK one-liners

```bash
$PB run 'pb.collection("posts").getList(1, 20, { filter: "status = \"published\"", sort: "-created", fields: "id,title" })'
```

- The code is a single expression, or statements ending in `return`. Top-level `await` works.
- In scope: `pb`, `args` (extra CLI arguments), `file(path)` (makes a `File` for uploads), and `ClientResponseError`.
- Strings are printed raw; everything else is printed as JSON. Errors go to stderr as JSON, including per-field validation `details`.
- Use `$PB run - < code.js` for longer snippets.

**Pass shell values through `args`, never by splicing them into the code,** and inside filters bind them with `pb.filter()`. That way a value like `O'Brien "); drop…` stays data:

```bash
$PB run 'pb.collection("authors").getFirstListItem(pb.filter("name = {:n}", { n: args[0] }))' "$NAME"
```

## Workflow

### 1. Learn the schema before writing

Field names, types, required flags, select values, and relation targets determine what a valid write looks like. Guessing produces 400s at best, and at worst silently wrong data, like a name written into a relation field that expects an id. The raw collection JSON is verbose, so use the summaries:

```bash
$PB collections                 # every collection with its field names
$PB collections --detail        # compact field definitions for all
$PB schema posts                # one collection: fields, rules, indexes
$PB schema posts --raw          # full JSON (needed before editing a schema)
```

These are superuser-only. As a regular user, infer the shape from a sample record (`getList(1, 1)`) and from the field messages in 400 responses.

### 2. Read

```bash
$PB run 'pb.collection("posts").getList(1, 50, { filter: pb.filter("author.name = {:n}", { n: args[0] }), sort: "-created", fields: "id,title" })' "$NAME"
$PB run 'pb.collection("posts").getFullList({ filter: "views > 100", fields: "id,title,views" })'   # every page
$PB run 'pb.collection("posts").getOne(args[0], { expand: "author,tags" })' "$ID"
$PB run 'pb.collection("posts").getFirstListItem(pb.filter("slug = {:s}", { s: args[0] }))' "$SLUG"   # 404 if none
```

- **Always pass `fields`** unless you need whole records. Full records burn context fast.
- `getFullList` pages through everything; add a narrow `filter` first on big collections, or use `getList` plus `skipTotal: true` to sample.
- `expand: "rel1,rel2.sub"` pulls related records inline (up to 6 levels), under `record.expand`.
- For counts, aggregates, and joins that filters can't express, superusers can run read-only SQL: `$PB run 'pb.sql.run("SELECT status, count(*) AS n FROM posts GROUP BY status")'`.

### 3. Write

```bash
$PB run 'pb.collection("posts").create({ title: args[0], status: "draft", author: args[1] })' "$TITLE" "$AUTHOR_ID"
$PB run 'pb.collection("posts").update(args[0], { status: "published", "views+": 1 }, { fields: "id,status,views" })' "$ID"
$PB run 'pb.collection("posts").update(args[0], { cover: file(args[1]) })' "$ID" ./cover.png        # upload
$PB run 'pb.collection("posts").update(args[0], { "gallery+": [file(args[1])] })' "$ID" ./extra.jpg # append file
```

The SDK switches to multipart automatically when the body contains a `File`.

Things that trip people up:

- **Relations take record ids**, not names. Look the id up first. Multi-relations take an array of ids.
- **Modifiers edit atomically, with no read-modify-write race:** `"tags+": "news"`, `"tags-": "old"`, `"+tags": "first"` (prepend), `"views+": 1`, `"gallery-": ["stored_name.png"]`. Use these instead of fetching an array, editing it, and writing it back.
- **Fields are never null.** Empty means `""`, `0`, `false`, or `[]`, so filter with `author = ""`, not `author = null`.
- **Dates** are UTC strings, `"2026-09-24 17:00:00.000Z"`, or pass a JS `Date` to `pb.filter()`.
- On a 400, read `details`, fix the payload, and retry. Don't resend the same payload.

### 4. Bulk changes and anything with logic: write a script

For imports, backfills, transforms, or multi-step fixes, write a Node script. It's easier to read, re-run, and hand to the user than a long `run` string. Import `connect()` by absolute path to this skill's `scripts/client.mjs`:

```js
// archive-drafts.mjs — run with: node archive-drafts.mjs [--apply]
import { connect } from "/ABSOLUTE/PATH/TO/pocketbase-skill/scripts/client.mjs";

const apply = process.argv.includes("--apply");
const pb = await connect();   // authenticated SDK client; pass { allowDestructive: true } only for confirmed deletes

const drafts = await pb.collection("posts").getFullList({
  filter: pb.filter("status = {:s} && created < {:d}", { s: "draft", d: new Date("2026-01-01") }),
  fields: "id,title",
});
console.log(`${drafts.length} drafts to archive`, drafts.slice(0, 5));
if (!apply) process.exit(0);                 // dry run by default

for (let i = 0; i < drafts.length; i += 50) {           // chunk to batch.maxRequests
  const batch = pb.createBatch();
  for (const r of drafts.slice(i, i + 50)) batch.collection("posts").update(r.id, { status: "archived" });
  await batch.send();                                   // one transaction per chunk
  console.log(`updated ${Math.min(i + 50, drafts.length)}/${drafts.length}`);
}
```

- **Dry run by default:** log the count and a sample, show the user, and apply only after they confirm.
- **`createBatch()`** needs batch enabled in *Dashboard → Settings → Application*. A 403 "Batch requests are not allowed" means it's off: tell the user. Changing settings is guarded, so enable it only with their OK. Each `send()` is one transaction: if any request in the chunk fails, none of it applies, and the error `details` say which one failed.
- **Uncaught SDK errors** print as compact JSON.
- **If the user's project already depends on the `pocketbase` npm package,** a script inside that project may use it directly: `new PocketBase(url)`, then `pb.autoCancellation(false)`, or concurrent requests to the same path abort each other. That route bypasses this skill's guard, so the confirmation discipline below is entirely on you.

## Safety

This is someone's real database, often production. Act like a careful DBA.

**The guard.** Every SDK call through `connect()`, including `run`, is checked before it's sent. These throw `DestructiveBlocked`:

- any `DELETE`: record delete, collection delete, truncate, backup delete
- batches containing a delete
- schema updates and imports (`PATCH`/`PUT /api/collections...`)
- settings updates
- backup restores
- SQL that isn't a single read-only `SELECT`/`EXPLAIN`

Creating records, updating records, and creating collections are allowed.

To proceed with a blocked operation:

1. Show the user what will be affected. Run the same filter as a read and report the count and a few examples.
2. Get their explicit go-ahead.
3. Re-run with `--allow-destructive` (CLI) or `connect({ allowDestructive: true })` (scripts). Keep the scope as narrow as what they approved.

**Updates aren't guarded, but broad ones still need confirmation.** An update filtered to thousands of rows can do as much damage as a delete, so apply the same show-then-confirm steps.

Other hazards:

- **Cascading deletes.** Deleting a record can cascade through relations with `cascadeDelete`. Check `$PB schema` before deleting from a collection other records point at.
- **Schema edits replace the whole `fields` array.** Any field you leave out is dropped, along with its data. Start from `pb.collections.getOne(name)`, modify the array, and send the whole thing back, keeping each field's `id` (that's how a rename keeps its data). `pb.collections.import(cols, true)` also deletes whatever is missing.
- **Credentials.** Prefer the least-privileged credentials that can do the job. A regular auth user plus API rules is safer than a superuser. Never echo tokens or passwords back to the user, and never write them into scripts or project files.

## Credentials for agents

Password auth works. `client.mjs` caches the token in `~/.cache/pocketbase-skill/` (mode 600) and refreshes it, so it doesn't log in again on every call and trigger "login from new location" emails.

For unattended use, a long-lived `PB_TOKEN` is cleaner. A superuser can mint one:

```bash
$PB run 'pb.collection("_superusers").impersonate(args[0], 2592000).then(c => c.authStore.token)' "$RECORD_ID"
```

The token can't be refreshed and expires after the given number of seconds (30 days here). Impersonating a record in a regular auth collection (`pb.collection("users").impersonate(...)`) gives a token limited to that user's permissions. Tokens can also be generated from the dashboard.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Could not reach ...` (status 0) | Wrong `PB_URL`, server down, or the sandbox blocks outbound network to that host |
| Fewer rows than expected, or surprise 403s | Token invalid, so you're being treated as a guest; run `$PB auth` |
| `Blocked destructive request: ...` | The guard. Confirm with the user, then use `--allow-destructive` |
| `Syntax error in code` | Bad JS in `run`; for statements, end with `return` |
| 400 "Invalid filter" | Filter syntax, or a value pasted in without quoting; use `pb.filter()` |
| 400 with field `details` | Validation: missing required field, bad select value, text too short, wrong relation id |
| 403 "Only superusers can..." | Endpoint, or a filter using `@collection.*`, requires a superuser |
| 404 on a record you know exists | An API rule hides it from the current user |
| 403 "Batch requests are not allowed" | Batch is disabled in settings |
| "…autocancelled…" | Using the npm SDK directly without `pb.autoCancellation(false)` |
