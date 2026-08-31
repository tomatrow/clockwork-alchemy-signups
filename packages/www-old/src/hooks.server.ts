import type { Handle, HandleServerError } from "@sveltejs/kit"
import { setup } from "./clients"
import { Airtable } from "$lib/tables"

setup()

export const handle = (async ({ event, resolve }) => {
	Airtable.fetch = event.fetch
	console.log(`loading: ${event.url}`)
	const response = await resolve(event)
	console.log(`loaded: ${event.url}`)
	return response
}) satisfies Handle

export const handleError = (({ error }) => {
	console.error(error)
}) satisfies HandleServerError
