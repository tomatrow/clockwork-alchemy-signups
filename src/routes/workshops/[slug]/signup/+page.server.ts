import type { PageServerLoad, Actions } from "./$types"
import { error } from "@sveltejs/kit"
import { find } from "lodash"

export const load = (async ({ parent, params }) => {
	const { workshops, leaders } = await parent()

	const workshop = find(workshops, (workshop) => workshop.slug === params.slug)

	if (!workshop) throw error(404)

	const leader = workshop.leaderId ? leaders[workshop.leaderId] : undefined

	return {
		leader,
		workshop
	}
}) satisfies PageServerLoad

export const actions = {
	async default({ request }) {
		const data = await request.formData()
		const name = data.get("name") as string
		const email = data.get("email") as string
		const option = data.get("option") as string

		console.log({
			name,
			email,
			option
		})
	}
} satisfies Actions
