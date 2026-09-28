<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/env';
	import { pb } from '#lib/pocketbase/client.js';
	import { userFrom } from '#lib/pocketbase/user.js';
	import { formatWhen } from '#lib/workshops.js';
	import {
		appendEvents,
		createAccountAndSignIn,
		describeError,
		diffSelections,
		EmailExistsError,
		selectionsFromStatus,
		stashPending,
		takePending,
		type Selections
	} from '#lib/signup.js';
	import { startConfirmationEmail } from '#lib/pending-email.js';

	let { data } = $props();

	// Form state is seeded ONCE from the loaded data (hence untrack): the user
	// edits it from there, and every navigation to this page remounts it.
	const initial = untrack(() => {
		// A submission that bounced through /signin because the email already
		// existed. Only honoured when the sign-in actually happened.
		const pending = browser && data.user ? takePending() : null;
		return {
			pending,
			name: pending?.name ?? data.user?.name ?? '',
			email: data.user?.email ?? '',
			selections: pending?.selections ?? selectionsFromStatus(data.workshops, data.status)
		};
	});
	const pending = initial.pending;

	let name = $state(initial.name);
	let email = $state(initial.email);
	let selections: Selections = $state(initial.selections);

	let submitting = $state(false);
	let errorMessage = $state('');
	// Workshops the parked submission would cancel; shown once for confirmation.
	let confirmCancels: string[] | null = $state(null);

	const statusByWorkshop = $derived(new Map(data.status.map((row) => [row.workshop, row])));
	const anySelected = $derived(Object.values(selections).some((s) => s.going));

	onMount(() => {
		if (!pending) return;
		const { cancels } = diffSelections(selections, data.status, data.workshops);
		if (cancels.length > 0) confirmCancels = cancels;
		else void submit();
	});

	async function submit(event?: SubmitEvent) {
		event?.preventDefault();
		confirmCancels = null;
		errorMessage = '';
		submitting = true;
		try {
			let user = data.user;
			let status = data.status;

			if (!user) {
				try {
					await createAccountAndSignIn(pb, { email: email.trim(), name: name.trim() });
				} catch (err) {
					if (err instanceof EmailExistsError) {
						stashPending({ name, selections });
						const params = new URLSearchParams({ next: '/', email: err.email, reason: 'exists' });
						await goto(`/signin?${params}`);
						return;
					}
					throw err;
				}
				user = userFrom(pb)!;
				status = [];
			}

			const { events } = diffSelections(selections, status, data.workshops);
			await appendEvents(pb, user.id, events);

			if (name.trim() && name.trim() !== user.name) {
				await pb.collection('users').update(user.id, { name: name.trim() });
			}

			// Don't wait on SMTP: /confirmation picks up the send and shows how it went.
			startConfirmationEmail();
			await goto('/confirmation', { invalidateAll: true });
		} catch (err) {
			errorMessage = describeError(err);
		} finally {
			submitting = false;
		}
	}

	function workshopName(id: string) {
		return data.workshops.find((w) => w.id === id)?.name ?? id;
	}
</script>

{#if data.content.signupPreBlurb}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- editor-authored content -->
	{@html data.content.signupPreBlurb}
{/if}

{#if !data.content.signupsOpen}
	<p class="notice"><b>Signups are closed.</b> You can still cancel existing signups.</p>
{/if}

{#if confirmCancels}
	<article>
		<h2>Before we apply this</h2>
		<p>
			You already had signups on file. Submitting this form as-is will <b>cancel</b> your spot in:
		</p>
		<ul>
			{#each confirmCancels as id (id)}
				<li>{workshopName(id)}</li>
			{/each}
		</ul>
		<p>
			<button onclick={() => submit()} disabled={submitting}>Yes, apply it</button>
			<button class="secondary" onclick={() => (confirmCancels = null)} disabled={submitting}>
				Let me review first
			</button>
		</p>
	</article>
{/if}

<form onsubmit={submit}>
	<fieldset disabled={submitting}>
		<legend>Your info</legend>
		<label>
			Name
			<input type="text" bind:value={name} required autocomplete="name" />
		</label>
		<label>
			Email
			{#if data.user}
				<input type="email" value={email} readonly />
				<small
					>To use a different email, <a href="/signout" data-sveltekit-reload>sign out</a>.</small
				>
			{:else}
				<input type="email" bind:value={email} required autocomplete="email" />
				<small>We only use this to send you a confirmation of your signups.</small>
			{/if}
		</label>
	</fieldset>

	{#each data.workshops as workshop (workshop.id)}
		{@const current = statusByWorkshop.get(workshop.id)}
		{@const currentlyGoing = current?.intention === 'going'}
		{@const joinBlocked = workshop.ended || !data.content.signupsOpen}
		{@const selection = selections[workshop.id]}

		<fieldset disabled={submitting}>
			<legend><h2 style="margin: 0;">{workshop.name}</h2></legend>

			<p>
				{#if workshop.ended}
					<b>This workshop has ended.</b>
				{:else if workshop.spotsLeft > 0}
					{workshop.spotsLeft} of {workshop.capacity} spots remaining
				{:else}
					<b>Full</b> — {workshop.waitlisted} on the waitlist. You can still join the waitlist.
				{/if}
				{#if currentlyGoing && current}
					· You are
					<b
						>{current.status === 'confirmed'
							? 'confirmed'
							: `#${current.position - workshop.capacity} on the waitlist`}</b
					>
				{/if}
			</p>

			{#if workshop.start || workshop.location}
				<p>
					<b>
						{formatWhen(workshop.start, workshop.end)}
						{#if workshop.location}@ {workshop.location}{/if}
					</b>
				</p>
			{/if}

			{#if workshop.cost}
				<p><b>Cost:</b> {workshop.cost}</p>
				{#if workshop.paymentInstructions}
					<details>
						<summary>Payment details</summary>
						<p>{workshop.paymentInstructions}</p>
					</details>
				{/if}
			{/if}

			<details open={workshop.options.length > 0}>
				<summary>Workshop summary</summary>
				{#if workshop.image}
					<img src={workshop.image} alt={workshop.name} style="max-width: 20rem;" />
				{/if}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- editor-authored content -->
				{@html workshop.description}

				{#if workshop.options.length > 0}
					<p><b>Choose an option:</b></p>
					{#each workshop.options as option (option.value)}
						<label>
							<input
								type="radio"
								name="option-{workshop.id}"
								value={option.value}
								bind:group={selection.option}
								required={selection.going}
								disabled={joinBlocked && !currentlyGoing}
							/>
							{option.value}
							{#if option.image}
								<img
									src={option.image}
									alt={option.value}
									style="max-width: 12rem; display: block;"
								/>
							{/if}
						</label>
					{/each}
				{/if}
			</details>

			<label>
				<input
					type="checkbox"
					bind:checked={selection.going}
					disabled={joinBlocked && !currentlyGoing}
				/>
				{#if currentlyGoing}
					Keep my signup (uncheck to cancel)
				{:else if workshop.spotsLeft === 0}
					Join the waitlist
				{:else}
					{data.content.rsvpButtonLabel}
				{/if}
			</label>
		</fieldset>
	{/each}

	{#if errorMessage}
		<p class="notice"><b>Couldn't save:</b> {errorMessage}</p>
	{/if}

	<p>
		<button type="submit" disabled={submitting}>
			{submitting ? 'Saving…' : data.user ? 'Update my signups' : 'Sign up'}
		</button>
		{#if data.user && !anySelected}
			<small>Submitting with nothing checked cancels all your signups.</small>
		{/if}
	</p>
</form>
