import { env } from "$env/dynamic/private"
import { ServerClient } from "postmark"
import Airtable from "airtable"

export let postmarkClient: ServerClient

export function setup() {
	try {
		Airtable.configure({
			endpointUrl: "https://api.airtable.com",
			apiKey: env.AIRTABLE_API_KEY
		})
	} catch(cause) {
		throw new Error("Airtable setup error", {
			cause
		})
	}

	try {
		postmarkClient = new ServerClient(env.POSTMARK_SERVER_TOKEN!)
	} catch (cause) {
		throw new Error("Postmark setup error", {
			cause
		})
	}
}
