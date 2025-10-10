<script lang="ts">
	import type { LayoutServerData } from "./$types"

	export let data: LayoutServerData
</script>

<svelte:head>
	<link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" type="text/css" />
</svelte:head>

<header>
	{#if data.assets.logo}
		<img alt="logo" src={data.assets.logo} />
	{/if}
</header>

<main>
	<slot />
</main>

<footer></footer>
