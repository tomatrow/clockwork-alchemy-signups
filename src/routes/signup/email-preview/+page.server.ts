import type { PageServerLoad } from "./$types"
import { render } from "svelte-email"
import Confirmation from "$lib/emails/confirmation.svelte"
import type { SignupFormData } from "$lib/types"
import { getImageSize } from '$lib/emails/getImageSize'
import { sortBy, pickBy } from "lodash"
import { isNotNil } from "$lib/utility"

export const load = (({ parent, cookies }) => {
	const emailHtml = parent().then(async ({ workshops, copy  }) => {
		const signup = JSON.parse(cookies.get("signup")!) as Required<SignupFormData>
		const attendingWorkshops = sortBy(pickBy(workshops, workshop => signup.workshops?.[workshop.id]?.attending), (workshop) => workshop.start?.getTime() ?? Infinity)
		const images: Record<string, string> = Object.fromEntries(
			await Promise.all(
				attendingWorkshops.flatMap(workshop => [workshop.imageURL, ...workshop.options.map(option => option.imageURL)])
				.filter(isNotNil)
				.map(async url => [url, await getImageSize(url)])
			)
		)

		return render({
			template: Confirmation,
			props: {
				workshops,
				copy,
				signup,
				images
			}
		})
		
	}).catch(error => {
		console.error(error)
		return ""
	})
	return {
		emailHtml
	}
}) satisfies PageServerLoad
