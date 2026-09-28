/// <reference path="../../pb_data/types.d.ts" />

// Shared send logic for transactional_emails. Not a hook file: PocketBase only
// auto-loads *.pb.js, so this builds to pb_hooks/mail.js and handlers load it
// with require(`${__hooks}/mail.js`) INSIDE the handler body (JSVM re-evaluates
// handler bodies standalone, so a top-level import would not be in scope).
// Hook files may only `import type` from here, or tsdown would inline it.

// Sends the row's email and stamps the outcome on it: sentAt on success,
// error on failure (truncated to the field's max so saving can't itself
// fail). Always clears `resend`, then saves.
export function sendAndStamp(app: core.App, record: core.Record) {
	const settings = app.settings()
	try {
		app.newMailClient().send(
			new MailerMessage({
				from: { address: settings.meta.senderAddress, name: settings.meta.senderName },
				to: [{ address: record.getString("to") }],
				subject: record.getString("subject"),
				html: record.getString("html"),
				text: record.getString("text")
			})
		)
		record.set("sentAt", new DateTime())
		record.set("error", "")
	} catch (err) {
		record.set("error", String(err).slice(0, 10000))
	}
	record.set("resend", false)
	app.save(record)
}
