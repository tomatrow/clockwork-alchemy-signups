import { env } from "$env/dynamic/private"
import { ServerClient } from "postmark"

export let postmarkClient: ServerClient

export function setup() {
	try {
		postmarkClient = new ServerClient(env.POSTMARK_SERVER_TOKEN!)
	} catch (cause) {
		throw new Error("Postmark setup error", {
			cause
		})
	}
}
