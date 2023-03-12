import Airtable, { type Table, type FieldSet } from "airtable"
import { env } from "$env/dynamic/private"
import { mapValues } from "lodash-es"
import type {
	Asset,
	Copy,
	RawCopy,
	RawAsset,
	Person,
	RawPerson,
	Attendee,
	Workshop,
	Leader,
	RawWorkshop
} from "./types"
import { marked } from "marked"
import { isURL, isNotNil } from "./utility"

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
	try {
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
	} catch (cause) {
		throw new Error(`Failed to load table data: ${table.name}`, {
			cause
		})
	}
}

export async function getAssets() {
	const rawAssets = (await getTableData(Tables.Assets)) as Record<string, RawAsset>

	return Object.fromEntries(
		Object.values(rawAssets)
			.map(({ id, slug, address }): Asset | undefined => {
				address = address?.trim() ?? ""

				const guard = slug && address && isURL(address)

				if (!guard) return

				return {
					id,
					slug,
					address
				}
			})
			.filter(isNotNil)
			.map((asset) => [asset.slug, asset.address])
	)
}

export async function getCopy() {
	const rawCopys = (await getTableData(Tables.Copy)) as Record<string, RawCopy>

	return Object.fromEntries(
		Object.values(rawCopys)
			.map(({ id, slug, value }): Copy | undefined => {
				value = value?.trim() ?? ""

				const guard = slug && value

				if (!guard) return

				value = marked(value)

				return {
					id,
					slug,
					value
				}
			})
			.filter(isNotNil)
			.map((copy) => [copy.slug, copy.value])
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
					imageURL: rawWorkshop.Image,
					cost: rawWorkshop.Cost,
					attendeeIds: rawWorkshop.Attendees ?? [],
					description: rawWorkshop.Description ? marked(rawWorkshop.Description) : undefined,
					start: rawWorkshop.Start ? new Date(rawWorkshop.Start) : undefined,
					end: rawWorkshop.End ? new Date(rawWorkshop.End) : undefined,
					deadline: rawWorkshop.Deadline ? new Date(rawWorkshop.Deadline) : undefined,
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

export async function signup({
	name,
	email,
	workshops
}: {
	name: string
	email: string
	workshops: {
		id: string
		option?: string
	}[]
}) {
	return Tables.Attendees.create({
		Name: name,
		Email: email,
		Workshops: workshops.map(({ id }) => id),
		Options: workshops
			.flatMap(({ id, option }) => [id, option])
			.filter(isNotNil)
			.join("\n")
	})
}
