import { mapValues } from "lodash-es"
import { getCopy, getAssets, getLeaders, getWorkshops, getAttendees } from "$lib/tables"
import { getNonsensitiveLeader, getNonsensitiveAttendee } from "$lib/utility"
import type { LayoutServerLoad } from "./$types"

export const load = (async () => {
	console.log("loading signup layout data")

	return {
		copy: await getCopy(),
		assets: await getAssets(),
		leaders: await getLeaders().then((leaders) => mapValues(leaders, getNonsensitiveLeader)),
		workshops: await getWorkshops(),
		attendees: await getAttendees().then((attendees) =>
			mapValues(attendees, getNonsensitiveAttendee)
		)
	}
}) satisfies LayoutServerLoad
