/// <reference path="../pb_data/types.d.ts" />

// Initial schema. STUB — the collections are not modelled yet.
//
// This is the ONE migration that builds the database from nothing. The workflow
// (see README) always resets pb_data and re-runs it, so it is never "migrated
// against" an existing database — edit it in place instead of adding follow-ups
// until we actually have prod data worth preserving.
//
// Anything read from $os.getenv here is baked into data.db at migrate time.
// Dev gets .env.development.local; prod gets .env.production.local via deploy.fish.

migrate(
	(app) => {
		// ----------------------------------------------------------------
		// app settings
		// ----------------------------------------------------------------
		const appUrl = $os.getenv("PB_APP_URL")

		const settings = app.settings()
		settings.meta.appName = "Clockwork Alchemy Signups"
		// Guarded: PocketBase VALIDATES meta.appURL (`cannot be blank`), so an
		// unset PB_APP_URL would fail the whole migration and leave a fresh clone
		// with no database at all. Leaving the default (http://localhost:8090) is
		// wrong-but-harmless in dev; deploy.fish refuses to ship without a real
		// prod origin, which is where it actually matters (it resolves {APP_URL}
		// in auth emails).
		if (appUrl) settings.meta.appURL = appUrl

		// TODO: sender identity once the Postmark domain is confirmed.
		// settings.meta.senderName = "Clockwork Alchemy"
		// settings.meta.senderAddress = "signups@..."

		// TODO: SMTP. Off for now so a fresh clone with no env still boots;
		// PocketBase falls back to logging mail to the console.
		// settings.smtp.enabled = true
		// settings.smtp.host = $os.getenv("SMTP_HOST")
		// settings.smtp.port = parseInt($os.getenv("SMTP_PORT"), 10)
		// settings.smtp.username = $os.getenv("SMTP_USERNAME")
		// settings.smtp.password = $os.getenv("SMTP_PASSWORD")

		// ----------------------------------------------------------------
		// batch API — REQUIRED, not an optimization
		// ----------------------------------------------------------------
		// runic-pocketbase-collection funnels every optimistic create/update/delete
		// into a single transactional POST /api/batch. PocketBase ships with that
		// endpoint DISABLED, so without this a fresh database fails EVERY mutation
		// — and it fails at the endpoint, so it reads as a client bug. Set the
		// limits explicitly (they match PocketBase's own defaults) so the config is
		// self-documenting regardless of prior settings state.
		settings.batch.enabled = true
		settings.batch.maxRequests = 50
		settings.batch.timeout = 3

		// No S3, by decision: files and backups stay on the local PocketBase
		// volume. See the durability note in the README — this is the one thing
		// that makes the "prod is disposable" deploy model load-bearing rather
		// than merely convenient.
		// TODO: decide the backup story before real signups land, e.g.
		// settings.backups.cron = "0 0 * * *"
		// settings.backups.cronMaxKeep = 14

		app.save(settings)

		// ----------------------------------------------------------------
		// superuser (admin UI + pocketbase-typegen login)
		// ----------------------------------------------------------------
		// Seeded HERE rather than by a `pocketbase superuser upsert` script, so the
		// admin account is part of the database's definition like everything else:
		// one command (`migrate up`) produces a database you can actually log into.
		//
		// The same pair authenticates pocketbase-typegen (it reads the schema over
		// the API as a superuser), which is why packages/scripts' env file repeats
		// these values for the same stage. They must match.
		//
		// STAGE-SCOPED ON PURPOSE: PB_ADMIN_* live in .env.development.local /
		// .env.production.local, never in the shared .env.local. start.fish sources
		// the former and deploy.fish the latter, so the dev password is structurally
		// incapable of being baked into prod's data.db — no guard required.
		const adminEmail = $os.getenv("PB_ADMIN_USERNAME")
		const adminPassword = $os.getenv("PB_ADMIN_PASSWORD")

		// Unset is non-fatal: a fresh clone with no env files must still produce a
		// working database. PocketBase then prints its one-time installer link on
		// serve, which is the pre-existing behaviour.
		if (adminEmail && adminPassword) {
			// Checked before save because PocketBase's own failure here is a validation
			// dump in the middle of `migrate up`, which reads as a broken migration
			// rather than a 3-character-too-short password.
			if (adminPassword.length < 10)
				throw new Error("PB_ADMIN_PASSWORD must be at least 10 characters")

			const superuser = new Record(app.findCollectionByNameOrId("_superusers"))
			superuser.set("email", adminEmail)
			// setPassword, not set("password"): it hashes and sets tokenKey. Assigning
			// the field directly stores the plaintext and the login silently fails.
			superuser.setPassword(adminPassword)
			app.save(superuser)
		} else {
			console.log(
				">> PB_ADMIN_USERNAME/PB_ADMIN_PASSWORD unset: no superuser seeded." +
					" PocketBase will print an installer link on serve." +
					" See packages/database/.env.example."
			)
		}

		// ----------------------------------------------------------------
		// collections
		// ----------------------------------------------------------------
		// TODO — port the Airtable model (see packages/www-old/src/lib/types.ts):
		//
		//   workshops   slug, name, description, image, location, start, end,
		//               deadline, limit, cost, paymentInstructions, options[],
		//               leader (rel -> leaders)
		//   leaders     name, email
		//   signups     name, email, workshop (rel), option, status
		//               (was Airtable "Attendees"; renamed — a signup is an
		//               event, a person is not)
		//   copy        slug, value        -- editable page strings
		//   settings    slug, value        -- feature flags / knobs
		//   assets      slug, address      -- image + link indirection
		//
		// Open questions to settle before writing these:
		//   - do attendees authenticate, or is signup anonymous by email like v1?
		//   - is capacity (`limit`) enforced in a hook, or advisory like v1?
		//   - API rules: public read on workshops/copy/settings, no client read
		//     on signups (PII) — signups created through a SvelteKit remote
		//     function with a superuser token, most likely.

		// Placeholder so `pocketbase migrate up` is exercised end-to-end and the
		// admin UI has something to show. DELETE once real collections land.
		const placeholder = new Collection({
			type: "base",
			name: "_scaffold",
			fields: [{ type: "text", name: "note", required: false }],
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null
		})
		app.save(placeholder)
	},
	(app) => {
		// Down: drop what the up created. Rarely used — `pnpm reset` is the
		// normal way back to zero — but PocketBase wants it and it keeps
		// `migrate down 1` honest.
		// The seeded superuser usually SURVIVES this: PocketBase refuses to delete
		// the only existing superuser ("You can't delete the only existing
		// superuser"), which is exactly the situation after a fresh up. Attempted
		// anyway for the case where another admin exists, and non-fatal otherwise —
		// `pnpm reset` is the real way back to zero, and re-running `migrate up`
		// against a database that kept the record fails on the unique email.
		const adminEmail = $os.getenv("PB_ADMIN_USERNAME")
		if (adminEmail) {
			try {
				app.delete(app.findAuthRecordByEmail("_superusers", adminEmail))
			} catch (err) {
				console.log(`>> could not delete superuser ${adminEmail}: ${err}`)
			}
		}

		try {
			app.delete(app.findCollectionByNameOrId("_scaffold"))
		} catch {
			// already gone
		}
	}
)
