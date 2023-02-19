import { getLeaders, getWorkshops, getAttendees } from "$lib/tables"
import { getNonsensitiveLeader, getNonsensitiveAttendee, getStructuredFormData } from "$lib/utility"
import { mapValues, pickBy, size } from "lodash"
import type { PageServerLoad, Actions } from "./$types"
import { fail } from "@sveltejs/kit"
import { signup } from "$lib/tables"
import { postmarkClient } from "../../clients"

export const load = (async () => {
	return {
		leaders: getLeaders().then((leaders) => mapValues(leaders, getNonsensitiveLeader)),
		workshops: getWorkshops(),
		attendees: getAttendees().then((attendees) => mapValues(attendees, getNonsensitiveAttendee))
	}
}) satisfies PageServerLoad

interface SignupFormData {
	name?: string
	email?: string
	workshops?: Record<
		string,
		{
			attending?: "on"
			option?: string
		}
	>
}

export const actions = {
	async default({ request }) {
		const { name = "", email = "", workshops = {} } = getStructuredFormData(await request.formData()) as SignupFormData

		if (!name) return fail(400, { name, missing: true })

		if (!email) return fail(400, { email, missing: true })

		if (!/^[^@ \t\r\n]+@[^@ \t\r\n]+\.[^@ \t\r\n]+/.test(email)) return fail(400, { email, invalid: true })

		const chosenWorkshops = pickBy(workshops ?? {}, (workshop) => workshop.attending === "on")

		if (!size(chosenWorkshops)) return fail(400, { workshops: chosenWorkshops, missing: true })

		const existingWorkshops = await getWorkshops()

		const nonexistantWorkshops = pickBy(chosenWorkshops, (_, id) => !existingWorkshops[id])

		if (size(nonexistantWorkshops)) return fail(400, { workshops: nonexistantWorkshops, nonexistant: true })

		const invalidOptionWorkshops = pickBy(chosenWorkshops, ({ option }, id) => {
			const optionPool = existingWorkshops[id]?.options

			return optionPool?.length
				? !optionPool.some((existingOption) => existingOption.value === option)
				: option !== undefined
		})

		if (size(invalidOptionWorkshops)) return fail(400, { workshops: invalidOptionWorkshops, invalidOption: true })

		const fullWorkshops = pickBy(chosenWorkshops, (_, id) => {
			const workshop = existingWorkshops[id]!
			return workshop.limit !== undefined && workshop.attendeeIds.length >= workshop.limit
		})

		if (size(fullWorkshops)) return fail(400, { workshops: fullWorkshops, full: true })

		await signup({
			name,
			email,
			workshops: Object.entries(chosenWorkshops).map(([id, { option }]) => ({ id, option }))
		})
		
		await postmarkClient.sendEmail({
			From: "clockwork_confirmation_test@tomatrow.com",
			To: email,
			Subject: "Clockwork Alchemy Confirmation Test",
			TextBody: `
				Success
				
				${JSON.stringify({
					name,
					email,
					workshops: chosenWorkshops
				})}
			`
		})

		return { success: true }
	}
} satisfies Actions
