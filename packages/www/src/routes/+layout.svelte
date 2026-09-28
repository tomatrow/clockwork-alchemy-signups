<script lang="ts">
	import 'simpledotcss/simple.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { data, children } = $props();
	let onSignin = $derived(page.url.pathname === '/signin');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Clockwork Alchemy Workshop Signups</title>
</svelte:head>

<header>
	<nav>
		<a href="/">Signups</a>
		{#if data.content.scheduleUrl}
			<a href={data.content.scheduleUrl}>Full schedule</a>
		{/if}
		{#if data.user}
			<span>Signed in as {data.user.name || data.user.email}</span>
			<a href="/signout" data-sveltekit-reload data-sveltekit-preload-data="off">Sign out</a>
		{:else if !onSignin}
			<a href="/signin?next=/">Updating your submission?</a>
		{/if}
	</nav>
	{#if data.content.logo}
		<img src={data.content.logo} alt="Clockwork Alchemy" style="max-height: 8rem;" />
	{/if}
	<h1>Workshop Signups</h1>
</header>

<main>
	{@render children()}
</main>
