import type { Workshop } from "./types"
import { startCase } from "lodash-es"
import { formatInTimeZone } from "date-fns-tz"
import { set, omit, mapValues, filter } from "lodash-es"
import type { Attendee, NonsensitiveAttendee, Leader, NonsensitiveLeader } from "$lib/types"

export function formatMoney(amount: number) {
	return new Intl.NumberFormat("en-us", {
		style: "currency",
		currency: "USD"
	}).format(amount)
}

export function isNotNil<T>(value: T | undefined | null): value is T {
	return value !== null && value !== undefined
}

export function getWorkshopTitle<T extends Pick<Workshop, "slug" | "name">>(workshop: T) {
	return workshop.name ?? startCase(workshop.slug ?? "Workshop")
}

export function getDisplayDate(date?: Date) {
	return date ? formatInTimeZone(date, "America/Los_Angeles", "E h:mm a") : "-"
}

export function getAttendanceByWorkshopId({
	workshops,
	attendees
}: {
	workshops: Record<string, Workshop>
	attendees: Record<string, Attendee>
}): Record<string, number> {
	return mapValues(workshops, ({ id }) => filter(attendees, (attendee) => attendee.workshopIds.includes(id)).length)
}

export function getWorkshopAvailability(workshop: Workshop) {
	if (workshop.limit === undefined) return
	return Math.max(0, workshop.limit - workshop.attendeeIds.length)
}

export function getNonsensitiveAttendee(attendee: Attendee): NonsensitiveAttendee {
	return omit(attendee, "email", "name")
}

export function getNonsensitiveLeader(leader: Leader): NonsensitiveLeader {
	return omit(leader, "email")
}

export function isURL(value: string) {
	try {
		new URL(value)
		return true
	} catch {
		return false
	}
}

type StructuredFormDataValue = FormDataEntryValue | { [key: string]: StructuredFormDataValue }
export type StructuredFormData = Record<string, StructuredFormDataValue>

export function getStructuredFormData(formData: FormData) {
	const data: StructuredFormData = {}
	formData.forEach((value, path) => set(data, path, value))
	return data
}
