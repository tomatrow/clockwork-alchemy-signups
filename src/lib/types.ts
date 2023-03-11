export interface RawAsset {
	id: string
	slug?: string
	address?: string
}

export interface Asset {
	id: string
	slug: string
	address: string
}

export interface Copy {
	id: string
	slug: string
	value: string
}

export interface RawCopy {
	id: string
	slug?: string
	value?: string
}

export interface RawPerson {
	id: string
	Email?: string
	Name?: string
	Workshops?: string[]
}

export interface RawLeader extends RawPerson {}

export interface RawAttendee extends RawPerson {}

export interface RawWorkshop {
	id: string
	slug?: string
	Name?: string
	Description?: string
	Image?: string
	Location?: string
	Start?: string
	End?: string
	Deadline?: string
	Limit?: number
	Cost?: string
	"Payment Instructions"?: string
	Options?: string
	Leader?: string[]
	Attendees?: string[]
}

export interface Person {
	id: string
	email?: string
	name?: string
	workshopIds: string[]
}

export interface Leader extends Person {}

export interface Workshop {
	id: string
	slug?: string
	name?: string
	description?: string
	imageURL?: string
	location?: string
	start?: Date
	end?: Date
	deadline?: Date
	limit?: number
	cost?: string
	paymentInstructions?: string
	options: {
		value: string
		imageURL?: string
	}[]
	leaderId?: string
	attendeeIds: string[]
}

export interface Attendee extends Person {}

export type NonsensitiveAttendee = Omit<Attendee, "email" | "name">

export type NonsensitiveLeader = Omit<Leader, "email">

export interface SignupFormData {
	name?: string
	email?: string
	workshops?: Record<
		string,
		{
			attending?: "on"
			option?: string
		}
	>
}

export type Size = {
	width: number
	height: number
}