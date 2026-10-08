# PocketBase via the JS SDK: condensed reference

Verified against PocketBase server v0.40.4 and JS SDK v0.28.1 (bundled at `scripts/vendor/`). Exact signatures: grep `scripts/vendor/pocketbase.es.d.mts`. Upstream docs: https://pocketbase.io/docs/api-records/ and https://github.com/pocketbase/js-sdk

`pb` below is the client from `connect()` or the one in scope inside `pb.mjs run`.

## Contents
1. SDK method ↔ endpoint map
2. Query options
3. Filter syntax
4. Field value formats
5. Update modifiers
6. Batch
7. Files
8. Auth and tokens
9. Collections (schema edits)
10. SQL
11. Realtime
12. Destructive-operation guard
13. Raw HTTP / curl

---

## 1. SDK method ↔ endpoint map

| SDK | HTTP | Notes |
| --- | --- | --- |
| `pb.collection(c).getList(page, perPage, opts)` | `GET /api/collections/{c}/records` | `listRule`; returns `{page, perPage, totalItems, totalPages, items}` |
| `pb.collection(c).getFullList(opts)` | same, all pages | `opts.batch` = page size (default 1000) |
| `pb.collection(c).getFirstListItem(filter, opts)` | same, `perPage=1` | throws 404 if none |
| `pb.collection(c).getOne(id, opts)` | `GET .../records/{id}` | `viewRule` |
| `pb.collection(c).create(body, opts)` | `POST .../records` | optional 15-char `id` in body |
| `pb.collection(c).update(id, body, opts)` | `PATCH .../records/{id}` | partial |
| `pb.collection(c).delete(id)` | `DELETE .../records/{id}` | **guarded** |
| `pb.createBatch()` | `POST /api/batch` | see §6 |
| `pb.collections.getFullList() / getOne(c)` | `GET /api/collections[/{c}]` | superuser |
| `pb.collections.create(def)` | `POST /api/collections` | superuser |
| `pb.collections.update(c, def)` | `PATCH /api/collections/{c}` | superuser, **guarded**, see §9 |
| `pb.collections.delete(c) / truncate(c)` | `DELETE ...` | superuser, **guarded** |
| `pb.collections.import(cols, deleteMissing)` | `PUT /api/collections/import` | superuser, **guarded** |
| `pb.settings.getAll() / update(obj)` | `GET/PATCH /api/settings` | superuser; update **guarded** |
| `pb.logs.getList(page, perPage, opts) / getStats()` | `/api/logs` | superuser |
| `pb.backups.getFullList() / create(name) / restore(name)` | `/api/backups` | superuser; restore **guarded** |
| `pb.crons.getFullList() / run(id)` | `/api/crons` | superuser |
| `pb.sql.run(query)` | `POST /api/sql` | superuser; writes **guarded**, see §10 |
| `pb.health.check()` | `GET /api/health` | public |
| `pb.files.getURL(record, filename, q)` | builds `/api/files/...` URL | see §7 |
| `pb.send(path, { method, query, body })` | anything | escape hatch; still guarded |

Errors are `ClientResponseError`: `.status`, `.response.message`, `.response.data` (per-field validation), `.url`. A status of 0 means a network failure.

## 2. Query options (the `opts` argument)

- `filter`: see §3. Build it with `pb.filter()` whenever values vary.
- `sort`: `"-created,title"` (`-` = DESC). Also `@random`, `@rowid`.
- `expand`: `"author,tags.category"`, up to 6 levels. Results land under `record.expand.<field>`.
- `fields`: `"id,title,expand.author.name"`. `*` means every field at that level. `"*,description:excerpt(200,true)"` returns a plain-text preview.
- `skipTotal: true`: skips the count query (`totalItems`/`totalPages` = -1), which is much faster on big tables. `getFullList` and `getFirstListItem` set it automatically.
- `perPage` caps at 1000.
- Any other key in `opts` is sent as a query parameter.

## 3. Filter syntax

`OPERAND OPERATOR OPERAND`, combined with `&&`, `||`, and parentheses. `// comments` are allowed.

**Operators:** `=` `!=` `>` `>=` `<` `<=` `~` (contains/LIKE) `!~`. Prefix with `?` for **any-of** on multi-value fields or back-relations: `?=`, `?!=`, `?~`, and so on. Without the `?`, a comparison on a multi-value field must hold for **every** value.

