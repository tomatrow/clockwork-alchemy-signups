<script lang="ts">
	import type { PageData, ActionData } from "./$types"
	import { sortBy } from "lodash-es"
	import { getDisplayDate, getWorkshopAvailability } from "$lib/utility"
	import { enhance } from "$app/forms"

	export let data: PageData
	export let form: ActionData

	let attending: Record<string, boolean> = {}
</script>

<form method="POST" use:enhance>	
	{#if data.copy.workshop_signup_page_pre_blurb}
		{@html data.copy.workshop_signup_page_pre_blurb}
	{/if}

	<fieldset>
		<legend>Info</legend>
		<label class="name" class:missing={form?.name && form?.missing}>
			<div>Name</div>
			<input required type="text" name="name" placeholder="your name" />
		</label>
		<label class="email" class:missing={form?.email && form?.missing} class:invalid={form?.email && form?.invalid}>
			<div>Email (We’ll only use this to email you a confirmation of your reservations, nothing else)</div>
			<input required type="email" name="email" placeholder="your email" />
		</label>
	</fieldset>

	{#each sortBy(data.workshops, (workshop) => workshop.start?.getTime() ?? Infinity) as workshop}
		{@const { imageURL, id, cost, description, end, location, paymentInstructions, options, start, name } = workshop}
		{@const prefix = `workshops[${id}]`}
		{@const remaining = getWorkshopAvailability(workshop)}
		{@const isFull = remaining !== undefined && remaining === 0}
		{@const invalidOption = form?.workshops?.[id] && form?.invalidOption}
		{@const closeDate = workshop.deadline ?? workshop.start}
		{@const isClosed = !!closeDate && closeDate < new Date()}
		{@const disabled = isFull || isClosed}

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

			{#if invalidOption}
				<p class="warning">Please choose a valid option</p>
			{/if}

			<details open={invalidOption}>
				<summary> Workshop Summary </summary>

				<div class="description" class:divide={imageURL}>
					{#if imageURL}
						<img src={imageURL} alt={name} />
					{/if}
					<article>
						{@html description}
					</article>
				</div>

				{#if options.length}
					<div class="options">
						{#each options as { value, imageURL }}
							<label>
								<div>
									<input {disabled} required={!!attending[id]} type="radio" name="{prefix}.option" {value} />
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

			<label class="attend-label">
				<input {disabled} type="checkbox" name="{prefix}.attending" bind:checked={attending[id]} />
				<div>{@html (data.copy.workshop_signup_page_rsvp_button_label ?? "RSVP")}</div>
			</label>
		</fieldset>
	{/each}

	<button>Signup</button>
</form>

<style lang="scss">
	.description {
		display: flex;
		gap: 1rem;

		&.divide > * {
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
	
	.attend-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		
		input {
			margin: 0;
		}
		
		:global(p) {
			margin-bottom: 0;
		}
	}

	.warning {
		color: red;
		font: bold;
	}
</style>
