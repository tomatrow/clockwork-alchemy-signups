import { getCopy, getAssets, getLeaders, getWorkshops, getAttendees } from "$lib/tables"
import { getNonsensitiveLeader, getNonsensitiveAttendee} from "$lib/utility"
import { mapValues } from "lodash"
import type { LayoutServerLoad } from "./$types"

export const load = (async () => {
	return {
		copy: getCopy(),
		assets: getAssets(),
		leaders: getLeaders().then((leaders) => mapValues(leaders, getNonsensitiveLeader)),
		workshops: getWorkshops(),
		attendees: getAttendees().then((attendees) => mapValues(attendees, getNonsensitiveAttendee))
	}	
}) satisfies LayoutServerLoad
