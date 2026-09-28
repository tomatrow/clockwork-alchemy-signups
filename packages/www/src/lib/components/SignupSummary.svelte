<script lang="ts">
	// Rendered on the client for /confirmation and on the server for the
	// email, so: no scoped <style> (SSR render() drops it) — inline styles
	// only, and nothing that needs JS.
	import type { SummaryItem } from '#lib/workshops.js';
	import { formatWhen } from '#lib/workshops.js';

	let {
		name,
		email,
		items,
		footer
	}: { name: string; email: string; items: SummaryItem[]; footer: string } = $props();
</script>

<section>
	<h2>Attendee</h2>
	<p><b>Name:</b> {name}</p>
	<p><b>Email:</b> {email}</p>
</section>

<section>
	<h2>Workshops</h2>

	{#if items.length === 0}
		<p>You are not signed up for any workshops.</p>
	{/if}

	{#each items as { workshop, status, waitlistPlace, option } (workshop.id)}
		<div style="border: 1px solid #ccc; border-radius: 6px; padding: 1rem; margin: 1rem 0;">
			<h3 style="margin-top: 0;">{workshop.name}</h3>

			<p>
				{#if status === 'confirmed'}
					<b style="color: #1a7f37;">Confirmed</b> — you have a spot.
				{:else}
					<b style="color: #9a6700;">Waitlisted</b> — you are #{waitlistPlace} in line. If a spot opens
					up it's yours automatically; check the signup page for your status.
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
			{/if}
			{#if workshop.paymentInstructions}
				<p>{workshop.paymentInstructions}</p>
			{/if}

			{#if option}
				<p><b>Your selection:</b> {option.value}</p>
				{#if option.image}
					<img src={option.image} alt={option.value} width="200" style="display: block;" />
				{/if}
			{/if}
		</div>
	{/each}
</section>

{#if footer}
	<section>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- editor-authored content -->
		{@html footer}
	</section>
{/if}
