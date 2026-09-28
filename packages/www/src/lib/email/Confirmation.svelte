<script lang="ts">
	// Email chrome (svelty-email) around the same summary the /confirmation
	// page renders. Rendered server-side only, via svelty-email's render().
	import { Html, Head, Preview, Body, Container, Section } from 'svelty-email';
	import SignupSummary from '#lib/components/SignupSummary.svelte';
	import type { SummaryItem } from '#lib/workshops.js';

	let {
		name,
		email,
		items,
		footer,
		signupUrl
	}: {
		name: string;
		email: string;
		items: SummaryItem[];
		footer: string;
		signupUrl: string;
	} = $props();
</script>

<Html lang="en">
	<Head>
		<title>Workshop Confirmation</title>
	</Head>
	<Preview preview="Your Clockwork Alchemy workshop signups" />
	<Body style={{ fontFamily: 'Helvetica, Arial, sans-serif', color: '#222' }}>
		<Section>
			<Container>
				<h1>Workshop Confirmation</h1>
				<p>
					This is your complete list of workshop signups. To change anything, go to
					<a href={signupUrl}>{signupUrl}</a> and choose “Updating your submission?”.
				</p>

				<SignupSummary {name} {email} {items} {footer} />
			</Container>
		</Section>
	</Body>
</Html>
