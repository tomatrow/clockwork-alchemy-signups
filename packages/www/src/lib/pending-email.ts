// Hands the confirmation send from the signup form to /confirmation, so
// submitting doesn't wait on SMTP. The form starts the send and navigates;
// the confirmation page takes the promise ONCE and shows how it went. A
// refresh or direct visit finds nothing, so it can never send twice.
//
// Client-only: module state is shared across requests on the server, so only
// call these from event handlers / browser code.
import { isHttpError } from '@sveltejs/kit';
import { sendConfirmation } from '../routes/email.remote';

export type EmailOutcome = 'sent' | 'failed' | 'throttled';

/** Sends the confirmation email. Never rejects. */
export async function sendConfirmationEmail(): Promise<EmailOutcome> {
	try {
		await sendConfirmation();
		return 'sent';
	} catch (err) {
		// 429: the address already got its 3 emails today. Anything else,
		// including the 502 for an SMTP failure, is a failed send.
		return isHttpError(err, 429) ? 'throttled' : 'failed';
	}
}

let pending: Promise<EmailOutcome> | null = null;

export function startConfirmationEmail() {
	pending = sendConfirmationEmail();
}

export function takePendingEmail() {
	const taken = pending;
	pending = null;
	return taken;
}