**`pb.filter(expr, params)`** replaces `{:name}` placeholders with safely quoted literals. Strings become JSON string literals; numbers and booleans are inserted as-is; `null` becomes `null`; a `Date` becomes `"YYYY-MM-DD HH:MM:SS.sssZ"`. It leaves any placeholder without a param untouched, so make sure every placeholder is bound.

- `~` wraps its value in `%...%` automatically; include your own `%` to control where the wildcard goes: `title ~ "Seed 00%"` means "starts with".
- **Fields are never NULL.** Empty is the zero value: `""`, `0`, `false`, `[]`. "No author" is `author = ""`; "no tags" is `tags:length = 0`. `!= null` matches everything.

**Field paths:**
- Relation traversal: `author.name = "AJ"`
- Back-relations: `comments_via_post.status ?= "flagged"`, meaning records in `comments` whose `post` field points here
- Superuser-only: `@collection.other.field ...`

**Modifiers:** `:lower` (case-insensitive: `email:lower = "aj@x.com"`), `:length` (array length), `:each` (apply to every element), `:isset` (only in API rules).

**Macros (UTC):** `@now`, `@yesterday`, `@tomorrow`, `@todayStart`, `@todayEnd`, `@monthStart`, `@monthEnd`, `@yearStart`, `@yearEnd`, `@second` … `@year`. `@request.auth.id` / `@request.auth.<field>` refer to the caller.

**Functions:** `strftime("%Y-%m", created) = "2026-09"`.

## 4. Field value formats (in `create`/`update` bodies)

| Type | Value | Notes |
| --- | --- | --- |
| text / editor / email / url | string | editor is HTML |
| number | number | `onlyInt` may be set |
| bool | true/false | |
| date | `"2026-09-24 17:00:00.000Z"` | UTC; `""` clears |
| autodate | — | server-managed (`created`, `updated`) |
| select (maxSelect 1) | `"draft"` | must be one of the field's `values` |
| select (maxSelect >1) | `["a","b"]` | |
| relation (single / multi) | `"RECORD_ID"` / `["ID1","ID2"]` | ids, not names |
| file | `File` / `Blob` (or an array of them) | the SDK switches to multipart automatically |
| json | any JSON value | |
| geoPoint | `{ lon: -117.3, lat: 33.2 }` | |
| password (auth collections) | string | `create` needs `password` + `passwordConfirm` |

## 5. Update modifiers

These edit on the server in one step, so there's no read-modify-write race.

| Body key | Effect |
| --- | --- |
| `"views+": 1` / `"views-": 1` | increment / decrement a number |
| `"tags+": "x"` or `["x","y"]` | append to a select, relation, or file array |
| `"+tags": "x"` | prepend |
| `"tags-": "x"` or `["x"]` | remove values |
| `"gallery+": [file(p)]` | append uploaded file(s) |
| `"gallery-": ["stored_name.png"]` | remove specific stored files |

## 6. Batch

```js
const batch = pb.createBatch();
batch.collection("posts").create({ title: "A" });
batch.collection("posts").update(id, { "views+": 1 });
batch.collection("posts").upsert({ id: "abc123def456ghi", title: "Upserted" });  // upsert needs id
batch.collection("posts").delete(oldId);                                          // makes the whole batch guarded
const results = await batch.send();   // [{ status, body }, ...] in order
```

- The whole batch is **one transaction**. If any request fails, nothing is applied. The error's `response.data.requests.<index>.response` explains which request failed and why.
- Batch must be enabled in Settings → Application (`pb.settings.update({ batch: { enabled: true, maxRequests: 50, timeout: 3 } })`, which is guarded). Chunk large jobs to `maxRequests`, and keep each batch short, because a batch blocks other writes while it runs.
- Files work inside batches (the SDK builds the multipart body). Every request in a batch shares the caller's auth.

## 7. Files

- Upload by putting `File`/`Blob` values in the body. In `run`, `file(path)` builds one from a local path. In a script, use `new File([readFileSync(p)], name)`.
- The stored value is the generated filename (`photo_ab12cd.png`), not a URL.
- `pb.files.getURL(record, filename, { thumb: "100x100" })` builds the URL. The record needs `id` and `collectionId`. Thumb formats: `WxH`, `Wx0`, `0xH`, `WxHt`, `WxHb`, `WxHf`; they only work for image fields that define those thumbs. Add `download: true` to force a download.
- Protected file fields need `{ token: await pb.files.getToken() }` in the query; the token is short-lived.

