<script lang="ts">
	import type { PageData } from "./$types"
	import { getWorkshopTitle, getDisplayDate, getWorkshopAvailability } from "$lib/utility"
	import { WorkshopTable } from "$lib/components"
	import { pickBy } from "lodash"

	export let data: PageData

	const similarWorkshops = data.leader && pickBy(data.workshops, (workshop) => workshop.leaderId === data.leader!.id)

	const { slug, cost, description, end, location, paymentInstructions, start } = data.workshop

	const availability = getWorkshopAvailability(data.workshop)
</script>

<h1>{getWorkshopTitle(data.workshop)}</h1>

{#if (start && end) || location}
	<b>
		{#if start && end}
			{getDisplayDate(start)} - {getDisplayDate(end)}
		{/if}
		{#if location}
			@ {location}
		{/if}
	</b>
	<br />
{/if}

{#if cost || paymentInstructions}
	{#if cost}
		<b>Cost</b>: {cost}
	{/if}
	{#if paymentInstructions}
		<details>
			<summary> Payment Details </summary>
			{@html paymentInstructions}
		</details>
	{/if}
{/if}

{#if description}
	<article class="description">
		{@html description}
	</article>
{/if}

{#if availability}
	<article class="signup-footer">
		<a href="/workshops/{slug}/signup">Signup</a>
		<em>({availability} remaining)</em>
	</article>
{/if}

{#if similarWorkshops}
	<h2>Other Workshops by {data.leader?.name}:</h2>
	<WorkshopTable workshops={similarWorkshops} />
{/if}

<style>
	.description {
		margin-top: 1rem;
	}

	.signup-footer {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		justify-content: center;
		align-items: center;
	}
</style>
