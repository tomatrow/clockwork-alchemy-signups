/// <reference path="../../pb_data/types.d.ts" />

// signups is an APPEND-ONLY LOG: every user action (register, cancel, rejoin,
// option change) is a new immutable event. updateRule/deleteRule are null;
// these hooks enforce the invariants API rules cannot express, and send the
// emails.
//
// Current state and confirmed/waitlisted are NEVER stored — they derive from
// the log (see the signup_status view: position ranks by the oldest going-
// event since your last not-going, so option changes keep your spot and only
// cancelling loses it).
//
// JSVM rules: handler bodies are re-evaluated standalone — no module-scope
// bindings, no async, everything inlined.

// create (the only write): validate the append against current state.
onRecordCreateRequest((e) => {
	const record = e.record
	if (!record) return e.next()

	const userId = record.getString("user")
	const workshopId = record.getString("workshop")
	const intention = record.getString("intention")

	// current state = latest event for this (user, workshop)
	const prior = e.app.findRecordsByFilter(
		"signups",
		"user = {:user} && workshop = {:workshop}",
		"-created,-id",
		1,
		0,
		{ user: userId, workshop: workshopId }
	)
	const current = prior.length > 0 ? prior[0] : null

	// the log must start with a registration
	if (!current && intention !== "going") {
		throw new BadRequestError("You are not signed up for this workshop.")
	}

	// anything after the first event requires a proven email (OTP → verified)
	if (current && !e.auth?.getBool("verified")) {
		throw new ForbiddenError("Verify your email before changing a signup.")
	}

	// the kill switch gates joining, never cancelling
	if (intention === "going") {
		const content = e.app.findFirstRecordByFilter("content", "id != ''")
		if (!content.getBool("signupsOpen")) {
			throw new BadRequestError("Signups are closed.")
		}

		// option must be one of the workshop's options (or empty when none)
		const workshop = e.app.findRecordById("workshops", workshopId)
		const option = record.getString("option")
		const options = JSON.parse(workshop.getString("options") || "[]") as { value: string }[]
		if (options.length > 0) {
			if (!options.some((item) => item.value === option)) {
				throw new BadRequestError("Invalid option for this workshop.")
			}
		} else if (option !== "") {
			throw new BadRequestError("This workshop has no options.")
		}
	} else {
		// cancel events carry no option
		record.set("option", "")
	}

	// reject no-op appends (double-clicks): no state change, no email
	if (
		current &&
		current.getString("intention") === intention &&
		current.getString("option") === record.getString("option")
	) {
		throw new BadRequestError("Nothing changed.")
	}

	e.next()
}, "signups")

// after create: every appended event is an explicit user action, so every
// append emails — confirmation or waitlist for going (read straight off the
// signup_status view, whose row id IS this latest event), cancellation for
// not-going. Implicit changes (someone else's cancel promoting you) stay
// silent, by decision.
onRecordAfterCreateSuccess((e) => {
	const record = e.record
	if (!record) return e.next()

	const workshop = e.app.findRecordById("workshops", record.getString("workshop"))
	const user = e.app.findRecordById("users", record.getString("user"))
	const settings = e.app.settings()
	const name = workshop.getString("name")
	const from = {
		address: settings.meta.senderAddress,
		name: settings.meta.senderName
	}

	if (record.getString("intention") === "not-going") {
		e.app.newMailClient().send(
			new MailerMessage({
				from,
				to: [{ address: user.email() }],
				subject: `Cancelled: ${name}`,
				html:
					`<p>Your signup for <strong>${name}</strong> is cancelled.</p>` +
					`<p>Changed your mind? You can rejoin from the signup page —` +
					` you'll go to the back of the line.</p>`
			})
		)
		return e.next()
	}

	// going: this record is the latest event, so it is the view row's id
	const status = e.app.findRecordById("signup_status", record.id)
	const confirmed = status.getString("status") === "confirmed"
	const position = status.getInt("position")
	const capacity = workshop.getInt("capacity")
	const option = record.getString("option")
	const optionLine = option ? `<p>Your selection: ${option}</p>` : ""

	e.app.newMailClient().send(
		new MailerMessage({
			from,
			to: [{ address: user.email() }],
			subject: confirmed ? `Confirmed: ${name}` : `Waitlisted: ${name}`,
			html: confirmed
				? `<p>You have a spot in <strong>${name}</strong>.</p>` +
					optionLine +
					`<p>${workshop.getString("start")} @ ${workshop.getString("location")}</p>` +
					`<p>Cost: ${workshop.getString("cost")} ${workshop.getString("paymentInstructions")}</p>`
				: `<p>You are #${position - capacity} on the waitlist for <strong>${name}</strong>.</p>` +
					optionLine +
					`<p>If a spot opens up, it's yours automatically — check your status on the signup page.</p>`
		})
	)

	e.next()
}, "signups")
