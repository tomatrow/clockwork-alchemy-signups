/// <reference path="../pb_data/types.d.ts" />

// Init migration: builds the whole database.
// Values read from $os.getenv are baked into data.db at migrate time.
//
// Model (decided 2026-09, see log.md):
//   users     auth. The signup form creates the account with a random
//             throwaway password and immediately authenticates with it, so
//             the first submission needs no email round-trip. Password auth
//             is enabled for that one call only — it is never a login UI.
//             Returning users sign in with OTP; PocketBase flips `verified`
//             and (its own doing) rotates the password + tokenKey, which
//             invalidates every token issued before verification.
//             The only PocketBase email users get is the OTP code (plus
//             email change): login alerts are off here, password reset and
//             verification mails are suppressed in src/hooks/users.pb.ts.
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
//   transactional_emails
//             outbox. The SvelteKit server renders the confirmation email and
//             creates a row; a hook sends it and stamps sentAt/error.
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

		// Batch API is disabled by default in PocketBase; the signup form
		// appends all of a submission's events in one transactional batch.
		settings.batch.enabled = true
		settings.batch.maxRequests = 50
		settings.batch.timeout = 3

		// Rate limiting (per client IP). Only the abuse paths the browser hits
		// directly, as guests: account creation (anyone can create an account
		// for any address) and the auth/OTP endpoints. Deliberately NO catch-all
		// like the default "/api/" rule: SSR runs on Cloudflare Workers, so every
		// page load and the admin client's _superusers login arrive from shared
		// Worker IPs and would throttle the whole site as one client. Hence also
		// `users:` rather than `*:` on the auth rules. Superuser-authed requests
		// skip the limiter entirely. Per-address caps live elsewhere: PocketBase's
		// built-in OTP reuse (disabled under --dev!) and the transactional_emails
		// hook (3/day).
		settings.rateLimits.enabled = true
		settings.rateLimits.rules = [
			{ label: "users:create", audience: "@guest", duration: 60, maxRequests: 5 },
			{ label: "*:requestOTP", audience: "@guest", duration: 60, maxRequests: 3 },
			{ label: "users:authWithPassword", audience: "@guest", duration: 60, maxRequests: 5 },
			{ label: "users:authWithOTP", audience: "@guest", duration: 60, maxRequests: 5 },
			{ label: "*:create", audience: "@guest", duration: 5, maxRequests: 20 },
			// signed-in browsers submit their signups as one batch, direct to PB
			{ label: "/api/batch", audience: "", duration: 1, maxRequests: 3 }
		]
		// PocketBase sits behind Cloudflare's proxy; without this every client
		// is Cloudflare's IP. Only safe if the origin isn't reachable directly
		// (otherwise the header is spoofable).
		settings.trustedProxy.headers = ["CF-Connecting-IP"]

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
		// users
		// ------------------------------------------------------------------
		const users = app.findCollectionByNameOrId("users")
		// First visit: the form creates the account with a random throwaway
		// password and calls authWithPassword once to get a token — no email
		// round-trip. Nobody ever types a password; there is no password UI.
		//
		// Return visit: OTP. On the first successful OTP PocketBase marks the
		// record verified AND sets a new random password, which regenerates
		// tokenKey (core.onRecordSaveExecute) — so a token minted by whoever
		// created the account (possibly not the inbox owner) dies the moment
		// the inbox owner signs in. No custom hook needed for that.
		users.passwordAuth.enabled = true
		users.otp.enabled = true
		// No "Login from a new location" emails: the throwaway-password login
		// can be replayed by whoever created the account, with a new User-Agent
		// each time, and each one would mail the address. Password reset and
		// verification mails are suppressed in src/hooks/users.pb.ts.
		users.authAlert.enabled = false
		// Long sessions: signups open well before the con and "keep me signed
		// in" is the intent. 90 days.
		users.authToken.duration = 90 * 24 * 60 * 60
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
				// The only image field: first file is the workshop's main image,
				// the rest are the pool options[].imageURL references by filename
				// (or "" / an external URL).
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
		// event must be going, no-op appends are rejected, joining is gated by
		// signupsOpen and by the workshop not having ended (cancelling never is).
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
		// transactional_emails: outbox. Only the SvelteKit server (as a
		// superuser) writes rows; the hook sends on create and stamps
		// sentAt or error. A failed row is the retry queue — editors resend
		// from the admin UI by clearing `error` and re-saving with `resend`.
		// ------------------------------------------------------------------
		const transactionalEmails = new Collection({
			type: "base",
			name: "transactional_emails",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				{
					type: "relation",
					name: "user",
					maxSelect: 1,
					cascadeDelete: false,
					collectionId: users.id
				},
				{ type: "email", name: "to", required: true },
				{ type: "text", name: "subject", required: true },
				// Explicit max: a text field with no max gets PocketBase's default
				// 5000 chars, which a rendered email with ~5 workshops exceeds (all 9
				// is ~14KB). 100k sits just under where Gmail clips a message (~102KB).
				{ type: "text", name: "html", required: true, max: 100_000 },
				{ type: "text", name: "text", max: 100_000 },
				{ type: "date", name: "sentAt" },
				// The hook truncates to this so saving an error can't itself fail.
				{ type: "text", name: "error", max: 10_000 },
				// Flip to true in the admin UI to send again; the hook clears it.
				{ type: "bool", name: "resend" },
				{ type: "autodate", name: "created", onCreate: true },
				{ type: "autodate", name: "updated", onCreate: true, onUpdate: true }
			]
		})
		app.save(transactionalEmails)

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
				images: ["clockwork-pendant-device.jpeg"],
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
				images: [],
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
				images: ["make-a-steampunk-medal.jpeg"],
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
				images: ["steampunk-bugs.jpeg"],
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
				images: [],
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
				images: ["introduction-to-bobbin-lace.jpeg"],
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
				images: ["build-an-engine-box.jpeg"],
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
				images: ["victorian-hat-pins.jpeg"],
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
				images: [],
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
			if (seed.images.length > 0)
				record.set(
					"images",
					seed.images.map((file) => $filesystem.fileFromPath(`seed/images/${file}`))
				)
			app.save(record)
		}
	},
	(app) => {
		// Drops what the up migration created (views first: they read the
		// base tables). The users collection keeps its modified options.
		for (const name of [
			"signup_status",
			"workshop_availability",
			"transactional_emails",
			"signups",
			"content",
			"workshops"
		]) {
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
