import type { Handle, HandleServerError } from "@sveltejs/kit"
import { setup } from "./clients"
import crypto from "crypto"

setup()

export const handle = (async ({ event, resolve }) => {
	const response = await resolve(event)
	return response
}) satisfies Handle

export const handleError = (({ error, event }) => {
	const errorId = crypto.randomUUID()

	console.log({
		errorId,
		error,
		json: JSON.stringify(event, null, 2)
	})
}) satisfies HandleServerError
