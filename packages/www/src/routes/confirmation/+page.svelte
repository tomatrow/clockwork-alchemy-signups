<script lang="ts">
	import { browser } from '$app/env';
	import SignupSummary from '#lib/components/SignupSummary.svelte';
	import {
		sendConfirmationEmail,
		takePendingEmail,
		type EmailOutcome
	} from '#lib/pending-email.js';

	let { data } = $props();

	// The send the signup form started on its way here, if any (none on a
	// refresh or direct visit).
	const pending = browser ? takePendingEmail() : null;

	// last settled send; a resend keeps showing it until the new one settles
	let outcome: EmailOutcome | null = $state(null);
	let sending = $state(!!pending);

	pending?.then((result) => {
		outcome = result;
		sending = false;
	});

	async function resendEmail() {
		sending = true;
		outcome = await sendConfirmationEmail();
		sending = false;
	}
</script>

<h2>You're all set</h2>

{#if outcome === 'throttled'}
	<p class="notice">
		<b>We've already emailed {data.user.email} 3 times today,</b> so we didn't send another. Your signups
		are saved, and this page shows the same content.
	</p>
{:else if outcome === 'failed'}
	<p class="notice">
		<b>We couldn't send your confirmation email.</b> Your signups are saved; this page is the same
		content.
		<button onclick={resendEmail} disabled={sending}>
			{sending ? 'Sending…' : 'Try sending it again'}
		</button>
	</p>
{:else if outcome === 'sent'}
	<p class="notice">Sent — check your inbox.</p>
{:else}
	<p>
		{sending ? 'Emailing a copy of this to' : 'A copy of this has been emailed to'}
		<b>{data.user.email}</b>.
		<button class="secondary" onclick={resendEmail} disabled={sending}>
			{sending ? 'Sending…' : 'Resend'}
		</button>
	</p>
{/if}

<SignupSummary
	name={data.user.name}
	email={data.user.email}
	items={data.items}
	footer={data.content.confirmationFooter}
/>

<p><a href="/">Change your signups</a></p>
