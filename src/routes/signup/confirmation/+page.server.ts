import type { SignupFormData } from "$lib/types"
import type { PageServerLoad } from "./$types"
import { fail } from "@sveltejs/kit"

export const load = (async ({ cookies }) => {
	try {
		return {
			signup: JSON.parse(cookies.get("signup")!) as Required<SignupFormData>
		}
	} catch (error) {
		console.error(error)
	}

	throw fail(400)
}) satisfies PageServerLoad
