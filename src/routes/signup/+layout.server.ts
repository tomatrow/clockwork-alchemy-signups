import { mapValues } from "lodash-es"
import { error } from "@sveltejs/kit"
import { dev } from "$app/environment"
import { getCopy, getAssets, getLeaders, getWorkshops, getAttendees } from "$lib/tables"
import { getNonsensitiveLeader, getNonsensitiveAttendee } from "$lib/utility"
import type { LayoutServerLoad } from "./$types"

export const load = (async () => {
	if (!dev) throw error(418, "Temporarily disabled")

	console.log("loading signup layout data")

	return {
		copy: getCopy(),
		assets: getAssets(),
		leaders: getLeaders().then((leaders) => mapValues(leaders, getNonsensitiveLeader)),
		workshops: getWorkshops(),
		attendees: getAttendees().then((attendees) => mapValues(attendees, getNonsensitiveAttendee))
	}
}) satisfies LayoutServerLoad