## 8. Auth and tokens

| SDK | Purpose |
| --- | --- |
| `pb.collection(c).authWithPassword(identity, password)` | log in (`connect()` does this for you) |
| `pb.collection(c).authRefresh()` | validate and extend the current token |
| `pb.collection(c).listAuthMethods()` | enabled methods |
| `pb.collection(c).requestOTP(email)` → `authWithOTP(otpId, code)` | OTP login |
| `pb.collection(c).impersonate(id, seconds)` | superuser only; **returns a new client**, whose token is at `.authStore.token` (non-refreshable) |
| `pb.authStore.token / .record / .isSuperuser / .isValid` | current auth state |

Superusers live in `_superusers`. If MFA is enabled on the auth collection, a password login alone won't produce a token; give the agent an impersonate-minted `PB_TOKEN` instead.

## 9. Collections (schema edits)

- `pb.collections.update(name, { fields })` **replaces the whole field list**. Omitted fields are dropped along with their data. Always start from `pb.collections.getOne(name)`, change the array, and send the whole thing back. Keep each field's `id`: that makes PocketBase treat it as a rename or modification rather than a drop plus add, so a rename keeps its data.
- Collection types are `base`, `auth`, and `view` (read-only, defined by `viewQuery` SQL).
- **API rules:** `null` = superuser only, `""` = public, otherwise a filter expression evaluated per request (e.g. `@request.auth.id != "" && owner = @request.auth.id`).
- `indexes` are raw SQL `CREATE [UNIQUE] INDEX` strings.

## 10. SQL

`pb.sql.run(query)` (superuser) returns `{ columns: [{name, type, nullable}], rows: [[...]], affectedRows, execTime }`. Row values come back as strings. It's useful for aggregates, `GROUP BY`, and ad-hoc joins that filters can't express. The guard allows only a single `SELECT`/`EXPLAIN` with no write keywords or extra statements; anything else needs `allowDestructive`. SQL bypasses API rules and validation, so prefer record APIs for writes even when writing is allowed.

## 11. Realtime

`pb.collection(c).subscribe("*" | id, callback, opts)` needs a global `EventSource`, which Node doesn't provide by default. On Node 22+, run the script with `node --experimental-eventsource script.mjs` (verified). Unsubscribe with `pb.collection(c).unsubscribe()`. Events look like `{ action: "create" | "update" | "delete", record }`.

## 12. Destructive-operation guard

Implemented in `client.mjs` by `isDestructive(path, options)`, and applied to every request sent through `connect()`'s client, including `run`, `PB_TOKEN`, and anonymous clients. Blocked by default:

- any `DELETE` request
- `POST /api/batch` containing a DELETE
- `PATCH`/`PUT` on `/api/collections` or `/api/collections/{name}` (schema edits, import)
- `PATCH /api/settings`
- `POST /api/backups/{name}/restore`
- `POST /api/sql` unless it's a single read-only `SELECT`/`EXPLAIN`

Lift it with `--allow-destructive` (`run`) or `connect({ allowDestructive: true })`, only after the user confirms. The guard does not cover a separately installed npm SDK or raw curl.

## 13. Raw HTTP / curl

Only needed when Node isn't available or when you're debugging the wire format. The token comes from the same cache:

```bash
TOKEN=$(node scripts/pb.mjs token)
curl -sS --fail-with-body -G "$PB_URL/api/collections/posts/records" -H "Authorization: $TOKEN" \
  --data-urlencode "filter=$(node scripts/pb.mjs run 'pb.filter("title ~ {:q}", { q: args[0] })' "$QUERY")" \
  --data-urlencode 'fields=id,title'
# multipart: non-file fields as JSON in @jsonPayload
curl -sS --fail-with-body -X PATCH "$PB_URL/api/collections/posts/records/ID" -H "Authorization: $TOKEN" \
  -F '@jsonPayload={"title":"With cover","views+":1}' -F 'cover=@./cover.png'
```

The header is the raw token (`Authorization: <token>`); a `Bearer ` prefix is also accepted. Use `-G --data-urlencode` for query params, and `--fail-with-body` so errors give a non-zero exit code but still show PocketBase's error JSON. curl bypasses the guard.
