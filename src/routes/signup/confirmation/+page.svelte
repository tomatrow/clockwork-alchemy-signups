<script lang="ts">
	import type { PageData } from "./$types"
	import { sortBy, pickBy } from "lodash-es"
	import { getDisplayDate } from "$lib/utility"

	export let data: PageData
</script>

<h1>Confirmation</h1>

<section>	
	<h2>Attendee</h2>
	<p><b>Name:</b> {data.signup.name}</p>
	<p><b>Email:</b> {data.signup.email}</p>
</section>

<section>	
	<h2>Workshops</h2>

	{#each sortBy(pickBy(data.workshops, workshop => data.signup.workshops[workshop.id]?.attending), (workshop) => workshop.start?.getTime() ?? Infinity) as workshop}
		{@const { imageURL, id, cost, description, end, location, paymentInstructions, options, start, name } = workshop}
		{@const option = Object.values(options).find(option => option.value === data.signup.workshops[id]?.option)}

		<fieldset>
			<legend>
				<h2>{name ?? ""}</h2>
			</legend>
	
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
	
			{#if cost}
				<b>Cost</b>: {cost}
			{/if}
	
			{#if paymentInstructions}
				<details>
					<summary>Payment Details</summary>
					{@html paymentInstructions}
				</details>
			{/if}
	
			<details>
				<summary> Workshop Summary </summary>
	
				<div class="description" class:divide={imageURL}>
					{#if imageURL}
						<img src={imageURL} alt={name} />
					{/if}
					<article>
						{@html description}
					</article>
				</div>
	
				{#if option}
					<div class="option">
						<div>
							<h3>Chosen Option</h3>
							<span>{option.value}</span>
						</div>
						{#if option.imageURL}
							<img src={option.imageURL} alt={option.value} />
						{/if}
					</div>
				{/if}
			</details>
		</fieldset>
	{/each}
</section>

<section>
	{@html data.copy.confirmation_page_footer}
</section>

<style lang="scss">
	.description {
		display: flex;
		gap: 1rem;

		&.divide > * {
			width: 50%;
		}
	}

	.option {
		display: flex;
		flex-direction: column;

		img {
			max-width: 25rem;
		}
	}
</style>
