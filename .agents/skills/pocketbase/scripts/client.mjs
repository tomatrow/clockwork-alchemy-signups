/**
 * client.mjs — returns an authenticated instance of the official PocketBase JS SDK
 * (vendored in ./vendor, so no npm install is needed).
 *
 *   import { connect } from "<skill>/scripts/client.mjs";
 *   const pb = await connect();              // reads PB_URL, PB_TOKEN | PB_EMAIL+PB_PASSWORD
 *   const posts = await pb.collection("posts").getFullList({ filter: pb.filter("x = {:x}", { x }) });
 *
 * What this adds on top of the SDK (everything else is plain SDK):
 *   - Config from env vars (PB_URL, PB_TOKEN, PB_EMAIL, PB_PASSWORD, PB_AUTH_COLLECTION).
 *   - autoCancellation(false): the SDK's browser default aborts concurrent requests to the
 *     same path, which breaks Promise.all in scripts.
 *   - A token cache shared across processes (~/.cache/pocketbase-skill/, mode 600), so each
 *     CLI call / script run doesn't do a fresh password login ("new location" alert emails).
 *   - A destructive-operation guard (see isDestructive): deletes, batches containing deletes,
 *     schema edits/imports, settings changes, backup restores, and non-read-only SQL throw
 *     DestructiveBlocked unless connect({ allowDestructive: true }) — so the agent has to
 *     consciously opt in after the user confirms.
 *   - Guest-fallback protection: PocketBase does NOT reject an invalid token on public
 *     endpoints — it silently treats the caller as a guest. So cached tokens are revalidated
 *     with authRefresh when older than 5 minutes, and a 401/403 while using an unvalidated
 *     cached token triggers one revalidate-and-retry.
 */

import PocketBase, { ClientResponseError } from "./vendor/pocketbase.es.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

export { PocketBase, ClientResponseError };

export class DestructiveBlocked extends Error {
  constructor(what) {
    super(`Blocked destructive request: ${what}. Show the user what will be affected, get their ` +
      `confirmation, then re-run with --allow-destructive (CLI) or connect({ allowDestructive: true }).`);
    this.name = "DestructiveBlocked";
  }
}

const READ_ONLY_SQL = /^\s*(select|explain)\b/i;
const WRITE_SQL = /\b(insert|update|delete|replace|drop|alter|create|attach|detach|vacuum|reindex)\b|pragma\s+\w+\s*=/i;

function bodyJson(body) {
  if (!body) return null;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    try { return JSON.parse(body.get("@jsonPayload") || "null"); } catch { return null; }
  }
  if (typeof body === "string") { try { return JSON.parse(body); } catch { return null; } }
  return typeof body === "object" ? body : null;
}

/** Returns a description of why a request is destructive, or null if it's safe. */
export function isDestructive(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const p = "/" + String(path).split("?")[0].replace(/^\/+/, "");
  if (method === "GET") return null;
  if (method === "DELETE") return `DELETE ${p}`;
  if (p === "/api/batch") {
    const n = (bodyJson(options.body)?.requests || []).filter((r) => String(r.method).toUpperCase() === "DELETE").length;
    return n ? `batch containing ${n} DELETE request(s)` : null;
  }
  if (/^\/api\/collections(\/[^/]+)?$/.test(p) && (method === "PATCH" || method === "PUT")) {
    return `${method} ${p} (schema change — omitted fields are dropped with their data)`;
  }
  if (p === "/api/settings" && method === "PATCH") return "settings change";
  if (/^\/api\/backups\/[^/]+\/restore$/.test(p)) return "backup restore (replaces the whole database)";
  if (p === "/api/sql") {
    const q = String(bodyJson(options.body)?.query || "");
    const readOnly = READ_ONLY_SQL.test(q) && !WRITE_SQL.test(q) && !/;\s*\S/.test(q);
    return readOnly ? null : "SQL that isn't a single read-only SELECT/EXPLAIN";
  }
  return null;
}

