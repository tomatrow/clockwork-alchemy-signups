<script lang="ts">
	import type { PageData } from "./$types"
	import { getWorkshopTitle } from "$lib/utility"
	import { enhance } from "$app/forms"
	import { page } from "$app/stores"
	export let data: PageData

	console.log({
		data
	})

	$: console.log({
		"$page.form": $page.form
	})
</script>

<h1>{getWorkshopTitle(data.workshop)}</h1>

<p>{@html data.workshop.description}</p>

<form use:enhance method="POST">
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

	{#if data.workshop.options.length}
		<fieldset class="options">
			<legend>Options</legend>
			{#each data.workshop.options as { value, imageURL }}
				<label>
					<div>
						<input required type="radio" name="option" {value} />
						<span>{value}</span>
					</div>
					{#if imageURL}
						<img src={imageURL} alt={value} />
					{/if}
				</label>
			{/each}
		</fieldset>
	{/if}

	<button>Submit</button>
</form>

<style lang="scss">
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
