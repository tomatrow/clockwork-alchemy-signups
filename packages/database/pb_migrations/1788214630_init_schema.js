/// <reference path="../pb_data/types.d.ts" />

// Init migration: builds the whole database.
// Values read from $os.getenv are baked into data.db at migrate time.
//
// Model (decided 2026-09, see log.md):
//   users     auth, OTP-only login (password auth disabled; the client creates
//             accounts with a random throwaway password). `verified` flips on
//             first successful OTP auth and gates signup updates.
//   workshops public read, superuser write. Options are a json array of
//             { value, imageURL } validated by a hook.
//   signups   APPEND-ONLY LOG. Every user action (register, cancel, rejoin,
//             option change) appends an immutable event; records are never
//             updated or deleted. Current state = latest event per
//             (user, workshop). Confirmed-vs-waitlisted is NEVER stored — it
//             is derived by the signup_status view: queue position is the
//             oldest going-event since the user's last not-going, so option
//             changes keep your spot and only cancelling loses it (rejoin =
//             back of the queue).
//   content   singleton row of editable page content (create/delete locked).
//   views     workshop_availability (public counts),
//             signup_status (owner-read derived status).

migrate(
	(app) => {
		// ------------------------------------------------------------------
		// app settings
		// ------------------------------------------------------------------
		const appUrl = $os.getenv("PB_APP_URL")

		const settings = app.settings()
		settings.meta.appName = "Clockwork Alchemy Signups"
		// meta.appURL cannot be blank, so only override it when PB_APP_URL is set.
		if (appUrl) settings.meta.appURL = appUrl

		// SMTP: Cloudflare Email Service (smtp.mx.cloudflare.net:465, implicit
		// TLS, username is the literal string "api_token", password is a CF API
		// token with Email Sending: Edit). Sender domain must be onboarded.
		// Without these, mail (OTP + signup emails) logs to the console.
		const smtpHost = $os.getenv("SMTP_HOST")
		const smtpPassword = $os.getenv("SMTP_PASSWORD")
		const senderAddress = $os.getenv("PB_SENDER_ADDRESS")

		if (smtpHost && smtpPassword && senderAddress) {
			settings.smtp.enabled = true
			settings.smtp.host = smtpHost
			settings.smtp.port = parseInt($os.getenv("SMTP_PORT") || "465", 10)
			settings.smtp.tls = true
			settings.smtp.username = $os.getenv("SMTP_USERNAME") || "api_token"
			settings.smtp.password = smtpPassword
			settings.meta.senderAddress = senderAddress
			settings.meta.senderName = $os.getenv("PB_SENDER_NAME") || "Clockwork Alchemy Workshops"
		} else {
			console.log(">> SMTP env unset: mail will log to the console. See .env.example.")
		}

		// Batch API is disabled by default in PocketBase but required by
		// runic-pocketbase-collection's transactional mutations.
		settings.batch.enabled = true
		settings.batch.maxRequests = 50
		settings.batch.timeout = 3

		// No S3: files and backups stay on the local PocketBase volume.
		// TODO: enable settings.backups (plus somewhere off-box to put them)
		// before the first real signup — see README "Durability caveat".

		app.save(settings)

		// ------------------------------------------------------------------
		// superuser (admin UI + pocketbase-typegen login; also the content
		// editors' login — editors are superusers, by decision)
		// ------------------------------------------------------------------
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

		// ------------------------------------------------------------------
		// users: OTP-only auth
		// ------------------------------------------------------------------
		const users = app.findCollectionByNameOrId("users")
		// Login is exclusively "enter the code we emailed you". Accounts are
		// still CREATED with a password (PocketBase requires one) — the client
		// generates a random throwaway that is never shown or usable.
		users.passwordAuth.enabled = false
		users.otp.enabled = true
		users.listRule = "id = @request.auth.id"
		users.viewRule = "id = @request.auth.id"
		users.createRule = "" // public: the signup form creates unverified accounts
		users.updateRule = "id = @request.auth.id"
		users.deleteRule = null
		app.save(users)

		// ------------------------------------------------------------------
		// workshops
		// ------------------------------------------------------------------
		const workshops = new Collection({
			type: "base",
			name: "workshops",
			listRule: "",
			viewRule: "",
			createRule: null, // superusers (the editors) only
			updateRule: null,
			deleteRule: null,
			fields: [
				{ type: "text", name: "slug", required: true },
				{ type: "text", name: "name", required: true },
				{ type: "editor", name: "description" },
				{
					type: "file",
					name: "image",
					maxSelect: 1,
					maxSize: 10485760,
					mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"]
				},
				// Pool for option images; options[].imageURL references a
				// filename from here (or "" / an external URL).
				{
					type: "file",
					name: "images",
					maxSelect: 20,
					maxSize: 10485760,
					mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"]
				},
				{ type: "text", name: "location" },
				{ type: "date", name: "start" },
				{ type: "date", name: "end" },
				// Confirmed spots. Everyone past this (by queue order) is
				// waitlisted — derived, never stored. See signup_status.
				{ type: "number", name: "capacity", required: true, onlyInt: true, min: 0 },
				{ type: "text", name: "cost" },
				{ type: "text", name: "paymentInstructions" },
				// [{ value: string, imageURL: string ("" allowed) }] — shape
				// enforced by the workshops hook on create/update.
				{ type: "json", name: "options", maxSize: 100000 },
				{ type: "autodate", name: "created", onCreate: true },
				{ type: "autodate", name: "updated", onCreate: true, onUpdate: true }
			],
			indexes: ["CREATE UNIQUE INDEX idx_workshops_slug ON workshops (slug)"]
		})
		app.save(workshops)

		// ------------------------------------------------------------------
		// signups: append-only event log — no updates, no deletes, ever.
		// The hook enforces log invariants that rules cannot express: first
		// event must be going, later events require a verified email, no-op
		// appends are rejected, signupsOpen gates joining (never cancelling).
		// ------------------------------------------------------------------
		const signups = new Collection({
			type: "base",
			name: "signups",
			listRule: "user = @request.auth.id",
			viewRule: "user = @request.auth.id",
			createRule: '@request.auth.id != "" && user = @request.auth.id',
			updateRule: null, // events are immutable
			deleteRule: null, // cancel = append intention: not-going
			fields: [
				{
					type: "relation",
					name: "user",
					required: true,
					maxSelect: 1,
					cascadeDelete: true,
					collectionId: users.id
				},
				{
					type: "relation",
					name: "workshop",
					required: true,
					maxSelect: 1,
					cascadeDelete: true,
					collectionId: workshops.id
				},
				{ type: "select", name: "intention", required: true, maxSelect: 1, values: ["going", "not-going"] },
				{ type: "text", name: "option" },
				// created orders the log; there is no `updated` — nothing updates.
				{ type: "autodate", name: "created", onCreate: true }
			],
			indexes: ["CREATE INDEX idx_signups_user_workshop ON signups (user, workshop, created)"]
		})
		app.save(signups)

		// ------------------------------------------------------------------
		// content: singleton page content (one row, seeded below; create and
		// delete locked so it stays a singleton — superusers edit it in place)
		// ------------------------------------------------------------------
		const content = new Collection({
			type: "base",
			name: "content",
			listRule: "",
			viewRule: "",
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				{
					type: "file",
					name: "logo",
					maxSelect: 1,
					maxSize: 10485760,
					mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"]
				},
				{ type: "editor", name: "signupPreBlurb" },
				{ type: "text", name: "rsvpButtonLabel" },
				{ type: "editor", name: "confirmationFooter" },
				{ type: "url", name: "scheduleUrl" },
				// Kill switch: the signups hook rejects new registrations when false.
				{ type: "bool", name: "signupsOpen" },
				{ type: "autodate", name: "updated", onCreate: true, onUpdate: true }
			]
		})
		app.save(content)

		// ------------------------------------------------------------------
		// views (see .agents/skills/pocketbase-view-collections)
		// ------------------------------------------------------------------

		// Public per-workshop counts, so the form can show "N spots remaining"
		// / "join waitlist (N waiting)" without reading signups (PII).
		// Current state = latest event per (user, workshop).
		const availability = new Collection({
			type: "view",
			name: "workshop_availability",
			listRule: "",
			viewRule: "",
			viewQuery: `
				WITH latest AS (
					SELECT sid, wid, intent FROM (
						SELECT
							s.id AS sid,
							s.workshop AS wid,
							s.intention AS intent,
							ROW_NUMBER() OVER (
								PARTITION BY s.user, s.workshop
								ORDER BY s.created DESC, s.id DESC
							) AS rn
						FROM signups s
					) WHERE rn = 1
				),
				stats AS (
					SELECT
						w.id AS wid,
						w.capacity AS cap,
						COUNT(latest.sid) FILTER (WHERE latest.intent = 'going') AS goingCount
					FROM workshops w
					LEFT JOIN latest ON latest.wid = w.id
					GROUP BY w.id
				)
				SELECT
					stats.wid AS id,
					CAST(stats.cap AS INTEGER) AS capacity,
					CAST(MIN(stats.goingCount, stats.cap) AS INTEGER) AS confirmed,
					CAST(MAX(stats.goingCount - stats.cap, 0) AS INTEGER) AS waitlisted
				FROM stats
			`
		})
		app.save(availability)

		// Derived state per (user, workshop), readable only by its owner; the
		// client reads THIS, never the raw log. One row per (user, workshop):
		// the latest event (its id is the row id — it changes on every append,
		// so clients key on user+workshop) plus derived status/position.
		//
		// Queue position ranks by joinedAt = the OLDEST going-event since the
		// user's last not-going: option changes keep your spot; cancelling and
		// rejoining puts you at the back. Someone cancelling implicitly
		// promotes the next in line (no hook, no recompute, no email — by
		// decision).
		const signupStatus = new Collection({
			type: "view",
			name: "signup_status",
			listRule: "user = @request.auth.id",
			viewRule: "user = @request.auth.id",
			viewQuery: `
				WITH latest AS (
					SELECT sid FROM (
						SELECT
							s.id AS sid,
							ROW_NUMBER() OVER (
								PARTITION BY s.user, s.workshop
								ORDER BY s.created DESC, s.id DESC
							) AS rn
						FROM signups s
					) WHERE rn = 1
				),
				joined AS (
					SELECT
						s.user AS uid,
						s.workshop AS wid,
						MIN(s.created) AS joinedAt
					FROM signups s
					WHERE s.intention = 'going'
						AND s.created > COALESCE((
							SELECT MAX(s3.created) FROM signups s3
							WHERE s3.user = s.user AND s3.workshop = s.workshop
								AND s3.intention = 'not-going'
						), '')
					GROUP BY s.user, s.workshop
				),
				ranked AS (
					SELECT
						latest.sid AS sid,
						ROW_NUMBER() OVER (
							PARTITION BY cur.workshop
							ORDER BY joined.joinedAt, latest.sid
						) AS pos
					FROM latest
					JOIN signups cur ON cur.id = latest.sid
					JOIN joined ON joined.uid = cur.user AND joined.wid = cur.workshop
					WHERE cur.intention = 'going'
				)
				SELECT
					signups.id AS id,
					users.id AS user,
					workshops.id AS workshop,
					signups.intention AS intention,
					signups.option AS option,
					CAST(
						CASE
							WHEN ranked.pos IS NULL THEN 'not-going'
							WHEN ranked.pos <= workshops.capacity THEN 'confirmed'
							ELSE 'waitlisted'
						END
					AS TEXT) AS status,
					CAST(ranked.pos AS INTEGER) AS position
				FROM latest
				JOIN signups ON signups.id = latest.sid
				JOIN workshops ON workshops.id = signups.workshop
				JOIN users ON users.id = signups.user
				LEFT JOIN ranked ON ranked.sid = latest.sid
			`
		})
		app.save(signupStatus)

		// ------------------------------------------------------------------
		// seed: content singleton
		// ------------------------------------------------------------------
		const contentRecord = new Record(content)
		contentRecord.set("logo", $filesystem.fileFromPath("seed/images/logo.png"))
		contentRecord.set(
			"signupPreBlurb",
			"<p>This is a selection of workshops that require registration, see the" +
				" schedule for a list of all workshops and events.</p>"
		)
		contentRecord.set("rsvpButtonLabel", "RSVP for this workshop")
		contentRecord.set(
			"confirmationFooter",
			"<p>See you at the con! Questions? Reply to your confirmation email.</p>"
		)
		contentRecord.set("scheduleUrl", "https://www.clockworkalchemy.com/")
		contentRecord.set("signupsOpen", true)
		app.save(contentRecord)

		// ------------------------------------------------------------------
		// seed: workshops — ported from last year's live site
		// (https://clockwork-alchemy-signups.vercel.app/signup), weekday/time
		// slots mapped onto CA 2026 (Fri Oct 16 – Sun Oct 18, Grand Bay Hotel
		// SF, Redwood City; times below are UTC for PDT local).
		// capacity 15 is a UNIFORM GUESS — editors correct it in the admin UI.
		// ------------------------------------------------------------------
		const payAtCon = "Pay in person at con."
		const payPalJan = "Pay at con or prepay with PayPal to janzabah@gmail.com"

		const seedWorkshops = [
			{
				slug: "clockwork-pendant-device",
				name: "Clockwork Pendant Device",
				image: "clockwork-pendant-device.jpeg",
				start: "2026-10-16 21:30:00.000Z", // Fri 2:30 PM PDT
				end: "2026-10-16 23:00:00.000Z", // Fri 4:00 PM PDT
				cost: "$5",
				paymentInstructions: payAtCon,
				description:
					"<p>Assemble tiny watch parts inside a little pendant to make an accessory" +
					" that you can add to a hat or gun, or wear as jewelry. Your little pendant" +
					" could be anything that you imagine: a magic detection device, a danger" +
					" prognosticator, or a power converter. Tiny parts may not be suitable for" +
					" children.</p>"
			},
			{
				slug: "pearly-kings-and-queens",
				name: "The Magic of the London Pearly Kings and Queens",
				image: null,
				start: "2026-10-16 23:00:00.000Z", // Fri 4:00 PM PDT
				end: "2026-10-17 00:30:00.000Z", // Fri 5:30 PM PDT
				cost: "$15",
				paymentInstructions: payAtCon,
				description:
					"<p>Pearl button jewelry making class in the tradition of the Victorian era" +
					" Costermongers Charitable Society. Participants will make a pin or a bracelet" +
					" with white mother of pearl buttons while learning about this tradition that" +
					" still exists today. Supplies will be provided, but participants will be" +
					" invited to bring any pearl buttons they have as well. Proceeds will go to" +
					" the Redwood Empire Food Bank.</p>"
			},
			{
				slug: "make-a-steampunk-medal",
				name: "Make a Steampunk Medal",
				image: "make-a-steampunk-medal.jpeg",
				start: "2026-10-17 00:30:00.000Z", // Fri 5:30 PM PDT
				end: "2026-10-17 02:00:00.000Z", // Fri 7:00 PM PDT
				cost: "$15",
				paymentInstructions: payPalJan,
				description:
					"<p>To honor your service as a Steampunk Adventurer, you should be given a" +
					" medal. Or you can make your own! You will use ribbon, gears, and other" +
					" supplies to create your own Medal of Merit reflecting your own Steamy" +
					" Journey. Ages 12 and up.</p>"
			},
			{
				slug: "steampunk-bugs",
				name: "Steampunk Bugs",
				image: "steampunk-bugs.jpeg",
				start: "2026-10-17 16:00:00.000Z", // Sat 9:00 AM PDT
				end: "2026-10-17 17:30:00.000Z", // Sat 10:30 AM PDT
				cost: "$7",
				paymentInstructions: payAtCon,
				description:
					"<p>Construct a steampunk beetle and/or spider out of wire and bits of" +
					" hardware. Minimum age 10 with adult supervision.</p>"
			},
			{
				slug: "pin-a-butterfly",
				name: "Pin a Butterfly!",
				image: null,
				start: "2026-10-17 19:00:00.000Z", // Sat 12:00 PM PDT
				end: "2026-10-17 20:30:00.000Z", // Sat 1:30 PM PDT
				cost: "$15",
				paymentInstructions: payAtCon,
				description:
					"<p>Victorians loved incorporating butterflies into their decor. In the first" +
					" part of this two-part workshop, you will learn the Victorian art of" +
					" butterfly pinning. Leave your butterfly to dry, then return for part two" +
					" the next day. All ages are welcome!</p>"
			},
			{
				slug: "introduction-to-bobbin-lace",
				name: "Introduction to Bobbin Lace",
				image: "introduction-to-bobbin-lace.jpeg",
				start: "2026-10-18 01:00:00.000Z", // Sat 6:00 PM PDT
				end: "2026-10-18 02:30:00.000Z", // Sat 7:30 PM PDT
				cost: "$0",
				paymentInstructions: "",
				description:
					"<p>Learn the basics of Bobbin Lace Making with the experienced instructors" +
					" of the Lace Museum in San Jose. Free, we are a non profit and this fits" +
					" within our mission of preserving and teaching lace skills.</p>"
			},
			{
				slug: "build-an-engine-box",
				name: "Build an Engine Box",
				image: "build-an-engine-box.jpeg",
				start: "2026-10-18 16:00:00.000Z", // Sun 9:00 AM PDT
				end: "2026-10-18 17:30:00.000Z", // Sun 10:30 AM PDT
				cost: "$20",
				paymentInstructions: payAtCon,
				description:
					"<p>Tinkers, young and old, assemble an engine powered by fairy dust! As a" +
					" fairy, I will provide the dust, paint, and mechanical parts. Arrange the" +
					" foam and plastic parts in any configuration you wish around a wooden box," +
					" paint it, and you\u2019ll have an engine ready to power any fantastical" +
					" contraption!</p>"
			},
			{
				slug: "victorian-hat-pins",
				name: "Victorian Hat Pins",
				image: "victorian-hat-pins.jpeg",
				start: "2026-10-18 17:30:00.000Z", // Sun 10:30 AM PDT
				end: "2026-10-18 19:00:00.000Z", // Sun 12:00 PM PDT
				cost: "$15",
				paymentInstructions: payPalJan,
				description:
					'<p>This workshop provides everything you need to create a stunning 8" hat' +
					" pin to adorn your chapeau, your lapel or to provide protection against" +
					" marauders, evil doers and things that go bump in the night in a dark" +
					" alley. Learn the history of Victorian Hat Pins and why they were sometimes" +
					" banned. We provide a stainless steel pin and thousands of glass beads for" +
					" your artistic enjoyment.</p>"
			},
			{
				slug: "frame-your-butterfly",
				name: "Frame your butterfly",
				image: null,
				start: "2026-10-18 19:00:00.000Z", // Sun 12:00 PM PDT
				end: "2026-10-18 20:30:00.000Z", // Sun 1:30 PM PDT
				cost: "$5",
				paymentInstructions: payAtCon,
				description:
					"<p>In the second part of this two-part workshop, you will glue the butterfly" +
					" that you have already pinned into a rustic wood window box. Decorate your" +
					" box with patterned paper and steampunk embellishments. Then, you will be" +
					" ready to display a work of art worthy of any Victorian home! All ages" +
					" welcome.</p>"
			}
		]

		for (const seed of seedWorkshops) {
			const record = new Record(workshops)
			record.set("slug", seed.slug)
			record.set("name", seed.name)
			record.set("description", seed.description)
			record.set("location", "Executive Boardroom")
			record.set("start", seed.start)
			record.set("end", seed.end)
			record.set("capacity", 15)
			record.set("cost", seed.cost)
			record.set("paymentInstructions", seed.paymentInstructions)
			record.set("options", "[]")
			if (seed.image) record.set("image", $filesystem.fileFromPath(`seed/images/${seed.image}`))
			app.save(record)
		}
	},
	(app) => {
		// Drops what the up migration created (views first: they read the
		// base tables). The users collection keeps its modified options.
		for (const name of ["signup_status", "workshop_availability", "signups", "content", "workshops"]) {
			try {
				app.delete(app.findCollectionByNameOrId(name))
			} catch {
				// already gone
			}
		}

		const adminEmail = $os.getenv("PB_ADMIN_USERNAME")
		if (adminEmail) {
			try {
				app.delete(app.findAuthRecordByEmail("_superusers", adminEmail))
			} catch (err) {
				console.log(`>> could not delete superuser ${adminEmail}: ${err}`)
			}
		}
	}
)
