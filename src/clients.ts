import { env } from "$env/dynamic/private"
import { ServerClient } from "postmark"
import Airtable from "airtable"

export let postmarkClient: ServerClient

export function setup() {
	Airtable.configure({
		endpointUrl: "https://api.airtable.com",
		apiKey: env.AIRTABLE_API_KEY
	})

	postmarkClient = new ServerClient(env.POSTMARK_SERVER_TOKEN!)
}