// The vendored SDK is minified onto one line, so Node's default crash output for an uncaught
// SDK error prints the entire ~40 KB file as "source context". Print a compact error instead
// (covers failed top-level awaits and floating promises in scripts).
if (!process.listenerCount("uncaughtException")) {
  process.on("uncaughtException", (e) => {
    if (e instanceof ClientResponseError) {
      console.error(JSON.stringify({
        error: e.response?.message || e.message, status: e.status, url: e.url, details: e.response?.data,
      }, null, 2));
    } else if (e?.name === "DestructiveBlocked") {
      console.error(JSON.stringify({ error: e.message }, null, 2));
    } else {
      console.error(e?.stack || String(e));
    }
    process.exit(1);
  });
}

const CACHE_DIR = join(homedir(), ".cache", "pocketbase-skill");
const REVALIDATE_MS = 5 * 60 * 1000;

function jwtExp(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp || 0;
  } catch { return 0; }
}

export function config(overrides = {}) {
  const c = {
    url: overrides.url || process.env.PB_URL,
    token: overrides.token || process.env.PB_TOKEN,
    email: overrides.email || process.env.PB_EMAIL,
    password: overrides.password || process.env.PB_PASSWORD,
    authCollection: overrides.authCollection || process.env.PB_AUTH_COLLECTION || "_superusers",
    cache: overrides.cache ?? true,
  };
  if (!c.url) throw new Error("PB_URL is not set. Export PB_URL (e.g. https://pb.example.com).");
  return c;
}

/**
 * @param {object} [overrides] url, token, email, password, authCollection, cache (bool),
 *   validate (bool: force a server-side token check now),
 *   allowDestructive (bool: disable the destructive-operation guard; only after user confirmation)
 * @returns {Promise<PocketBase>} authenticated (or anonymous if no credentials) SDK client
 */
export async function connect(overrides = {}) {
  const c = config(overrides);
  const pb = new PocketBase(c.url);
  pb.autoCancellation(false);

  // Guard first, so it wraps every SDK call regardless of how we authenticate.
  const rawSend = pb.send.bind(pb);
  pb.send = async (path, options) => {
    if (!overrides.allowDestructive) {
      const why = isDestructive(path, options);
      if (why) throw new DestructiveBlocked(why);
    }
    return rawSend(path, options);
  };

  if (c.token) {
    pb.authStore.save(c.token, null);
    return pb;
  }
  if (!c.email || !c.password) return pb; // anonymous: only public API rules apply

  const auth = pb.collection(c.authCollection);
  const cacheFile = join(CACHE_DIR, createHash("sha256")
    .update(`${c.url.replace(/\/+$/, "")}|${c.authCollection}|${c.email}`)
    .digest("hex").slice(0, 24) + ".json");

  const login = () => auth.authWithPassword(c.email, c.password);
  const revalidate = async () => {
    try { await auth.authRefresh(); } catch { await login(); }
  };

  let unvalidated = false;
  let cached = null;
  if (c.cache && existsSync(cacheFile)) {
    try { cached = JSON.parse(readFileSync(cacheFile, "utf8")).token; } catch { /* ignore */ }
  }
  const usable = cached && jwtExp(cached) > Date.now() / 1000 + 60;
  if (usable) pb.authStore.save(cached, null);

  // Persist every NEW token the SDK obtains (login, refresh). Registered after loading the
  // cached token, so merely reading the cache doesn't rewrite it and reset its age.
  if (c.cache) {
    pb.authStore.onChange((token) => {
      if (!token || token === cached) return;
      mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(cacheFile, JSON.stringify({ token }), { mode: 0o600 });
    });
  }

  if (usable) {
    const fresh = Date.now() - statSync(cacheFile).mtimeMs < REVALIDATE_MS;
    if (fresh && !overrides.validate) unvalidated = true;
    else await revalidate();
  } else {
    await login();
  }

  // Every SDK call goes through pb.send; retry once if an unvalidated cached token
  // turns out to be bad (it shows up as 401 on some endpoints, guest-level 403 on others).
  const send = pb.send.bind(pb);
  pb.send = async (path, options) => {
    try {
      return await send(path, options);
    } catch (e) {
      if (unvalidated && (e.status === 401 || e.status === 403)) {
        unvalidated = false;
        const before = pb.authStore.token;
        await revalidate();
        if (pb.authStore.token !== before) return send(path, options);
      }
      throw e;
    }
  };
  return pb;
}
