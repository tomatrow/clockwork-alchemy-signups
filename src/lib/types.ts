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
	Location?: string
	Start?: string
	End?: string
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
	location?: string
	start?: Date
	end?: Date
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
