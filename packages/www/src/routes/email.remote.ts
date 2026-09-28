// Renders the confirmation email for the calling user and drops it in the
// transactional_emails outbox; a PocketBase hook does the actual sending.
//
// The hook sends before PocketBase writes the create response, so the returned
// row already says how the send went. Expected outcomes are thrown as
// expected errors: 429 throttled, 502 send failed. Resolves on success.
import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { ClientResponseError } from 'pocketbase';
import { render } from 'svelty-email';
import Confirmation from '#lib/email/Confirmation.svelte';
import { adminClient } from '#lib/server/pocketbase.js';
import type {
	AvailabilityRecord,
	ContentRecord,
	SignupStatusRecord,
	TransactionalEmailRecord,
	WorkshopRecord
} from '#lib/pocketbase/types.js';
import { buildSummary, toWorkshopView } from '#lib/workshops.js';

export const sendConfirmation = command(async () => {
	const { locals, url } = getRequestEvent();
	const { pb, user } = locals;
	if (!user) error(401, 'Sign in first.');

	const [workshops, availability, status, content] = await Promise.all([
		pb.collection('workshops').getFullList<WorkshopRecord>(),
		pb.collection('workshop_availability').getFullList<AvailabilityRecord>(),
		pb.collection('signup_status').getFullList<SignupStatusRecord>(),
		pb.collection('content').getFirstListItem<ContentRecord>('')
	]);
	const byWorkshop = new Map(availability.map((a) => [a.id, a]));
	const items = buildSummary(
		workshops.map((w) => toWorkshopView(pb, w, byWorkshop.get(w.id))),
		status
	);

	const { html, text } = await render(Confirmation, {
		name: user.name,
		email: user.email,
		items,
		footer: content.confirmationFooter ?? '',
		signupUrl: url.origin
	});

	const admin = await adminClient();
	let row: TransactionalEmailRecord;
	try {
		row = await admin.collection('transactional_emails').create<TransactionalEmailRecord>({
			user: user.id,
			to: user.email,
			subject: 'Your Clockwork Alchemy workshop signups',
			html,
			text
		});
	} catch (err) {
		// The outbox hook caps each address at 3 emails a day (spam relay guard).
		if (err instanceof ClientResponseError && err.status === 429) {
			error(429, err.message);
		}
		// No outbox row means editors can't retry, so leave enough to diagnose
		// (no address or body — PII).
		console.error('sendConfirmation: outbox create failed', {
			user: user.id,
			htmlLength: html.length,
			textLength: text.length,
			data: err instanceof ClientResponseError ? err.response?.data : String(err)
		});
		throw err;
	}

	if (row.error) {
		// The SMTP error is on the row; editors can resend from the admin UI.
		console.error('sendConfirmation: send failed', { row: row.id });
		error(502, "We couldn't send your confirmation email.");
	}
});
