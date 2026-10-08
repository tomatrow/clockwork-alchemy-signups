/// <reference path="../../pb_data/types.d.ts" />

// Every outgoing email (PocketBase's built-in OTP mail and our
// transactional_emails rows alike) goes through app.newMailClient(), which
// fires onMailerSend. Mail is sent from mail.clockworkalchemy.info, which has no
// inbox, so point replies at the real one. A Reply-To already set on the
// message wins.
onMailerSend((e) => {
	// Inside the handler: JSVM evaluates handler bodies standalone, so
	// top-level constants are not in scope.
	const replyTo = "info@clockworkalchemy.com"

	// Copy into a fresh object rather than writing into the Go map, which may
	// be nil.
	const headers: Record<string, string> = {}
	const existing = e.message.headers
	if (existing) for (const key in existing) headers[key] = existing[key]
	if (!headers["Reply-To"]) headers["Reply-To"] = replyTo
	e.message.headers = headers

	e.next()
})
