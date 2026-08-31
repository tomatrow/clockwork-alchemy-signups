/// <reference path="../pb_data/types.d.ts" />

// STUB — real collections are not modelled yet.
// Values read from $os.getenv are baked into data.db at migrate time.

migrate(
	(app) => {
		// app settings
		const appUrl = $os.getenv("PB_APP_URL")

		const settings = app.settings()
		settings.meta.appName = "Clockwork Alchemy Signups"
		// meta.appURL cannot be blank, so only override it when PB_APP_URL is set.
		if (appUrl) settings.meta.appURL = appUrl

		// TODO: sender identity once the Postmark domain is confirmed.
		// settings.meta.senderName = "Clockwork Alchemy"
		// settings.meta.senderAddress = "signups@..."

		// TODO: SMTP. Mail currently just logs to the console.
		// settings.smtp.enabled = true
		// settings.smtp.host = $os.getenv("SMTP_HOST")
		// settings.smtp.port = parseInt($os.getenv("SMTP_PORT"), 10)
		// settings.smtp.username = $os.getenv("SMTP_USERNAME")
		// settings.smtp.password = $os.getenv("SMTP_PASSWORD")

		// Batch API is disabled by default in PocketBase but required by
		// runic-pocketbase-collection's transactional mutations.
		settings.batch.enabled = true
		settings.batch.maxRequests = 50
		settings.batch.timeout = 3

		// No S3: files and backups stay on the local PocketBase volume.
		// TODO: decide the backup story before real signups land, e.g.
		// settings.backups.cron = "0 0 * * *"
		// settings.backups.cronMaxKeep = 14

		app.save(settings)

		// superuser (admin UI + pocketbase-typegen login)
		const adminEmail = $os.getenv("PB_ADMIN_USERNAME")
		const adminPassword = $os.getenv("PB_ADMIN_PASSWORD")

		if (adminEmail && adminPassword) {
			if (adminPassword.length < 10)
				throw new Error("PB_ADMIN_PASSWORD must be at least 10 characters")

			const superuser = new Record(app.findCollectionByNameOrId("_superusers"))
			superuser.set("email", adminEmail)
			// setPassword hashes and sets tokenKey; set("password") would not.
			superuser.setPassword(adminPassword)
			app.save(superuser)
		} else {
			console.log(
				">> PB_ADMIN_USERNAME/PB_ADMIN_PASSWORD unset: no superuser seeded." +
					" PocketBase will print an installer link on serve." +
					" See packages/database/.env.example."
			)
		}

		// collections
		// TODO — port the Airtable model (see packages/www-old/src/lib/types.ts):
		//
		//   workshops   slug, name, description, image, location, start, end,
		//               deadline, limit, cost, paymentInstructions, options[],
		//               leader (rel -> leaders)
		//   leaders     name, email
		//   signups     name, email, workshop (rel), option, status
		//   copy        slug, value        -- editable page strings
		//   settings    slug, value        -- feature flags / knobs
		//   assets      slug, address      -- image + link indirection
		//
		// Open questions to settle before writing these:
		//   - do attendees authenticate, or is signup anonymous by email?
		//   - is capacity (`limit`) enforced in a hook, or advisory?
		//   - API rules: public read on workshops/copy/settings, no client read
		//     on signups (PII).

		// Placeholder collection; delete once real collections land.
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
		// Drops what the up migration created.
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
