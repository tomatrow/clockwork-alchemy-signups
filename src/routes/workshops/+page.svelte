<script lang="ts">
	import type { PageData } from "./$types"
	import { WorkshopTable } from "$lib/components"

	export let data: PageData
</script>

<WorkshopTable {...data} />
