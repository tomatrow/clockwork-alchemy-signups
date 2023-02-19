<script lang="ts">
	import type { PageData, ActionData } from "./$types"
	import { sortBy } from "lodash"
	import { getDisplayDate, getWorkshopAvailability } from "$lib/utility"
	import { enhance } from "$app/forms"

	export let data: PageData
	export let form: ActionData

	let attending: Record<string, boolean> = {}
</script>

{#if form}
	{#if form.success}
		Success
	{:else}
		Failure:

		{#if form.name}
			missing name
		{:else if form.email}
			{#if form.missing}
				missing
			{:else if form.invalid}
				invalid
			{/if}

			email
		{:else if form.workshops}
			{#if form.missing}
				missing
			{:else if form.nonexistant}
				nonexistant
			{:else if form.invalidOption}
				invalidOption
			{:else if form.full}
				full
			{/if}

			workshops
		{/if}
	{/if}
{/if}

<form method="POST" use:enhance>
	<fieldset>
		<legend>Info</legend>
		<label>
			<div>Name</div>
			<input required type="text" name="name" placeholder="your name" />
		</label>
		<label>
			<div>Email (we'll email you a copy of your reservations)</div>
			<input required type="email" name="email" placeholder="your email" />
		</label>
	</fieldset>

	{#each sortBy(data.workshops, (workshop) => workshop.start?.getTime() ?? Infinity) as workshop}
		{@const { imageURL, id, cost, description, end, location, paymentInstructions, options, start, name } = workshop}
		{@const prefix = `workshops[${id}]`}
		{@const remaining = getWorkshopAvailability(workshop)}
		{@const isFull = remaining !== undefined && remaining === 0}

		<fieldset>
			<legend>
				<h2>{name ?? ""}</h2>
			</legend>

			<div>{remaining ?? "-"} spots remaining</div>

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

				<div class="description">
					<img src={imageURL} alt={name} />
					<article>
						{@html description}
					</article>
				</div>

				{#if options.length}
					<div class="options">
						{#each options as { value, imageURL }}
							<label>
								<div>
									<input disabled={isFull} required={!!attending[id]} type="radio" name="{prefix}.option" {value} />
									<span>{value}</span>
								</div>
								{#if imageURL}
									<img src={imageURL} alt={value} />
								{/if}
							</label>
						{/each}
					</div>
				{/if}
			</details>

			<label>
				<input disabled={isFull} type="checkbox" name="{prefix}.attending" bind:checked={attending[id]} />
				<span>Attend</span>
			</label>
		</fieldset>
	{/each}

	<button>Signup</button>
</form>

<style lang="scss">
	.description {
		display: flex;
		gap: 1rem;
		& > * {
			width: 50%;
		}
	}

	.options {
		label {
			display: flex;
			flex-direction: column;

			img {
				max-width: 25rem;
			}
		}
	}
</style>
