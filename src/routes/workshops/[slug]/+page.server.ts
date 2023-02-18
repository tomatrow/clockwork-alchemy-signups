import type { PageServerLoad } from "./$types"
import { getLeaders, getWorkshops } from "$lib/tables"
import { error } from "@sveltejs/kit"
import { getNonsensitiveLeader } from "$lib/utility"
import { find } from "lodash"

export const load = (async ({ params }) => {
	const leaders = await getLeaders()
	const workshops = await getWorkshops()

	const workshop = find(workshops, (workshop) => workshop.slug === params.slug)

	if (!workshop) throw error(404)

	const leader = workshop.leaderId ? leaders[workshop.leaderId] : undefined

	return {
		leader: leader ? getNonsensitiveLeader(leader) : undefined,
		workshop
	}
}) satisfies PageServerLoad
