<script lang="ts">
	import { sortBy } from "lodash-es"
	import { getWorkshopTitle, getDisplayDate, getWorkshopAvailability } from "$lib/utility"
	import type { Workshop } from "$lib/types"

	export let workshops: Record<string, Workshop>
</script>

<table>
	<thead>
		<tr>
			<th>Name</th>
			<th>Start</th>
			<th>End</th>
			<th>Availability</th>
			<th />
		</tr>
	</thead>

	<tbody>
		{#each sortBy(workshops, (workshop) => workshop.start?.getTime() ?? Infinity) as { id, slug, name, start, end }}
			<tr>
				<th
					>{getWorkshopTitle({
						slug,
						name
					})}</th
				>
				<td>{getDisplayDate(start)}</td>
				<td>{getDisplayDate(end)}</td>
				<td>{getWorkshopAvailability(workshops[id]) ?? "-"}</td>
				<td>
					{#if slug}
						<a href="/workshops/{slug}">View</a>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	th,
	td {
		text-align: left;
	}
</style>
