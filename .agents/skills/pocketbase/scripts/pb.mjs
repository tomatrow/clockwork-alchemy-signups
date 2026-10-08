#!/usr/bin/env node
/**
 * pb.mjs — run official PocketBase JS SDK code against a live instance (Node 18+).
 * Auth/config come from client.mjs: PB_URL, PB_TOKEN | PB_EMAIL + PB_PASSWORD, PB_AUTH_COLLECTION.
 *
 *   run '<js>' [args...]      Execute SDK code with an authenticated `pb` in scope and print the
 *                             result (strings raw, everything else as JSON). The code can be a
 *                             single expression, or statements using `return`. `await` works.
 *                             In scope: pb, args (extra CLI args), file(path) -> File for
 *                             uploads, ClientResponseError.
 *                             Pass shell values via args, never by splicing them into the code.
 *                             --allow-destructive  lift the destructive-operation guard
 *                             (only after the user has confirmed)
 *   run -                     Read the code from stdin.
 *   schema <col> [--raw]      Compact field/rule/index summary of one collection (superuser).
 *   collections [--detail] [--include-system]
 *                             All collections with field names (or compact field definitions).
 *   auth                      Who am I: collection, id, superuser, token expiry (validated).
 *   token                     Print a validated token, e.g. for curl -H "Authorization: $TOKEN".
 *   health                    Server reachability.
 *
 * Examples:
 *   pb.mjs run 'pb.collection("posts").getList(1, 20, { sort: "-created", fields: "id,title" })'
 *   pb.mjs run 'pb.collection("authors").getFirstListItem(pb.filter("name = {:n}", { n: args[0] }))' "$NAME"
 *   pb.mjs run 'pb.collection("posts").update(args[0], { "views+": 1, cover: file(args[1]) })' "$ID" ./c.png
 *
 * Errors are JSON on stderr, exit code 1.
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { connect, config, PocketBase, ClientResponseError } from "./client.mjs";

function die(msg, status, details) {
  const err = { error: msg };
  if (status !== undefined) err.status = status;
  if (details && Object.keys(details).length) err.details = details;
  process.stderr.write(JSON.stringify(err, null, 2) + "\n");
  process.exit(1);
}
const out = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
const isoExp = (tok) => {
  try { return new Date(JSON.parse(Buffer.from(tok.split(".")[1], "base64url")).exp * 1000).toISOString(); }
  catch { return null; }
};
const file = (path) => new File([readFileSync(path)], basename(path));

function summarizeField(f, names) {
  const s = { name: f.name, type: f.type };
  for (const flag of ["required", "hidden", "system"]) if (f[flag]) s[flag] = true;
  const pick = (...keys) => { for (const k of keys) if (f[k] != null && f[k] !== "" && f[k] !== 0 && f[k] !== false) s[k] = f[k]; };
  switch (f.type) {
    case "select": s.values = f.values; s.maxSelect = f.maxSelect; break;
    case "relation":
      s.collection = names[f.collectionId] || f.collectionId; s.maxSelect = f.maxSelect;
      if (f.cascadeDelete) s.cascadeDelete = true; break;
    case "file": s.maxSelect = f.maxSelect; pick("mimeTypes", "protected", "thumbs"); break;
    case "text": case "editor": case "email": case "url":
      pick("min", "max", "pattern");
      if (f.autogeneratePattern) s.autogenerate = f.autogeneratePattern; break;
    case "number": pick("min", "max", "onlyInt"); break;
    case "autodate": s.onCreate = f.onCreate; s.onUpdate = f.onUpdate; break;
    case "date": pick("min", "max"); break;
  }
  return s;
}

const AsyncFunction = (async () => {}).constructor;

const commands = {
  async run(v, [code, ...args]) {
    if (code === "-") code = readFileSync(0, "utf8");
    if (!code) die("Usage: run '<sdk code>' [args...]");
    const pb = await connect({ allowDestructive: !!v["allow-destructive"] });
    const scope = { pb, args, file, ClientResponseError };
    let fn;
    try {
      fn = new AsyncFunction(...Object.keys(scope), `return (${code}\n);`);   // single expression
    } catch {
      try { fn = new AsyncFunction(...Object.keys(scope), code); }         // statements (use return)
      catch (e) { die(`Syntax error in code: ${e.message}`); }
    }
    const result = await fn(...Object.values(scope));
    if (result === undefined) return;
    if (typeof result === "string") process.stdout.write(result + "\n");
    else out(result);
  },

  async token() {
    const pb = await connect({ validate: true });
    if (!pb.authStore.token) die("No credentials. Set PB_TOKEN, or PB_EMAIL and PB_PASSWORD.");
    process.stdout.write(pb.authStore.token + "\n");
  },

  async health() { out(await new PocketBase(config().url).health.check()); },

  async auth() {
    const pb = await connect({ validate: true });
    if (!pb.authStore.token) die("No credentials. Set PB_TOKEN, or PB_EMAIL and PB_PASSWORD.");
    const r = pb.authStore.record;
    out(r
      ? { authenticated: true, collection: r.collectionName, id: r.id, email: r.email,
          superuser: pb.authStore.isSuperuser, tokenExpires: isoExp(pb.authStore.token) }
      : { authenticated: true, via: "PB_TOKEN", superuser: pb.authStore.isSuperuser,
          tokenExpires: isoExp(pb.authStore.token) });
  },

  async collections(v) {
    const pb = await connect();
    const cols = await pb.collections.getFullList();
    const names = Object.fromEntries(cols.map((x) => [x.id, x.name]));
    const sys = v["include-system"];
    out(cols.filter((x) => sys || !x.system).map((x) => {
      const row = { name: x.name, type: x.type };
      if (v.detail) row.fields = x.fields
        .filter((f) => sys || !f.system || ["id", "email"].includes(f.name))
        .map((f) => summarizeField(f, names));
      else row.fieldNames = x.fields.map((f) => f.name);
      return row;
    }));
  },

  async schema(v, [col]) {
    if (!col) die("Usage: schema <collection>");
    const pb = await connect();
    const cols = await pb.collections.getFullList();
    const names = Object.fromEntries(cols.map((x) => [x.id, x.name]));
    const x = cols.find((x) => x.name === col || x.id === col);
    if (!x) die(`Collection ${JSON.stringify(col)} not found. Available: ${Object.values(names).sort().join(", ")}`);
    if (v.raw) return out(x);
    const res = {
      name: x.name, id: x.id, type: x.type,
      fields: x.fields.map((f) => summarizeField(f, names)),
      rules: Object.fromEntries(["listRule", "viewRule", "createRule", "updateRule", "deleteRule"].map((k) => [k, x[k]])),
      indexes: x.indexes || [],
    };
    if (x.type === "view") res.viewQuery = x.viewQuery;
    out(res);
  },
};

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      "allow-destructive": { type: "boolean" },
      detail: { type: "boolean" }, "include-system": { type: "boolean" }, raw: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (e) { die(`${e.message} (put args that start with "-" after --)`); }

const [cmd, ...rest] = parsed.positionals;
if (!cmd || parsed.values.help || !commands[cmd]) {
  const src = readFileSync(new URL(import.meta.url), "utf8");
  process.stderr.write(src.slice(src.indexOf("/**"), src.indexOf("*/") + 2) + "\n");
  process.exit(cmd && !commands[cmd] ? 1 : 0);
}

try {
  await commands[cmd](parsed.values, rest);
} catch (e) {
  if (e instanceof ClientResponseError) {
    if (e.status === 0) die(`Could not reach ${process.env.PB_URL}: ${e.originalError?.cause?.code || e.originalError?.message || "network error"}`, 0);
    die(e.response?.message || "Request failed", e.status, e.response?.data);
  }
  if (e?.name === "DestructiveBlocked") die(e.message);
  die(e?.stack || String(e));
}
