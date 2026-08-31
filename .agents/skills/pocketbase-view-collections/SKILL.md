---
name: pocketbase-view-collections
description: Write correct PocketBase view collection SQL (type "view", viewQuery). Covers how PocketBase infers view fields from the outer SELECT, the FILTER / "invalid identifier parts" trap and CTE workaround, CAST-based field typing, relation columns, and the required id column. Use ONLY when authoring or debugging a PocketBase view's viewQuery.
---

# PocketBase view collections

Writing a `viewQuery` PocketBase can turn into a typed collection. PocketBase
infers a view's fields by **parsing the query**, and that parser — not SQLite —
is what bites you. Everything here is about shaping the SQL to satisfy it.

## How PocketBase reads your query

PocketBase generates the view's fields by parsing **only the outermost
`SELECT`'s column list**. Two parser behaviors drive every rule below:

- Its tokenizer treats balanced `(...)`, `'...'`, `"..."`, and backticks as
  **single opaque tokens**.
- It strips `JOIN`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER`, `LIMIT`, and `WITH`
  before splitting columns.

So anything inside parentheses — CTE bodies, subqueries, the insides of
`CAST(...)` and function calls — is **invisible to field inference**, even though
SQLite still executes it. You exploit this to hide SQL the parser can't handle.

## Rule 1 — every outer column must be a clean `expr AS alias`

Each outer-`SELECT` column must tokenize (on whitespace, parens grouped) to
**1, 2, or 3 parts**; `expr AS alias` is the 3-part form. More parts fail with:

    viewQuery: Invalid query - invalid identifier parts [...]

The classic offender is `FILTER`:

```sql
-- BROKEN: 5 tokens → COUNT(a.id) | FILTER | (WHERE ...) | AS | goingCount
COUNT(a.id) FILTER (WHERE a.status = 'going') AS goingCount
```

Window functions (`... OVER (...)`), `COLLATE`, and other multi-token
expressions break the same way. A failed parse also surfaces a misleading
second error — `fields: cannot be blank` — because zero fields got generated.

## Rule 2 — hide complex SQL in a CTE or subquery

Move `FILTER`, window functions, and any multi-token expression into a
`WITH cte AS (...)` (or `FROM (subquery) alias`). The parser sees the CTE body as
one opaque paren-group and skips it; the outer `SELECT` only references the
precomputed columns. SQLite supports `FILTER` (3.30+) and runs the full query —
only the parser needed appeasing.

## Rule 3 — type your columns; unrecognized forms become `json`

PocketBase types each outer column by **pattern**, not by executing it:

| Outer-`SELECT` column                       | Generated field                                        |
| ------------------------------------------- | ------------------------------------------------------ |
| `<anything> AS id`                          | **text primary key** (always — `id` is special-cased)  |
| `COUNT(...) AS x`                           | number (integer)                                       |
| `total(...) AS x`                           | number (float)                                         |
| `CAST(expr AS int\|integer) AS x`           | number (integer)                                       |
| `CAST(expr AS real\|decimal\|numeric) AS x` | number (float)                                         |
| `CAST(expr AS text) AS x`                   | text                                                   |
| `CAST(expr AS bool\|boolean) AS x`          | bool                                                   |
| `realTable.field AS x`                      | **clone** of that collection field (relation/select/…) |
| `realTable.id AS x` (alias ≠ `id`)          | **relation** to that collection                        |
| anything else — `SUM(...)`, arithmetic, a bare CTE column | **untyped `json`**                       |

Fallout to watch for:

- **`SUM(...)` is not recognized as numeric.** A bare `SUM(...) AS x` (or any
  CTE-derived column) becomes a `json` field — your client then does math on an
  untyped, possibly-string value. Wrap it: `CAST(SUM(...) AS REAL) AS x`.
- **No wildcards.** PocketBase rejects `SELECT *` / `table.*` ("dynamic column
  names are not supported"). List columns explicitly.

## Rule 4 — the `id` column

Every view **must** expose an `id` column, or PocketBase errors with
`missing required id column`. If there's no natural id, synthesize one:
`(ROW_NUMBER() OVER()) AS id`.

Special case: **`alias = id` always wins.** `x.id AS id` is a text PK, _not_ a
relation. For a relation to the source collection, alias it to something else
(`x.id AS event`) and join the real table.

## Rule 5 — relations and real field settings

A typed **relation** (or preserving a real field's settings like `select`
values or `maxSelect`) requires referencing the **real collection table** in the
outer `SELECT`:

- Relation: join the collection, select `theCollection.id AS aliasOtherThanId`.
- Preserve settings: source `theCollection.field AS x` from the actual table,
  not from a CTE (a CTE column loses the field metadata and falls back to
  `json`/`CAST` typing).

## Known-good template

```sql
WITH stats AS (
  SELECT
    e.id AS event,
    COUNT(a.id) FILTER (WHERE a.status = 'going')      AS goingCount,
    COUNT(a.id) FILTER (WHERE a.status = 'waitlisted') AS waitCount
  FROM events e
  LEFT JOIN attendees a ON a.event = e.id
  GROUP BY e.id
)
SELECT
  stats.event           AS id,                  -- text PK = event id
  CAST(stats.goingCount AS REAL) AS goingCount, -- number, not json
  CAST(stats.waitCount  AS REAL) AS waitCount
FROM stats
```

`FILTER` lives in the CTE (parser never sees it); `CAST(... AS REAL)` makes the
counts numeric; `id` is present. The `event_stats` view in
`packages/database/pb_migrations/1779840000_init_schema.js` is a worked
reference in this repo.

## Error → SQL fix

| Error / symptom                                                                | Cause                                               | Fix                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `Invalid query - invalid identifier parts [...]` (+ `fields: cannot be blank`) | An outer column has >3 tokens (`FILTER`, window fn) | Move it into a CTE; expose the precomputed column        |
| `missing required id column`                                                  | No `id` column                                      | Add `... AS id`, or `(ROW_NUMBER() OVER()) AS id`        |
| Field is `json` / client math `NaN` / counts arrive as strings                | Column isn't a recognized numeric pattern           | `CAST(... AS REAL/INT)`, or use `COUNT(...)`/`total(...)` |
| Relation/expand empty on a view column                                        | Not sourced from the real table, or aliased `id`    | Join the real table; select `table.id AS nonIdAlias`     |
