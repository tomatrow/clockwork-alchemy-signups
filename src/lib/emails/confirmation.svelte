<script lang="ts">
	import { Section, Container, Preview, Head, Body, Html, Img } from "svelty-email"
	import type { SignupFormData, Workshop, Size } from "$lib/types"
	import { sortBy, pickBy } from "lodash-es"
	import { getDisplayDate } from "$lib/utility"

	export let copy: Record<string, string>
	export let signup: SignupFormData
	export let workshops: Record<string, Workshop>
	export let images: Record<string, Size>

	const attendingWorkshops = sortBy(
		pickBy(workshops, (workshop) => signup.workshops?.[workshop.id]?.attending),
		(workshop) => workshop.start?.getTime() ?? Infinity
	)
</script>

<Html lang="en">
	<Head>
		<title>Workshop Confirmation</title>
		<meta name="description" content="Workshop Confirmation" />
	</Head>
	<Preview preview="Workshop Confirmation" />
	<Body>
		<Section>
			<Container>
				<h1>Confirmation</h1>

				<Section>
					<h2>Attendee</h2>
					<p><b>Name:</b> {signup.name}</p>
					<p><b>Email:</b> {signup.email}</p>
				</Section>

				<Section>
					<h2>Workshops</h2>

					{#each attendingWorkshops as workshop}
						{@const {
							imageURL,
							id,
							cost,
							description,
							end,
							location,
							paymentInstructions,
							options,
							start,
							name
						} = workshop}
						{@const option = Object.values(options).find(
							(option) => option.value === signup.workshops?.[id]?.option
						)}

						<fieldset>
							<legend>
								<h3>{name ?? ""}</h3>
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
								<div>
									<h4>Payment Details</h4>
									{@html paymentInstructions}
								</div>
							{/if}

							<div>
								<h3>Workshop Summary</h3>

								<div class="description" class:divide={imageURL}>
									{#if imageURL}
										{@const { width, height } = images[imageURL]}
										<Img src={imageURL} width={300} height={300 * (+height / +width)} alt={name} />
									{/if}

									<div>
										{@html description}
									</div>
								</div>

								{#if option}
									<div class="option">
										<div>
											<h3>Chosen Option</h3>
											<span>{option.value}</span>
										</div>
										{#if option.imageURL}
											{@const { width, height } = images[option.imageURL]}
											<Img
												src={option.imageURL}
												width={300}
												height={300 * (+height / +width)}
												alt={option.value}
											/>
										{/if}
									</div>
								{/if}
							</div>
						</fieldset>
					{/each}
				</Section>

				<Section>
					{@html copy.confirmation_page_footer}
				</Section>
			</Container>
		</Section>
	</Body>
</Html>
