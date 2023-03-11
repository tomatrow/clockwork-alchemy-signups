import {  getCopy, getWorkshops } from "$lib/tables"
import {  getStructuredFormData, isNotNil } from "$lib/utility"
import {  pickBy, size, sortBy } from "lodash-es"
import type { PageServerLoad, Actions } from "./$types"
import { fail, redirect } from "@sveltejs/kit"
import { signup } from "$lib/tables"
import { postmarkClient } from "../../clients"
import type { SignupFormData } from "$lib/types"
import { render } from "svelte-email"
import Confirmation from "$lib/emails/confirmation.svelte"
import { getImageSize } from "$lib/emails/getImageSize"

export const load = (async () => {
	return {}
}) satisfies PageServerLoad

export const actions = {
	async default({ request, cookies }) {
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

		const closedWorkshops = pickBy(chosenWorkshops, (_, id) => {
			const workshop = existingWorkshops[id]!
			const closeDate = workshop.deadline ?? workshop.start
			return closeDate && closeDate < new Date()
		})

		if (size(closedWorkshops)) return fail(400, { workshops: closedWorkshops, closed: true })

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
		
		const signupFormData: SignupFormData = {
			name,
			email,
			workshops
		}
		
		const copy = await getCopy()
		
		const attendingWorkshops = sortBy(pickBy(existingWorkshops, workshop => signupFormData.workshops?.[workshop.id]?.attending), (workshop) => workshop.start?.getTime() ?? Infinity)
		const images: Record<string, string> = Object.fromEntries(
			await Promise.all(
				attendingWorkshops.flatMap(workshop => [workshop.imageURL, ...workshop.options.map(option => option.imageURL)])
				.filter(isNotNil)
				.map(async url => [url, await getImageSize(url)])
			)
		)

		await postmarkClient.sendEmail({
			From: "clockwork_confirmation_test@tomatrow.com",
			To: email,
			Subject: "Clockwork Alchemy Confirmation Test",
			HtmlBody: render({
				template: Confirmation,
				props: {
					signup: signupFormData,
					copy,
					workshops: existingWorkshops,
					images
				}
			})
		})
		
		cookies.set("signup", JSON.stringify(signupFormData), { path: "/" })

		throw redirect(307, '/signup/confirmation')
	}
} satisfies Actions
