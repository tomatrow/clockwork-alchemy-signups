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
		settings.meta.appURL = appUrl

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

		// TODO: enable the batch API if the client ever needs transactional
		// multi-record writes (signing up for N workshops at once).
		// settings.batch.enabled = true
		// settings.batch.maxRequests = 50
		// settings.batch.timeout = 3

		// TODO: S3-backed files + backups in prod (Coolify volume is disposable).
		// settings.backups.cron = "0 0 * * *"
		// settings.backups.cronMaxKeep = 14

		app.save(settings)

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
		try {
			app.delete(app.findCollectionByNameOrId("_scaffold"))
		} catch {
			// already gone
		}
	}
)
