/// <reference path="../../pb_data/types.d.ts" />

import type * as Mail from "./mail"

// transactional_emails is an outbox. The SvelteKit server renders an email
// (svelty-email) and creates a row as a superuser; this hook sends it.
//
// Sending happens AFTER the row is committed but BEFORE PocketBase writes the
// create response (both are queued on the transaction's completion, the send
// first), so the response the server gets back already carries sentAt/error.
// A failure can't lose the email: the row stays with `error` set and editors
// can retry from the admin UI by ticking `resend`. There is no automatic
// retry, by decision.
//
// JSVM rules: handler bodies are re-evaluated standalone — no module-scope
// bindings. The shared send logic lives in mail.ts (built to pb_hooks/mail.js)
// and is require()d inside each handler.

// Throttle: at most 3 emails per recipient per rolling 24h. Anyone can create
// an account for any address and trigger sends, so this is what keeps the
// outbox from being a spam relay. Failed sends (error set) don't count: they
// reached nobody, and counting them would lock people out during an SMTP
// outage. In-flight rows have an empty error, so they still count.
// Check and insert run in ONE transaction: PocketBase transactions share a
// single write connection, so they serialize and concurrent creates can't all
// see "2 so far" and slip past. (A plain onRecordCreate check isn't enough:
// its read goes through the concurrent pool; 10 parallel creates let 4 in.)
// Swapping e.app for txApp makes the create itself use the transaction.
// Editor retries (`resend` on update) are not throttled.
onRecordCreateRequest((e) => {
	const record = e.record
	if (!record) return e.next()

	e.app.runInTransaction((txApp) => {
		const limit = 3
		const since = new DateTime().addDate(0, 0, -1)
		const recent = txApp.findRecordsByFilter(
			"transactional_emails",
			"to = {:to} && created > {:since} && error = ''",
			"",
			limit,
			0,
			{ to: record.getString("to"), since }
		)
		if (recent.length >= limit) {
			throw new TooManyRequestsError(
				"We've already emailed this address 3 times today. Try again tomorrow."
			)
		}

		e.app = txApp
		e.next()
	})
}, "transactional_emails")

onRecordAfterCreateSuccess((e) => {
	const record = e.record
	if (!record) return e.next()

	const { sendAndStamp }: typeof Mail = require(`${__hooks}/mail.js`)
	sendAndStamp(e.app, record)

	e.next()
}, "transactional_emails")

// manual retry: tick `resend` in the admin UI and save
onRecordAfterUpdateSuccess((e) => {
	const record = e.record
	if (!record || !record.getBool("resend")) return e.next()

	const { sendAndStamp }: typeof Mail = require(`${__hooks}/mail.js`)
	sendAndStamp(e.app, record)

	e.next()
}, "transactional_emails")
