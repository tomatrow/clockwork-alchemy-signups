import { env } from "$env/dynamic/private"
import Airtable from "airtable"
import type { Handle } from "@sveltejs/kit"

Airtable.configure({
	endpointUrl: "https://api.airtable.com",
	apiKey: env.AIRTABLE_API_KEY
})

export const handle = (async ({ event, resolve }) => {
	const response = await resolve(event)
	return response
}) satisfies Handle
