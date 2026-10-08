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
		// No "Login from a new location" emails for editors either: SSR and the
		// admin client log in from shared Cloudflare Worker IPs, so nearly every
		// login looked new and mailed the editor.
		const superusers = app.findCollectionByNameOrId("_superusers")
		superusers.authAlert.enabled = false
		app.save(superusers)

		const adminEmail = $os.getenv("PB_ADMIN_USERNAME")
		const adminPassword = $os.getenv("PB_ADMIN_PASSWORD")

		if (adminEmail && adminPassword) {
			if (adminPassword.length < 10)
				throw new Error("PB_ADMIN_PASSWORD must be at least 10 characters")

			const superuser = new Record(superusers)
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
		contentRecord.set("logo", $filesystem.fileFromPath("seed/images/logo.jpg"))
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
		contentRecord.set("scheduleUrl", "https://schedule.clockworkalchemy.com/")
		contentRecord.set("signupsOpen", true)
		app.save(contentRecord)

		// ------------------------------------------------------------------
		// seed: workshops — CA 2026 (Fri Oct 16 – Sun Oct 18, Grand Bay Hotel
		// SF, Redwood City), scraped from https://schedule.clockworkalchemy.com
		// on 2026-10-08: every session with a registration link. Snapshot of
		// the scrape: .agents/workbench/workshops-2026.json. Times are UTC for
		// PDT local. The schedule has no images, options or payment
		// instructions — editors add those in the admin UI.
		// ------------------------------------------------------------------
		const seedWorkshops = [
			{
				slug: "pin-a-butterfly-pt-1-2",
				name: "Pin a Butterfly! Pt. 1/2",
				location: "Executive Boardroom (2nd floor)",
				start: "2026-10-16 18:30:00.000Z", // Fri 11:30 AM PDT
				end: "2026-10-16 20:30:00.000Z", // Fri 1:30 PM PDT
				capacity: 20,
				cost: "$5",
				description:
					"<p>Victorians loved incorporating butterflies into their decor. In the first " +
					"part of this two-part workshop, you will learn the Victorian art of butterfly " +
					"pinning. Leave your butterfly to dry, then return for part two the next day. " +
					"All ages are welcome! (Beware, you can’t take it home until part two.)</p>"
			},
			{
				slug: "steampunk-bookmarks",
				name: "Steampunk Bookmarks",
				location: "Peninsula 6 (2nd floor)",
				start: "2026-10-16 20:30:00.000Z", // Fri 1:30 PM PDT
				end: "2026-10-16 22:30:00.000Z", // Fri 3:30 PM PDT
				capacity: 20,
				cost: "$5",
				description:
					"<p>Unleash your creativity and craft a steampunk bookmark! Join the Steampunk " +
					"Lady Scientists as they offer an array of gears, bits, and bobs, for you to " +
					"create a one of a kind bookmark. Express your unique style while diving into " +
					"the fascinating world of steampunk!</p>"
			},
			{
				slug: "make-an-airship-captains-logbook",
				name: "Make an Airship Captain's Logbook",
				location: "Executive Boardroom (2nd floor)",
				start: "2026-10-16 22:30:00.000Z", // Fri 3:30 PM PDT
				end: "2026-10-17 00:30:00.000Z", // Fri 5:30 PM PDT
				capacity: 12,
				cost: "$5",
				description:
					"<p>Every Airship Captain needs their logbook to record their adventures, cargo " +
					"and crew. Learn how to make a quick and easy logbook with an easy bookbinding " +
					"technique. Supplies will be provided to make a finished Captain's Log for a " +
					"small fee, but you can bring your own supplies. Please email me at " +
					"barbaraklessig2@gmail.com for a supply list.</p>"
			},
			{
				slug: "adult-origami",
				name: "Adult Origami",
				location: "Executive Boardroom (2nd floor)",
				start: "2026-10-17 00:00:00.000Z", // Fri 5:00 PM PDT
				end: "2026-10-17 02:00:00.000Z", // Fri 7:00 PM PDT
				capacity: 15,
				cost: "$0",
				description: "<p>Oh my, what rude, lascivious folds can I find for this year.</p>"
			},
			{
				slug: "rogue-button-pin-making",
				name: "Rogue Button Pin Making",
				location: "Peninsula 6 (2nd floor)",
				start: "2026-10-17 00:30:00.000Z", // Fri 5:30 PM PDT
				end: "2026-10-17 02:30:00.000Z", // Fri 7:30 PM PDT
				capacity: 15,
				cost: "$15",
				description:
					"<p>Creative use of buttons for clothing decoration has been around for a long " +
					"time, but hit it’s Zenith in Victorian, England with the Pearly Kings and " +
					"Queens of the Costermongers. Rogue button pin creations will take this a step " +
					"further. We will go rogue with pins of many colors for participants to add to " +
					"their garments.</p>"
			},
			{
				slug: "create-a-franken-creature-plushie",
				name: "Create A Franken-Creature Plushie",
				location: "Executive Boardroom (2nd floor)",
				start: "2026-10-17 16:00:00.000Z", // Sat 9:00 AM PDT
				end: "2026-10-17 18:00:00.000Z", // Sat 11:00 AM PDT
				capacity: 20,
				cost: "$5",
				description:
					'<p>Attention Rogue Makers! Join us to bring "life" to a new plushie creature ' +
					"by hand sewing bits and pieces of old plushies and fabric together. No " +
					"experience needed as visible stitches only add to the creation.</p>"
			},
			{
				slug: "parrots-a-pirates-familiar",
				name: "Parrots, A pirate's familiar",
				location: "Peninsula 6 (2nd floor)",
				start: "2026-10-17 16:00:00.000Z", // Sat 9:00 AM PDT
				end: "2026-10-17 18:00:00.000Z", // Sat 11:00 AM PDT
				capacity: 20,
				cost: "$0",
				description:
					"<p>Nothing is more quintessential to a pirate's life than a parrot. I will " +
					"start with the simplest and see how complicated a form we can create</p>"
			},
			{
				slug: "wearable-technology-sewing-with-electronics",
				name: "Wearable Technology - Sewing with Electronics!",
				location: "Executive Boardroom (2nd floor)",
				start: "2026-10-17 18:00:00.000Z", // Sat 11:00 AM PDT
				end: "2026-10-17 20:00:00.000Z", // Sat 1:00 PM PDT
				capacity: 30,
				cost: "$12",
				description:
					"<p>Prototype circuits and create your hand-sewn design with lights. The " +
					"workshop with Tenaya of Rogue Making will involve sewing a few lights onto a " +
					"patch of fabric, so you can get the hang of it. Later, personalize your " +
					"costumes with wearable tech to shine brightly at night! Not a sewer? Still " +
					"please join us, first we will make the circuits with wires, then we'll take " +
					"time to hand sew two threads to a fabric patch. This is a great workshop to " +
					"learn a new skill that can help enhance all your events!</p>"
			},
			{
				slug: "frame-your-butterfly-pt-2-2",
				name: "Frame Your Butterfly! Pt. 2/2",
				location: "Peninsula 6 (2nd floor)",
				start: "2026-10-17 18:00:00.000Z", // Sat 11:00 AM PDT
				end: "2026-10-17 20:00:00.000Z", // Sat 1:00 PM PDT
				capacity: 20,
				cost: "$5",
				description:
					"<p>In the second part of this two-part workshop, you will glue the butterfly " +
					"that you have already pinned into a rustic wood window box. Decorate your box " +
					"with patterned paper and steampunk embellishments. Then, you will be ready to " +
					"display a work of art worthy of any Victorian home! All ages welcome.</p>"
			},
			{
				slug: "sky-pirate-lapel-charm",
				name: "Sky Pirate Lapel Charm",
				location: "Executive Boardroom (2nd floor)",
				start: "2026-10-17 22:00:00.000Z", // Sat 3:00 PM PDT
				end: "2026-10-18 00:00:00.000Z", // Sat 5:00 PM PDT
				capacity: 20,
				cost: "$5",
				description:
					"<p>Make a scrappy Lapel Charm pin to hang on your jacket, hat, tote bag or " +
					"anywhere fun. The kit includes gears, a sword charm, beads, fabric scraps and " +
					"pins. You choose the components to create a custom jewelry dangler to show off " +
					"your prowess as a fabulous scavenging pirate raiding the skies of the " +
					"'verse.</p>"
			},
			{
				slug: "parasol-dueling-holsters",
				name: "Parasol Dueling Holsters",
				location: "Executive Boardroom (2nd floor)",
				start: "2026-10-17 22:00:00.000Z", // Sat 3:00 PM PDT
				end: "2026-10-18 00:00:00.000Z", // Sat 5:00 PM PDT
				capacity: 20,
				cost: "$25",
				description:
					"<p>Customize your own street dueling parasol and holster! Receive a 10″ " +
					"parasol and cloth holster then choose from a bounty of findings to decorate " +
					"them both. Finish with a lesson in Western Territorial Parasol Dueling.</p>"
			},
			{
				slug: "inexpensive-steampunk-gauges",
				name: "Inexpensive Steampunk Gauges",
				location: "Executive Boardroom (2nd floor)",
				start: "2026-10-18 00:00:00.000Z", // Sat 5:00 PM PDT
				end: "2026-10-18 02:00:00.000Z", // Sat 7:00 PM PDT
				capacity: 30,
				cost: "$0",
				description:
					"<p>A common prop in steampunk costuming is gauges. Real metal gauges are both " +
					"expensive and heavy. A prop maker shows you how to make convincing, " +
					"lightweight gauges for nearly free. Materials will be provided. This workshop " +
					"is suitable for adults, young adults, and pre-teens working with an adult.</p>"
			},
			{
				slug: "build-an-engine-box",
				name: "Build an Engine Box",
				location: "Peninsula 6 (2nd floor)",
				start: "2026-10-18 16:00:00.000Z", // Sun 9:00 AM PDT
				end: "2026-10-18 18:00:00.000Z", // Sun 11:00 AM PDT
				capacity: 16,
				cost: "$20",
				description:
					"<p>Rogue makers, young and old, assemble an engine that doubles as storage! I " +
					"will provide the box, paint, and mechanical parts. Arrange the foam and " +
					"plastic parts in any configuration you wish around a wooden box, paint it, and " +
					"you’ll have an engine ready to power any contraption!</p>"
			},
			{
				slug: "bumblebot-tiny-rogue-led-robots",
				name: "BumbleBot - Tiny Rogue LED Robots!",
				location: "Peninsula 6 (2nd floor)",
				start: "2026-10-18 16:00:00.000Z", // Sun 9:00 AM PDT
				end: "2026-10-18 18:00:00.000Z", // Sun 11:00 AM PDT
				capacity: 30,
				cost: "$10",
				description:
					"<p>Rapid prototype this small motor circuit, then experiment with tiny " +
					"materials provided to create a robotic pirate, pirate ship, or other rogue " +
					"design! Make the robot move around on the table, add or remove materials to " +
					"change how it moves. Tenaya of Rogue Making brings the coolest tiny upcycled " +
					"stuff to create little robots that interact and battle on the table-top. This " +
					"activity now comes with a special LED surprise!!</p>"
			},
			{
				slug: "steampunk-map-folio",
				name: "Steampunk Map Folio",
				location: "Peninsula 6 (2nd floor)",
				start: "2026-10-18 18:00:00.000Z", // Sun 11:00 AM PDT
				end: "2026-10-18 20:00:00.000Z", // Sun 1:00 PM PDT
				capacity: 10,
				cost: "$10",
				description:
					"<p>Using parchment business-size envelopes, we'll create a fun map folio. Stoe " +
					"maps, memorabilia, and other convention souvenirs in this cool folder. " +
					'Finished size: 9"x4". Kit includes maps, envelopes, stickers, decorations, ' +
					"string, brads and more.</p>"
			},
			{
				slug: "paper-engineer-some-wearable-tech",
				name: "Paper Engineer Some Wearable Tech!",
				location: "Executive Boardroom (2nd floor)",
				start: "2026-10-18 18:00:00.000Z", // Sun 11:00 AM PDT
				end: "2026-10-18 20:00:00.000Z", // Sun 1:00 PM PDT
				capacity: 30,
				cost: "$10",
				description:
					"<p>Combine the familiar skill of folding paper with LED circuits. PaperGem is " +
					"a fast project to make a wearable pin to wear around the event. Tenaya of " +
					"Rogue Making will help you make your light shine. Take home a BONUS KIT to " +
					"keep the making going or give as a gift. This is a great workshop to learn a " +
					"new skill that can help enhance all your events!</p>"
			},
			{
				slug: "letter-folding-and-origami-boxes",
				name: "Letter folding, and origami boxes",
				location: "Executive Boardroom (2nd floor)",
				start: "2026-10-18 20:00:00.000Z", // Sun 1:00 PM PDT
				end: "2026-10-18 22:00:00.000Z", // Sun 3:00 PM PDT
				capacity: 20,
				cost: "$0",
				description:
					"<p>Letter folding was important in the Victorian era. Glue was cumbersome and " +
					"messy. Commercial envelops have not yet been invented. So having a way to send " +
					"letters was important. This led to a lovely and intricate art form.</p>"
			}
		]

		for (const seed of seedWorkshops) {
			const record = new Record(workshops)
			record.set("slug", seed.slug)
			record.set("name", seed.name)
			record.set("description", seed.description)
			record.set("location", seed.location)
			record.set("start", seed.start)
			record.set("end", seed.end)
			record.set("capacity", seed.capacity)
			record.set("cost", seed.cost)
			record.set("paymentInstructions", "")
			record.set("options", "[]")
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
