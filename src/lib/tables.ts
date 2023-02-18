import Airtable, { type Table, type FieldSet } from "airtable"
import { env } from "$env/dynamic/private"
import { mapValues } from "lodash"
import type { Person, RawPerson, Attendee, Workshop, Leader, RawWorkshop } from "./types"
import { marked } from "marked"
import { isURL } from "./utility"

const base = Airtable.base(env.AIRTABLE_BASE_ID)

enum TableNames {
	"Leaders" = "Leaders",
	"Workshops" = "Workshops",
	"Attendees" = "Attendees",
	"Copy" = "Copy",
	"Assets" = "Assets",
	"Settings" = "Settings"
}

const Tables = mapValues(TableNames, base)

async function getTableData(table: Table<FieldSet>) {
	const rows = await table.select({ view: env.AIRTABLE_API_VIEW_NAME }).all()
	return Object.fromEntries(
		rows.map((row) => [
			row.id,
			{
				...row.fields,
				id: row.id
			}
		])
	)
}

async function getPeople(tableName: TableNames) {
	const rawPeople = (await getTableData(Tables[tableName])) as Record<string, RawPerson>
	return Object.fromEntries(
		Object.values(rawPeople)
			.map((rawPerson): Person => {
				return {
					id: rawPerson.id,
					email: rawPerson.Email,
					name: rawPerson.Name,
					workshopIds: rawPerson.Workshops ?? []
				}
			})
			.map((person) => [person.id, person])
	)
}

export async function getLeaders() {
	return (await getPeople(TableNames.Leaders)) as Record<string, Leader>
}

export async function getAttendees() {
	return (await getPeople(TableNames.Attendees)) as Record<string, Attendee>
}

function parseOptions(rawOptions?: string) {
	if (!rawOptions) return []

	const entries = [
		...rawOptions
			.trim()
			.split("\n")
			.map((line) => line.trim())
			.entries()
	]
	const values = entries.filter(([, item]) => !isURL(item))

	const options = values.map(([index, value]) => {
		const next = entries[index + 1]?.[1]
		return {
			value,
			imageURL: isURL(next) ? next : undefined
		}
	})

	return options
}

export async function getWorkshops(): Promise<Record<string, Workshop>> {
	const rawWorkshops = (await getTableData(Tables.Workshops)) as Record<string, RawWorkshop>

	return Object.fromEntries(
		Object.values(rawWorkshops)
			.map((rawWorkshop): Workshop => {
				return {
					id: rawWorkshop.id,
					slug: rawWorkshop.slug,
					name: rawWorkshop.Name,
					cost: rawWorkshop.Cost,
					attendeeIds: rawWorkshop.Attendees ?? [],
					description: rawWorkshop.Description ? marked(rawWorkshop.Description) : undefined,
					start: rawWorkshop.Start ? new Date(rawWorkshop.Start) : undefined,
					end: rawWorkshop.End ? new Date(rawWorkshop.End) : undefined,
					leaderId: rawWorkshop.Leader?.[0],
					limit: rawWorkshop.Limit,
					location: rawWorkshop.Location,
					options: parseOptions(rawWorkshop.Options),
					paymentInstructions: rawWorkshop["Payment Instructions"]
				}
			})
			.map((workshop) => [workshop.id, workshop])
	)
}
