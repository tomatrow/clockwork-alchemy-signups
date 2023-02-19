import type { Handle } from "@sveltejs/kit"
import { setup } from "./clients"

setup()

export const handle = (async ({ event, resolve }) => {
	const response = await resolve(event)
	return response
}) satisfies Handle
