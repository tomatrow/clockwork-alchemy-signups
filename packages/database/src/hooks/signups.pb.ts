/// <reference path="../../pb_data/types.d.ts" />

// signups is an APPEND-ONLY LOG: every user action (register, cancel, rejoin,
// option change) is a new immutable event. updateRule/deleteRule are null;
// this hook enforces the invariants API rules cannot express.
//
// Current state and confirmed/waitlisted are NEVER stored — they derive from
// the log (see the signup_status view: position ranks by the oldest going-
// event since your last not-going, so option changes keep your spot and only
// cancelling loses it).
//
// Emails are NOT sent from here. The SvelteKit server renders one summary of
// the user's whole submission and drops it in transactional_emails.
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

	if (intention === "going") {
		// the kill switch gates joining, never cancelling
		const content = e.app.findFirstRecordByFilter("content", "id != ''")
		if (!content.getBool("signupsOpen")) {
			throw new BadRequestError("Signups are closed.")
		}

		const workshop = e.app.findRecordById("workshops", workshopId)

		// no joining a workshop that has already ended (no deadlines beyond
		// that, by decision). Cancelling stays possible forever.
		const end = workshop.getString("end")
		if (end && new Date(end).getTime() < Date.now()) {
			throw new BadRequestError("This workshop has already ended.")
		}

		// option must be one of the workshop's options (or empty when none)
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

	// reject no-op appends (double-clicks): no state change
	if (
		current &&
		current.getString("intention") === intention &&
		current.getString("option") === record.getString("option")
	) {
		throw new BadRequestError("Nothing changed.")
	}

	e.next()
}, "signups")
